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
function orderType(type: string) {
  if (type === "dinein") return 1;
  if (type === "pickup") return 2;
  if (type === "delivery") return 3;
  if (type === "curbside") return 4;
  return 2;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const { orderId } = await req.json();
    if (!orderId) return json({ error: "order_id_required" }, 400);

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

    const { data: integrations, error: intErr } = await user.rpc("staff_integrations");
    if (intErr) return json({ error: "not_authorized" }, 403);
    const foodics = (integrations ?? []).find((row: any) => row.provider_slug === "foodics");
    if (!foodics?.integration_id || !foodics?.has_credentials) return json({ error: "foodics_not_configured" }, 409);
    if (foodics.integration_status === "disabled") return json({ error: "foodics_disabled" }, 409);

    const { data: credentials, error: credErr } = await admin.rpc("service_integration_credentials", { p_integration_id: foodics.integration_id });
    if (credErr || !credentials) return json({ error: "foodics_credentials_unavailable" }, 503);
    const token = credentials.access_token || credentials.token;
    if (!token) return json({ error: "foodics_access_token_missing" }, 409);

    const { data: order, error: orderErr } = await admin.from("orders")
      .select("id,tenant_id,branch_id,order_type,status,notes,subtotal,total,scheduled_for,pos_ref,pos_status")
      .eq("id", orderId).maybeSingle();
    if (orderErr || !order) return json({ error: "order_not_found" }, 404);
    if (order.pos_status === "sent" && order.pos_ref) return json({ ok: true, alreadySent: true, foodicsOrderRef: order.pos_ref });

    const { data: mapping } = await admin.from("integration_branch_mappings")
      .select("external_branch_id,active").eq("integration_id", foodics.integration_id).eq("branch_id", order.branch_id).maybeSingle();
    if (!mapping?.active || !mapping.external_branch_id) return json({ error: "foodics_branch_not_mapped" }, 409);

    const { data: items, error: itemsErr } = await admin.from("order_items")
      .select("id,product_id,name_ar,qty,unit_price,line_total,notes").eq("order_id", order.id);
    if (itemsErr || !items?.length) return json({ error: "order_items_missing" }, 409);

    const productIds = [...new Set(items.map((i: any) => i.product_id).filter(Boolean))];
    const { data: products } = await admin.from("products").select("id,pos_ref").in("id", productIds);
    const productRef = new Map((products ?? []).map((p: any) => [p.id, p.pos_ref]));

    const itemIds = items.map((i: any) => i.id);
    const { data: itemModifiers } = await admin.from("order_item_modifiers").select("id,order_item_id,modifier_id,price").in("order_item_id", itemIds);
    const modifierIds = [...new Set((itemModifiers ?? []).map((m: any) => m.modifier_id).filter(Boolean))];
    const { data: modifiers } = modifierIds.length ? await admin.from("modifiers").select("id,pos_ref").in("id", modifierIds) : { data: [] as any[] };
    const modifierRef = new Map((modifiers ?? []).map((m: any) => [m.id, m.pos_ref]));

    for (const item of items) if (!productRef.get(item.product_id)) return json({ error: "foodics_product_not_mapped", orderItemId: item.id }, 409);
    for (const mod of itemModifiers ?? []) if (mod.modifier_id && !modifierRef.get(mod.modifier_id)) return json({ error: "foodics_modifier_not_mapped", modifierId: mod.modifier_id }, 409);

    const byItem = new Map<string, any[]>();
    for (const mod of itemModifiers ?? []) { const list = byItem.get(mod.order_item_id) ?? []; list.push(mod); byItem.set(mod.order_item_id, list); }

    const payload: Record<string, any> = {
      guests: 1,
      type: orderType(order.order_type),
      branch_id: mapping.external_branch_id,
      customer_notes: order.notes || undefined,
      due_at: order.scheduled_for || undefined,
      meta: { "3rd_party_order_number": order.id },
      products: items.map((item: any) => ({
        product_id: productRef.get(item.product_id),
        quantity: Number(item.qty),
        unit_price: Number(item.unit_price),
        total_price: Number(item.line_total),
        kitchen_notes: item.notes || undefined,
        meta: { external_additional_product_info: `TALAB:${item.id}` },
        options: (byItem.get(item.id) ?? []).map((mod: any) => ({
          modifier_option_id: modifierRef.get(mod.modifier_id), quantity: 1,
          unit_price: Number(mod.price ?? 0), total_price: Number(mod.price ?? 0),
        })),
      })),
      subtotal_price: Number(order.subtotal),
      total_price: Number(order.total),
    };

    const { data: latestAttempt } = await admin.from("order_dispatch_log").select("attempt").eq("order_id", order.id).eq("integration_id", foodics.integration_id).order("attempt", { ascending: false }).limit(1).maybeSingle();
    const attempt = Number(latestAttempt?.attempt ?? 0) + 1;
    const { data: logRow } = await admin.from("order_dispatch_log").insert({ tenant_id: order.tenant_id, order_id: order.id, integration_id: foodics.integration_id, attempt, request: payload, status: "sending" }).select("id").single();
    await admin.from("orders").update({ pos_status: "sending", pos_last_error: null, updated_at: new Date().toISOString() }).eq("id", order.id);

    const environment = foodics.settings_json?.environment === "sandbox" ? "sandbox" : "production";
    const baseUrl = environment === "sandbox" ? "https://api-sandbox.foodics.com/v5" : "https://api.foodics.com/v5";
    const response = await fetch(`${baseUrl}/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    let responseBody: any = null;
    try { responseBody = responseText ? JSON.parse(responseText) : null; } catch { responseBody = { raw: responseText.slice(0, 2000) }; }

    if (!response.ok) {
      const errorText = `Foodics ${response.status}: ${responseText.slice(0, 700)}`;
      await Promise.all([
        admin.from("orders").update({ pos_status: "failed", pos_last_error: errorText, updated_at: new Date().toISOString() }).eq("id", order.id),
        admin.from("order_dispatch_log").update({ status: "failed", response: responseBody, error: errorText }).eq("id", logRow?.id),
      ]);
      return json({ error: "foodics_order_push_failed", status: response.status }, response.status >= 500 ? 502 : 400);
    }

    const created = responseBody?.data ?? responseBody ?? {};
    const externalRef = String(created.reference || created.id || "");
    if (!externalRef) {
      const errorText = "Foodics response did not include an order id/reference";
      await Promise.all([
        admin.from("orders").update({ pos_status: "failed", pos_last_error: errorText, updated_at: new Date().toISOString() }).eq("id", order.id),
        admin.from("order_dispatch_log").update({ status: "failed", response: responseBody, error: errorText }).eq("id", logRow?.id),
      ]);
      return json({ error: "foodics_order_reference_missing" }, 502);
    }

    await Promise.all([
      admin.from("orders").update({ pos_status: "sent", pos_ref: externalRef, pos_last_error: null, pos_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", order.id),
      admin.from("order_dispatch_log").update({ status: "succeeded", response: responseBody, error: null }).eq("id", logRow?.id),
    ]);
    return json({ ok: true, alreadySent: false, foodicsOrderRef: externalRef, attempt });
  } catch (error) {
    console.error("foodics-order-push", error);
    return json({ error: error instanceof Error ? error.message : "unexpected_error" }, 500);
  }
});
