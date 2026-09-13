import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: integrations, error: integrationsError } = await user.rpc("staff_integrations");
    if (integrationsError) return json({ error: "not_authorized" }, 403);

    const oneSignal = (integrations ?? []).find((row: any) => row.provider_slug === "onesignal");
    if (!oneSignal?.integration_id || !oneSignal?.has_credentials) {
      return json({ error: "onesignal_not_configured" }, 409);
    }

    const appId = typeof oneSignal.settings_json?.app_id === "string"
      ? oneSignal.settings_json.app_id.trim()
      : "";
    if (!appId) return json({ error: "onesignal_app_id_missing" }, 409);

    const { data: credentials, error: credentialError } = await admin.rpc(
      "service_integration_credentials",
      { p_integration_id: oneSignal.integration_id },
    );
    if (credentialError || !credentials) {
      return json({ error: "onesignal_credentials_unavailable" }, 503);
    }

    const apiKey = credentials.rest_api_key || credentials.api_key;
    if (!apiKey) return json({ error: "onesignal_api_key_missing" }, 409);

    const response = await fetch(`https://api.onesignal.com/apps/${encodeURIComponent(appId)}`, {
      headers: {
        Authorization: `Key ${apiKey}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const detail = await response.text();
      await admin
        .from("tenant_integrations")
        .update({
          status: "error",
          last_tested_at: new Date().toISOString(),
          last_error: `OneSignal ${response.status}: ${detail.slice(0, 500)}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", oneSignal.integration_id);

      return json(
        { error: "onesignal_connection_failed", status: response.status },
        response.status === 401 || response.status === 403 || response.status === 404 ? 400 : 502,
      );
    }

    const payload = (await response.json()) as Record<string, unknown>;
    await admin
      .from("tenant_integrations")
      .update({
        status: "active",
        last_tested_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", oneSignal.integration_id);

    return json({
      ok: true,
      id: String(payload.id ?? appId),
      name: typeof payload.name === "string" ? payload.name : null,
    });
  } catch (error) {
    console.error("onesignal-test", error);
    return json({ error: "unexpected_error" }, 500);
  }
});
