import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

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

function AppsPage() {
  const { loading: permissionsLoading, can } = usePermissions();
  const canManage = can("integrations.manage");
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

  const connected = integrations.filter((item) => item.integration_status !== "disconnected").length;
  const withCredentials = integrations.filter((item) => item.has_credentials).length;
  const foodics = integrations.find((item) => item.provider_slug === "foodics") ?? null;
  const otherIntegrations = integrations.filter((item) => item.provider_slug !== "foodics");

  return (
    <main className="min-h-screen pb-12">
      <header className="border-b border-border bg-background px-5 py-5">
        <h1 className="text-lg font-extrabold">متجر التطبيقات</h1>
        <p className="mt-1 text-xs text-muted-foreground">إدارة تكاملات نقاط البيع، التوصيل، الولاء، التحليلات والخدمات الخارجية.</p>
      </header>

      <div className="space-y-5 px-5 py-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <Summary label="التطبيقات المتاحة" value={integrations.length.toLocaleString("ar-SA")} />
          <Summary label="التكاملات المهيأة" value={connected.toLocaleString("ar-SA")} />
          <Summary label="بيانات الاعتماد المحفوظة" value={withCredentials.toLocaleString("ar-SA")} />
        </div>

        <div className="card-surface border border-border p-4">
          <p className="text-sm font-extrabold">خزنة بيانات الاعتماد</p>
          <p className="mt-1 max-w-3xl text-xs leading-6 text-muted-foreground">بيانات الدخول تحفظ مشفرة داخل Supabase Vault. بعد الحفظ لا تعرض لوحة التحكم الرمز مرة أخرى.</p>
        </div>

        {error ? (
          <div className="card-surface p-6 text-center text-sm font-bold text-danger">تعذّر تحميل متجر التطبيقات</div>
        ) : (
          <>
            {foodics ? <FoodicsPanel integration={foodics} /> : null}
            {otherIntegrations.length ? <IntegrationGroups integrations={otherIntegrations} /> : null}
          </>
        )}
      </div>
    </main>
  );
}

function FoodicsPanel({ integration }: { integration: IntegrationProvider }) {
  const queryClient = useQueryClient();
  const { data: setup, isLoading } = useQuery({ queryKey: ["foodics-setup"], queryFn: fetchFoodicsSetup });
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
    const env = setup.settings["environment"] === "sandbox" ? "sandbox" : "production";
    setEnvironment(env);
    const menuId = typeof setup.settings["target_menu_id"] === "string" ? setup.settings["target_menu_id"] : "";
    setTargetMenuId(menuId);
    const next: Record<string, string> = {};
    for (const mapping of setup.mappings) next[mapping.branch_id] = mapping.external_branch_id;
    setBranchDrafts(next);
  }, [setup]);

  const mappedCount = setup?.mappings.filter((m) => m.active).length ?? 0;
  const selectedMenu = useMemo(() => setup?.menus.find((m) => m.id === targetMenuId), [setup, targetMenuId]);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["integrations"] }),
      queryClient.invalidateQueries({ queryKey: ["foodics-setup"] }),
    ]);
  }

  async function saveConfiguration() {
    setBusy("save"); setMessage(null);
    try {
      if (!targetMenuId) throw new Error("اختر قائمة طلب التي ستستقبل بيانات فودكس");
      if (!integration.integration_id && !token.trim()) throw new Error("أدخل Foodics Access Token لتهيئة الاتصال لأول مرة");
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
    } finally { setBusy(null); }
  }

  async function testConnection() {
    setBusy("test"); setMessage(null);
    try {
      const result = await testFoodicsConnection();
      setFoodicsBranches(result.branches);
      await refresh();
      setMessage(`تم الاتصال بفودكس بنجاح — ${result.branches.length.toLocaleString("ar-SA")} فرع متاح للربط`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "فشل اختبار الاتصال بفودكس");
    } finally { setBusy(null); }
  }

  async function saveMapping(branchId: string) {
    const externalId = branchDrafts[branchId];
    const external = foodicsBranches.find((b) => b.id === externalId);
    if (!externalId) { setMessage("اختر فرع فودكس أولاً"); return; }
    setBusy(`map:${branchId}`); setMessage(null);
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
    } finally { setBusy(null); }
  }

  async function previewMenu() {
    setBusy("preview"); setMessage(null);
    try {
      const result = await pullFoodicsMenu(false);
      setPreview(result);
      setMessage("تمت معاينة بيانات فودكس. راجع الأعداد ثم اختر تطبيق السحب.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذّرت معاينة قائمة فودكس");
    } finally { setBusy(null); }
  }

  async function applyMenu() {
    if (!preview) return;
    setBusy("apply"); setMessage(null);
    try {
      const result = await pullFoodicsMenu(true);
      setPreview(result);
      await refresh();
      setMessage(`اكتمل سحب القائمة: ${result.counts.products.toLocaleString("ar-SA")} منتج`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذّر تطبيق سحب قائمة فودكس");
    } finally { setBusy(null); }
  }

  return (
    <section className="card-surface border border-border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><h2 className="text-base font-extrabold">فودكس</h2><StatusBadge status={integration.integration_status} /></div>
          <p className="mt-1 text-xs text-muted-foreground">Foodics — سحب القائمة وإرسال الطلبات</p>
        </div>
        <div className="text-left text-xs">
          <p className={integration.has_credentials ? "font-bold text-success" : "font-bold text-muted-foreground"}>{integration.has_credentials ? "بيانات الاعتماد محفوظة" : "غير مهيأ"}</p>
          <p className="mt-1 text-muted-foreground">الفروع المربوطة: {mappedCount.toLocaleString("ar-SA")}</p>
        </div>
      </div>

      {isLoading || !setup ? <div className="mt-5 h-28 animate-pulse rounded-card bg-secondary" /> : (
        <div className="mt-5 space-y-5">
          <div className="grid gap-3 lg:grid-cols-3">
            <Field label="Foodics Access Token">
              <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={integration.has_credentials ? "اتركه فارغاً للإبقاء على الرمز الحالي" : "يُحفظ مباشرة في Supabase Vault"} className="w-full rounded-card border border-border bg-background px-3 py-2 text-sm" dir="ltr" autoComplete="new-password" />
            </Field>
            <Field label="البيئة">
              <select value={environment} onChange={(e) => setEnvironment(e.target.value as "production" | "sandbox")} className="w-full rounded-card border border-border bg-background px-3 py-2 text-sm">
                <option value="production">Production</option><option value="sandbox">Sandbox</option>
              </select>
            </Field>
            <Field label="قائمة طلب المستهدفة">
              <select value={targetMenuId} onChange={(e) => setTargetMenuId(e.target.value)} className="w-full rounded-card border border-border bg-background px-3 py-2 text-sm">
                <option value="">اختر القائمة</option>
                {setup.menus.map((menu) => <option key={menu.id} value={menu.id}>{menu.name_ar}{menu.is_default ? " — افتراضية" : ""}</option>)}
              </select>
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionButton busy={busy === "save"} onClick={saveConfiguration}>حفظ الإعدادات</ActionButton>
            <ActionButton busy={busy === "test"} onClick={testConnection} secondary disabled={!integration.has_credentials && !token.trim()}>اختبار الاتصال وجلب الفروع</ActionButton>
          </div>
          {selectedMenu ? <p className="text-[11px] text-muted-foreground">سيتم ربط بيانات Foodics بالقائمة: <strong>{selectedMenu.name_ar}</strong></p> : null}

          {foodicsBranches.length > 0 ? (
            <div className="border-t border-border pt-5">
              <h3 className="text-sm font-extrabold">ربط الفروع</h3>
              <p className="mt-1 text-xs text-muted-foreground">يجب ربط كل فرع طلب بفرعه المقابل في Foodics قبل إرسال الطلبات أو أسعار الفروع.</p>
              <div className="mt-3 space-y-2">
                {setup.branches.map((branch) => (
                  <div key={branch.id} className="grid items-center gap-2 rounded-card border border-border p-3 md:grid-cols-[1fr_1.4fr_auto]">
                    <div><p className="text-sm font-bold">{branch.name_ar}</p><p className="text-[11px] text-muted-foreground">{branch.name_en}</p></div>
                    <select value={branchDrafts[branch.id] ?? ""} onChange={(e) => setBranchDrafts((current) => ({ ...current, [branch.id]: e.target.value }))} className="rounded-card border border-border bg-background px-3 py-2 text-sm">
                      <option value="">اختر فرع Foodics</option>
                      {foodicsBranches.map((external) => <option key={external.id} value={external.id}>{external.name_localized || external.name} {external.reference ? `(${external.reference})` : ""}</option>)}
                    </select>
                    <button type="button" onClick={() => saveMapping(branch.id)} disabled={busy === `map:${branch.id}`} className="rounded-card border border-border px-3 py-2 text-xs font-bold hover:bg-secondary disabled:opacity-60">{busy === `map:${branch.id}` ? "جاري الحفظ…" : "حفظ الربط"}</button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="border-t border-border pt-5">
            <h3 className="text-sm font-extrabold">سحب القائمة من Foodics</h3>
            <p className="mt-1 text-xs text-muted-foreground">المعاينة لا تعدّل البيانات. التطبيق يحدث العناصر المرتبطة بـ Foodics ويضيف العناصر غير الموجودة دون حذف عناصر طلب اليدوية.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <ActionButton busy={busy === "preview"} onClick={previewMenu} secondary disabled={!integration.has_credentials || !targetMenuId}>معاينة السحب</ActionButton>
              <ActionButton busy={busy === "apply"} onClick={applyMenu} disabled={!preview?.preview}>تطبيق السحب</ActionButton>
            </div>
            {preview ? <PreviewBox preview={preview} /> : null}
          </div>

          {integration.last_error ? <p className="rounded-card bg-danger/10 px-3 py-2 text-xs font-bold text-danger">{integration.last_error}</p> : null}
          {message ? <p className="rounded-card bg-secondary px-3 py-2 text-xs font-bold">{message}</p> : null}
        </div>
      )}
    </section>
  );
}

function PreviewBox({ preview }: { preview: FoodicsMenuPreview }) {
  return (
    <div className="mt-3 rounded-card border border-border bg-secondary/40 p-4">
      <div className="grid gap-2 sm:grid-cols-4">
        <Mini label="المنتجات" value={preview.counts.products} />
        <Mini label="الفئات" value={preview.counts.categories} />
        <Mini label="مجموعات الإضافات" value={preview.counts.modifier_groups} />
        <Mini label="خيارات الإضافات" value={preview.counts.modifier_options} />
      </div>
      {preview.sample?.length ? <div className="mt-3 text-xs text-muted-foreground">عينة: {preview.sample.map((item) => item.name_localized || item.name).join(" · ")}</div> : null}
    </div>
  );
}

function IntegrationGroups({ integrations }: { integrations: IntegrationProvider[] }) {
  const groups = new Map<string, IntegrationProvider[]>();
  for (const integration of integrations) {
    const list = groups.get(integration.category) ?? [];
    list.push(integration); groups.set(integration.category, list);
  }
  return <div className="space-y-5">{[...groups.entries()].map(([category, items]) => (
    <section key={category} className="space-y-3"><div><h2 className="text-sm font-extrabold">{CATEGORY_LABELS[category] ?? category}</h2><p className="mt-0.5 text-[11px] text-muted-foreground">{items.length.toLocaleString("ar-SA")} تطبيق</p></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{items.map((item) => <IntegrationCard key={item.provider_id} integration={item} />)}</div></section>
  ))}</div>;
}

function IntegrationCard({ integration }: { integration: IntegrationProvider }) {
  const capabilities = Array.isArray(integration.config_schema["capabilities"]) ? integration.config_schema["capabilities"] as string[] : [];
  return <article className="card-surface flex min-h-48 flex-col border border-border p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-base font-extrabold">{integration.name_ar}</p><p className="mt-0.5 text-xs text-muted-foreground">{integration.name_en}</p></div><StatusBadge status={integration.integration_status} /></div><div className="mt-4 flex flex-wrap gap-1.5">{capabilities.map((capability) => <span key={capability} className="chip text-[10px]">{capabilityLabel(capability)}</span>)}</div><div className="mt-auto pt-5 text-xs text-muted-foreground">إعداد الاتصال سيُضاف عند تنفيذ هذا المزود</div></article>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="grid gap-1.5 text-xs font-bold text-muted-foreground"><span>{label}</span>{children}</label>; }
function ActionButton({ children, onClick, busy, disabled, secondary = false }: { children: React.ReactNode; onClick: () => void; busy?: boolean; disabled?: boolean; secondary?: boolean }) { return <button type="button" onClick={onClick} disabled={busy || disabled} className={secondary ? "rounded-card border border-border px-4 py-2 text-xs font-extrabold hover:bg-secondary disabled:opacity-50" : "rounded-card bg-brand px-4 py-2 text-xs font-extrabold text-brand-ink disabled:opacity-50"}>{busy ? "جاري التنفيذ…" : children}</button>; }
function Summary({ label, value }: { label: string; value: string }) { return <div className="card-surface p-4"><p className="text-xs font-bold text-muted-foreground">{label}</p><p className="mt-1 text-xl font-extrabold">{value}</p></div>; }
function Mini({ label, value }: { label: string; value: number }) { return <div><p className="text-[10px] font-bold text-muted-foreground">{label}</p><p className="text-lg font-extrabold">{value.toLocaleString("ar-SA")}</p></div>; }
function StatusBadge({ status }: { status: IntegrationProvider["integration_status"] }) {
  if (status === "active") return <span className="rounded-pill bg-success/10 px-2.5 py-1 text-[11px] font-bold text-success">متصل</span>;
  if (status === "configured") return <span className="rounded-pill bg-brand/10 px-2.5 py-1 text-[11px] font-bold text-brand">مهيأ</span>;
  if (status === "error") return <span className="rounded-pill bg-danger/10 px-2.5 py-1 text-[11px] font-bold text-danger">خطأ</span>;
  if (status === "disabled") return <span className="rounded-pill bg-secondary px-2.5 py-1 text-[11px] font-bold text-muted-foreground">معطل</span>;
  return <span className="rounded-pill bg-secondary px-2.5 py-1 text-[11px] font-bold text-muted-foreground">غير متصل</span>;
}
function capabilityLabel(value: string) { if (value === "menu_pull") return "سحب القائمة"; if (value === "order_push") return "إرسال الطلبات"; return value; }
