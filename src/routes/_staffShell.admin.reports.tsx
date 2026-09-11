import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { fetchOrderReport } from "@/lib/reports";
import { ORDER_TYPE_LABEL, STATUS_LABEL, type OrderStatus, type OrderType } from "@/lib/staff";
import { formatSAR } from "@/lib/menu";

export const Route = createFileRoute("/_staffShell/admin/reports")({
  head: () => ({ meta: [{ title: "تقارير الطلبات — طلب" }] }),
  component: OrderReportsPage,
});

function riyadhToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(date: string, days: number) {
  const [y, m, d] = date.split("-").map(Number);
  const value = new Date(Date.UTC(y, m - 1, d));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function OrderReportsPage() {
  const today = useMemo(() => riyadhToday(), []);
  const [from, setFrom] = useState(() => addDays(today, -29));
  const [to, setTo] = useState(today);
  const [branchId, setBranchId] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["order_report", from, to, branchId],
    queryFn: () => fetchOrderReport(from, to, branchId || null),
    enabled: Boolean(from && to && from <= to),
  });

  const maxDailySales = Math.max(1, ...(data?.by_day.map((row) => Number(row.sales)) ?? [1]));

  function applyPreset(days: number) {
    setTo(today);
    setFrom(addDays(today, -(days - 1)));
  }

  return (
    <main className="min-h-screen pb-12">
      <header className="border-b border-border bg-background px-5 py-5">
        <h1 className="text-lg font-extrabold">تقارير الطلبات</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          المبيعات تعتمد على الطلبات المكتملة فقط، والتواريخ محسوبة بتوقيت الرياض.
        </p>
      </header>

      <div className="space-y-5 px-5 py-6">
        <section className="card-surface p-4">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => applyPreset(7)} className="rounded-pill border border-border px-3 py-2 text-xs font-bold">آخر 7 أيام</button>
            <button type="button" onClick={() => applyPreset(30)} className="rounded-pill border border-border px-3 py-2 text-xs font-bold">آخر 30 يوم</button>
            <button type="button" onClick={() => applyPreset(90)} className="rounded-pill border border-border px-3 py-2 text-xs font-bold">آخر 90 يوم</button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <label className="grid gap-1 text-xs font-bold text-muted-foreground">
              من
              <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="rounded-card border border-border bg-background px-3 py-2.5 text-sm text-foreground" />
            </label>
            <label className="grid gap-1 text-xs font-bold text-muted-foreground">
              إلى
              <input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className="rounded-card border border-border bg-background px-3 py-2.5 text-sm text-foreground" />
            </label>
            <label className="grid gap-1 text-xs font-bold text-muted-foreground">
              الفرع
              <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="rounded-card border border-border bg-background px-3 py-2.5 text-sm text-foreground">
                <option value="">كل الفروع المتاحة</option>
                {data?.branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
            </label>
          </div>
        </section>

        {error ? (
          <div className="rounded-card border border-danger/30 bg-danger/10 p-4 text-sm font-bold text-danger">
            تعذّر تحميل التقرير. تأكد من الصلاحيات والفترة المحددة.
          </div>
        ) : null}

        {isLoading ? (
          <div className="grid gap-3 md:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <div key={i} className="card-surface h-28 animate-pulse opacity-60" />)}
          </div>
        ) : data ? (
          <>
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label="المبيعات المكتملة" value={formatSAR(Number(data.summary.gross_sales))} />
              <Kpi label="الطلبات المكتملة" value={String(data.summary.completed_orders)} hint={`من ${data.summary.all_orders} طلب`} />
              <Kpi label="متوسط قيمة الطلب" value={formatSAR(Number(data.summary.average_order_value))} />
              <Kpi label="نسبة الإلغاء" value={`${Number(data.summary.cancellation_rate).toFixed(1)}%`} hint={`${data.summary.cancelled_orders} طلب ملغي`} />
            </section>

            <section className="grid gap-5 xl:grid-cols-2">
              <div className="card-surface p-4">
                <h2 className="text-sm font-extrabold">اتجاه المبيعات اليومية</h2>
                {data.by_day.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">لا توجد بيانات في هذه الفترة</p>
                ) : (
                  <div className="mt-5 flex h-52 items-end gap-1 overflow-x-auto border-b border-border pb-2">
                    {data.by_day.map((row) => {
                      const height = Math.max(4, (Number(row.sales) / maxDailySales) * 170);
                      return (
                        <div key={row.day} className="group flex min-w-8 flex-1 flex-col items-center justify-end gap-1" title={`${row.day} — ${formatSAR(Number(row.sales))}`}>
                          <span className="text-[10px] font-bold text-muted-foreground opacity-0 group-hover:opacity-100">{row.completed_orders}</span>
                          <div className="w-full max-w-8 rounded-t bg-brand" style={{ height }} />
                          <span className="whitespace-nowrap text-[9px] text-muted-foreground">{row.day.slice(5)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="card-surface p-4">
                <h2 className="text-sm font-extrabold">ملخص مالي</h2>
                <dl className="mt-4 divide-y divide-border text-sm">
                  <MoneyRow label="إجمالي المنتجات قبل الإضافات" value={data.summary.subtotal} />
                  <MoneyRow label="الضريبة" value={data.summary.tax_total} />
                  <MoneyRow label="رسوم التوصيل" value={data.summary.delivery_fees} />
                  <MoneyRow label="الخصومات" value={data.summary.discounts} negative />
                  <MoneyRow label="الإجمالي المكتمل" value={data.summary.gross_sales} strong />
                </dl>
              </div>
            </section>

            <section className="grid gap-5 xl:grid-cols-2">
              <div className="card-surface overflow-hidden">
                <div className="border-b border-border p-4"><h2 className="text-sm font-extrabold">الأداء حسب الفرع</h2></div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead className="bg-secondary text-xs text-muted-foreground"><tr><th className="px-4 py-3 text-start">الفرع</th><th className="px-4 py-3 text-start">الطلبات</th><th className="px-4 py-3 text-start">المكتملة</th><th className="px-4 py-3 text-start">المبيعات</th></tr></thead>
                    <tbody className="divide-y divide-border">
                      {data.by_branch.map((row) => <tr key={row.branch_id}><td className="px-4 py-3 font-bold">{row.branch_name}</td><td className="px-4 py-3">{row.orders}</td><td className="px-4 py-3">{row.completed_orders}</td><td className="px-4 py-3 font-bold">{formatSAR(Number(row.sales))}</td></tr>)}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card-surface overflow-hidden">
                <div className="border-b border-border p-4"><h2 className="text-sm font-extrabold">الأداء حسب نوع الطلب</h2></div>
                <div className="divide-y divide-border">
                  {data.by_order_type.map((row) => (
                    <div key={row.order_type} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                      <div><p className="font-bold">{ORDER_TYPE_LABEL[row.order_type as OrderType] ?? row.order_type}</p><p className="text-xs text-muted-foreground">{row.completed_orders} مكتمل من {row.orders}</p></div>
                      <span className="font-extrabold">{formatSAR(Number(row.sales))}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="card-surface p-4">
              <h2 className="text-sm font-extrabold">حالات الطلبات</h2>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {data.by_status.map((row) => (
                  <div key={row.status} className="rounded-card border border-border p-3">
                    <p className="text-xs text-muted-foreground">{STATUS_LABEL[row.status as OrderStatus] ?? row.status}</p>
                    <p className="mt-1 text-xl font-extrabold">{row.orders}</p>
                  </div>
                ))}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="card-surface p-4"><p className="text-xs font-bold text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-extrabold">{value}</p>{hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}</div>;
}

function MoneyRow({ label, value, negative = false, strong = false }: { label: string; value: number; negative?: boolean; strong?: boolean }) {
  return <div className={`flex items-center justify-between py-3 ${strong ? "font-extrabold" : ""}`}><dt>{label}</dt><dd>{negative && Number(value) > 0 ? "− " : ""}{formatSAR(Number(value))}</dd></div>;
}
