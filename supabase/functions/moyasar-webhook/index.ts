import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const event = await req.json() as Record<string, any>;
    const payment = event.data as Record<string, any> | undefined;
    const metadata = (payment?.metadata ?? {}) as Record<string, string>;
    const accountId = metadata.payment_account_id;
    const orderId = metadata.order_id;

    if (!event.id || !event.type || !payment?.id || !accountId || !orderId) {
      return json({ error: "invalid_webhook_payload" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json({ error: "server_not_configured" }, 500);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const [{ data: account, error: accountError }, { data: order, error: orderError }] = await Promise.all([
      admin
        .from("payment_accounts")
        .select("id, tenant_id, brand_id, provider, environment, enabled, public_config")
        .eq("id", accountId)
        .maybeSingle(),
      admin
        .from("orders")
        .select("id, tenant_id, brand_id, total, currency, payment_account_id, payment_method")
        .eq("id", orderId)
        .maybeSingle(),
    ]);

    if (accountError || orderError || !account || !order) return json({ error: "payment_context_not_found" }, 404);
    if (account.provider !== "moyasar" || !account.enabled) return json({ error: "payment_account_disabled" }, 409);
    if (order.payment_method !== "online" || order.payment_account_id !== account.id) return json({ error: "payment_account_mismatch" }, 409);
    if (order.tenant_id !== account.tenant_id || (account.brand_id && account.brand_id !== order.brand_id)) {
      return json({ error: "payment_account_mismatch" }, 409);
    }

    const publicConfig = (account.public_config ?? {}) as Record<string, unknown>;
    const webhookEnv = typeof publicConfig.webhook_secret_env === "string"
      ? publicConfig.webhook_secret_env
      : "MOYASAR_WEBHOOK_SECRET";
    const webhookSecret = Deno.env.get(webhookEnv);
    if (!webhookSecret) return json({ error: "moyasar_webhook_secret_not_configured" }, 503);
    if (typeof event.secret_token !== "string" || !constantTimeEqual(event.secret_token, webhookSecret)) {
      return json({ error: "invalid_webhook_secret" }, 401);
    }

    const expectedLive = account.environment === "live";
    if (typeof event.live === "boolean" && event.live !== expectedLive) {
      return json({ error: "payment_environment_mismatch" }, 409);
    }

    const expectedAmount = Math.round(Number(order.total) * 100);
    const expectedCurrency = String(order.currency || "SAR").trim().toUpperCase();
    if (Number(payment.amount) !== expectedAmount || String(payment.currency).toUpperCase() !== expectedCurrency) {
      return json({ error: "payment_amount_mismatch" }, 409);
    }

    if (String(event.type) === "payment_refunded" || String(payment.status) === "refunded") {
      const cumulativeRefunded = Number(payment.refunded ?? 0) / 100;
      const { error: refundError } = await admin.rpc("payment_reconcile_moyasar_refund", {
        p_payment_account_id: account.id,
        p_provider_event_id: String(event.id),
        p_order_id: order.id,
        p_provider_payment_id: String(payment.id),
        p_refunded_amount: cumulativeRefunded,
        p_currency: payment.currency || expectedCurrency,
        p_payload: event,
      });

      if (refundError) {
        console.error("moyasar-webhook refund reconciliation", refundError);
        return json({ error: "refund_reconciliation_failed" }, 500);
      }
      return json({ received: true });
    }

    const status = mapStatus(String(payment.status));
    const method = payment.source?.company || payment.source?.type || "moyasar";
    const { error: applyError } = await admin.rpc("payment_apply_provider_event", {
      p_payment_account_id: account.id,
      p_provider_event_id: String(event.id),
      p_event_type: String(event.type),
      p_order_id: order.id,
      p_provider_payment_id: String(payment.id),
      p_status: status,
      p_amount: Number(payment.amount) / 100,
      p_currency: payment.currency || expectedCurrency,
      p_payment_method: method,
      p_payload: event,
    });

    if (applyError) {
      console.error("moyasar-webhook state update", applyError);
      return json({ error: "payment_state_update_failed" }, 500);
    }

    return json({ received: true });
  } catch (error) {
    console.error("moyasar-webhook", error);
    return json({ error: "unexpected_error" }, 500);
  }
});
