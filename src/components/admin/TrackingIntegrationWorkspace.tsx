import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BarChart3, CheckCircle2, Power, PowerOff, Settings2 } from "lucide-react";

import {
  removeIntegration,
  saveIntegration,
  type IntegrationProvider,
} from "@/lib/integrations";

const TRACKING_SLUGS = new Set([
  "meta-pixel",
  "tiktok-pixel",
  "snapchat-pixel",
  "google-tag-manager",
  "google-analytics",
]);

export function isTrackingIntegration(slug: string) {
  return TRACKING_SLUGS.has(slug);
}

function settingKey(integration: IntegrationProvider) {
  const configured = integration.config_schema["field_key"];
  return typeof configured === "string" && configured ? configured : "tracking_id";
}

function fieldLabel(integration: IntegrationProvider) {
  const configured = integration.config_schema["field_label_ar"];
  return typeof configured === "string" && configured ? configured : "معرّف التتبع";
}

function placeholder(integration: IntegrationProvider) {
  const configured = integration.config_schema["placeholder"];
  return typeof configured === "string" ? configured : "";
}

function validateTrackingId(slug: string, value: string) {
  const id = value.trim();
  if (!id) return "أدخل معرّف التكامل أولاً";
  if (slug === "google-tag-manager" && !/^GTM-[A-Z0-9]+$/i.test(id)) {
    return "معرّف Google Tag Manager يجب أن يبدأ بـ GTM-";
  }
  if (slug === "google-analytics" && !/^G-[A-Z0-9]+$/i.test(id)) {
    return "Measurement ID في Google Analytics يجب أن يبدأ بـ G-";
  }
  if (slug === "meta-pixel" && !/^\d{5,30}$/.test(id)) {
    return "معرّف Meta Pixel يجب أن يكون أرقاماً فقط";
  }
  if (slug === "snapchat-pixel" && id.length < 8) {
    return "تحقق من معرّف Snapchat Pixel";
  }
  if (slug === "tiktok-pixel" && id.length < 8) {
    return "تحقق من معرّف TikTok Pixel";
  }
  return null;
}

export function TrackingIntegrationWorkspace({ integration }: { integration: IntegrationProvider }) {
  const queryClient = useQueryClient();
  const key = settingKey(integration);
  const savedValue = useMemo(() => {
    const value = integration.settings_json[key];
    return typeof value === "string" ? value : "";
  }, [integration.settings_json, key]);
  const [value, setValue] = useState(savedValue);
  const [busy, setBusy] = useState<"save" | "disable" | "remove" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => setValue(savedValue), [savedValue]);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["integrations"] });
  }

  async function saveAndActivate() {
    setMessage(null);
    const validation = validateTrackingId(integration.provider_slug, value);
    if (validation) {
      setMessage(validation);
      return;
    }
    setBusy("save");
    try {
      await saveIntegration({
        providerSlug: integration.provider_slug,
        settings: { [key]: value.trim() },
        status: "active",
      });
      await refresh();
      setMessage("تم حفظ التكامل وتفعيله على واجهة المتجر");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذّر حفظ التكامل");
    } finally {
      setBusy(null);
    }
  }

  async function disable() {
    if (!integration.integration_id) return;
    setBusy("disable");
    setMessage(null);
    try {
      await saveIntegration({
        providerSlug: integration.provider_slug,
        settings: integration.settings_json,
        status: "disabled",
      });
      await refresh();
      setMessage("تم تعطيل التتبع. الإعداد محفوظ ويمكن إعادة تفعيله لاحقاً.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذّر تعطيل التكامل");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!integration.integration_id) return;
    setBusy("remove");
    setMessage(null);
    try {
      await removeIntegration(integration.integration_id);
      setValue("");
      await refresh();
      setMessage("تم حذف إعداد التكامل من الحساب");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذّر حذف التكامل");
    } finally {
      setBusy(null);
    }
  }

  const active = integration.integration_status === "active";

  return (
    <div className="space-y-5">
      <section className="grid gap-3 md:grid-cols-3">
        <div className="card-surface border border-border p-4">
          <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
            <Power className="size-4" /> الحالة
          </div>
          <p className="mt-2 text-base font-extrabold">{active ? "مفعّل" : "غير مفعّل"}</p>
        </div>
        <div className="card-surface border border-border p-4">
          <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
            <BarChart3 className="size-4" /> الاستخدام
          </div>
          <p className="mt-2 text-base font-extrabold">واجهة المتجر</p>
        </div>
        <div className="card-surface border border-border p-4">
          <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
            <CheckCircle2 className="size-4" /> المعرف
          </div>
          <p className="mt-2 truncate text-base font-extrabold" dir="ltr">{savedValue || "غير مضاف"}</p>
        </div>
      </section>

      <section className="card-surface border border-border p-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-8 items-center justify-center rounded-card bg-secondary text-brand">
            <Settings2 className="size-4" />
          </div>
          <div>
            <h2 className="text-sm font-extrabold">إعداد التتبع</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              أدخل المعرّف فقط. طلب يحمّل كود المزود الرسمي على المتجر عند تفعيل التكامل، ولا يتم تخزين أي Secret لهذا النوع من التطبيقات.
            </p>
          </div>
        </div>

        <label className="mt-5 block max-w-2xl">
          <span className="mb-1.5 block text-xs font-bold">{fieldLabel(integration)}</span>
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={placeholder(integration)}
            className="w-full rounded-card border border-border bg-background px-3 py-2.5 text-sm"
            dir="ltr"
            autoComplete="off"
          />
        </label>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={saveAndActivate}
            disabled={busy !== null}
            className="rounded-card bg-brand px-4 py-2.5 text-xs font-bold text-brand-ink disabled:opacity-50"
          >
            {busy === "save" ? "جاري الحفظ…" : active ? "حفظ التغييرات" : "حفظ وتفعيل"}
          </button>
          {integration.integration_id ? (
            <button
              type="button"
              onClick={disable}
              disabled={busy !== null || integration.integration_status === "disabled"}
              className="inline-flex items-center gap-1.5 rounded-card border border-border px-4 py-2.5 text-xs font-bold disabled:opacity-50"
            >
              <PowerOff className="size-3.5" />
              {busy === "disable" ? "جاري التعطيل…" : "تعطيل"}
            </button>
          ) : null}
          {integration.integration_id ? (
            <button
              type="button"
              onClick={remove}
              disabled={busy !== null}
              className="rounded-card border border-danger/30 px-4 py-2.5 text-xs font-bold text-danger disabled:opacity-50"
            >
              {busy === "remove" ? "جاري الحذف…" : "حذف التكامل"}
            </button>
          ) : null}
        </div>
      </section>

      {message ? (
        <p className="rounded-card border border-border bg-secondary/50 px-4 py-3 text-xs font-bold">
          {message}
        </p>
      ) : null}
    </div>
  );
}
