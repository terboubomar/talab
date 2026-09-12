import { useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronLeft, LockKeyhole, PlugZap, Search, Store } from "lucide-react";

import { FoodicsIntegrationWorkspace } from "@/components/admin/FoodicsIntegrationWorkspace";
import { LoyverseIntegrationWorkspace } from "@/components/admin/LoyverseIntegrationWorkspace";
import {
  TrackingIntegrationWorkspace,
  isTrackingIntegration,
} from "@/components/admin/TrackingIntegrationWorkspace";
import { fetchIntegrations, type IntegrationProvider } from "@/lib/integrations";
import { usePermissions } from "@/lib/permissions";

export const Route = createFileRoute("/_staffShell/admin/apps")({
  head: () => ({ meta: [{ title: "متجر التطبيقات — طلب" }] }),
  component: AppsPage,
});

const CATEGORY_LABELS: Record<string, string> = {
  delivery: "مزودي التوصيل",
  pos: "نقطة البيع",
  loyalty: "الولاء",
  analytics: "التحليلات",
  communication: "الاتصال",
  notifications: "الإشعارات",
  accounting: "المحاسبة",
  sms: "SMS",
  other: "أخرى",
};

function marketplaceDescription(integration: IntegrationProvider) {
  const configured = integration.config_schema["description_ar"];
  if (typeof configured === "string" && configured.trim()) return configured;
  if (integration.provider_slug === "foodics") return "مزامنة القائمة والفروع وإرسال طلبات طلب إلى Foodics.";
  if (integration.provider_slug === "loyverse") return "اربط فروع طلب بمتاجر Loyverse واختبر الاتصال مباشرة من متجر التطبيقات.";
  if (integration.category === "delivery") return "إسناد طلبات التوصيل المباشرة إلى مزود الميل الأخير ومتابعة حالة التوصيل من طلب.";
  if (integration.category === "pos") return "تكامل نقطة بيع لإدارة تدفق البيانات والطلبات من خلال متجر التطبيقات.";
  return "تكامل خارجي لإضافة قدرات جديدة إلى حساب المطعم من خلال متجر التطبيقات.";
}

function AppsPage() {
  const { loading: permissionsLoading, can } = usePermissions();
  const canManage = can("integrations.manage");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const { data: integrations = [], isLoading, error } = useQuery({
    queryKey: ["integrations"],
    queryFn: fetchIntegrations,
    enabled: !permissionsLoading && canManage,
  });

  if (permissionsLoading || isLoading) {
    return <div className="p-6"><div className="card-surface h-40 animate-pulse opacity-60" /></div>;
  }

  if (!canManage) {
    return <main className="p-6"><div className="card-surface p-6 text-center text-sm font-bold text-danger">لا تملك صلاحية التحكم بمتجر التطبيقات</div></main>;
  }

  const selected = selectedSlug
    ? integrations.find((integration) => integration.provider_slug === selectedSlug) ?? null
    : null;

  if (selected) {
    return <AppWorkspace integration={selected} onBack={() => setSelectedSlug(null)} />;
  }

  const normalizedSearch = search.trim().toLowerCase();
  const filtered = integrations.filter((integration) => {
    if (!normalizedSearch) return true;
    return [integration.name_ar, integration.name_en, CATEGORY_LABELS[integration.category] ?? integration.category]
      .join(" ")
      .toLowerCase()
      .includes(normalizedSearch);
  });

  const connected = integrations.filter((item) => item.integration_status === "active").length;
  const configured = integrations.filter((item) => item.integration_status !== "disconnected").length;

  return (
    <main className="min-h-screen pb-12">
      <header className="border-b border-border bg-background px-5 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-bold text-brand"><Store aria-hidden className="size-4" />متجر التطبيقات</div>
            <h1 className="text-xl font-extrabold">اربط طلب بالأدوات التي تستخدمها</h1>
            <p className="mt-1 max-w-2xl text-xs leading-6 text-muted-foreground">اختر التطبيق لفتح صفحة التكامل الخاصة به، ثم أدر الاتصال والمزامنة والإعدادات من مكان واحد.</p>
          </div>
          <div className="flex gap-2 text-xs">
            <MetricChip label="متصل" value={connected} />
            <MetricChip label="مهيأ" value={configured} />
          </div>
        </div>
      </header>

      <div className="space-y-6 px-5 py-6">
        <section className="grid gap-3 lg:grid-cols-[1fr_auto]">
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث عن تطبيق أو فئة..." className="w-full rounded-card border border-border bg-background py-3 pe-10 ps-4 text-sm outline-none transition focus:border-brand" />
          </div>
          <div className="flex items-center gap-2 rounded-card border border-border bg-secondary/40 px-4 py-3 text-xs text-muted-foreground"><LockKeyhole aria-hidden className="size-4 text-success" />بيانات الاعتماد الحساسة محفوظة في Supabase Vault</div>
        </section>

        {error ? (
          <div className="card-surface p-6 text-center text-sm font-bold text-danger">تعذّر تحميل متجر التطبيقات</div>
        ) : filtered.length === 0 ? (
          <div className="card-surface p-10 text-center text-sm text-muted-foreground">لا توجد تطبيقات مطابقة لبحثك</div>
        ) : (
          <MarketplaceGrid integrations={filtered} onOpen={setSelectedSlug} />
        )}
      </div>
    </main>
  );
}

function MarketplaceGrid({ integrations, onOpen }: { integrations: IntegrationProvider[]; onOpen: (slug: string) => void }) {
  const groups = new Map<string, IntegrationProvider[]>();
  for (const integration of integrations) {
    const items = groups.get(integration.category) ?? [];
    items.push(integration);
    groups.set(integration.category, items);
  }

  return (
    <div className="space-y-7">
      {[...groups.entries()].map(([category, items]) => (
        <section key={category}>
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-extrabold">{CATEGORY_LABELS[category] ?? category}</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{items.length.toLocaleString("ar-SA")} تطبيق</p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {items.map((integration) => <MarketplaceCard key={integration.provider_id} integration={integration} onOpen={() => onOpen(integration.provider_slug)} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function MarketplaceCard({ integration, onOpen }: { integration: IntegrationProvider; onOpen: () => void }) {
  const capabilities = Array.isArray(integration.config_schema["capabilities"])
    ? (integration.config_schema["capabilities"] as string[])
    : [];
  const tracking = isTrackingIntegration(integration.provider_slug);
  const configured = integration.integration_status !== "disconnected";

  return (
    <button type="button" onClick={onOpen} className="group card-surface relative flex min-h-56 w-full flex-col overflow-hidden border border-border p-5 text-right transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3"><AppMark integration={integration} /><div><p className="text-base font-extrabold">{integration.name_ar}</p><p className="mt-0.5 text-xs text-muted-foreground">{integration.name_en}</p></div></div>
        <StatusBadge status={integration.integration_status} />
      </div>
      <p className="mt-4 text-xs leading-6 text-muted-foreground">{marketplaceDescription(integration)}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">{capabilities.map((capability) => <span key={capability} className="chip text-[10px]">{capabilityLabel(capability)}</span>)}</div>
      <div className="mt-auto flex items-center justify-between border-t border-border pt-4 text-xs">
        <span className={configured ? "font-bold text-success" : "text-muted-foreground"}>
          {configured ? (tracking ? "معرّف التتبع محفوظ" : integration.has_credentials ? "بيانات الاعتماد محفوظة" : "تم الإعداد") : "يحتاج إلى إعداد"}
        </span>
        <span className="inline-flex items-center gap-1 font-bold text-brand">فتح التطبيق<ChevronLeft aria-hidden className="size-3.5 transition group-hover:-translate-x-0.5" /></span>
      </div>
    </button>
  );
}

function AppWorkspace({ integration, onBack }: { integration: IntegrationProvider; onBack: () => void }) {
  const tracking = isTrackingIntegration(integration.provider_slug);
  const publicTracking = tracking ? "معرّف عام بدون Secret" : null;

  return (
    <main className="min-h-screen pb-12">
      <header className="border-b border-border bg-background px-5 py-5">
        <button type="button" onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground"><ArrowRight aria-hidden className="size-3.5" />رجوع إلى متجر التطبيقات</button>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AppMark integration={integration} large />
            <div><div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-extrabold">{integration.name_ar}</h1><StatusBadge status={integration.integration_status} /></div><p className="mt-1 text-xs text-muted-foreground">{integration.name_en} · {CATEGORY_LABELS[integration.category] ?? integration.category}</p></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <InfoPill icon={<LockKeyhole className="size-3.5" />} label={publicTracking ?? (integration.has_credentials ? "الاعتماد محفوظ" : "بدون اعتماد")} />
            <InfoPill icon={<PlugZap className="size-3.5" />} label={statusLabel(integration.integration_status)} />
          </div>
        </div>
      </header>

      <div className="px-5 py-6">
        {integration.provider_slug === "foodics" ? (
          <FoodicsIntegrationWorkspace integration={integration} />
        ) : integration.provider_slug === "loyverse" ? (
          <LoyverseIntegrationWorkspace integration={integration} />
        ) : tracking ? (
          <TrackingIntegrationWorkspace integration={integration} />
        ) : (
          <ComingSoonWorkspace integration={integration} />
        )}
      </div>
    </main>
  );
}

function ComingSoonWorkspace({ integration }: { integration: IntegrationProvider }) {
  const isCareem = integration.provider_slug === "careem";
  const docs = typeof integration.config_schema["developer_hub_url"] === "string" ? String(integration.config_schema["developer_hub_url"]) : null;
  return (
    <section className="card-surface border border-border p-8 text-center">
      <div className="flex justify-center"><AppMark integration={integration} large /></div>
      <h2 className="mt-4 text-lg font-extrabold">{integration.name_ar}</h2>
      <p className="mx-auto mt-2 max-w-xl text-xs leading-6 text-muted-foreground">{isCareem ? "بنية طلب جاهزة لإسناد الطلب إلى مزود توصيل خارجي ومتابعة حالته. تفعيل Careem الفعلي يحتاج بيانات اعتماد وعقد API من Careem Developer Hub؛ لن نخمن حقول الاعتماد أو مسارات API غير المنشورة." : "صفحة التطبيق جاهزة داخل بنية متجر التطبيقات. إعداد الاتصال لهذا المزود سيُضاف عند تنفيذ تكامله في خارطة المشروع."}</p>
      {isCareem && docs ? <a href={docs} target="_blank" rel="noreferrer" className="mt-5 inline-flex rounded-card bg-brand px-4 py-2.5 text-xs font-bold text-brand-ink">فتح Careem Developer Hub</a> : null}
      <div><span className="mt-5 inline-flex rounded-pill bg-secondary px-3 py-1.5 text-xs font-bold text-muted-foreground">{isCareem ? "بانتظار اعتماد Careem API" : "قريباً"}</span></div>
    </section>
  );
}

function AppMark({ integration, large = false }: { integration: IntegrationProvider; large?: boolean }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const boxSize = large ? "h-14 w-20" : "h-11 w-16";
  const fallbackSize = large ? "text-lg" : "text-sm";
  const showLogo = Boolean(integration.logo) && !logoFailed;
  return <div className={`${boxSize} flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-background p-2`}>{showLogo ? <img src={integration.logo ?? undefined} alt={`${integration.name_en} logo`} className="max-h-full max-w-full object-contain" loading="lazy" onError={() => setLogoFailed(true)} /> : <span className={`${fallbackSize} font-black`}>{integration.name_en.slice(0, 1).toUpperCase()}</span>}</div>;
}
function MetricChip({ label, value }: { label: string; value: number }) {
  return <div className="rounded-card border border-border bg-secondary/40 px-3 py-2 text-center"><p className="text-sm font-extrabold">{value.toLocaleString("ar-SA")}</p><p className="text-[10px] text-muted-foreground">{label}</p></div>;
}
function InfoPill({ icon, label }: { icon: ReactNode; label: string }) {
  return <span className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-secondary/50 px-3 py-1.5 text-[11px] font-bold">{icon}{label}</span>;
}
function StatusBadge({ status }: { status: IntegrationProvider["integration_status"] }) {
  if (status === "active") return <span className="rounded-pill bg-success/10 px-2.5 py-1 text-[11px] font-bold text-success">متصل</span>;
  if (status === "configured") return <span className="rounded-pill bg-brand/10 px-2.5 py-1 text-[11px] font-bold text-brand">مهيأ</span>;
  if (status === "error") return <span className="rounded-pill bg-danger/10 px-2.5 py-1 text-[11px] font-bold text-danger">خطأ</span>;
  if (status === "disabled") return <span className="rounded-pill bg-secondary px-2.5 py-1 text-[11px] font-bold text-muted-foreground">معطل</span>;
  return <span className="rounded-pill bg-secondary px-2.5 py-1 text-[11px] font-bold text-muted-foreground">غير متصل</span>;
}
function statusLabel(status: IntegrationProvider["integration_status"]) {
  if (status === "active") return "متصل";
  if (status === "configured") return "مهيأ";
  if (status === "error") return "يوجد خطأ";
  if (status === "disabled") return "معطل";
  return "غير متصل";
}
function capabilityLabel(value: string) {
  if (value === "menu_pull") return "سحب القائمة";
  if (value === "order_push") return "إرسال الطلبات";
  if (value === "delivery_dispatch") return "إسناد التوصيل";
  if (value === "delivery_tracking") return "تتبع التوصيل";
  if (value === "sandbox") return "Sandbox";
  if (value === "page_view") return "Page View";
  if (value === "conversion_tracking") return "تتبع التحويلات";
  if (value === "tag_manager") return "إدارة الوسوم";
  if (value === "analytics") return "التحليلات";
  if (value === "connection_test") return "اختبار الاتصال";
  if (value === "store_mapping") return "ربط المتاجر";
  if (value === "items_read") return "قراءة المنتجات";
  if (value === "receipts_read") return "قراءة المبيعات";
  return value;
}
