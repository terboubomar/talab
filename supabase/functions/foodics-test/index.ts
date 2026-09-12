import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "server_not_configured" }, 500);

    const user = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data: integrations, error: integrationsError } = await user.rpc("staff_integrations");
    if (integrationsError) return json({ error: "not_authorized" }, 403);
    const foodics = (integrations ?? []).find((row: any) => row.provider_slug === "foodics");
    if (!foodics?.integration_id || !foodics?.has_credentials) return json({ error: "foodics_not_configured" }, 409);

    const { data: credentials, error: credentialError } = await admin.rpc("service_integration_credentials", {
      p_integration_id: foodics.integration_id,
    });
    if (credentialError || !credentials) return json({ error: "foodics_credentials_unavailable" }, 503);

    const accessToken = credentials.access_token || credentials.token;
    if (!accessToken) return json({ error: "foodics_access_token_missing" }, 409);
    const environment = foodics.settings_json?.environment === "sandbox" ? "sandbox" : "production";
    const baseUrl = environment === "sandbox" ? "https://api-sandbox.foodics.com/v5" : "https://api.foodics.com/v5";

    const response = await fetch(`${baseUrl}/branches`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const detail = await response.text();
      await admin.from("tenant_integrations").update({
        status: "error",
        last_tested_at: new Date().toISOString(),
        last_error: `Foodics ${response.status}: ${detail.slice(0, 500)}`,
        updated_at: new Date().toISOString(),
      }).eq("id", foodics.integration_id);
      return json({ error: "foodics_connection_failed", status: response.status }, response.status === 401 || response.status === 403 ? 400 : 502);
    }

    const payload = await response.json() as any;
    await admin.from("tenant_integrations").update({
      status: "active",
      last_tested_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    }).eq("id", foodics.integration_id);

    const branches = Array.isArray(payload?.data) ? payload.data.map((b: any) => ({
      id: b.id,
      name: b.name,
      name_localized: b.name_localized ?? null,
      reference: b.reference ?? null,
    })) : [];

    return json({ ok: true, environment, branches });
  } catch (error) {
    console.error("foodics-test", error);
    return json({ error: "unexpected_error" }, 500);
  }
});
