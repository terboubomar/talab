import { useMemo, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  CalendarDays,
  Download,
  FileSpreadsheet,
  LockKeyhole,
  MapPin,
  SlidersHorizontal,
} from "lucide-react";

import { formatSAR } from "@/lib/menu";
import {
  fetchReportCenterSupport,
  fetchSalesDetailReport,
  downloadExcel,
  downloadExcelWorkbook,
  type ReportCenterSupport,
  type SalesDetailReport,
} from "@/lib/report-center";
import { fetchOrderReport, type OrderReport } from "@/lib/reports";
import { PAYMENT_STATUS_LABEL, type PaymentStatus } from "@/lib/payments";
import { ORDER_SOURCE_LABEL, ORDER_TYPE_LABEL, STATUS_LABEL, type OrderStatus, type OrderType } from "@/lib/staff";

export const Route = createFileRoute("/_staffShell/admin/reports")({
  head: () => ({ meta: [{ title: "مركز التقارير — طلب" }] }),
  component: ReportsCenterPage,
});

type ReportKey =
  | "orders" | "sales_period" | "sales_location" | "sales_details"
  | "driver" | "customers" | "app_downloads" | "wallet"
  | "reward" | "gift_cards" | "wallet_log" | "points_log";

type ReportDefinition = {
  key: ReportKey;
  label: string;
  group: string;
  available: boolean;
  description: string;
};

const REPORTS: ReportDefinition[] = [
  { key: "orders", label: "الطلبات", group: "المبيعات", available: true, description: "الطلبات والحالات والمبيعات والاستردادات" },
  { key: "sales_period", label: "المبيعات حسب الفترة", group: "المبيعات", available: true, description: "المبيعات اليومية ومتوسط قيمة الطلب" },
  { key: "sales_location", label: "المبيعات حسب الموقع", group: "المبيعات", available: true, description: "مقارنة الفروع والمواقع" },
  { key: "sales_details", label: "تفاصيل المبيعات", group: "المبيعات", available: true, description: "تفاصيل كل طلب مع المصدر والدفع وموظف خدمة العملاء" },
  { key: "driver", label: "السائقين", group: "التشغيل", available: true, description: "التوصيلات والمبيعات لكل سائق" },
  { key: "customers", label: "العملاء", group: "العملاء", available: true, description: "أفضل العملاء وعدد الطلبات والإنفاق" },
  { key: "app_downloads", label: "تحميلات التطبيق", group: "العملاء", available: false, description: "يتطلب وحدة تطبيقات العميل" },
  { key: "wallet", label: "المحفظة", group: "الولاء", available: true, description: "الإيداعات والخصومات وصافي الحركة" },
  { key: "reward", label: "المكافآت والنقاط", group: "الولاء", available: true, description: "النقاط الممنوحة والمستخدمة" },
  { key: "gift_cards", label: "بطاقات الهدايا", group: "الولاء", available: false, description: "يتطلب وحدة بطاقات الهدايا" },
  { key: "wallet_log", label: "إحصائيات سجل المحفظة", group: "السجلات", available: true, description: "حركة المحفظة اليومية" },
  { key: "points_log", label: "إحصائيات سجل النقاط", group: "السجلات", available: true, description: "حركة النقاط اليومية" },
];

const REPORT_GROUPS = Array.from(new Set(REPORTS.map((item) => item.group)));

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
  const [exportAllBusy, setExportAllBusy] = useState(false);

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
  const detailQuery = useQuery({
    queryKey: ["sales_detail_report", from, to, branchId],
    queryFn: () => fetchSalesDetailReport(from, to, branchId || null),
    enabled: validRange && reportKey === "sales_details",
  });

  const selected = REPORTS.find((item) => item.key === reportKey) ?? REPORTS[0]!;
  const selectedBranch = branchId
    ? orderQuery.data?.branches.find((branch) => branch.id === branchId)?.name ?? "فرع محدد"
    : "كل الفروع المتاحة";
  const loading = orderQuery.isLoading || supportQuery.isLoading || (reportKey === "sales_details" && detailQuery.isLoading);
  const error = orderQuery.error || supportQuery.error || (reportKey === "sales_details" ? detailQuery.error : null);
  const availableCount = REPORTS.filter((report) => report.available).length;

  function preset(days: number) {
    setTo(today);
    setFrom(addDays(today, -(days - 1)));
  }

  function exportCurrent() {
    if (!selected.available || !orderQuery.data || !supportQuery.data) return;
    const rows = exportRows(reportKey, orderQuery.data, supportQuery.data, detailQuery.data);
    if (rows.length) downloadExcel(`talab-${reportKey}-${from}-${to}`, rows, selected.label);
  }

  async function exportAllReports() {
    if (!orderQuery.data || !supportQuery.data || exportAllBusy) return;
    setExportAllBusy(true);
    try {
      const detail = detailQuery.data ?? await fetchSalesDetailReport(from, to, branchId || null);
      const metadata = [{
        "الفترة من": from,
        "الفترة إلى": to,
        "الفرع": selectedBranch,
        "تاريخ التصدير": new Intl.DateTimeFormat("ar-SA", {
          timeZone: "Asia/Riyadh",
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date()),
      }];
      const sheets = REPORTS.filter((report) => report.available).map((report) => {
        const rows = exportRows(report.key, orderQuery.data!, supportQuery.data!, detail);
        return {
          name: report.label,
          rows: rows.length ? rows : [{ الحالة: "لا توجد بيانات في الفترة المحددة" }],
        };
      });
      downloadExcelWorkbook(`talab-all-reports-${from}-${to}`, [
        { name: "ملخص التصدير", rows: metadata },
        ...sheets,
      ]);
    } finally {
      setExportAllBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-secondary/20 pb-12">
      <header className="border-b border-border bg-background px-4 py-5 sm:px-5">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4">
          <div>
            <div className="mb-1.5 flex items-center gap-2 text-[11px] font-bold text-brand">
              <BarChart3 aria-hidden className="size-4" /> التحليلات والتقارير
            </div>
            <h1 className="text-xl font-extrabold tracking-tight">مركز التقارير</h1>
            <p className="mt-1 text-xs text-muted-foreground">{availableCount} تقارير جاهزة · توقيت الرياض · صلاحيات الفروع مطبقة تلقائياً</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={exportCurrent}
              disabled={!selected.available || loading || exportAllBusy}
              className="inline-flex items-center gap-2 rounded-card border border-border bg-background px-3.5 py-2.5 text-xs font-bold transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download aria-hidden className="size-4" /> التقرير الحالي
            </button>
            <button
              type="button"
              onClick={exportAllReports}
              disabled={loading || exportAllBusy || !orderQuery.data || !supportQuery.data}
              className="inline-flex items-center gap-2 rounded-card bg-brand px-3.5 py-2.5 text-xs font-bold text-brand-ink transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <FileSpreadsheet aria-hidden className="size-4" /> {exportAllBusy ? "جاري التجهيز…" : "Excel كامل"}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-5">
        <MobileReportPicker reportKey={reportKey} onSelect={setReportKey} />

        <div className="grid gap-5 xl:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="hidden xl:block">
            <div className="sticky top-4 overflow-hidden rounded-card border border-border bg-background shadow-sm">
              <div className="border-b border-border px-3.5 py-3">
                <p className="text-xs font-extrabold">اختر التقرير</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">التقارير مصنفة حسب الاستخدام</p>
              </div>
              <ReportNavigation reportKey={reportKey} onSelect={setReportKey} />
            </div>
          </aside>

          <div className="min-w-0 space-y-4">
            <section className="rounded-card border border-border bg-background shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-4 py-4 sm:px-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-extrabold">{selected.label}</h2>
                    {!selected.available ? <span className="rounded-pill bg-secondary px-2 py-1 text-[10px] font-bold text-muted-foreground">قريباً</span> : null}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{selected.description}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold text-muted-foreground">
                  <ContextPill icon={<CalendarDays className="size-3.5" />} label={`${from} — ${to}`} />
                  <ContextPill icon={<MapPin className="size-3.5" />} label={selectedBranch} />
                </div>
              </div>

              <div className="px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="me-auto flex flex-wrap gap-1.5">
                    <Preset active={from === addDays(today, -6) && to === today} onClick={() => preset(7)}>7 أيام</Preset>
                    <Preset active={from === addDays(today, -29) && to === today} onClick={() => preset(30)}>30 يوم</Preset>
                    <Preset active={from === addDays(today, -89) && to === today} onClick={() => preset(90)}>90 يوم</Preset>
                    <Preset active={from === addDays(today, -364) && to === today} onClick={() => preset(365)}>12 شهر</Preset>
                  </div>
                  <div className="grid w-full gap-2 sm:grid-cols-3 lg:w-auto lg:grid-cols-[150px_150px_220px]">
                    <Filter label="من"><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="report-input" /></Filter>
                    <Filter label="إلى"><input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className="report-input" /></Filter>
                    <Filter label="الفرع"><select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="report-input"><option value="">كل الفروع المتاحة</option>{orderQuery.data?.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></Filter>
                  </div>
                </div>
              </div>
            </section>

            {!validRange ? (
              <StateCard icon={<CalendarDays className="size-5" />} title="الفترة غير صالحة" description="اختر تاريخ بداية يسبق أو يساوي تاريخ النهاية." />
            ) : error ? (
              <div className="rounded-card border border-danger/30 bg-danger/10 p-4 text-sm font-bold text-danger">تعذّر تحميل التقرير. تأكد من الصلاحيات والفترة ثم حاول مرة أخرى.</div>
            ) : loading ? (
              <Loading />
            ) : !selected.available ? (
              <Unavailable reportKey={reportKey} />
            ) : orderQuery.data && supportQuery.data ? (
              <ReportBody reportKey={reportKey} order={orderQuery.data} support={supportQuery.data} detail={detailQuery.data ?? null} branchFiltered={Boolean(branchId)} />
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}

function ReportNavigation({ reportKey, onSelect }: { reportKey: ReportKey; onSelect: (key: ReportKey) => void }) {
  return (
    <nav className="max-h-[calc(100vh-11rem)] overflow-y-auto py-1.5">
      {REPORT_GROUPS.map((group) => (
        <div key={group} className="border-b border-border py-1.5 last:border-b-0">
          <p className="px-3.5 py-1.5 text-[10px] font-extrabold text-muted-foreground">{group}</p>
          {REPORTS.filter((item) => item.group === group).map((item) => {
            const active = reportKey === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onSelect(item.key)}
                aria-current={active ? "page" : undefined}
                className={`group flex w-full items-center gap-2.5 px-3.5 py-2.5 text-right transition ${active ? "bg-brand/10 text-brand" : "hover:bg-secondary/70"}`}
              >
                <span className={`h-6 w-1 shrink-0 rounded-full ${active ? "bg-brand" : "bg-transparent"}`} />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-xs ${active ? "font-extrabold" : "font-bold"}`}>{item.label}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{item.description}</span>
                </span>
                {!item.available ? <LockKeyhole aria-hidden className="size-3 shrink-0 text-muted-foreground" /> : null}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function MobileReportPicker({ reportKey, onSelect }: { reportKey: ReportKey; onSelect: (key: ReportKey) => void }) {
  return (
    <div className="-mx-4 mb-4 overflow-x-auto px-4 pb-1 xl:hidden">
      <div className="flex w-max gap-2">
        {REPORTS.map((item) => {
          const active = reportKey === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onSelect(item.key)}
              className={`inline-flex items-center gap-1.5 rounded-pill border px-3 py-2 text-xs font-bold transition ${active ? "border-brand bg-brand text-brand-ink" : "border-border bg-background hover:bg-secondary"}`}
            >
              {item.label}{!item.available ? <LockKeyhole aria-hidden className="size-3" /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ReportBody({ reportKey, order, support, detail, branchFiltered }: { reportKey: ReportKey; order: OrderReport; support: ReportCenterSupport; detail: SalesDetailReport | null; branchFiltered: boolean }) {
  if (reportKey === "orders") return <div className="space-y-4"><Kpis order={order} /><Panel title="حالات الطلبات" subtitle="توزيع الطلبات حسب آخر حالة مسجلة"><Table headers={["الحالة", "الطلبات"]} rows={order.by_status.map((row) => [STATUS_LABEL[row.status as OrderStatus] ?? row.status, row.orders])} /></Panel></div>;
  if (reportKey === "sales_period") return <div className="space-y-4"><Kpis order={order} /><DailyBars rows={order.by_day} /><Panel title="المبيعات اليومية" subtitle="تفصيل الأداء لكل يوم ضمن الفترة"><Table headers={["التاريخ", "الطلبات", "المكتملة", "الإجمالي", "الاسترداد", "الصافي"]} rows={order.by_day.map((row) => [row.day,row.orders,row.completed_orders,formatSAR(Number(row.sales)),formatSAR(Number(row.refunds)),formatSAR(Number(row.net_sales))])} /></Panel></div>;
  if (reportKey === "sales_location") return <Panel title="الأداء حسب الفرع" subtitle="قارن حجم الطلبات وصافي المبيعات بين الفروع"><Table headers={["الفرع", "الطلبات", "المكتملة", "المبيعات", "الاسترداد", "الصافي"]} rows={order.by_branch.map((row) => [row.branch_name,row.orders,row.completed_orders,formatSAR(Number(row.sales)),formatSAR(Number(row.refunds)),formatSAR(Number(row.net_sales))])} /></Panel>;
  if (reportKey === "sales_details") return <SalesDetails order={order} detail={detail} />;
  if (reportKey === "driver") return <Panel title="أداء السائقين" subtitle="التوصيلات المكتملة وقيمة الطلبات لكل سائق"><Table headers={["السائق", "التوصيلات المكتملة", "قيمة الطلبات", "آخر توصيل"]} rows={support.drivers.map((row) => [row.driver_name,row.orders,formatSAR(Number(row.sales)),formatDate(row.last_delivery_at)])} empty="لا توجد توصيلات مسندة لسائقين في الفترة" /></Panel>;
  if (reportKey === "customers") return <Panel title="أفضل العملاء" subtitle="العملاء الأعلى حسب عدد الطلبات والإنفاق"><Table headers={["العميل", "الجوال", "الطلبات", "الإنفاق", "متوسط الطلب", "آخر طلب"]} rows={support.customers.map((row) => [row.name,row.phone,row.orders,formatSAR(Number(row.sales)),formatSAR(Number(row.average_order_value)),formatDate(row.last_order_at)])} empty="لا توجد طلبات مكتملة في الفترة" /></Panel>;
  if (reportKey === "wallet" || reportKey === "wallet_log") return <div className="space-y-4"><LedgerNotice branchFiltered={branchFiltered} /><LedgerKpis kind="wallet" support={support} /><Panel title="حركة المحفظة اليومية" subtitle="الإيداعات والخصومات وعدد الحركات"><Table headers={["التاريخ", "الإيداعات", "الخصومات", "الحركات"]} rows={support.wallet_by_day.map((row) => [String(row.day).slice(0,10),formatSAR(Number(row.credits)),formatSAR(Number(row.debits)),row.movements])} empty="لا توجد حركات محفظة في الفترة" /></Panel></div>;
  if (reportKey === "reward" || reportKey === "points_log") return <div className="space-y-4"><LedgerNotice branchFiltered={branchFiltered} /><LedgerKpis kind="points" support={support} /><Panel title="حركة النقاط اليومية" subtitle="النقاط الممنوحة والمستخدمة حسب اليوم"><Table headers={["التاريخ", "الممنوحة", "المستخدمة", "الحركات"]} rows={support.points_by_day.map((row) => [String(row.day).slice(0,10),Number(row.awarded),Number(row.redeemed),row.movements])} empty="لا توجد حركات نقاط في الفترة" /></Panel></div>;
  return null;
}

function SalesDetails({ order, detail }: { order: OrderReport; detail: SalesDetailReport | null }) {
  if (!detail) return <Loading />;
  return (
    <div className="space-y-4">
      <Kpis order={order} />
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="حسب نوع الطلب" compact><Table headers={["النوع", "الطلبات", "المكتملة", "الصافي"]} rows={order.by_order_type.map((row) => [ORDER_TYPE_LABEL[row.order_type as OrderType] ?? row.order_type,row.orders,row.completed_orders,formatSAR(Number(row.net_sales))])} /></Panel>
        <Panel title="حسب مصدر الطلب" compact><Table headers={["المصدر", "الطلبات", "المكتملة", "المبيعات"]} rows={detail.by_source.map((row) => [ORDER_SOURCE_LABEL[row.source] ?? row.source,row.orders,row.completed_orders,formatSAR(Number(row.sales))])} /></Panel>
        <Panel title="حسب طريقة الدفع" compact><Table headers={["طريقة الدفع", "الطلبات", "المكتملة", "المبيعات"]} rows={detail.by_payment_method.map((row) => [row.payment_method === "online" ? "دفع إلكتروني" : "الدفع عند الاستلام",row.orders,row.completed_orders,formatSAR(Number(row.sales))])} /></Panel>
      </div>
      <Panel title={`تفاصيل الطلبات (${detail.total_rows.toLocaleString("ar-SA")})`} subtitle="أحدث الطلبات المطابقة للفلاتر الحالية">
        {detail.truncated ? <p className="mb-3 rounded-card border border-border bg-secondary/60 px-3 py-2 text-[11px] font-bold text-muted-foreground">الفترة تحتوي أكثر من 1000 طلب؛ يعرض الجدول أحدث 1000 طلب للحفاظ على سرعة الصفحة.</p> : null}
        <Table
          headers={["الطلب", "التاريخ", "الفرع", "العميل", "النوع", "الحالة", "المصدر", "موظف خدمة العملاء", "الدفع", "الإجمالي"]}
          rows={detail.orders.map((row) => [
            `#${row.id.slice(0,8)}`,
            formatDateTime(row.placed_at),
            row.branch_name,
            row.customer_name || "—",
            ORDER_TYPE_LABEL[row.order_type as OrderType] ?? row.order_type,
            STATUS_LABEL[row.status as OrderStatus] ?? row.status,
            ORDER_SOURCE_LABEL[row.source] ?? row.source,
            row.agent_name ?? "—",
            row.payment_method === "online" ? PAYMENT_STATUS_LABEL[row.payment_status as PaymentStatus] ?? "دفع إلكتروني" : "عند الاستلام",
            formatSAR(Number(row.total)),
          ])}
          empty="لا توجد طلبات في الفترة"
        />
      </Panel>
    </div>
  );
}

function Kpis({ order }: { order: OrderReport }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Kpi label="صافي المبيعات" value={formatSAR(Number(order.summary.net_sales))} emphasis />
      <Kpi label="الطلبات المكتملة" value={Number(order.summary.completed_orders).toLocaleString("ar-SA")} />
      <Kpi label="متوسط الطلب" value={formatSAR(Number(order.summary.average_order_value))} />
      <Kpi label="الاستردادات" value={formatSAR(Number(order.summary.refunds))} />
      <Kpi label="نسبة الإلغاء" value={`${Number(order.summary.cancellation_rate).toFixed(1)}%`} />
    </div>
  );
}

function Kpi({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className={`rounded-card border p-4 shadow-sm ${emphasis ? "border-brand/30 bg-brand/5" : "border-border bg-background"}`}>
      <p className="text-[11px] font-bold text-muted-foreground">{label}</p>
      <p className={`mt-2 truncate font-extrabold tracking-tight ${emphasis ? "text-2xl text-brand" : "text-xl"}`}>{value}</p>
    </div>
  );
}

function DailyBars({ rows }: { rows: OrderReport["by_day"] }) {
  const max = Math.max(1, ...rows.map((row) => Math.max(Number(row.net_sales), 0)));
  return (
    <Panel title="اتجاه صافي المبيعات" subtitle="مرور سريع على أداء الفترة يومياً">
      {rows.length ? (
        <div className="flex h-56 items-end gap-1.5 overflow-x-auto border-b border-border pb-2 pt-4">
          {rows.map((row) => (
            <div key={row.day} className="group flex min-w-8 flex-1 flex-col items-center justify-end gap-1.5" title={`${row.day} · ${formatSAR(Number(row.net_sales))}`}>
              <span className="pointer-events-none text-[9px] font-bold opacity-0 transition group-hover:opacity-100">{Math.round(Number(row.net_sales)).toLocaleString("ar-SA")}</span>
              <div className="w-full max-w-8 rounded-t-md bg-brand/80 transition group-hover:bg-brand" style={{ height: Math.max(5, (Math.max(Number(row.net_sales), 0) / max) * 165) }} />
              <span className="text-[9px] text-muted-foreground">{row.day.slice(5)}</span>
            </div>
          ))}
        </div>
      ) : <EmptyTableState text="لا توجد مبيعات يومية في الفترة" />}
    </Panel>
  );
}

function LedgerKpis({ kind, support }: { kind: "wallet" | "points"; support: ReportCenterSupport }) {
  const s = kind === "wallet" ? support.wallet_summary : support.points_summary;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Kpi label="عدد الحركات" value={Number(s.movements).toLocaleString("ar-SA")} />
      <Kpi label={kind === "wallet" ? "الإيداعات" : "النقاط الممنوحة"} value={kind === "wallet" ? formatSAR(Number(s.credits ?? 0)) : Number(s.awarded ?? 0).toLocaleString("ar-SA")} />
      <Kpi label={kind === "wallet" ? "الخصومات" : "النقاط المستخدمة"} value={kind === "wallet" ? formatSAR(Number(s.debits ?? 0)) : Number(s.redeemed ?? 0).toLocaleString("ar-SA")} />
      <Kpi label="الصافي" value={kind === "wallet" ? formatSAR(Number(s.net)) : Number(s.net).toLocaleString("ar-SA")} emphasis />
    </div>
  );
}

function LedgerNotice({ branchFiltered }: { branchFiltered: boolean }) {
  return branchFiltered ? (
    <div className="flex gap-2 rounded-card border border-border bg-background px-4 py-3 text-xs text-muted-foreground shadow-sm">
      <SlidersHorizontal aria-hidden className="mt-0.5 size-4 shrink-0" />
      <p>فلتر الفرع لا يغيّر هذا التقرير حالياً لأن سجلات المحفظة والنقاط محفوظة على مستوى العميل/المستأجر ولا تحمل branch_id.</p>
    </div>
  ) : null;
}

function Panel({ title, subtitle, children, compact = false }: { title: string; subtitle?: string; children: ReactNode; compact?: boolean }) {
  return (
    <section className="overflow-hidden rounded-card border border-border bg-background shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5">
        <div>
          <h3 className="text-sm font-extrabold">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-[10px] text-muted-foreground">{subtitle}</p> : null}
        </div>
      </div>
      <div className={compact ? "p-2" : "p-3 sm:p-4"}>{children}</div>
    </section>
  );
}

function Table({ headers, rows, empty = "لا توجد بيانات في الفترة" }: { headers: string[]; rows: Array<Array<ReactNode>>; empty?: string }) {
  if (!rows.length) return <EmptyTableState text={empty} />;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[680px] text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="bg-secondary/90 text-[11px] text-muted-foreground backdrop-blur">
            {headers.map((header) => <th key={header} className="whitespace-nowrap px-3 py-2.5 text-start font-extrabold">{header}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, index) => (
            <tr key={index} className="transition hover:bg-secondary/40">
              {row.map((cell, cellIndex) => <td key={cellIndex} className="whitespace-nowrap px-3 py-2.5 text-xs first:font-bold">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyTableState({ text }: { text: string }) {
  return <p className="py-10 text-center text-xs font-medium text-muted-foreground">{text}</p>;
}

function Unavailable({ reportKey }: { reportKey: ReportKey }) {
  const gift = reportKey === "gift_cards";
  return (
    <StateCard
      icon={<LockKeyhole className="size-5" />}
      title="هذا التقرير غير متاح بعد"
      description={gift ? "سيصبح تقرير بطاقات الهدايا متاحاً عند تنفيذ وحدة Gift Cards في Phase 4." : "تقرير تحميلات التطبيق يحتاج إلى تطبيق العميل وتتبع عمليات التنزيل والتثبيت أولاً."}
    />
  );
}

function StateCard({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="rounded-card border border-dashed border-border bg-background p-10 text-center shadow-sm">
      <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-secondary text-muted-foreground">{icon}</div>
      <h3 className="mt-3 text-sm font-extrabold">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-lg text-xs leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}

function Loading() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[0,1,2,3,4].map((i) => <div key={i} className="h-24 animate-pulse rounded-card border border-border bg-background opacity-60" />)}</div>
      <div className="h-64 animate-pulse rounded-card border border-border bg-background opacity-60" />
    </div>
  );
}

function Filter({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-1 text-[10px] font-bold text-muted-foreground"><span>{label}</span>{children}</label>;
}

function Preset({ children, onClick, active = false }: { children: ReactNode; onClick: () => void; active?: boolean }) {
  return <button type="button" onClick={onClick} className={`rounded-pill border px-3 py-2 text-[11px] font-bold transition ${active ? "border-brand bg-brand/10 text-brand" : "border-border bg-background hover:bg-secondary"}`}>{children}</button>;
}

function ContextPill({ icon, label }: { icon: ReactNode; label: string }) {
  return <span className="inline-flex max-w-full items-center gap-1.5 rounded-pill bg-secondary px-2.5 py-1.5"><span className="shrink-0">{icon}</span><span className="max-w-48 truncate">{label}</span></span>;
}

function formatDate(value: string | null) { return value ? new Intl.DateTimeFormat("ar-SA", { timeZone: "Asia/Riyadh", dateStyle: "medium" }).format(new Date(value)) : "—"; }
function formatDateTime(value: string | null) { return value ? new Intl.DateTimeFormat("ar-SA", { timeZone: "Asia/Riyadh", dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—"; }

function exportRows(key: ReportKey, order: OrderReport, support: ReportCenterSupport, detail?: SalesDetailReport): Array<Record<string, string | number | null | undefined>> {
  if (key === "orders") return order.by_status.map((row) => ({ الحالة: STATUS_LABEL[row.status as OrderStatus] ?? row.status, الطلبات: row.orders }));
  if (key === "sales_period") return order.by_day.map((row) => ({ التاريخ: row.day, الطلبات: row.orders, المكتملة: row.completed_orders, المبيعات: row.sales, الاستردادات: row.refunds, الصافي: row.net_sales }));
  if (key === "sales_location") return order.by_branch.map((row) => ({ الفرع: row.branch_name, الطلبات: row.orders, المكتملة: row.completed_orders, المبيعات: row.sales, الاستردادات: row.refunds, الصافي: row.net_sales }));
  if (key === "sales_details") return (detail?.orders ?? []).map((row) => ({
    رقم_الطلب: row.id,
    التاريخ: row.placed_at,
    الفرع: row.branch_name,
    العميل: row.customer_name,
    الجوال: row.customer_phone,
    نوع_الطلب: ORDER_TYPE_LABEL[row.order_type as OrderType] ?? row.order_type,
    الحالة: STATUS_LABEL[row.status as OrderStatus] ?? row.status,
    المصدر: ORDER_SOURCE_LABEL[row.source] ?? row.source,
    موظف_خدمة_العملاء: row.agent_name,
    طريقة_الدفع: row.payment_method === "online" ? "إلكتروني" : "عند الاستلام",
    حالة_الدفع: PAYMENT_STATUS_LABEL[row.payment_status as PaymentStatus] ?? row.payment_status,
    قبل_الخصم: row.subtotal,
    الخصم: row.discount_total,
    رسوم_التوصيل: row.delivery_fee,
    الضريبة: row.tax_total,
    الإجمالي: row.total,
  }));
  if (key === "driver") return support.drivers.map((row) => ({ السائق: row.driver_name, التوصيلات: row.orders, المبيعات: row.sales, آخر_توصيل: row.last_delivery_at }));
  if (key === "customers") return support.customers.map((row) => ({ العميل: row.name, الجوال: row.phone, الطلبات: row.orders, الإنفاق: row.sales, متوسط_الطلب: row.average_order_value, آخر_طلب: row.last_order_at }));
  if (key === "wallet" || key === "wallet_log") return support.wallet_by_day.map((row) => ({ التاريخ: String(row.day).slice(0,10), الإيداعات: row.credits, الخصومات: row.debits, الحركات: row.movements }));
  if (key === "reward" || key === "points_log") return support.points_by_day.map((row) => ({ التاريخ: String(row.day).slice(0,10), الممنوحة: row.awarded, المستخدمة: row.redeemed, الحركات: row.movements }));
  return [];
}
