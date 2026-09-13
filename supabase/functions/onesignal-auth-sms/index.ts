import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function hookSecret() {
  return Deno.env.get("SEND_SMS_HOOK_SECRET")?.replace(/^v1,whsec_/, "") ?? "";
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const secret = hookSecret();
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!secret || !supabaseUrl || !serviceKey) return json({ error: "server_not_configured" }, 500);

    const payloadText = await req.text();
    const webhook = new Webhook(secret);
    const event = webhook.verify(payloadText, Object.fromEntries(req.headers)) as any;

    const phone = String(event?.user?.phone ?? "").trim();
    const otp = String(event?.sms?.otp ?? "").trim();
    const tenantSlug = String(event?.user?.user_metadata?.tenant_slug ?? "").trim();
    if (!phone || !otp) return json({ error: { http_code: 400, message: "missing_phone_or_otp" } }, 400);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: provider } = await admin
      .from("integration_providers")
      .select("id")
      .eq("slug", "onesignal")
      .eq("active", true)
      .maybeSingle();
    if (!provider?.id) return json({ error: { http_code: 503, message: "onesignal_provider_missing" } }, 503);

    let integrationQuery = admin
      .from("tenant_integrations")
      .select("id, tenant_id, settings_json, status, credentials_secret_id, tenants!inner(slug)")
      .eq("provider_id", provider.id)
      .in("status", ["configured", "active"])
      .not("credentials_secret_id", "is", null);

    if (tenantSlug) integrationQuery = integrationQuery.eq("tenants.slug", tenantSlug);
    const { data: matches, error: matchError } = await integrationQuery.order("updated_at", { ascending: false }).limit(2);
    if (matchError) return json({ error: { http_code: 500, message: "onesignal_lookup_failed" } }, 500);

    if (!matches?.length || (!tenantSlug && matches.length !== 1)) {
      return json({ error: { http_code: 409, message: "onesignal_tenant_not_resolved" } }, 409);
    }

    const integration = matches[0] as any;
    const appId = String(integration.settings_json?.app_id ?? "").trim();
    const smsFrom = String(integration.settings_json?.sms_from ?? "").trim();
    if (!appId) return json({ error: { http_code: 409, message: "onesignal_app_id_missing" } }, 409);

    const { data: credentials, error: credentialError } = await admin.rpc("service_integration_credentials", {
      p_integration_id: integration.id,
    });
    if (credentialError || !credentials) {
      return json({ error: { http_code: 503, message: "onesignal_credentials_unavailable" } }, 503);
    }

    const apiKey = String(credentials.rest_api_key ?? credentials.api_key ?? "").trim();
    if (!apiKey) return json({ error: { http_code: 409, message: "onesignal_api_key_missing" } }, 409);

    const body: Record<string, unknown> = {
      app_id: appId,
      contents: { en: `رمز التحقق الخاص بك في طلب: ${otp}` },
      target_channel: "sms",
      include_phone_numbers: [phone],
      idempotency_key: crypto.randomUUID(),
    };
    if (smsFrom) body.sms_from = smsFrom;

    const response = await fetch("https://api.onesignal.com/notifications?c=sms", {
      method: "POST",
      headers: {
        Authorization: `Key ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    const responseText = await response.text();
    if (!response.ok) {
      console.error("onesignal-auth-sms provider error", response.status, responseText.slice(0, 500));
      return json({ error: { http_code: 502, message: "onesignal_sms_delivery_failed" } }, 502);
    }

    let responsePayload: any = null;
    try { responsePayload = responseText ? JSON.parse(responseText) : null; } catch { /* ignore */ }
    if (responsePayload && !responsePayload.id && responsePayload.errors) {
      console.error("onesignal-auth-sms no message id", responsePayload.errors);
      return json({ error: { http_code: 502, message: "onesignal_sms_not_sent" } }, 502);
    }

    return json({});
  } catch (error) {
    console.error("onesignal-auth-sms", error);
    return json({ error: { http_code: 401, message: "invalid_auth_hook_signature" } }, 401);
  }
});
