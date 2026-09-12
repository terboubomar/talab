import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { formatSAR } from "@/lib/menu";
import { usePermissions } from "@/lib/permissions";
import { fetchCashbackProgram, saveCashbackProgram } from "@/lib/cashback";

export const Route = createFileRoute("/_staffShell/admin/cashback")({
  head: () => ({ meta: [{ title: "الكاش باك — طلب" }] }),
  component: CashbackPage,
});

type FormState = {
  active: boolean;
  percent: string;
  cap: string;
  minOrder: string;
  validFrom: string;
  validTo: string;
};

const DEFAULTS: FormState = {
  active: false,
  percent: "5",
  cap: "",
  minOrder: "0",
  validFrom: "",
  validTo: "",
};

/** ISO timestamp -> value accepted by <input type="datetime-local"> (local time). */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIso(local: string): string | null {
  const trimmed = local.trim();
  if (trimmed === "") return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function CashbackPage() {
  const { loading: permissionsLoading, can } = usePermissions();
  const queryClient = useQueryClient();
  const canManage = can("marketing.cashback");

  const {
    data: program,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["admin_cashback_program"],
    queryFn: fetchCashbackProgram,
    enabled: !permissionsLoading && canManage,
  });

  const [form, setForm] = useState<FormState>(DEFAULTS);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!program) return;
    setForm({
      active: program.active,
      percent: String(program.percent),
      cap: program.cap == null ? "" : String(program.cap),
      minOrder: String(program.min_order),
      validFrom: toLocalInput(program.valid_from),
      validTo: toLocalInput(program.valid_to),
    });
  }, [program]);

  const percentValue = Number(form.percent);
  const capValue = form.cap.trim() === "" ? null : Number(form.cap);
  const rawExample =
    Number.isFinite(percentValue) && percentValue > 0 ? (100 * percentValue) / 100 : 0;
  const exampleCashback =
    capValue != null && Number.isFinite(capValue) && capValue > 0
      ? Math.min(rawExample, capValue)
      : rawExample;

  if (permissionsLoading) {
    return (
      <div className="p-6">
        <div className="card-surface h-28 animate-pulse opacity-60" />
      </div>
    );
  }

  if (!canManage) {
    return (
      <main className="p-6">
        <div className="card-surface p-6 text-center text-sm font-bold text-danger">
          لا تملك صلاحية إدارة الكاش باك
        </div>
      </main>
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSaved(false);

    const percent = Number(form.percent);
    const capRaw = form.cap.trim();
    const cap = capRaw === "" ? null : Number(capRaw);
    const minOrder = Number(form.minOrder);
    const validFrom = toIso(form.validFrom);
    const validTo = toIso(form.validTo);

    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      setFormError("نسبة الكاش باك يجب أن تكون بين صفر و100");
      return;
    }
    if (form.active && percent <= 0) {
      setFormError("عند التفعيل يجب أن تكون النسبة أكبر من صفر");
      return;
    }
    if (cap !== null && (!Number.isFinite(cap) || cap <= 0)) {
      setFormError("الحد الأقصى يجب أن يكون أكبر من صفر أو فارغاً");
      return;
    }
    if (!Number.isFinite(minOrder) || minOrder < 0) {
      setFormError("الحد الأدنى لقيمة الطلب يجب أن يكون صفراً أو أكثر");
      return;
    }
    if (validFrom && validTo && new Date(validTo) <= new Date(validFrom)) {
      setFormError("تاريخ الانتهاء يجب أن يكون بعد تاريخ البداية");
      return;
    }

    setSubmitting(true);
    try {
      await saveCashbackProgram({
        percent,
        cap,
        minOrder,
        validFrom,
        validTo,
        active: form.active,
      });
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ["admin_cashback_program"] });
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "تعذّر حفظ الإعدادات");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen pb-12">
      <header className="border-b border-border bg-background px-5 py-5">
        <div className="mb-1 text-xs text-muted-foreground">
          <Link to="/admin/marketing-tools" className="hover:text-foreground hover:underline">
            أدوات التسويق
          </Link>
          <span className="mx-1">›</span>
          <span className="font-bold text-foreground">إعدادات الكاش باك</span>
        </div>
        <h1 className="text-lg font-extrabold">إعدادات الكاش باك</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          الكاش باك يُضاف إلى محفظة العميل بعد إكمال الطلب فقط، وكل حركة محفظة مسجّلة في سجل
          غير قابل للتعديل.
        </p>
      </header>

      <div className="space-y-4 px-5 py-6">
        {error ? (
          <div className="card-surface p-6 text-center text-sm font-bold text-danger">
            تعذّر تحميل إعدادات الكاش باك
          </div>
        ) : isLoading ? (
          <div className="card-surface h-64 animate-pulse opacity-60" />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
            <form onSubmit={handleSubmit} className="card-surface space-y-4 p-5">
              <label className="flex items-center gap-2 text-sm font-bold">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                  className="size-4"
                />
                تفعيل برنامج الكاش باك
              </label>

              <label className="grid gap-1 text-xs font-bold text-muted-foreground">
                نسبة الكاش باك %
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={form.percent}
                  onChange={(e) => setForm((f) => ({ ...f, percent: e.target.value }))}
                  className="rounded-card border border-border bg-background px-3 py-2 text-sm font-bold text-foreground"
                />
              </label>

              <label className="grid gap-1 text-xs font-bold text-muted-foreground">
                الحد الأقصى للكاش باك لكل طلب (ر.س)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.cap}
                  onChange={(e) => setForm((f) => ({ ...f, cap: e.target.value }))}
                  className="rounded-card border border-border bg-background px-3 py-2 text-sm font-bold text-foreground"
                />
                <span className="text-[11px] font-normal">اتركه فارغاً بدون حد أقصى</span>
              </label>

              <label className="grid gap-1 text-xs font-bold text-muted-foreground">
                الحد الأدنى لقيمة الطلب المؤهلة (ر.س)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.minOrder}
                  onChange={(e) => setForm((f) => ({ ...f, minOrder: e.target.value }))}
                  className="rounded-card border border-border bg-background px-3 py-2 text-sm font-bold text-foreground"
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-xs font-bold text-muted-foreground">
                  يبدأ من
                  <input
                    type="datetime-local"
                    value={form.validFrom}
                    onChange={(e) => setForm((f) => ({ ...f, validFrom: e.target.value }))}
                    className="rounded-card border border-border bg-background px-3 py-2 text-sm font-bold text-foreground"
                  />
                </label>
                <label className="grid gap-1 text-xs font-bold text-muted-foreground">
                  ينتهي في
                  <input
                    type="datetime-local"
                    value={form.validTo}
                    onChange={(e) => setForm((f) => ({ ...f, validTo: e.target.value }))}
                    className="rounded-card border border-border bg-background px-3 py-2 text-sm font-bold text-foreground"
                  />
                </label>
              </div>

              {formError ? <p className="text-xs font-bold text-danger">{formError}</p> : null}
              {saved ? <p className="text-xs font-bold text-success">تم حفظ الإعدادات</p> : null}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-card bg-brand px-4 py-2.5 text-sm font-extrabold text-brand-ink disabled:opacity-60"
              >
                {submitting ? "جاري الحفظ…" : "حفظ الإعدادات"}
              </button>
            </form>

            <div className="card-surface space-y-3 p-5">
              <p className="text-sm font-extrabold">مثال</p>
              <p className="text-[11px] text-muted-foreground">
                مثال فقط — محسوب من المدخلات الحالية ولا يُحفظ.
              </p>
              <div className="rounded-card bg-secondary p-4">
                <p className="text-xs font-bold text-muted-foreground">
                  إنفاق مؤهل على المنتجات بقيمة {formatSAR(100)}
                </p>
                <p className="mt-1 text-xl font-extrabold">{formatSAR(exampleCashback)}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  كاش باك مقدَّر يُضاف إلى المحفظة بعد إكمال الطلب.
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground">
                رسوم التوصيل غير محسوبة في الإنفاق المؤهل.
              </p>
              <p className="text-[11px] text-muted-foreground">
                الدفع من المحفظة لا يقلّل الكاش باك، لأن المحفظة وسيلة دفع فقط.
              </p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
