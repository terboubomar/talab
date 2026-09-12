import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { formatSAR } from "@/lib/menu";
import { usePermissions } from "@/lib/permissions";
import { fetchLoyaltyProgram, saveLoyaltyProgram } from "@/lib/loyalty";

export const Route = createFileRoute("/_staffShell/admin/loyalty")({
  head: () => ({ meta: [{ title: "نقاط الولاء — طلب" }] }),
  component: LoyaltyPage,
});

type FormState = {
  active: boolean;
  earnRate: string;
  redeemRate: string;
  minRedeem: string;
  expiryDays: string;
};

const DEFAULTS: FormState = {
  active: false,
  earnRate: "1",
  redeemRate: "0.10",
  minRedeem: "0",
  expiryDays: "",
};

function LoyaltyPage() {
  const { loading: permissionsLoading, can } = usePermissions();
  const queryClient = useQueryClient();
  const canManage = can("marketing.loyalty");

  const {
    data: program,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["admin_loyalty_program"],
    queryFn: fetchLoyaltyProgram,
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
      earnRate: String(program.earn_rate),
      redeemRate: String(program.redeem_rate),
      minRedeem: String(program.min_redeem),
      expiryDays: program.expiry_days == null ? "" : String(program.expiry_days),
    });
  }, [program]);

  const earnRate = Number(form.earnRate);
  const redeemRate = Number(form.redeemRate);
  const examplePoints = Number.isFinite(earnRate) && earnRate >= 0 ? earnRate * 100 : 0;
  const exampleValue = Number.isFinite(redeemRate) && redeemRate > 0 ? redeemRate * 100 : 0;

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
          لا تملك صلاحية إدارة نقاط الولاء
        </div>
      </main>
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSaved(false);

    const earn = Number(form.earnRate);
    const redeem = Number(form.redeemRate);
    const min = Number(form.minRedeem);
    const expiryRaw = form.expiryDays.trim();
    const expiry = expiryRaw === "" ? null : Number(expiryRaw);

    if (!Number.isFinite(earn) || earn < 0) {
      setFormError("أدخل عدد نقاط صحيحاً (صفر أو أكثر)");
      return;
    }
    if (!Number.isFinite(redeem) || redeem <= 0) {
      setFormError("قيمة النقطة يجب أن تكون أكبر من صفر");
      return;
    }
    if (!Number.isFinite(min) || min < 0) {
      setFormError("الحد الأدنى للنقاط يجب أن يكون صفراً أو أكثر");
      return;
    }
    if (expiry !== null && (!Number.isInteger(expiry) || expiry <= 0)) {
      setFormError("صلاحية النقاط يجب أن تكون عدد أيام صحيحاً أكبر من صفر");
      return;
    }

    setSubmitting(true);
    try {
      await saveLoyaltyProgram({
        earnRate: earn,
        redeemRate: redeem,
        minRedeem: min,
        expiryDays: expiry,
        active: form.active,
      });
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ["admin_loyalty_program"] });
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "تعذّر حفظ الإعدادات");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen pb-12">
      <header className="border-b border-border bg-background px-5 py-5">
        <h1 className="text-lg font-extrabold">إعدادات نقاط الولاء</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          النقاط تُمنح تلقائياً بعد إكمال الطلب فقط، وكل حركة نقاط مسجّلة في سجل غير قابل للتعديل.
        </p>
      </header>

      <div className="space-y-4 px-5 py-6">
        {error ? (
          <div className="card-surface p-6 text-center text-sm font-bold text-danger">
            تعذّر تحميل إعدادات الولاء
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
                تفعيل برنامج الولاء
              </label>

              <label className="grid gap-1 text-xs font-bold text-muted-foreground">
                نقاط مكتسبة لكل 1 ر.س
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.earnRate}
                  onChange={(e) => setForm((f) => ({ ...f, earnRate: e.target.value }))}
                  className="rounded-card border border-border bg-background px-3 py-2 text-sm font-bold text-foreground"
                />
              </label>

              <label className="grid gap-1 text-xs font-bold text-muted-foreground">
                قيمة النقطة عند الاستبدال (ر.س)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.redeemRate}
                  onChange={(e) => setForm((f) => ({ ...f, redeemRate: e.target.value }))}
                  className="rounded-card border border-border bg-background px-3 py-2 text-sm font-bold text-foreground"
                />
              </label>

              <label className="grid gap-1 text-xs font-bold text-muted-foreground">
                الحد الأدنى للنقاط للاستبدال
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.minRedeem}
                  onChange={(e) => setForm((f) => ({ ...f, minRedeem: e.target.value }))}
                  className="rounded-card border border-border bg-background px-3 py-2 text-sm font-bold text-foreground"
                />
              </label>

              <label className="grid gap-1 text-xs font-bold text-muted-foreground">
                صلاحية النقاط بالأيام
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.expiryDays}
                  onChange={(e) => setForm((f) => ({ ...f, expiryDays: e.target.value }))}
                  className="rounded-card border border-border bg-background px-3 py-2 text-sm font-bold text-foreground"
                />
                <span className="text-[11px] font-normal">
                  اتركه فارغاً لعدم انتهاء الصلاحية
                </span>
              </label>

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
              <p className="text-sm font-extrabold">مثال توضيحي</p>
              <p className="text-[11px] text-muted-foreground">
                مثال فقط — الأرقام محسوبة من المدخلات الحالية ولا تُحفظ.
              </p>
              <div className="rounded-card bg-secondary p-4">
                <p className="text-xs font-bold text-muted-foreground">
                  إنفاق مؤهل بقيمة {formatSAR(100)}
                </p>
                <p className="mt-1 text-xl font-extrabold">
                  {examplePoints.toLocaleString("ar-SA", { maximumFractionDigits: 2 })} نقطة
                </p>
              </div>
              <div className="rounded-card bg-secondary p-4">
                <p className="text-xs font-bold text-muted-foreground">قيمة 100 نقطة</p>
                <p className="mt-1 text-xl font-extrabold">{formatSAR(exampleValue)}</p>
              </div>
              <p className="text-[11px] text-muted-foreground">
                ترتيب الحساب في السلة: الكوبون ثم النقاط ثم المحفظة ثم رسوم التوصيل.
              </p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
