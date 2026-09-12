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
    if (!supabaseUrl || !anonKey || !serviceKey) {
      return json({ error: "server_not_configured" }, 500);
    }

    const user = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: integrations, error: integrationsError } = await user.rpc("staff_integrations");
    if (integrationsError) return json({ error: "not_authorized" }, 403);

    const loyverse = (integrations ?? []).find((row: any) => row.provider_slug === "loyverse");
    if (!loyverse?.integration_id || !loyverse?.has_credentials) {
      return json({ error: "loyverse_not_configured" }, 409);
    }

    const { data: credentials, error: credentialError } = await admin.rpc(
      "service_integration_credentials",
      { p_integration_id: loyverse.integration_id },
    );
    if (credentialError || !credentials) {
      return json({ error: "loyverse_credentials_unavailable" }, 503);
    }

    const accessToken = credentials.access_token || credentials.token;
    if (!accessToken) return json({ error: "loyverse_access_token_missing" }, 409);

    const response = await fetch("https://api.loyverse.com/v1.0/stores", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
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
          last_error: `Loyverse ${response.status}: ${detail.slice(0, 500)}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", loyverse.integration_id);

      return json(
        { error: "loyverse_connection_failed", status: response.status },
        response.status === 401 || response.status === 403 ? 400 : 502,
      );
    }

    const payload = (await response.json()) as any;
    const stores = Array.isArray(payload?.stores)
      ? payload.stores.map((store: any) => ({
          id: String(store.id),
          name: String(store.name ?? "Loyverse Store"),
          address: store.address ?? null,
          phone_number: store.phone_number ?? null,
        }))
      : [];

    await admin
      .from("tenant_integrations")
      .update({
        status: "active",
        last_tested_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", loyverse.integration_id);

    return json({ ok: true, api_version: "v1.0", stores });
  } catch (error) {
    console.error("loyverse-test", error);
    return json({ error: "unexpected_error" }, 500);
  }
});
