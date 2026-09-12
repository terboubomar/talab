import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Database, PlugZap, Settings2 } from "lucide-react";

import {
  fetchFoodicsSetup,
  pullFoodicsMenu,
  saveFoodicsBranchMapping,
  saveIntegration,
  testFoodicsConnection,
  type FoodicsBranch,
  type FoodicsMenuPreview,
  type IntegrationProvider,
} from "@/lib/integrations";

export function FoodicsIntegrationWorkspace({ integration }: { integration: IntegrationProvider }) {
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
        <WorkspaceStat icon={<PlugZap className="size-4" />} label="حالة الاتصال" value={statusLabel(integration.integration_status)} />
        <WorkspaceStat icon={<Database className="size-4" />} label="الفروع المربوطة" value={mappedCount.toLocaleString("ar-SA")} />
        <WorkspaceStat icon={<CheckCircle2 className="size-4" />} label="قائمة المزامنة" value={selectedMenu?.name_ar ?? "غير محددة"} />
      </section>

      <section className="card-surface border border-border p-5">
        <SectionTitle icon={<Settings2 className="size-4" />} title="الاتصال والإعدادات" description="احفظ بيانات الاعتماد وحدد البيئة والقائمة التي ستستقبل بيانات Foodics." />
        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          <Field label="Foodics Access Token">
            <input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder={integration.has_credentials ? "اتركه فارغاً للإبقاء على الرمز الحالي" : "يُحفظ مباشرة في Supabase Vault"} className="w-full rounded-card border border-border bg-background px-3 py-2.5 text-sm" dir="ltr" autoComplete="new-password" />
          </Field>
          <Field label="البيئة">
            <select value={environment} onChange={(event) => setEnvironment(event.target.value as "production" | "sandbox")} className="w-full rounded-card border border-border bg-background px-3 py-2.5 text-sm">
              <option value="production">Production</option>
              <option value="sandbox">Sandbox</option>
            </select>
          </Field>
          <Field label="قائمة طلب المستهدفة">
            <select value={targetMenuId} onChange={(event) => setTargetMenuId(event.target.value)} className="w-full rounded-card border border-border bg-background px-3 py-2.5 text-sm">
              <option value="">اختر القائمة</option>
              {setup.menus.map((menu) => <option key={menu.id} value={menu.id}>{menu.name_ar}{menu.is_default ? " — افتراضية" : ""}</option>)}
            </select>
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <ActionButton busy={busy === "save"} onClick={saveConfiguration}>حفظ الإعدادات</ActionButton>
          <ActionButton busy={busy === "test"} onClick={testConnection} secondary disabled={!integration.has_credentials && !token.trim()}>اختبار الاتصال وجلب الفروع</ActionButton>
        </div>
      </section>

      <section className="card-surface border border-border p-5">
        <SectionTitle icon={<PlugZap className="size-4" />} title="ربط الفروع" description="اربط كل فرع في طلب بفرعه المقابل في Foodics قبل إرسال الطلبات أو مزامنة أسعار الفروع." />
        {foodicsBranches.length === 0 ? (
          <div className="mt-4 rounded-card border border-dashed border-border p-6 text-center text-xs text-muted-foreground">اختبر الاتصال أولاً لجلب فروع Foodics المتاحة للربط.</div>
        ) : (
          <div className="mt-4 space-y-2">
            {setup.branches.map((branch) => (
              <div key={branch.id} className="grid items-center gap-3 rounded-card border border-border p-3 md:grid-cols-[1fr_1.4fr_auto]">
                <div><p className="text-sm font-bold">{branch.name_ar}</p><p className="text-[11px] text-muted-foreground">{branch.name_en}</p></div>
                <select value={branchDrafts[branch.id] ?? ""} onChange={(event) => setBranchDrafts((current) => ({ ...current, [branch.id]: event.target.value }))} className="rounded-card border border-border bg-background px-3 py-2 text-sm">
                  <option value="">اختر فرع Foodics</option>
                  {foodicsBranches.map((external) => <option key={external.id} value={external.id}>{external.name_localized || external.name}{external.reference ? ` (${external.reference})` : ""}</option>)}
                </select>
                <button type="button" onClick={() => saveMapping(branch.id)} disabled={busy === `map:${branch.id}`} className="rounded-card border border-border px-3 py-2 text-xs font-bold hover:bg-secondary disabled:opacity-60">{busy === `map:${branch.id}` ? "جاري الحفظ…" : "حفظ الربط"}</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card-surface border border-border p-5">
        <SectionTitle icon={<Database className="size-4" />} title="مزامنة القائمة" description="ابدأ بالمعاينة. لا يتم تعديل بيانات طلب إلا بعد اختيار تطبيق السحب بشكل صريح." />
        <div className="mt-4 flex flex-wrap gap-2">
          <ActionButton busy={busy === "preview"} onClick={previewMenu} secondary disabled={!integration.has_credentials || !targetMenuId}>معاينة السحب</ActionButton>
          <ActionButton busy={busy === "apply"} onClick={applyMenu} disabled={!preview?.preview}>تطبيق السحب</ActionButton>
        </div>
        {preview ? <PreviewBox preview={preview} /> : null}
      </section>

      {integration.last_error ? <p className="rounded-card bg-danger/10 px-4 py-3 text-xs font-bold text-danger">{integration.last_error}</p> : null}
      {message ? <p className="rounded-card border border-border bg-secondary/50 px-4 py-3 text-xs font-bold">{message}</p> : null}
    </div>
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
                <p className="mt-0.5 text-[11px] text-muted-foreground">{item.category || "بدون فئة"} · {Number(item.price || 0).toLocaleString("ar-SA")} ر.س</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function WorkspaceStat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="card-surface border border-border p-4"><div className="flex items-center gap-2 text-xs font-bold text-muted-foreground">{icon}{label}</div><p className="mt-2 truncate text-base font-extrabold">{value}</p></div>;
}
function SectionTitle({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return <div className="flex items-start gap-3"><div className="mt-0.5 flex size-8 items-center justify-center rounded-card bg-secondary text-brand">{icon}</div><div><h2 className="text-sm font-extrabold">{title}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p></div></div>;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-bold">{label}</span>{children}</label>;
}
function ActionButton({ children, onClick, busy, secondary = false, disabled = false }: { children: ReactNode; onClick: () => void; busy: boolean; secondary?: boolean; disabled?: boolean }) {
  return <button type="button" onClick={onClick} disabled={busy || disabled} className={`rounded-card px-4 py-2.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${secondary ? "border border-border hover:bg-secondary" : "bg-brand text-brand-ink hover:opacity-90"}`}>{busy ? "جاري التنفيذ…" : children}</button>;
}
function Mini({ label, value }: { label: string; value: number }) {
  return <div className="rounded-card bg-background p-3 text-center"><p className="text-base font-extrabold">{Number(value || 0).toLocaleString("ar-SA")}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{label}</p></div>;
}
function statusLabel(status: IntegrationProvider["integration_status"]) {
  if (status === "active") return "متصل";
  if (status === "configured") return "مهيأ";
  if (status === "error") return "يوجد خطأ";
  if (status === "disabled") return "معطل";
  return "غير متصل";
}
