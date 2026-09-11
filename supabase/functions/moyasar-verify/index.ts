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

function basicAuth(key: string) {
  return `Basic ${btoa(`${key}:`)}`;
}

function mapStatus(status: string) {
  switch (status) {
    case "paid":
    case "captured":
      return "succeeded";
    case "authorized":
      return "authorized";
    case "failed":
      return "failed";
    case "voided":
      return "cancelled";
    default:
      return "pending";
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const { paymentId, orderId, accountId } = await req.json();
    if (!paymentId || !orderId || !accountId) return json({ error: "missing_parameters" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json({ error: "server_not_configured" }, 500);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const [{ data: order, error: orderError }, { data: account, error: accountError }] = await Promise.all([
      admin
        .from("orders")
        .select("id, tenant_id, brand_id, branch_id, total, currency, payment_account_id, payment_method, payment_status")
        .eq("id", orderId)
        .maybeSingle(),
      admin
        .from("payment_accounts")
        .select("id, tenant_id, brand_id, provider, environment, enabled, public_config")
        .eq("id", accountId)
        .maybeSingle(),
    ]);

    if (orderError || accountError || !order || !account) return json({ error: "payment_context_not_found" }, 404);
    if (account.provider !== "moyasar" || !account.enabled) return json({ error: "payment_account_disabled" }, 409);
    if (order.payment_method !== "online" || order.payment_account_id !== account.id) return json({ error: "payment_account_mismatch" }, 409);
    if (order.tenant_id !== account.tenant_id || (account.brand_id && account.brand_id !== order.brand_id)) {
      return json({ error: "payment_account_mismatch" }, 409);
    }

    const publicConfig = (account.public_config ?? {}) as Record<string, unknown>;
    const secretEnv = typeof publicConfig.secret_key_env === "string" ? publicConfig.secret_key_env : "MOYASAR_SECRET_KEY";
    const secretKey = Deno.env.get(secretEnv);
    if (!secretKey) return json({ error: "moyasar_secret_not_configured" }, 503);

    const response = await fetch(`https://api.moyasar.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: basicAuth(secretKey), Accept: "application/json" },
    });
    if (!response.ok) return json({ error: "moyasar_verification_failed" }, response.status >= 500 ? 502 : 400);

    const payment = await response.json() as Record<string, any>;
    const metadata = (payment.metadata ?? {}) as Record<string, string>;
    const expectedAmount = Math.round(Number(order.total) * 100);
    const expectedCurrency = String(order.currency || "SAR").trim().toUpperCase();

    if (Number(payment.amount) !== expectedAmount || String(payment.currency).toUpperCase() !== expectedCurrency) {
      return json({ error: "payment_amount_mismatch" }, 409);
    }
    if (metadata.order_id && metadata.order_id !== order.id) return json({ error: "payment_order_mismatch" }, 409);
    if (metadata.payment_account_id && metadata.payment_account_id !== account.id) {
      return json({ error: "payment_account_mismatch" }, 409);
    }

    const mappedStatus = mapStatus(String(payment.status));
    const eventId = `verify:${payment.id}:${payment.status}:${payment.updated_at ?? "current"}`;
    const method = payment.source?.company || payment.source?.type || "moyasar";

    const { error: applyError } = await admin.rpc("payment_apply_provider_event", {
      p_payment_account_id: account.id,
      p_provider_event_id: eventId,
      p_event_type: `verification_${payment.status}`,
      p_order_id: order.id,
      p_provider_payment_id: payment.id,
      p_status: mappedStatus,
      p_amount: Number(payment.amount) / 100,
      p_currency: payment.currency || expectedCurrency,
      p_payment_method: method,
      p_payload: payment,
    });
    if (applyError) return json({ error: "payment_state_update_failed" }, 500);

    return json({
      ok: true,
      orderId: order.id,
      paymentId: payment.id,
      paymentStatus: String(payment.status),
      paid: mappedStatus === "succeeded",
    });
  } catch (error) {
    console.error("moyasar-verify", error);
    return json({ error: "unexpected_error" }, 500);
  }
});
