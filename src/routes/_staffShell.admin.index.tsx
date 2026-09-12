import { useMemo, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bike,
  CarFront,
  ChevronLeft,
  CircleDollarSign,
  ClipboardList,
  Gift,
  Globe2,
  LayoutDashboard,
  MapPin,
  PackageCheck,
  ReceiptText,
  ShoppingBag,
  Store,
  Truck,
  Users,
  Utensils,
  WalletCards,
} from "lucide-react";

import { fetchDashboardStats } from "@/lib/dashboard";
import { formatSAR } from "@/lib/menu";
import { usePermissions } from "@/lib/permissions";
import { ORDER_TYPE_LABEL, type OrderType } from "@/lib/staff";

export const Route = createFileRoute("/_staffShell/admin/")({
  head: () => ({ meta: [{ title: "لوحة التحكم — طلب" }] }),
  component: DashboardPage,
});

const MONTHS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

const REPORT_SHORTCUTS = [
  { label: "تقارير الطلبات", icon: ClipboardList, available: true },
  { label: "المبيعات حسب الفترة", icon: CircleDollarSign, available: true },
  { label: "المبيعات حسب الموقع", icon: MapPin, available: true },
  { label: "تفاصيل المبيعات", icon: ReceiptText, available: true },
  { label: "تقرير السائقين", icon: Bike, available: false },
  { label: "تقرير العملاء", icon: Users, available: false },
  { label: "تحميلات التطبيق", icon: PackageCheck, available: false },
  { label: "تقرير المحفظة", icon: WalletCards, available: false },
  { label: "تقرير المكافآت", icon: Gift, available: false },
  { label: "بطاقات الهدايا", icon: Gift, available: false },
  { label: "إحصائيات سجل المحفظة", icon: WalletCards, available: false },
  { label: "إحصائيات سجل النقاط", icon: CircleDollarSign, available: false },
] as const;

function riyadhNowParts() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "numeric",
  }).formatToParts(new Date());
  return {
    year: Number(parts.find((part) => part.type === "year")?.value ?? new Date().getUTCFullYear()),
    month: Number(parts.find((part) => part.type === "month")?.value ?? 1),
  };
}

function DashboardPage() {
  const { loading: permissionsLoading, can } = usePermissions();
  const now = useMemo(riyadhNowParts, []);
  const [year, setYear] = useState(now.year);
  const [month, setMonth] = useState(now.month);
  const [orderType, setOrderType] = useState<"" | OrderType>("");
  const [branchId, setBranchId] = useState("");
  const canStats = can("dashboard.stats");
  const canReports = can("dashboard.reports");

  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard", year, month, orderType, branchId],
    queryFn: () => fetchDashboardStats({
      year,
      month,
      orderType: orderType || null,
      branchId: branchId || null,
    }),
    enabled: !permissionsLoading && canStats,
  });

  if (permissionsLoading) return <DashboardSkeleton />;
  if (!canStats) {
    return (
      <main className="p-6">
        <div className="card-surface p-6 text-center text-sm font-bold text-danger">
          لا تملك صلاحية عرض إحصائيات لوحة التحكم
        </div>
      </main>
    );
  }

  const kpis = data?.kpis;
  const maxSales = Math.max(1, ...(data?.chart.map((row) => Number(row.sales)) ?? [1]));
  const chartSales = data?.chart.reduce((sum, row) => sum + Number(row.sales), 0) ?? 0;
  const chartCompleted = data?.chart.reduce((sum, row) => sum + Number(row.completed_orders), 0) ?? 0;

  return (
    <main className="min-h-screen pb-12">
      <header className="border-b border-border bg-background px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-bold text-brand">
              <LayoutDashboard aria-hidden className="size-4" /> لوحة التحكم
            </div>
            <h1 className="text-xl font-extrabold">نظرة عامة على نشاط المطعم</h1>
            <p className="mt-1 text-xs leading-6 text-muted-foreground">
              المؤشرات الرئيسية تغطي آخر 12 شهراً، ومخطط المبيعات يعمل بتوقيت الرياض ويحترم صلاحيات الفروع.
            </p>
          </div>
          <span className="rounded-pill border border-border bg-secondary/50 px-3 py-1.5 text-[11px] font-bold text-muted-foreground">
            آخر 12 شهر
          </span>
        </div>
      </header>

      <div className="space-y-6 px-5 py-6">
        {error ? (
          <div className="rounded-card border border-danger/30 bg-danger/10 p-4 text-sm font-bold text-danger">
            تعذّر تحميل بيانات لوحة التحكم. تأكد من الصلاحيات ثم أعد المحاولة.
          </div>
        ) : null}

        {isLoading || !kpis ? (
          <DashboardSkeleton compact />
        ) : (
          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-extrabold">المؤشرات الرئيسية</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">نافذة متحركة لآخر 12 شهراً</p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
              <KpiTile icon={<ShoppingBag className="size-4" />} label="عدد الطلبات" value={kpis.orders} />
              <KpiTile icon={<PackageCheck className="size-4" />} label="الطلبات المكتملة" value={kpis.completed_orders} />
              <KpiTile icon={<Gift className="size-4" />} label="نقاط الولاء" value={kpis.loyalty_points} />
              <KpiTile icon={<WalletCards className="size-4" />} label="سجل المحفظة" value={kpis.wallet_log} />
              <KpiTile icon={<Truck className="size-4" />} label="طلبات التوصيل" value={kpis.delivery_orders} />
              <KpiTile icon={<Store className="size-4" />} label="طلبات الاستلام" value={kpis.pickup_orders} />
              <KpiTile icon={<CarFront className="size-4" />} label="من السيارة" value={kpis.curbside_orders} />
              <KpiTile icon={<Utensils className="size-4" />} label="الطلب المحلي" value={kpis.dinein_orders} />
            </div>
          </section>
        )}

        <section className="card-surface overflow-hidden border border-border">
          <div className="border-b border-border p-4 lg:p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-sm font-extrabold">المبيعات اليومية</h2>
                <p className="mt-1 text-xs text-muted-foreground">مبيعات الطلبات المكتملة حسب اليوم</p>
              </div>
              <div className="flex gap-5 text-xs">
                <ChartMetric label="المبيعات" value={formatSAR(chartSales)} />
                <ChartMetric label="الطلبات المكتملة" value={chartCompleted.toLocaleString("ar-SA")} />
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <FilterSelect label="السنة" value={String(year)} onChange={(value) => setYear(Number(value))}>
                {(data?.years.length ? data.years : [now.year]).map((item) => <option key={item} value={item}>{item}</option>)}
              </FilterSelect>
              <FilterSelect label="الشهر" value={String(month)} onChange={(value) => setMonth(Number(value))}>
                {MONTHS.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
              </FilterSelect>
              <FilterSelect label="نوع الطلب" value={orderType} onChange={(value) => setOrderType(value as "" | OrderType)}>
                <option value="">كل أنواع الطلبات</option>
                {(Object.keys(ORDER_TYPE_LABEL) as OrderType[]).map((type) => <option key={type} value={type}>{ORDER_TYPE_LABEL[type]}</option>)}
              </FilterSelect>
              <FilterSelect label="الفرع" value={branchId} onChange={setBranchId}>
                <option value="">كل الفروع المتاحة</option>
                {data?.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name_ar}</option>)}
              </FilterSelect>
            </div>
          </div>

          <div className="p-4 lg:p-5">
            {isLoading ? (
              <div className="h-64 animate-pulse rounded-card bg-secondary/60" />
            ) : data?.chart.length ? (
              <div className="overflow-x-auto">
                <div className="flex h-64 min-w-[760px] items-end gap-1 border-b border-border pb-2">
                  {data.chart.map((row) => {
                    const sales = Number(row.sales);
                    const height = Math.max(3, (sales / maxSales) * 205);
                    return (
                      <div
                        key={row.day}
                        className="group flex min-w-5 flex-1 flex-col items-center justify-end gap-1"
                        title={`${row.day} · ${formatSAR(sales)} · ${row.completed_orders} طلب مكتمل`}
                      >
                        <span className="text-[9px] font-bold text-muted-foreground opacity-0 transition group-hover:opacity-100">
                          {row.completed_orders}
                        </span>
                        <div className="w-full max-w-7 rounded-t bg-brand transition group-hover:opacity-80" style={{ height }} />
                        <span className="text-[9px] text-muted-foreground">{Number(row.day.slice(-2)).toLocaleString("ar-SA")}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="py-16 text-center text-sm text-muted-foreground">لا توجد مبيعات في الفترة المحددة</p>
            )}
          </div>
        </section>

        <section>
          <div className="mb-3">
            <h2 className="text-sm font-extrabold">وصول سريع</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">أهم نقاط التشغيل اليومية</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <a href="/" target="_blank" rel="noreferrer" className="card-surface group flex items-center gap-3 border border-border p-4 hover:border-brand/40">
              <LauncherIcon><Globe2 className="size-5" /></LauncherIcon>
              <div className="min-w-0 flex-1"><p className="text-sm font-extrabold">الموقع الإلكتروني</p><p className="mt-0.5 text-[11px] text-muted-foreground">فتح واجهة العميل</p></div>
              <ChevronLeft className="size-4 text-muted-foreground transition group-hover:-translate-x-0.5" />
            </a>
            {can("orders.page.view") ? (
              <Link to="/admin/orders" className="card-surface group flex items-center gap-3 border border-border p-4 hover:border-brand/40">
                <LauncherIcon><ClipboardList className="size-5" /></LauncherIcon>
                <div className="min-w-0 flex-1"><p className="text-sm font-extrabold">استقبال الطلبات KDS</p><p className="mt-0.5 text-[11px] text-muted-foreground">الطلبات المباشرة والتنبيهات</p></div>
                <ChevronLeft className="size-4 text-muted-foreground transition group-hover:-translate-x-0.5" />
              </Link>
            ) : <LockedLauncher icon={<ClipboardList className="size-5" />} label="استقبال الطلبات KDS" />}
            <div className="card-surface flex items-center gap-3 border border-border p-4">
              <LauncherIcon><Bike className="size-5" /></LauncherIcon>
              <div className="min-w-0 flex-1"><p className="text-sm font-extrabold">تطبيق السائقين</p><p className="mt-0.5 text-[11px] text-muted-foreground">تطبيق Expo منفصل · جاهز للتشغيل</p></div>
              <span className="rounded-pill bg-secondary px-2 py-1 text-[10px] font-bold text-muted-foreground">Expo</span>
            </div>
            {can("integrations.manage") ? (
              <Link to="/admin/apps" className="card-surface group flex items-center gap-3 border border-border p-4 hover:border-brand/40">
                <LauncherIcon><Store className="size-5" /></LauncherIcon>
                <div className="min-w-0 flex-1"><p className="text-sm font-extrabold">صفحة التطبيقات</p><p className="mt-0.5 text-[11px] text-muted-foreground">التكاملات ومزودو التوصيل</p></div>
                <ChevronLeft className="size-4 text-muted-foreground transition group-hover:-translate-x-0.5" />
              </Link>
            ) : <LockedLauncher icon={<Store className="size-5" />} label="صفحة التطبيقات" />}
          </div>
        </section>

        {canReports ? (
          <section>
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-sm font-extrabold">التقارير</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">12 اختصاراً حسب بنية لوحة التحكم الأصلية</p>
              </div>
              <Link to="/admin/reports" className="text-xs font-bold text-brand">فتح التقارير</Link>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {REPORT_SHORTCUTS.map(({ label, icon: Icon, available }) => available ? (
                <Link key={label} to="/admin/reports" className="group flex items-center gap-3 rounded-card border border-border bg-background p-3.5 hover:border-brand/40">
                  <span className="flex size-9 items-center justify-center rounded-card bg-secondary text-brand"><Icon className="size-4" /></span>
                  <span className="min-w-0 flex-1 text-xs font-bold">{label}</span>
                  <ChevronLeft className="size-3.5 text-muted-foreground transition group-hover:-translate-x-0.5" />
                </Link>
              ) : (
                <div key={label} className="flex items-center gap-3 rounded-card border border-border bg-background p-3.5 opacity-65">
                  <span className="flex size-9 items-center justify-center rounded-card bg-secondary text-muted-foreground"><Icon className="size-4" /></span>
                  <span className="min-w-0 flex-1 text-xs font-bold">{label}</span>
                  <span className="text-[9px] font-bold text-muted-foreground">قريباً</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function KpiTile({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="card-surface border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex size-8 items-center justify-center rounded-card bg-secondary text-brand">{icon}</span>
        <span className="text-[9px] font-bold text-muted-foreground">12 شهر</span>
      </div>
      <p className="mt-4 text-2xl font-extrabold tabular-nums">{Number(value || 0).toLocaleString("ar-SA")}</p>
      <p className="mt-1 text-[11px] font-bold text-muted-foreground">{label}</p>
    </div>
  );
}

function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-[11px] font-bold text-muted-foreground">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="rounded-card border border-border bg-background px-3 py-2.5 text-xs font-bold text-foreground">
        {children}
      </select>
    </label>
  );
}

function ChartMetric({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[10px] text-muted-foreground">{label}</p><p className="mt-0.5 font-extrabold">{value}</p></div>;
}

function LauncherIcon({ children }: { children: ReactNode }) {
  return <span className="flex size-11 shrink-0 items-center justify-center rounded-card bg-brand/10 text-brand">{children}</span>;
}

function LockedLauncher({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="card-surface flex items-center gap-3 border border-border p-4 opacity-55">
      <LauncherIcon>{icon}</LauncherIcon>
      <div className="min-w-0 flex-1"><p className="text-sm font-extrabold">{label}</p><p className="mt-0.5 text-[11px] text-muted-foreground">غير متاح حسب صلاحياتك</p></div>
    </div>
  );
}

function DashboardSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8" : "space-y-4 p-6"}>
      {Array.from({ length: compact ? 8 : 4 }).map((_, index) => <div key={index} className="card-surface h-28 animate-pulse opacity-60" />)}
    </div>
  );
}
