import { supabase } from "@/lib/supabase";

export type IntegrationProvider = {
  provider_id: string;
  provider_slug: string;
  category: string;
  name_ar: string;
  name_en: string;
  logo: string | null;
  config_schema: Record<string, unknown>;
  integration_id: string | null;
  integration_status: "disconnected" | "configured" | "active" | "error" | "disabled";
  has_credentials: boolean;
  settings_json: Record<string, unknown>;
  last_tested_at: string | null;
  last_error: string | null;
  updated_at: string | null;
};

export async function fetchIntegrations(): Promise<IntegrationProvider[]> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("staff_integrations");
  if (error) throw error;
  return (data ?? []) as IntegrationProvider[];
}

export async function saveIntegration(input: {
  providerSlug: string;
  credentials?: Record<string, unknown> | null;
  settings?: Record<string, unknown>;
  status?: "configured" | "active" | "disabled";
}): Promise<string> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("staff_save_integration", {
    p_provider_slug: input.providerSlug,
    p_credentials: input.credentials ?? null,
    p_settings: input.settings ?? {},
    p_status: input.status ?? "configured",
  });
  if (error) throw error;
  return String(data);
}

export async function removeIntegration(integrationId: string): Promise<void> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { error } = await supabase.rpc("staff_remove_integration", {
    p_integration_id: integrationId,
  });
  if (error) throw error;
}
