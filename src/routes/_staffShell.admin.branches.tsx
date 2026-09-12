import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock3, MapPin, Phone, Store, TimerReset } from "lucide-react";

import {
  fetchStaffBranchOperations,
  setBranchBusyUntil,
  type StaffBranchOperation,
} from "@/lib/branch-operations";
import { usePermissions } from "@/lib/permissions";

export const Route = createFileRoute("/_staffShell/admin/branches")({
  head: () => ({ meta: [{ title: "الفروع — طلب" }] }),
  component: BranchOperationsPage,
});

const QUICK_MINUTES = [15, 30, 60, 90] as const;

function formatBusyUntil(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
    timeZone: "Asia/Riyadh",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function riyadhInputToIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00+03:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function defaultCustomTime() {
  const target = new Date(Date.now() + 30 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(target);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function BranchOperationsPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const canToggle = can("branches.busy.toggle");
  const [customTimes, setCustomTimes] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<string | null>(null);

  const { data: branches = [], isLoading, isError, error } = useQuery({
    queryKey: ["staff_branch_operations"],
    queryFn: fetchStaffBranchOperations,
    refetchInterval: 30_000,
  });

  const mutation = useMutation({
    mutationFn: ({ branchId, busyUntil }: { branchId: string; busyUntil: string | null }) =>
      setBranchBusyUntil(branchId, busyUntil),
    onSuccess: (_data, variables) => {
      setFeedback(variables.busyUntil ? "تم تحديث حالة الفرع" : "الفرع متاح للطلب الآن");
      queryClient.invalidateQueries({ queryKey: ["staff_branch_operations"] });
      window.setTimeout(() => setFeedback(null), 2500);
    },
  });

  const busyCount = useMemo(() => branches.filter((branch) => branch.busy).length, [branches]);

  function setBusyFor(branch: StaffBranchOperation, minutes: number) {
    const until = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    mutation.mutate({ branchId: branch.id, busyUntil: until });
  }

  function saveCustom(branch: StaffBranchOperation) {
    const value = customTimes[branch.id] || defaultCustomTime();
    const iso = riyadhInputToIso(value);
    if (!iso || new Date(iso).getTime() <= Date.now()) {
      setFeedback("اختر وقتاً مستقبلياً صالحاً");
      return;
    }
    mutation.mutate({ branchId: branch.id, busyUntil: iso });
  }

  return (
    <main className="min-h-screen pb-10" dir="rtl">
      <header className="sticky top-0 z-20 border-b border-border bg-background px-5 py-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-base font-extrabold">الفروع</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              تحكم مؤقت بحالة استقبال الطلبات. الحالة تنتهي تلقائياً عند الوقت المحدد.
            </p>
          </div>
          <div className="flex gap-2 text-xs">
            <span className="rounded-pill bg-success/10 px-3 py-1.5 font-bold text-success">
              {branches.length - busyCount} متاح
            </span>
            <span className="rounded-pill bg-warning/10 px-3 py-1.5 font-bold text-warning">
              {busyCount} مشغول
            </span>
          </div>
        </div>
      </header>

      <div className="px-5 py-6">
        {feedback ? (
          <div className="mb-4 rounded-card bg-secondary px-4 py-3 text-sm font-bold text-foreground">
            {feedback}
          </div>
        ) : null}

        {mutation.isError ? (
          <div className="mb-4 rounded-card bg-destructive/10 px-4 py-3 text-sm font-bold text-destructive">
            تعذّر تحديث حالة الفرع. تحقق من الصلاحية وحاول مرة أخرى.
          </div>
        ) : null}

        {isLoading ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {[0, 1].map((item) => <div key={item} className="card-surface h-64 animate-pulse opacity-60" />)}
          </div>
        ) : isError ? (
          <div className="card-surface p-6 text-center">
            <p className="font-bold">تعذّر تحميل الفروع</p>
            <p className="mt-1 text-xs text-muted-foreground">{error instanceof Error ? error.message : "حاول مرة أخرى"}</p>
          </div>
        ) : branches.length === 0 ? (
          <div className="card-surface p-8 text-center text-sm text-muted-foreground">لا توجد فروع متاحة لحسابك.</div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {branches.map((branch) => {
              const inactive = branch.status !== "active";
              const busyUntil = branch.busy ? formatBusyUntil(branch.busy_until) : "";
              const pending = mutation.isPending && mutation.variables?.branchId === branch.id;
              const customValue = customTimes[branch.id] ?? defaultCustomTime();

              return (
                <article key={branch.id} className="card-surface p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="grid size-11 shrink-0 place-items-center rounded-pill bg-secondary text-brand">
                        <Store className="size-5" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <h2 className="truncate text-sm font-extrabold">{branch.name_ar}</h2>
                        {branch.name_en ? <p className="mt-0.5 truncate text-xs text-muted-foreground" dir="ltr">{branch.name_en}</p> : null}
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          {branch.city_ar ? <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" aria-hidden />{branch.city_ar}</span> : null}
                          {branch.phone ? <span className="inline-flex items-center gap-1" dir="ltr"><Phone className="size-3.5" aria-hidden />{branch.phone}</span> : null}
                        </div>
                      </div>
                    </div>

                    <span className={`shrink-0 rounded-pill px-3 py-1.5 text-xs font-bold ${inactive ? "bg-secondary text-muted-foreground" : branch.busy ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}`}>
                      {inactive ? "غير نشط" : branch.busy ? "مشغول" : "متاح"}
                    </span>
                  </div>

                  {branch.busy ? (
                    <div className="mt-4 flex items-center gap-2 rounded-card bg-warning/10 px-4 py-3 text-sm font-bold text-warning">
                      <Clock3 className="size-4" aria-hidden />
                      <span>{busyUntil ? `مشغول حتى ${busyUntil}` : "مشغول حالياً"}</span>
                    </div>
                  ) : (
                    <div className="mt-4 flex items-center gap-2 rounded-card bg-success/10 px-4 py-3 text-sm font-bold text-success">
                      <CheckCircle2 className="size-4" aria-hidden />
                      <span>يستقبل الطلبات الآن</span>
                    </div>
                  )}

                  {canToggle && !inactive ? (
                    <div className="mt-5 border-t border-border pt-4">
                      <p className="mb-2 text-xs font-bold text-muted-foreground">اجعله مشغولاً لمدة</p>
                      <div className="grid grid-cols-4 gap-2">
                        {QUICK_MINUTES.map((minutes) => (
                          <button
                            key={minutes}
                            type="button"
                            disabled={mutation.isPending}
                            onClick={() => setBusyFor(branch, minutes)}
                            className="min-h-11 rounded-card border border-border px-2 text-xs font-bold hover:border-brand hover:text-brand disabled:opacity-50"
                          >
                            {minutes} د
                          </button>
                        ))}
                      </div>

                      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                        <label className="min-w-0">
                          <span className="sr-only">وقت مخصص لانتهاء حالة الانشغال</span>
                          <input
                            type="datetime-local"
                            value={customValue}
                            onChange={(event) => setCustomTimes((current) => ({ ...current, [branch.id]: event.target.value }))}
                            className="min-h-11 w-full rounded-card border border-border bg-background px-3 text-sm outline-none focus:border-brand"
                          />
                        </label>
                        <button
                          type="button"
                          disabled={mutation.isPending}
                          onClick={() => saveCustom(branch)}
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-card bg-foreground px-4 text-xs font-bold text-background disabled:opacity-50"
                        >
                          <TimerReset className="size-4" aria-hidden /> وقت مخصص
                        </button>
                      </div>

                      {branch.busy ? (
                        <button
                          type="button"
                          disabled={mutation.isPending}
                          onClick={() => mutation.mutate({ branchId: branch.id, busyUntil: null })}
                          className="mt-3 min-h-11 w-full rounded-card bg-success px-4 text-sm font-extrabold text-white disabled:opacity-50"
                        >
                          {pending ? "جارٍ التحديث..." : "فتح الفرع الآن"}
                        </button>
                      ) : null}
                    </div>
                  ) : !canToggle ? (
                    <p className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground">للعرض فقط — تحتاج صلاحية التحكم بحالة الفرع للتعديل.</p>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
