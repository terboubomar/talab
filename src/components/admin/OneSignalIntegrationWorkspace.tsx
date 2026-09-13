import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BellRing, CheckCircle2, KeyRound, MessageSquareText, Settings2 } from "lucide-react";

import {
  saveIntegration,
  testOneSignalConnection,
  type IntegrationProvider,
} from "@/lib/integrations";

export function OneSignalIntegrationWorkspace({ integration }: { integration: IntegrationProvider }) {
  const queryClient = useQueryClient();
  const [appId, setAppId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const configuredAppId = integration.settings_json["app_id"];
    setAppId(typeof configuredAppId === "string" ? configuredAppId : "");
  }, [integration.settings_json]);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["integrations"] });
  }

  async function saveConfiguration() {
    setBusy("save");
    setMessage(null);
    try {
      if (!appId.trim()) throw new Error("أدخل OneSignal App ID");
      if (!integration.integration_id && !apiKey.trim()) {
        throw new Error("أدخل OneSignal REST API Key للتهيئة لأول مرة");
      }

      await saveIntegration({
        providerSlug: "onesignal",
        credentials: apiKey.trim() ? { rest_api_key: apiKey.trim() } : null,
        settings: {
          ...integration.settings_json,
          app_id: appId.trim(),
          auth_mode: "supabase_send_sms_hook",
        },
        status: "configured",
      });

      setApiKey("");
      await refresh();
      setMessage("تم حفظ إعدادات OneSignal ومفتاح API في Supabase Vault");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذّر حفظ إعدادات OneSignal");
    } finally {
      setBusy(null);
    }
  }

  async function testConnection() {
    setBusy("test");
    setMessage(null);
    try {
      if (!integration.has_credentials) throw new Error("احفظ بيانات الاعتماد أولاً");
      const result = await testOneSignalConnection();
      await refresh();
      setMessage(`تم الاتصال بـ OneSignal بنجاح — ${result.name || "التطبيق جاهز"}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "فشل اختبار اتصال OneSignal");
    } finally {
      setBusy(null);
    }
  }

  const configured = Boolean(appId && integration.has_credentials);

  return (
    <div className="space-y-5">
      <section className="grid gap-3 md:grid-cols-3">
        <Stat icon={<CheckCircle2 className="size-4" />} label="حالة الإعداد" value={configured ? "مهيأ" : "غير مكتمل"} />
        <Stat icon={<MessageSquareText className="size-4" />} label="OTP / SMS" value="جاهز للربط" />
        <Stat icon={<BellRing className="size-4" />} label="Push Notifications" value="مدعوم" />
      </section>

      <section className="card-surface border border-border p-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-8 items-center justify-center rounded-card bg-secondary text-brand"><Settings2 className="size-4" /></div>
          <div>
            <h2 className="text-sm font-extrabold">الاتصال والإعدادات</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">أدخل App ID واحفظ REST API Key بشكل آمن. يستخدم طلب OneSignal كقناة إرسال، بينما يبقى إنشاء OTP والتحقق منه داخل Supabase Auth.</p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-bold">OneSignal App ID</span>
            <input value={appId} onChange={(event) => setAppId(event.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" className="w-full rounded-card border border-border bg-background px-3 py-2.5 text-sm" dir="ltr" autoComplete="off" />
          </label>
          <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 text-xs font-bold"><KeyRound className="size-3.5" />REST API Key</span>
            <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={integration.has_credentials ? "اتركه فارغاً للإبقاء على المفتاح الحالي" : "يُحفظ مباشرة في Supabase Vault"} className="w-full rounded-card border border-border bg-background px-3 py-2.5 text-sm" dir="ltr" autoComplete="new-password" />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={saveConfiguration} disabled={busy !== null} className="rounded-card bg-brand px-4 py-2.5 text-xs font-bold text-brand-ink disabled:opacity-50">{busy === "save" ? "جاري الحفظ…" : "حفظ الإعدادات"}</button>
          <button type="button" onClick={testConnection} disabled={busy !== null || !integration.has_credentials || !appId} className="rounded-card border border-border px-4 py-2.5 text-xs font-bold hover:bg-secondary disabled:opacity-50">{busy === "test" ? "جاري الاختبار…" : "اختبار الاتصال"}</button>
        </div>
      </section>

      <section className="card-surface border border-border p-5">
        <h2 className="text-sm font-extrabold">طريقة الاستخدام داخل طلب</h2>
        <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
          <div className="rounded-card bg-secondary/40 p-3"><strong className="block text-foreground">1. OTP</strong><span className="mt-1 block leading-5">Supabase ينشئ رمز التحقق.</span></div>
          <div className="rounded-card bg-secondary/40 p-3"><strong className="block text-foreground">2. OneSignal</strong><span className="mt-1 block leading-5">يرسل SMS إلى رقم العميل.</span></div>
          <div className="rounded-card bg-secondary/40 p-3"><strong className="block text-foreground">3. Verify</strong><span className="mt-1 block leading-5">Supabase يتحقق من الرمز ويفتح الحساب.</span></div>
        </div>
      </section>

      {integration.last_error ? <p className="rounded-card bg-danger/10 px-4 py-3 text-xs font-bold text-danger">{integration.last_error}</p> : null}
      {message ? <p className="rounded-card border border-border bg-secondary/50 px-4 py-3 text-xs font-bold">{message}</p> : null}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="card-surface border border-border p-4"><div className="flex items-center gap-2 text-xs font-bold text-muted-foreground">{icon}{label}</div><p className="mt-2 truncate text-base font-extrabold">{value}</p></div>;
}
