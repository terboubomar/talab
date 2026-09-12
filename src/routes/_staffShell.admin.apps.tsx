import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  Database,
  LockKeyhole,
  PlugZap,
  Search,
  Settings2,
  Store,
} from "lucide-react";

import {
  fetchFoodicsSetup,
  fetchIntegrations,
  pullFoodicsMenu,
  saveFoodicsBranchMapping,
  saveIntegration,
  testFoodicsConnection,
  type FoodicsBranch,
  type FoodicsMenuPreview,
  type IntegrationProvider,
} from "@/lib/integrations";
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
            <div className="mb-2 flex items-center gap-2 text-xs font-bold text-brand">
              <Store aria-hidden className="size-4" />
              متجر التطبيقات
            </div>
            <h1 className="text-xl font-extrabold">اربط طلب بالأدوات التي تستخدمها</h1>
            <p className="mt-1 max-w-2xl text-xs leading-6 text-muted-foreground">
              اختر التطبيق لفتح صفحة التكامل الخاصة به، ثم أدر الاتصال والمزامنة والإعدادات من مكان واحد.
            </p>
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
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="ابحث عن تطبيق أو فئة..."
              className="w-full rounded-card border border-border bg-background py-3 pe-10 ps-4 text-sm outline-none transition focus:border-brand"
            />
          </div>
          <div className="flex items-center gap-2 rounded-card border border-border bg-secondary/40 px-4 py-3 text-xs text-muted-foreground">
            <LockKeyhole aria-hidden className="size-4 text-success" />
            بيانات الاعتماد محفوظة في Supabase Vault
          </div>
        </section>

        {error ? (
          <div className="card-surface p-6 text-center text-sm font-bold text-danger">
            تعذّر تحميل متجر التطبيقات
          </div>
        ) : filtered.length === 0 ? (
          <div className="card-surface p-10 text-center text-sm text-muted-foreground">
            لا توجد تطبيقات مطابقة لبحثك
          </div>
        ) : (
          <MarketplaceGrid integrations={filtered} onOpen={setSelectedSlug} />
        )}
      </div>
    </main>
  );
}

function MarketplaceGrid({
  integrations,
  onOpen,
}: {
  integrations: IntegrationProvider[];
  onOpen: (slug: string) => void;
}) {
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
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {items.length.toLocaleString("ar-SA")} تطبيق
              </p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {items.map((integration) => (
              <MarketplaceCard
                key={integration.provider_id}
                integration={integration}
                onOpen={() => onOpen(integration.provider_slug)}
              />
            ))}
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

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group card-surface relative flex min-h-56 w-full flex-col overflow-hidden border border-border p-5 text-right transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <AppMark integration={integration} />
          <div>
            <p className="text-base font-extrabold">{integration.name_ar}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{integration.name_en}</p>
          </div>
        </div>
        <StatusBadge status={integration.integration_status} />
      </div>

      <p className="mt-4 text-xs leading-6 text-muted-foreground">{marketplaceDescription(integration)}</p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {capabilities.map((capability) => (
          <span key={capability} className="chip text-[10px]">
            {capabilityLabel(capability)}
          </span>
        ))}
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-border pt-4 text-xs">
        <span className={integration.has_credentials ? "font-bold text-success" : "text-muted-foreground"}>
          {integration.has_credentials ? "بيانات الاعتماد محفوظة" : "يحتاج إلى إعداد"}
        </span>
        <span className="inline-flex items-center gap-1 font-bold text-brand">
          فتح التطبيق
          <ChevronLeft aria-hidden className="size-3.5 transition group-hover:-translate-x-0.5" />
        </span>
      </div>
    </button>
  );
}

function AppWorkspace({ integration, onBack }: { integration: IntegrationProvider; onBack: () => void }) {
  return (
    <main className="min-h-screen pb-12">
      <header className="border-b border-border bg-background px-5 py-5">
        <button
          type="button"
          onClick={onBack}
          className="mb-4 inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground"
        >
          <ArrowRight aria-hidden className="size-3.5" />
          رجوع إلى متجر التطبيقات
        </button>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AppMark integration={integration} large />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-extrabold">{integration.name_ar}</h1>
                <StatusBadge status={integration.integration_status} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {integration.name_en} · {CATEGORY_LABELS[integration.category] ?? integration.category}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <InfoPill icon={<LockKeyhole className="size-3.5" />} label={integration.has_credentials ? "الاعتماد محفوظ" : "بدون اعتماد"} />
            <InfoPill icon={<PlugZap className="size-3.5" />} label={statusLabel(integration.integration_status)} />
          </div>
        </div>
      </header>

      <div className="px-5 py-6">
        {integration.provider_slug === "foodics" ? (
          <FoodicsWorkspace integration={integration} />
        ) : (
          <ComingSoonWorkspace integration={integration} />
        )}
      </div>
    </main>
  );
}

function FoodicsWorkspace({ integration }: { integration: IntegrationProvider }) {
  const queryClient = useQueryClient();
  const { data: setup, isLoading } = useQuery({
    queryKey: ["foodics-setup"],
    queryFn: fetchFoodicsSetup,
  });
  const [token, setToken] = useState("");
  const [environment, setEnvironment] = useState<"production" | "sandbox">("production");
  const [targetMenuId, setTargetMenuId] = useState("");
  const [foodicsBranches, setFoodicsBranches] = useState<FoodicsBranch[]>([]);
  const [branchDrafts, setBranchDrafts] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<FoodicsMenuPreview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!setup) return;
    setEnvironment(setup.settings["environment"] === "sandbox" ? "sandbox" : "production");
    setTargetMenuId(
      typeof setup.settings["target_menu_id"] === "string" ? setup.settings["target_menu_id"] : "",
    );
    const next: Record<string, string> = {};
    for (const mapping of setup.mappings) next[mapping.branch_id] = mapping.external_branch_id;
    setBranchDrafts(next);
  }, [setup]);

  const mappedCount = setup?.mappings.filter((mapping) => mapping.active).length ?? 0;
  const selectedMenu = useMemo(
    () => setup?.menus.find((menu) => menu.id === targetMenuId),
    [setup, targetMenuId],
  );

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["integrations"] }),
      queryClient.invalidateQueries({ queryKey: ["foodics-setup"] }),
    ]);
  }

  async function saveConfiguration() {
    setBusy("save");
    setMessage(null);
    try {
      if (!targetMenuId) throw new Error("اختر قائمة طلب التي ستستقبل بيانات فودكس");
      if (!integration.integration_id && !token.trim()) {
        throw new Error("أدخل Foodics Access Token لتهيئة الاتصال لأول مرة");
      }
      await saveIntegration({
        providerSlug: "foodics",
        credentials: token.trim() ? { access_token: token.trim() } : null,
        settings: { ...integration.settings_json, environment, target_menu_id: targetMenuId },
        status: "configured",
      });
      setToken("");
      await refresh();
      setMessage("تم حفظ إعدادات فودكس وبيانات الاعتماد في الخزنة");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذّر حفظ إعدادات فودكس");
    } finally {
      setBusy(null);
    }
  }

  async function testConnection() {
    setBusy("test");
    setMessage(null);
    try {
      const result = await testFoodicsConnection();
      setFoodicsBranches(result.branches);
      await refresh();
      setMessage(`تم الاتصال بفودكس بنجاح — ${result.branches.length.toLocaleString("ar-SA")} فرع متاح للربط`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "فشل اختبار الاتصال بفودكس");
    } finally {
      setBusy(null);
    }
  }

  async function saveMapping(branchId: string) {
    const externalId = branchDrafts[branchId];
    const external = foodicsBranches.find((branch) => branch.id === externalId);
    if (!externalId) {
      setMessage("اختر فرع فودكس أولاً");
      return;
    }
    setBusy(`map:${branchId}`);
    setMessage(null);
    try {
      await saveFoodicsBranchMapping({
        branchId,
        externalBranchId: externalId,
        externalBranchName: external?.name_localized || external?.name || null,
      });
      await refresh();
      setMessage("تم حفظ ربط الفرع");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذّر حفظ ربط الفرع");
    } finally {
      setBusy(null);
    }
  }

  async function previewMenu() {
    setBusy("preview");
    setMessage(null);
    try {
      const result = await pullFoodicsMenu(false);
      setPreview(result);
      setMessage("تمت معاينة بيانات فودكس. راجع الأعداد ثم اختر تطبيق السحب.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذّرت معاينة قائمة فودكس");
    } finally {
      setBusy(null);
    }
  }

  async function applyMenu() {
    if (!preview) return;
    setBusy("apply");
    setMessage(null);
    try {
      const result = await pullFoodicsMenu(true);
      setPreview(result);
      await refresh();
      setMessage(`اكتمل سحب القائمة: ${result.counts.products.toLocaleString("ar-SA")} منتج`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذّر تطبيق سحب قائمة فودكس");
    } finally {
      setBusy(null);
    }
  }

  if (isLoading || !setup) {
    return <div className="card-surface h-64 animate-pulse opacity-60" />;
  }

  return (
    <div className="space-y-5">
      <section className="grid gap-3 md:grid-cols-3">
        <WorkspaceStat
          icon={<PlugZap className="size-4" />}
          label="حالة الاتصال"
          value={statusLabel(integration.integration_status)}
        />
        <WorkspaceStat
          icon={<Database className="size-4" />}
          label="الفروع المربوطة"
          value={mappedCount.toLocaleString("ar-SA")}
        />
        <WorkspaceStat
          icon={<CheckCircle2 className="size-4" />}
          label="قائمة المزامنة"
          value={selectedMenu?.name_ar ?? "غير محددة"}
        />
      </section>

      <section className="card-surface border border-border p-5">
        <SectionTitle
          icon={<Settings2 className="size-4" />}
          title="الاتصال والإعدادات"
          description="احفظ بيانات الاعتماد وحدد البيئة والقائمة التي ستستقبل بيانات Foodics."
        />
        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          <Field label="Foodics Access Token">
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={integration.has_credentials ? "اتركه فارغاً للإبقاء على الرمز الحالي" : "يُحفظ مباشرة في Supabase Vault"}
              className="w-full rounded-card border border-border bg-background px-3 py-2.5 text-sm"
              dir="ltr"
              autoComplete="new-password"
            />
          </Field>
          <Field label="البيئة">
            <select
              value={environment}
              onChange={(event) => setEnvironment(event.target.value as "production" | "sandbox")}
              className="w-full rounded-card border border-border bg-background px-3 py-2.5 text-sm"
            >
              <option value="production">Production</option>
              <option value="sandbox">Sandbox</option>
            </select>
          </Field>
          <Field label="قائمة طلب المستهدفة">
            <select
              value={targetMenuId}
              onChange={(event) => setTargetMenuId(event.target.value)}
              className="w-full rounded-card border border-border bg-background px-3 py-2.5 text-sm"
            >
              <option value="">اختر القائمة</option>
              {setup.menus.map((menu) => (
                <option key={menu.id} value={menu.id}>
                  {menu.name_ar}{menu.is_default ? " — افتراضية" : ""}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <ActionButton busy={busy === "save"} onClick={saveConfiguration}>حفظ الإعدادات</ActionButton>
          <ActionButton
            busy={busy === "test"}
            onClick={testConnection}
            secondary
            disabled={!integration.has_credentials && !token.trim()}
          >
            اختبار الاتصال وجلب الفروع
          </ActionButton>
        </div>
      </section>

      <section className="card-surface border border-border p-5">
        <SectionTitle
          icon={<PlugZap className="size-4" />}
          title="ربط الفروع"
          description="اربط كل فرع في طلب بفرعه المقابل في Foodics قبل إرسال الطلبات أو مزامنة أسعار الفروع."
        />
        {foodicsBranches.length === 0 ? (
          <div className="mt-4 rounded-card border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            اختبر الاتصال أولاً لجلب فروع Foodics المتاحة للربط.
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {setup.branches.map((branch) => (
              <div
                key={branch.id}
                className="grid items-center gap-3 rounded-card border border-border p-3 md:grid-cols-[1fr_1.4fr_auto]"
              >
                <div>
                  <p className="text-sm font-bold">{branch.name_ar}</p>
                  <p className="text-[11px] text-muted-foreground">{branch.name_en}</p>
                </div>
                <select
                  value={branchDrafts[branch.id] ?? ""}
                  onChange={(event) => setBranchDrafts((current) => ({ ...current, [branch.id]: event.target.value }))}
                  className="rounded-card border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="">اختر فرع Foodics</option>
                  {foodicsBranches.map((external) => (
                    <option key={external.id} value={external.id}>
                      {external.name_localized || external.name}{external.reference ? ` (${external.reference})` : ""}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => saveMapping(branch.id)}
                  disabled={busy === `map:${branch.id}`}
                  className="rounded-card border border-border px-3 py-2 text-xs font-bold hover:bg-secondary disabled:opacity-60"
                >
                  {busy === `map:${branch.id}` ? "جاري الحفظ…" : "حفظ الربط"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card-surface border border-border p-5">
        <SectionTitle
          icon={<Database className="size-4" />}
          title="مزامنة القائمة"
          description="ابدأ بالمعاينة. لا يتم تعديل بيانات طلب إلا بعد اختيار تطبيق السحب بشكل صريح."
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <ActionButton
            busy={busy === "preview"}
            onClick={previewMenu}
            secondary
            disabled={!integration.has_credentials || !targetMenuId}
          >
            معاينة السحب
          </ActionButton>
          <ActionButton busy={busy === "apply"} onClick={applyMenu} disabled={!preview?.preview}>
            تطبيق السحب
          </ActionButton>
        </div>
        {preview ? <PreviewBox preview={preview} /> : null}
      </section>

      {integration.last_error ? (
        <p className="rounded-card bg-danger/10 px-4 py-3 text-xs font-bold text-danger">
          {integration.last_error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-card border border-border bg-secondary/50 px-4 py-3 text-xs font-bold">
          {message}
        </p>
      ) : null}
    </div>
  );
}

function ComingSoonWorkspace({ integration }: { integration: IntegrationProvider }) {
  const isCareem = integration.provider_slug === "careem";
  const docs = typeof integration.config_schema["developer_hub_url"] === "string"
    ? String(integration.config_schema["developer_hub_url"])
    : null;

  return (
    <section className="card-surface border border-border p-8 text-center">
      <div className="flex justify-center">
        <AppMark integration={integration} large />
      </div>
      <h2 className="mt-4 text-lg font-extrabold">{integration.name_ar}</h2>
      <p className="mx-auto mt-2 max-w-xl text-xs leading-6 text-muted-foreground">
        {isCareem
          ? "بنية طلب جاهزة لإسناد الطلب إلى مزود توصيل خارجي ومتابعة حالته. تفعيل Careem الفعلي يحتاج بيانات اعتماد وعقد API من Careem Developer Hub؛ لن نخمن حقول الاعتماد أو مسارات API غير المنشورة."
          : "صفحة التطبيق جاهزة داخل بنية متجر التطبيقات. إعداد الاتصال لهذا المزود سيُضاف عند تنفيذ تكامله في خارطة المشروع."}
      </p>
      {isCareem ? (
        <div className="mx-auto mt-5 max-w-xl rounded-card border border-border bg-secondary/30 p-4 text-right">
          <p className="text-xs font-extrabold">جاهزية التكامل</p>
          <div className="mt-3 grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-3">
            <span className="rounded-card bg-background p-2">إسناد شركة التوصيل ✅</span>
            <span className="rounded-card bg-background p-2">التتبع ضمن التصميم ✅</span>
            <span className="rounded-card bg-background p-2">Sandbox متاح من Careem ✅</span>
          </div>
          {docs ? (
            <a
              href={docs}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex rounded-card bg-brand px-4 py-2.5 text-xs font-bold text-brand-ink"
            >
              فتح Careem Developer Hub
            </a>
          ) : null}
        </div>
      ) : null}
      <span className="mt-5 inline-flex rounded-pill bg-secondary px-3 py-1.5 text-xs font-bold text-muted-foreground">
        {isCareem ? "بانتظار اعتماد Careem API" : "قريباً"}
      </span>
    </section>
  );
}

function PreviewBox({ preview }: { preview: FoodicsMenuPreview }) {
  return (
    <div className="mt-4 rounded-card border border-border bg-secondary/40 p-4">
      <div className="grid gap-2 sm:grid-cols-4">
        <Mini label="المنتجات" value={preview.counts.products} />
        <Mini label="الفئات" value={preview.counts.categories} />
        <Mini label="مجموعات الإضافات" value={preview.counts.modifier_groups} />
        <Mini label="خيارات الإضافات" value={preview.counts.modifier_options} />
      </div>
      {preview.sample?.length ? (
        <div className="mt-4 border-t border-border pt-3">
          <p className="mb-2 text-[11px] font-bold text-muted-foreground">عينة من Foodics</p>
          <div className="grid gap-2 md:grid-cols-2">
            {preview.sample.map((item) => (
              <div key={item.id} className="rounded-card bg-background px-3 py-2 text-xs">
                <p className="font-bold">{item.name_localized || item.name}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {item.category || "بدون فئة"} · {Number(item.price || 0).toLocaleString("ar-SA")} ر.س
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AppMark({ integration, large = false }: { integration: IntegrationProvider; large?: boolean }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const boxSize = large ? "h-14 w-20" : "h-11 w-16";
  const fallbackSize = large ? "text-lg" : "text-sm";
  const showLogo = Boolean(integration.logo) && !logoFailed;

  return (
    <div
      className={`${boxSize} flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-background p-2`}
    >
      {showLogo ? (
        <img
          src={integration.logo ?? undefined}
          alt={`${integration.name_en} logo`}
          className="max-h-full max-w-full object-contain"
          loading="lazy"
          onError={() => setLogoFailed(true)}
        />
      ) : (
        <span className={`${fallbackSize} font-black`}>
          {integration.name_en.slice(0, 1).toUpperCase()}
        </span>
      )}
    </div>
  );
}

function MetricChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-card border border-border bg-secondary/40 px-3 py-2 text-center">
      <p className="text-sm font-extrabold">{value.toLocaleString("ar-SA")}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

function WorkspaceStat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="card-surface border border-border p-4">
      <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-2 truncate text-base font-extrabold">{value}</p>
    </div>
  );
}

function SectionTitle({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex size-8 items-center justify-center rounded-card bg-secondary text-brand">{icon}</div>
      <div>
        <h2 className="text-sm font-extrabold">{title}</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function InfoPill({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-secondary/50 px-3 py-1.5 text-[11px] font-bold">
      {icon}
      {label}
    </span>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold">{label}</span>
      {children}
    </label>
  );
}

function ActionButton({
  children,
  onClick,
  busy,
  secondary = false,
  disabled = false,
}: {
  children: ReactNode;
  onClick: () => void;
  busy: boolean;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className={`rounded-card px-4 py-2.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${
        secondary ? "border border-border hover:bg-secondary" : "bg-brand text-brand-ink hover:opacity-90"
      }`}
    >
      {busy ? "جاري التنفيذ…" : children}
    </button>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-card bg-background p-3 text-center">
      <p className="text-base font-extrabold">{Number(value || 0).toLocaleString("ar-SA")}</p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">{label}</p>
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
  return value;
}
