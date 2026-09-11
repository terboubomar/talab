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

function getPublishableKey() {
  const legacy = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (legacy) return legacy;
  const raw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (!raw) return null;
  try {
    const keys = JSON.parse(raw) as Record<string, string>;
    return keys.default ?? Object.values(keys)[0] ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let refundId: string | null = null;

  try {
    const authorization = req.headers.get("Authorization");
    if (!authorization) return json({ error: "not_authorized" }, 401);

    const { orderId, amount, reason, kind = "order" } = await req.json();
    if (!orderId || !Number.isFinite(Number(amount)) || Number(amount) <= 0 || typeof reason !== "string") {
      return json({ error: "invalid_parameters" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const publishableKey = getPublishableKey();
    if (!supabaseUrl || !serviceKey || !publishableKey) {
      return json({ error: "server_not_configured" }, 500);
    }

    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: prepared, error: prepareError } = await userClient.rpc("staff_prepare_gateway_refund", {
      p_order_id: orderId,
      p_amount: Number(amount),
      p_reason: reason,
      p_kind: kind,
    });

    if (prepareError) {
      const message = prepareError.message || "refund_prepare_failed";
      const status = message.includes("not_authorized") ? 403 : 409;
      return json({ error: message }, status);
    }

    const context = prepared as {
      refund_id: string;
      payment_account_id: string;
      provider_payment_id: string;
      amount: number;
      currency: string;
    };
    refundId = context.refund_id;

    const { data: account, error: accountError } = await admin
      .from("payment_accounts")
      .select("id, provider, enabled, public_config")
      .eq("id", context.payment_account_id)
      .maybeSingle();

    if (accountError || !account || account.provider !== "moyasar" || !account.enabled) {
      await admin.rpc("payment_fail_gateway_refund", {
        p_refund_id: refundId,
        p_error: "payment_account_unavailable",
        p_payload: {},
      });
      return json({ error: "payment_account_unavailable" }, 409);
    }

    const publicConfig = (account.public_config ?? {}) as Record<string, unknown>;
    const secretEnv = typeof publicConfig.secret_key_env === "string"
      ? publicConfig.secret_key_env
      : "MOYASAR_SECRET_KEY";
    const secretKey = Deno.env.get(secretEnv);
    if (!secretKey) {
      // Configuration failure is explicit, so releasing the reservation is safe.
      await admin.rpc("payment_fail_gateway_refund", {
        p_refund_id: refundId,
        p_error: "moyasar_secret_not_configured",
        p_payload: {},
      });
      return json({ error: "moyasar_secret_not_configured" }, 503);
    }

    let response: Response;
    try {
      response = await fetch(
        `https://api.moyasar.com/v1/payments/${encodeURIComponent(context.provider_payment_id)}/refund`,
        {
          method: "POST",
          headers: {
            Authorization: basicAuth(secretKey),
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ amount: Math.round(Number(context.amount) * 100) }),
        },
      );
    } catch (error) {
      // Network outcome may be ambiguous: do NOT mark failed and free the amount,
      // because Moyasar might already have accepted the refund.
      console.error("moyasar-refund network outcome unknown", error);
      return json({ error: "provider_outcome_unknown", refundId }, 502);
    }

    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      await admin.rpc("payment_fail_gateway_refund", {
        p_refund_id: refundId,
        p_error: `moyasar_http_${response.status}`,
        p_payload: payload,
      });
      return json({ error: "moyasar_refund_failed", refundId, provider: payload }, 409);
    }

    if (String(payload.status) !== "refunded") {
      // A 2xx with an unexpected state is treated as ambiguous; keep the refund
      // pending instead of allowing a second provider call.
      return json({ error: "provider_refund_not_confirmed", refundId }, 502);
    }

    const providerRef = typeof payload.id === "string" ? payload.id : context.provider_payment_id;
    const { data: completed, error: completeError } = await admin.rpc("payment_complete_gateway_refund", {
      p_refund_id: refundId,
      p_provider_ref: providerRef,
      p_payload: payload,
    });

    if (completeError) {
      // Money has already moved. Keep the pending reservation for reconciliation.
      console.error("moyasar-refund ledger completion", completeError);
      return json({ error: "refund_ledger_pending", refundId }, 500);
    }

    return json({ ok: true, refund: completed, provider: { id: providerRef, status: payload.status } });
  } catch (error) {
    console.error("moyasar-refund", error);
    return json({ error: "unexpected_error", refundId }, 500);
  }
});
