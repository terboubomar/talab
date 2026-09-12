import { useMemo, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, LockKeyhole } from "lucide-react";

import { formatSAR } from "@/lib/menu";
import { fetchReportCenterSupport, downloadExcel, type ReportCenterSupport } from "@/lib/report-center";
import { fetchOrderReport, type OrderReport } from "@/lib/reports";
import { ORDER_TYPE_LABEL, STATUS_LABEL, type OrderStatus, type OrderType } from "@/lib/staff";

export const Route = createFileRoute("/_staffShell/admin/reports")({
  head: () => ({ meta: [{ title: "مركز التقارير — طلب" }] }),
  component: ReportsCenterPage,
});

type ReportKey =
  | "orders" | "sales_period" | "sales_location" | "sales_details"
  | "driver" | "customers" | "app_downloads" | "wallet"
  | "reward" | "gift_cards" | "wallet_log" | "points_log";

const REPORTS: Array<{ key: ReportKey; label: string; group: string; available: boolean; description: string }> = [
  { key: "orders", label: "الطلبات", group: "المبيعات", available: true, description: "الطلبات والحالات والمبيعات والاستردادات" },
  { key: "sales_period", label: "المبيعات حسب الفترة", group: "المبيعات", available: true, description: "المبيعات اليومية ومتوسط قيمة الطلب" },
  { key: "sales_location", label: "المبيعات حسب الموقع", group: "المبيعات", available: true, description: "مقارنة الفروع والمواقع" },
  { key: "sales_details", label: "تفاصيل المبيعات", group: "المبيعات", available: true, description: "نوع الطلب والخصومات والضريبة والتوصيل" },
  { key: "driver", label: "السائقين", group: "التشغيل", available: true, description: "التوصيلات والمبيعات لكل سائق" },
  { key: "customers", label: "العملاء", group: "العملاء", available: true, description: "أفضل العملاء وعدد الطلبات والإنفاق" },
  { key: "app_downloads", label: "تحميلات التطبيق", group: "العملاء", available: false, description: "يتطلب وحدة تطبيقات العميل" },
  { key: "wallet", label: "المحفظة", group: "الولاء", available: true, description: "الإيداعات والخصومات وصافي الحركة" },
  { key: "reward", label: "المكافآت والنقاط", group: "الولاء", available: true, description: "النقاط الممنوحة والمستخدمة" },
  { key: "gift_cards", label: "بطاقات الهدايا", group: "الولاء", available: false, description: "يتطلب وحدة بطاقات الهدايا" },
  { key: "wallet_log", label: "إحصائيات سجل المحفظة", group: "السجلات", available: true, description: "حركة المحفظة اليومية" },
  { key: "points_log", label: "إحصائيات سجل النقاط", group: "السجلات", available: true, description: "حركة النقاط اليومية" },
];

function riyadhToday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(date: string, days: number) {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  const value = new Date(Date.UTC(y, m - 1, d));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function ReportsCenterPage() {
  const today = useMemo(riyadhToday, []);
  const [from, setFrom] = useState(() => addDays(today, -29));
  const [to, setTo] = useState(today);
  const [branchId, setBranchId] = useState("");
  const [reportKey, setReportKey] = useState<ReportKey>("orders");

  const validRange = Boolean(from && to && from <= to);
  const orderQuery = useQuery({
    queryKey: ["order_report", from, to, branchId],
    queryFn: () => fetchOrderReport(from, to, branchId || null),
    enabled: validRange,
  });
  const supportQuery = useQuery({
    queryKey: ["report_center_support", from, to, branchId],
    queryFn: () => fetchReportCenterSupport(from, to, branchId || null),
    enabled: validRange,
  });

  const selected = REPORTS.find((item) => item.key === reportKey) ?? REPORTS[0]!;
  const loading = orderQuery.isLoading || supportQuery.isLoading;
  const error = orderQuery.error || supportQuery.error;

  function preset(days: number) { setTo(today); setFrom(addDays(today, -(days - 1))); }

  function exportCurrent() {
    if (!selected.available || !orderQuery.data || !supportQuery.data) return;
    const rows = exportRows(reportKey, orderQuery.data, supportQuery.data);
    if (rows.length) downloadExcel(`talab-${reportKey}-${from}-${to}`, rows);
  }

  return (
    <main className="min-h-screen pb-12">
      <header className="border-b border-border bg-background px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><h1 className="text-lg font-extrabold">مركز التقارير</h1><p className="mt-1 text-xs text-muted-foreground">12 تقريراً حسب هيكل المشروع · الفترات بتوقيت الرياض · صلاحيات الفروع مطبقة من قاعدة البيانات</p></div>
          <button type="button" onClick={exportCurrent} disabled={!selected.available || loading} className="inline-flex items-center gap-2 rounded-card border border-border px-4 py-2.5 text-xs font-bold hover:bg-secondary disabled:opacity-40"><Download className="size-4" /> تحميل Excel</button>
        </div>
      </header>

      <div className="grid gap-5 px-5 py-6 xl:grid-cols-[270px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className="card-surface overflow-hidden border border-border">
            {Array.from(new Set(REPORTS.map((item) => item.group))).map((group) => (
              <div key={group} className="border-b border-border last:border-b-0">
                <p className="bg-secondary/60 px-3 py-2 text-[10px] font-extrabold text-muted-foreground">{group}</p>
                {REPORTS.filter((item) => item.group === group).map((item) => (
                  <button key={item.key} type="button" onClick={() => setReportKey(item.key)} className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 text-right text-xs transition ${reportKey === item.key ? "bg-brand/10 font-extrabold text-brand" : "hover:bg-secondary"}`}>
                    <span>{item.label}</span>{!item.available ? <LockKeyhole className="size-3 text-muted-foreground" /> : null}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </aside>

        <div className="min-w-0 space-y-4">
          <section className="card-surface border border-border p-4">
            <div className="flex flex-wrap gap-2"><Preset onClick={() => preset(7)}>7 أيام</Preset><Preset onClick={() => preset(30)}>30 يوم</Preset><Preset onClick={() => preset(90)}>90 يوم</Preset><Preset onClick={() => preset(365)}>12 شهر</Preset></div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <Filter label="من"><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="report-input" /></Filter>
              <Filter label="إلى"><input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className="report-input" /></Filter>
              <Filter label="الفرع"><select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="report-input"><option value="">كل الفروع المتاحة</option>{orderQuery.data?.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></Filter>
            </div>
          </section>

          <section className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="text-base font-extrabold">{selected.label}</h2><p className="mt-1 text-xs text-muted-foreground">{selected.description}</p></div>
            <span className="rounded-pill bg-secondary px-3 py-1 text-[10px] font-bold text-muted-foreground">{from} ← {to}</span>
          </section>

          {error ? <div className="rounded-card border border-danger/30 bg-danger/10 p-4 text-sm font-bold text-danger">تعذّر تحميل التقرير. تأكد من الصلاحيات والفترة.</div> : null}
          {loading ? <Loading /> : !selected.available ? <Unavailable reportKey={reportKey} /> : orderQuery.data && supportQuery.data ? <ReportBody reportKey={reportKey} order={orderQuery.data} support={supportQuery.data} branchFiltered={Boolean(branchId)} /> : null}
        </div>
      </div>
    </main>
  );
}

function ReportBody({ reportKey, order, support, branchFiltered }: { reportKey: ReportKey; order: OrderReport; support: ReportCenterSupport; branchFiltered: boolean }) {
  if (reportKey === "orders") return <><Kpis order={order} /><Panel title="حالات الطلبات"><Table headers={["الحالة", "الطلبات"]} rows={order.by_status.map((row) => [STATUS_LABEL[row.status as OrderStatus] ?? row.status, row.orders])} /></Panel></>;
  if (reportKey === "sales_period") return <><Kpis order={order} /><DailyBars rows={order.by_day} /><Panel title="المبيعات اليومية"><Table headers={["التاريخ", "الطلبات", "المكتملة", "الإجمالي", "الاسترداد", "الصافي"]} rows={order.by_day.map((row) => [row.day,row.orders,row.completed_orders,formatSAR(Number(row.sales)),formatSAR(Number(row.refunds)),formatSAR(Number(row.net_sales))])} /></Panel></>;
  if (reportKey === "sales_location") return <Panel title="الأداء حسب الفرع"><Table headers={["الفرع", "الطلبات", "المكتملة", "المبيعات", "الاسترداد", "الصافي"]} rows={order.by_branch.map((row) => [row.branch_name,row.orders,row.completed_orders,formatSAR(Number(row.sales)),formatSAR(Number(row.refunds)),formatSAR(Number(row.net_sales))])} /></Panel>;
  if (reportKey === "sales_details") return <div className="grid gap-4 xl:grid-cols-2"><Panel title="حسب نوع الطلب"><Table headers={["النوع", "الطلبات", "المكتملة", "الصافي"]} rows={order.by_order_type.map((row) => [ORDER_TYPE_LABEL[row.order_type as OrderType] ?? row.order_type,row.orders,row.completed_orders,formatSAR(Number(row.net_sales))])} /></Panel><Panel title="التفاصيل المالية"><MoneyRows order={order} /></Panel></div>;
  if (reportKey === "driver") return <Panel title="أداء السائقين"><Table headers={["السائق", "التوصيلات المكتملة", "قيمة الطلبات", "آخر توصيل"]} rows={support.drivers.map((row) => [row.driver_name,row.orders,formatSAR(Number(row.sales)),formatDate(row.last_delivery_at)])} empty="لا توجد توصيلات مسندة لسائقين في الفترة" /></Panel>;
  if (reportKey === "customers") return <Panel title="أفضل العملاء"><Table headers={["العميل", "الجوال", "الطلبات", "الإنفاق", "متوسط الطلب", "آخر طلب"]} rows={support.customers.map((row) => [row.name,row.phone,row.orders,formatSAR(Number(row.sales)),formatSAR(Number(row.average_order_value)),formatDate(row.last_order_at)])} empty="لا توجد طلبات مكتملة في الفترة" /></Panel>;
  if (reportKey === "wallet" || reportKey === "wallet_log") return <><LedgerNotice branchFiltered={branchFiltered} /><LedgerKpis kind="wallet" support={support} /><Panel title="حركة المحفظة اليومية"><Table headers={["التاريخ", "الإيداعات", "الخصومات", "الحركات"]} rows={support.wallet_by_day.map((row) => [String(row.day).slice(0,10),formatSAR(Number(row.credits)),formatSAR(Number(row.debits)),row.movements])} empty="لا توجد حركات محفظة في الفترة" /></Panel></>;
  if (reportKey === "reward" || reportKey === "points_log") return <><LedgerNotice branchFiltered={branchFiltered} /><LedgerKpis kind="points" support={support} /><Panel title="حركة النقاط اليومية"><Table headers={["التاريخ", "الممنوحة", "المستخدمة", "الحركات"]} rows={support.points_by_day.map((row) => [String(row.day).slice(0,10),Number(row.awarded),Number(row.redeemed),row.movements])} empty="لا توجد حركات نقاط في الفترة" /></Panel></>;
  return null;
}

function Kpis({ order }: { order: OrderReport }) { return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Kpi label="صافي المبيعات" value={formatSAR(Number(order.summary.net_sales))} /><Kpi label="المكتملة" value={String(order.summary.completed_orders)} /><Kpi label="متوسط الطلب" value={formatSAR(Number(order.summary.average_order_value))} /><Kpi label="الاستردادات" value={formatSAR(Number(order.summary.refunds))} /><Kpi label="نسبة الإلغاء" value={`${Number(order.summary.cancellation_rate).toFixed(1)}%`} /></div>; }
function Kpi({ label, value }: { label: string; value: string }) { return <div className="card-surface border border-border p-4"><p className="text-xs font-bold text-muted-foreground">{label}</p><p className="mt-2 text-xl font-extrabold">{value}</p></div>; }

function DailyBars({ rows }: { rows: OrderReport["by_day"] }) {
  const max = Math.max(1,...rows.map((row) => Math.max(Number(row.net_sales),0)));
  return <Panel title="اتجاه صافي المبيعات"><div className="flex h-52 items-end gap-1 overflow-x-auto border-b border-border pb-2">{rows.map((row) => <div key={row.day} className="group flex min-w-7 flex-1 flex-col items-center justify-end gap-1" title={`${row.day} · ${formatSAR(Number(row.net_sales))}`}><div className="w-full max-w-7 rounded-t bg-brand" style={{ height: Math.max(4,(Math.max(Number(row.net_sales),0)/max)*170) }} /><span className="text-[9px] text-muted-foreground">{row.day.slice(5)}</span></div>)}</div></Panel>;
}

function LedgerKpis({ kind, support }: { kind: "wallet" | "points"; support: ReportCenterSupport }) {
  const s = kind === "wallet" ? support.wallet_summary : support.points_summary;
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Kpi label="عدد الحركات" value={String(s.movements)} /><Kpi label={kind === "wallet" ? "الإيداعات" : "النقاط الممنوحة"} value={kind === "wallet" ? formatSAR(Number(s.credits ?? 0)) : String(Number(s.awarded ?? 0))} /><Kpi label={kind === "wallet" ? "الخصومات" : "النقاط المستخدمة"} value={kind === "wallet" ? formatSAR(Number(s.debits ?? 0)) : String(Number(s.redeemed ?? 0))} /><Kpi label="الصافي" value={kind === "wallet" ? formatSAR(Number(s.net)) : String(Number(s.net))} /></div>;
}
function LedgerNotice({ branchFiltered }: { branchFiltered: boolean }) { return branchFiltered ? <p className="rounded-card border border-border bg-secondary/60 px-4 py-3 text-xs font-bold text-muted-foreground">فلتر الفرع لا يغيّر هذا التقرير حالياً لأن سجلات المحفظة والنقاط محفوظة على مستوى العميل/المستأجر ولا تحمل branch_id.</p> : null; }

function MoneyRows({ order }: { order: OrderReport }) { return <dl className="divide-y divide-border text-sm"><Money label="الإجمالي" value={order.summary.gross_sales} /><Money label="الخصومات" value={order.summary.discounts} /><Money label="الضريبة" value={order.summary.tax_total} /><Money label="رسوم التوصيل" value={order.summary.delivery_fees} /><Money label="الاستردادات" value={order.summary.refunds} /><Money label="الصافي" value={order.summary.net_sales} strong /></dl>; }
function Money({ label, value, strong }: { label: string; value: number; strong?: boolean }) { return <div className={`flex justify-between py-3 ${strong ? "font-extrabold" : ""}`}><dt>{label}</dt><dd>{formatSAR(Number(value))}</dd></div>; }

function Panel({ title, children }: { title: string; children: ReactNode }) { return <section className="card-surface overflow-hidden border border-border"><div className="border-b border-border px-4 py-3"><h3 className="text-sm font-extrabold">{title}</h3></div><div className="p-4">{children}</div></section>; }
function Table({ headers, rows, empty = "لا توجد بيانات في الفترة" }: { headers: string[]; rows: Array<Array<ReactNode>>; empty?: string }) { if (!rows.length) return <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>; return <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="bg-secondary text-xs text-muted-foreground">{headers.map((h) => <th key={h} className="px-3 py-2.5 text-start">{h}</th>)}</tr></thead><tbody className="divide-y divide-border">{rows.map((row,i) => <tr key={i}>{row.map((cell,j) => <td key={j} className="px-3 py-2.5">{cell}</td>)}</tr>)}</tbody></table></div>; }

function Unavailable({ reportKey }: { reportKey: ReportKey }) { const gift = reportKey === "gift_cards"; return <div className="card-surface border border-dashed border-border p-10 text-center"><LockKeyhole className="mx-auto size-7 text-muted-foreground" /><h3 className="mt-3 text-sm font-extrabold">البيانات الأساسية لهذا التقرير لم تُبنَ بعد</h3><p className="mx-auto mt-2 max-w-lg text-xs leading-6 text-muted-foreground">{gift ? "تقرير بطاقات الهدايا سيصبح فعلياً عند تنفيذ وحدة Gift Cards في Phase 4." : "تقرير تحميلات التطبيق يحتاج أولاً إلى تطبيق العميل وتتبع عمليات التنزيل/التثبيت. لن يعرض طلب بيانات وهمية."}</p></div>; }
function Loading() { return <div className="grid gap-3 md:grid-cols-3">{[0,1,2,3,4,5].map((i) => <div key={i} className="card-surface h-28 animate-pulse opacity-60" />)}</div>; }
function Filter({ label, children }: { label: string; children: ReactNode }) { return <label className="grid gap-1 text-xs font-bold text-muted-foreground"><span>{label}</span>{children}</label>; }
function Preset({ children, onClick }: { children: ReactNode; onClick: () => void }) { return <button type="button" onClick={onClick} className="rounded-pill border border-border px-3 py-2 text-xs font-bold hover:bg-secondary">{children}</button>; }
function formatDate(value: string | null) { return value ? new Intl.DateTimeFormat("ar-SA", { timeZone: "Asia/Riyadh", dateStyle: "medium" }).format(new Date(value)) : "—"; }

function exportRows(key: ReportKey, order: OrderReport, support: ReportCenterSupport): Array<Record<string, string | number | null | undefined>> {
  if (key === "orders") return order.by_status.map((row) => ({ الحالة: STATUS_LABEL[row.status as OrderStatus] ?? row.status, الطلبات: row.orders }));
  if (key === "sales_period") return order.by_day.map((row) => ({ التاريخ: row.day, الطلبات: row.orders, المكتملة: row.completed_orders, المبيعات: row.sales, الاستردادات: row.refunds, الصافي: row.net_sales }));
  if (key === "sales_location") return order.by_branch.map((row) => ({ الفرع: row.branch_name, الطلبات: row.orders, المكتملة: row.completed_orders, المبيعات: row.sales, الاستردادات: row.refunds, الصافي: row.net_sales }));
  if (key === "sales_details") return order.by_order_type.map((row) => ({ النوع: ORDER_TYPE_LABEL[row.order_type as OrderType] ?? row.order_type, الطلبات: row.orders, المكتملة: row.completed_orders, المبيعات: row.sales, الاستردادات: row.refunds, الصافي: row.net_sales }));
  if (key === "driver") return support.drivers.map((row) => ({ السائق: row.driver_name, التوصيلات: row.orders, المبيعات: row.sales, آخر_توصيل: row.last_delivery_at }));
  if (key === "customers") return support.customers.map((row) => ({ العميل: row.name, الجوال: row.phone, الطلبات: row.orders, الإنفاق: row.sales, متوسط_الطلب: row.average_order_value, آخر_طلب: row.last_order_at }));
  if (key === "wallet" || key === "wallet_log") return support.wallet_by_day.map((row) => ({ التاريخ: String(row.day).slice(0,10), الإيداعات: row.credits, الخصومات: row.debits, الحركات: row.movements }));
  if (key === "reward" || key === "points_log") return support.points_by_day.map((row) => ({ التاريخ: String(row.day).slice(0,10), الممنوحة: row.awarded, المستخدمة: row.redeemed, الحركات: row.movements }));
  return [];
}
