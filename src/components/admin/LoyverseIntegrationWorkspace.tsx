import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Database, ExternalLink, LockKeyhole, PlugZap, Settings2 } from "lucide-react";

import {
  fetchLoyverseSetup,
  saveIntegration,
  saveLoyverseBranchMapping,
  testLoyverseConnection,
  type IntegrationProvider,
  type LoyverseStore,
} from "@/lib/integrations";

export function LoyverseIntegrationWorkspace({ integration }: { integration: IntegrationProvider }) {
  const queryClient = useQueryClient();
  const { data: setup, isLoading } = useQuery({
    queryKey: ["loyverse-setup"],
    queryFn: fetchLoyverseSetup,
  });
  const [token, setToken] = useState("");
  const [stores, setStores] = useState<LoyverseStore[]>([]);
  const [branchDrafts, setBranchDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!setup) return;
    const next: Record<string, string> = {};
    for (const mapping of setup.mappings) next[mapping.branch_id] = mapping.external_branch_id;
    setBranchDrafts(next);
  }, [setup]);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["integrations"] }),
      queryClient.invalidateQueries({ queryKey: ["loyverse-setup"] }),
    ]);
  }

  async function saveConfiguration() {
    setBusy("save");
    setMessage(null);
    try {
      if (!integration.integration_id && !token.trim()) {
        throw new Error("أدخل Loyverse Personal Access Token لتهيئة الاتصال لأول مرة");
      }
      await saveIntegration({
        providerSlug: "loyverse",
        credentials: token.trim() ? { access_token: token.trim() } : null,
        settings: { ...integration.settings_json, auth_mode: "personal_access_token", api_version: "v1.0" },
        status: "configured",
      });
      setToken("");
      await refresh();
      setMessage("تم حفظ رمز Loyverse بأمان في Supabase Vault");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذّر حفظ إعدادات Loyverse");
    } finally {
      setBusy(null);
    }
  }

  async function testConnection() {
    setBusy("test");
    setMessage(null);
    try {
      if (!integration.has_credentials && token.trim()) {
        await saveIntegration({
          providerSlug: "loyverse",
          credentials: { access_token: token.trim() },
          settings: { ...integration.settings_json, auth_mode: "personal_access_token", api_version: "v1.0" },
          status: "configured",
        });
        setToken("");
      }
      const result = await testLoyverseConnection();
      setStores(result.stores);
      await refresh();
      setMessage(`تم الاتصال بـ Loyverse بنجاح — ${result.stores.length.toLocaleString("ar-SA")} متجر متاح للربط`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "فشل اختبار الاتصال بـ Loyverse");
    } finally {
      setBusy(null);
    }
  }

  async function saveMapping(branchId: string) {
    const externalId = branchDrafts[branchId];
    const external = stores.find((store) => store.id === externalId);
    if (!externalId) {
      setMessage("اختر متجر Loyverse أولاً");
      return;
    }
    setBusy(`map:${branchId}`);
    setMessage(null);
    try {
      await saveLoyverseBranchMapping({
        branchId,
        externalBranchId: externalId,
        externalBranchName: external?.name ?? null,
      });
      await refresh();
      setMessage("تم حفظ ربط الفرع بمتجر Loyverse");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذّر حفظ ربط الفرع");
    } finally {
      setBusy(null);
    }
  }

  if (isLoading || !setup) {
    return <div className="card-surface h-64 animate-pulse opacity-60" />;
  }

  const mappedCount = setup.mappings.filter((mapping) => mapping.active).length;
  const canTest = integration.has_credentials || Boolean(token.trim());

  return (
    <div className="space-y-5">
      <section className="grid gap-3 md:grid-cols-3">
        <WorkspaceStat icon={<PlugZap className="size-4" />} label="حالة الاتصال" value={statusLabel(integration.integration_status)} />
        <WorkspaceStat icon={<Database className="size-4" />} label="الفروع المربوطة" value={mappedCount.toLocaleString("ar-SA")} />
        <WorkspaceStat icon={<CheckCircle2 className="size-4" />} label="Loyverse API" value="v1.0" />
      </section>

      <section className="card-surface border border-border p-5">
        <SectionTitle icon={<Settings2 className="size-4" />} title="الاتصال بـ Loyverse" description="استخدم Personal Access Token. الرمز يُحفظ في Supabase Vault ولا يُعرض مرة أخرى في المتصفح." />
        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <Field label="Loyverse Personal Access Token">
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={integration.has_credentials ? "اتركه فارغاً للإبقاء على الرمز الحالي" : "ألصق Personal Access Token"}
              className="w-full rounded-card border border-border bg-background px-3 py-2.5 text-sm"
              dir="ltr"
              autoComplete="new-password"
            />
          </Field>
          <a href="https://developer.loyverse.com/docs/" target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-1.5 rounded-card border border-border px-4 py-2.5 text-xs font-bold hover:bg-secondary">
            وثائق Loyverse <ExternalLink className="size-3.5" />
          </a>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <ActionButton busy={busy === "save"} onClick={saveConfiguration}>حفظ الرمز</ActionButton>
          <ActionButton busy={busy === "test"} onClick={testConnection} secondary disabled={!canTest}>اختبار الاتصال وجلب المتاجر</ActionButton>
        </div>
        <div className="mt-4 flex items-start gap-2 rounded-card bg-secondary/40 p-3 text-[11px] leading-5 text-muted-foreground">
          <LockKeyhole className="mt-0.5 size-4 shrink-0 text-success" />
          <span>Personal Access Token في Loyverse يمنح وصولاً واسعاً للحساب، لذلك لا يتم حفظه في settings أو عرضه في الواجهة بعد الحفظ.</span>
        </div>
      </section>

      <section className="card-surface border border-border p-5">
        <SectionTitle icon={<PlugZap className="size-4" />} title="ربط الفروع بالمتاجر" description="اختبر الاتصال أولاً، ثم اربط كل فرع في طلب بمتجره المقابل في Loyverse." />
        {stores.length === 0 ? (
          <div className="mt-4 rounded-card border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            {integration.has_credentials ? "اضغط اختبار الاتصال لجلب متاجر Loyverse." : "احفظ Personal Access Token ثم اختبر الاتصال لجلب المتاجر."}
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {setup.branches.map((branch) => (
              <div key={branch.id} className="grid items-center gap-3 rounded-card border border-border p-3 md:grid-cols-[1fr_1.4fr_auto]">
                <div>
                  <p className="text-sm font-bold">{branch.name_ar}</p>
                  <p className="text-[11px] text-muted-foreground">{branch.name_en}</p>
                </div>
                <select
                  value={branchDrafts[branch.id] ?? ""}
                  onChange={(event) => setBranchDrafts((current) => ({ ...current, [branch.id]: event.target.value }))}
                  className="rounded-card border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="">اختر متجر Loyverse</option>
                  {stores.map((store) => (
                    <option key={store.id} value={store.id}>{store.name}{store.address ? ` — ${store.address}` : ""}</option>
                  ))}
                </select>
                <button type="button" onClick={() => saveMapping(branch.id)} disabled={busy === `map:${branch.id}`} className="rounded-card border border-border px-3 py-2 text-xs font-bold hover:bg-secondary disabled:opacity-60">
                  {busy === `map:${branch.id}` ? "جاري الحفظ…" : "حفظ الربط"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card-surface border border-border p-5">
        <SectionTitle icon={<Database className="size-4" />} title="قدرات التكامل الحالية" description="هذه النسخة تؤسس اتصال Loyverse الحقيقي وتربط الفروع. مزامنة القائمة وإرسال الطلبات تُنفذ كمرحلة مستقلة حتى لا نفعّل عمليات كتابة على POS قبل اكتمال خرائط المنتجات والمدفوعات." />
        <div className="mt-4 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <Capability label="اختبار API" ready />
          <Capability label="جلب المتاجر" ready />
          <Capability label="ربط الفروع" ready />
          <Capability label="حماية الرمز في Vault" ready />
        </div>
      </section>

      {integration.last_error ? <p className="rounded-card bg-danger/10 px-4 py-3 text-xs font-bold text-danger">{integration.last_error}</p> : null}
      {message ? <p className="rounded-card border border-border bg-secondary/50 px-4 py-3 text-xs font-bold">{message}</p> : null}
    </div>
  );
}

function Capability({ label, ready }: { label: string; ready: boolean }) {
  return <div className="rounded-card bg-secondary/40 p-3 font-bold"><span className={ready ? "text-success" : "text-muted-foreground"}>{ready ? "✓" : "○"}</span> {label}</div>;
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
function statusLabel(status: IntegrationProvider["integration_status"]) {
  if (status === "active") return "متصل";
  if (status === "configured") return "مهيأ";
  if (status === "error") return "يوجد خطأ";
  if (status === "disabled") return "معطل";
  return "غير متصل";
}
