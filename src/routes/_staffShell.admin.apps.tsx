import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

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

function AppsPage() {
  const { loading: permissionsLoading, can } = usePermissions();
  const canManage = can("integrations.manage");

  const { data: integrations = [], isLoading, error } = useQuery({
    queryKey: ["integrations"],
    queryFn: fetchIntegrations,
    enabled: !permissionsLoading && canManage,
  });

  if (permissionsLoading || isLoading) {
    return (
      <div className="p-6">
        <div className="card-surface h-40 animate-pulse opacity-60" />
      </div>
    );
  }

  if (!canManage) {
    return (
      <main className="p-6">
        <div className="card-surface p-6 text-center text-sm font-bold text-danger">
          لا تملك صلاحية التحكم بمتجر التطبيقات
        </div>
      </main>
    );
  }

  const connected = integrations.filter((item) => item.integration_status !== "disconnected").length;
  const withCredentials = integrations.filter((item) => item.has_credentials).length;

  return (
    <main className="min-h-screen pb-12">
      <header className="border-b border-border bg-background px-5 py-5">
        <h1 className="text-lg font-extrabold">متجر التطبيقات</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          إدارة تكاملات نقاط البيع، التوصيل، الولاء، التحليلات والخدمات الخارجية.
        </p>
      </header>

      <div className="space-y-5 px-5 py-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <Summary label="التطبيقات المتاحة" value={integrations.length.toLocaleString("ar-SA")} />
          <Summary label="التكاملات المهيأة" value={connected.toLocaleString("ar-SA")} />
          <Summary label="بيانات الاعتماد المحفوظة" value={withCredentials.toLocaleString("ar-SA")} />
        </div>

        <div className="card-surface border border-border p-4">
          <p className="text-sm font-extrabold">خزنة بيانات الاعتماد</p>
          <p className="mt-1 max-w-3xl text-xs leading-6 text-muted-foreground">
            بيانات الدخول للتكاملات تحفظ مشفرة داخل Supabase Vault. لوحة التحكم تعرض فقط ما إذا كانت بيانات الاعتماد موجودة، ولا تعرض السر أو الرمز بعد حفظه.
          </p>
        </div>

        {error ? (
          <div className="card-surface p-6 text-center text-sm font-bold text-danger">
            تعذّر تحميل متجر التطبيقات
          </div>
        ) : integrations.length === 0 ? (
          <div className="card-surface p-6 text-center text-sm font-bold text-muted-foreground">
            لا توجد تطبيقات متاحة حالياً
          </div>
        ) : (
          <IntegrationGroups integrations={integrations} />
        )}
      </div>
    </main>
  );
}

function IntegrationGroups({ integrations }: { integrations: IntegrationProvider[] }) {
  const groups = new Map<string, IntegrationProvider[]>();
  for (const integration of integrations) {
    const list = groups.get(integration.category) ?? [];
    list.push(integration);
    groups.set(integration.category, list);
  }

  return (
    <div className="space-y-5">
      {[...groups.entries()].map(([category, items]) => (
        <section key={category} className="space-y-3">
          <div>
            <h2 className="text-sm font-extrabold">{CATEGORY_LABELS[category] ?? category}</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{items.length.toLocaleString("ar-SA")} تطبيق</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <IntegrationCard key={item.provider_id} integration={item} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function IntegrationCard({ integration }: { integration: IntegrationProvider }) {
  const capabilities = Array.isArray(integration.config_schema["capabilities"])
    ? (integration.config_schema["capabilities"] as string[])
    : [];

  return (
    <article className="card-surface flex min-h-52 flex-col border border-border p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-extrabold">{integration.name_ar}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{integration.name_en}</p>
        </div>
        <StatusBadge status={integration.integration_status} />
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {capabilities.map((capability) => (
          <span key={capability} className="chip text-[10px]">
            {capabilityLabel(capability)}
          </span>
        ))}
      </div>

      <div className="mt-auto space-y-2 pt-5 text-xs">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">بيانات الاعتماد</span>
          <span className={integration.has_credentials ? "font-bold text-success" : "font-bold text-muted-foreground"}>
            {integration.has_credentials ? "محفوظة في الخزنة" : "غير مضافة"}
          </span>
        </div>
        {integration.last_error ? (
          <p className="rounded-card bg-danger/10 px-3 py-2 text-[11px] font-bold text-danger">
            {integration.last_error}
          </p>
        ) : null}
        <div className="rounded-card border border-dashed border-border px-3 py-2 text-center text-[11px] font-bold text-muted-foreground">
          {integration.provider_slug === "foodics"
            ? "إعداد فودكس واختبار الاتصال هو الخطوة التالية"
            : "إعداد الاتصال سيُضاف عند تنفيذ هذا المزود"}
        </div>
      </div>
    </article>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-surface p-4">
      <p className="text-xs font-bold text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-extrabold">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: IntegrationProvider["integration_status"] }) {
  if (status === "active") {
    return <span className="rounded-pill bg-success/10 px-2.5 py-1 text-[11px] font-bold text-success">متصل</span>;
  }
  if (status === "configured") {
    return <span className="rounded-pill bg-brand/10 px-2.5 py-1 text-[11px] font-bold text-brand">مهيأ</span>;
  }
  if (status === "error") {
    return <span className="rounded-pill bg-danger/10 px-2.5 py-1 text-[11px] font-bold text-danger">خطأ</span>;
  }
  if (status === "disabled") {
    return <span className="rounded-pill bg-secondary px-2.5 py-1 text-[11px] font-bold text-muted-foreground">معطل</span>;
  }
  return <span className="rounded-pill bg-secondary px-2.5 py-1 text-[11px] font-bold text-muted-foreground">غير متصل</span>;
}

function capabilityLabel(value: string) {
  if (value === "menu_pull") return "سحب القائمة";
  if (value === "order_push") return "إرسال الطلبات";
  return value;
}
