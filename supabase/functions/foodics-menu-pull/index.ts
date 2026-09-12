import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

async function fetchAllProducts(baseUrl: string, token: string) {
  const products: any[] = [];
  let url: string | null = `${baseUrl}/products?include=category,modifiers.options,branches`;
  let pages = 0;
  while (url && pages < 20) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" } });
    if (!response.ok) throw new Error(`foodics_products_${response.status}:${(await response.text()).slice(0, 300)}`);
    const payload = await response.json() as any;
    if (Array.isArray(payload?.data)) products.push(...payload.data);
    const next = payload?.links?.next;
    url = typeof next === "string" && next ? (next.startsWith("http") ? next : `${baseUrl}${next}`) : null;
    pages += 1;
  }
  return products;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const { apply = false } = await req.json().catch(() => ({ apply: false }));
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "server_not_configured" }, 500);

    const user = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } });
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const [{ data: integrations, error: intErr }, { data: setup, error: setupErr }] = await Promise.all([
      user.rpc("staff_integrations"),
      user.rpc("staff_foodics_setup"),
    ]);
    if (intErr || setupErr) return json({ error: "not_authorized" }, 403);
    const foodics = (integrations ?? []).find((row: any) => row.provider_slug === "foodics");
    if (!foodics?.integration_id || !foodics?.has_credentials) return json({ error: "foodics_not_configured" }, 409);
    const targetMenuId = setup?.settings?.target_menu_id;
    if (!targetMenuId) return json({ error: "foodics_target_menu_required" }, 409);

    const { data: credentials, error: credErr } = await admin.rpc("service_integration_credentials", { p_integration_id: foodics.integration_id });
    if (credErr || !credentials) return json({ error: "foodics_credentials_unavailable" }, 503);
    const token = credentials.access_token || credentials.token;
    if (!token) return json({ error: "foodics_access_token_missing" }, 409);
    const environment = setup?.settings?.environment === "sandbox" ? "sandbox" : "production";
    const baseUrl = environment === "sandbox" ? "https://api-sandbox.foodics.com/v5" : "https://api.foodics.com/v5";

    const products = await fetchAllProducts(baseUrl, token);
    const categoryIds = new Set(products.map((p: any) => p.category?.id).filter(Boolean));
    const modifierIds = new Set(products.flatMap((p: any) => (p.modifiers ?? []).map((m: any) => m.id)).filter(Boolean));
    const optionIds = new Set(products.flatMap((p: any) => (p.modifiers ?? []).flatMap((m: any) => (m.options ?? []).map((o: any) => o.id))).filter(Boolean));

    if (!apply) {
      return json({ ok: true, preview: true, counts: { products: products.length, categories: categoryIds.size, modifier_groups: modifierIds.size, modifier_options: optionIds.size }, sample: products.slice(0, 5).map((p: any) => ({ id: p.id, name: p.name, name_localized: p.name_localized, price: p.price, category: p.category?.name })) });
    }

    const { data: menu, error: menuErr } = await admin.from("menus").select("id,tenant_id,brand_id").eq("id", targetMenuId).maybeSingle();
    if (menuErr || !menu) return json({ error: "target_menu_not_found" }, 409);
    const tenantId = menu.tenant_id;
    const mappings = new Map<string, string>((setup?.mappings ?? []).filter((m: any) => m.active).map((m: any) => [String(m.external_branch_id), String(m.branch_id)]));

    const { data: provider } = await admin.from("integration_providers").select("id").eq("slug", "foodics").maybeSingle();
    const { data: job } = await admin.from("sync_jobs").insert({ tenant_id: tenantId, provider_id: provider?.id, integration_id: foodics.integration_id, kind: "foodics_menu_pull", status: "running", last_run_at: new Date().toISOString() }).select("id").single();

    const categoryMap = new Map<string, string>();
    const groupMap = new Map<string, string>();
    let insertedProducts = 0;
    let updatedProducts = 0;

    for (const p of products) {
      if (!p?.id || !p?.category?.id) continue;
      let categoryId = categoryMap.get(p.category.id);
      if (!categoryId) {
        const { data: existingCategory } = await admin.from("categories").select("id").eq("tenant_id", tenantId).eq("menu_id", targetMenuId).eq("pos_ref", p.category.id).maybeSingle();
        if (existingCategory?.id) {
          categoryId = existingCategory.id;
          await admin.from("categories").update({ name_ar: p.category.name_localized || p.category.name || "Foodics", name_en: p.category.name || p.category.name_localized || "Foodics", image_url: p.category.image ?? null, active: !p.category.deleted_at, pos_name: "Foodics", updated_at: new Date().toISOString(), deleted_at: null }).eq("id", categoryId);
        } else {
          const { data: created, error } = await admin.from("categories").insert({ tenant_id: tenantId, menu_id: targetMenuId, name_ar: p.category.name_localized || p.category.name || "Foodics", name_en: p.category.name || p.category.name_localized || "Foodics", image_url: p.category.image ?? null, active: !p.category.deleted_at, pos_name: "Foodics", pos_ref: p.category.id, sort: 0 }).select("id").single();
          if (error) throw error; categoryId = created.id;
        }
        categoryMap.set(p.category.id, categoryId!);
      }

      const productPatch = { category_id: categoryId, kind: "product", name_ar: p.name_localized || p.name || "Foodics", name_en: p.name || p.name_localized || "Foodics", desc_ar: p.description_localized ?? p.description ?? null, desc_en: p.description ?? p.description_localized ?? null, price: Number(p.price ?? 0), calories: p.calories ?? null, active: Boolean(p.is_active) && !p.deleted_at, orderable: Boolean(p.is_ready ?? p.is_active) && !p.deleted_at, pos_name: "Foodics", pos_ref: p.id, deleted_at: null, updated_at: new Date().toISOString() };
      const { data: existingProduct } = await admin.from("products").select("id").eq("tenant_id", tenantId).eq("pos_ref", p.id).maybeSingle();
      let productId: string;
      if (existingProduct?.id) { productId = existingProduct.id; const { error } = await admin.from("products").update(productPatch).eq("id", productId); if (error) throw error; updatedProducts++; }
      else { const { data: created, error } = await admin.from("products").insert({ tenant_id: tenantId, ...productPatch, created_at: new Date().toISOString() }).select("id").single(); if (error) throw error; productId = created.id; insertedProducts++; }

      for (const m of p.modifiers ?? []) {
        if (!m?.id) continue;
        let groupId = groupMap.get(m.id);
        if (!groupId) {
          const { data: existingGroup } = await admin.from("modifier_groups").select("id").eq("tenant_id", tenantId).eq("pos_ref", m.id).maybeSingle();
          const groupPatch = { name_ar: m.name_localized || m.name || "Foodics", name_en: m.name || m.name_localized || "Foodics", min_select: Number(m.pivot?.minimum_options ?? 0), max_select: Number(m.pivot?.maximum_options ?? 1), required: Number(m.pivot?.minimum_options ?? 0) > 0, pos_ref: m.id, updated_at: new Date().toISOString() };
          if (existingGroup?.id) { groupId = existingGroup.id; await admin.from("modifier_groups").update(groupPatch).eq("id", groupId); }
          else { const { data: created, error } = await admin.from("modifier_groups").insert({ tenant_id: tenantId, ...groupPatch, sort: 0 }).select("id").single(); if (error) throw error; groupId = created.id; }
          groupMap.set(m.id, groupId!);
        }
        await admin.from("product_modifier_groups").upsert({ tenant_id: tenantId, product_id: productId, group_id: groupId, sort: Number(m.pivot?.index ?? 0) }, { onConflict: "product_id,group_id" });
        for (const o of m.options ?? []) {
          if (!o?.id) continue;
          const optionPatch = { group_id: groupId, name_ar: o.name_localized || o.name || "Foodics", name_en: o.name || o.name_localized || "Foodics", price: Number(o.price ?? 0), calories: o.calories ?? null, active: Boolean(o.is_active) && !o.deleted_at, pos_ref: o.id };
          const { data: existingOption } = await admin.from("modifiers").select("id").eq("tenant_id", tenantId).eq("pos_ref", o.id).maybeSingle();
          if (existingOption?.id) await admin.from("modifiers").update(optionPatch).eq("id", existingOption.id);
          else await admin.from("modifiers").insert({ tenant_id: tenantId, ...optionPatch, sort: Number(o.index ?? 0) });
        }
      }

      for (const b of p.branches ?? []) {
        const branchId = mappings.get(String(b.id));
        if (!branchId) continue;
        if (b.pivot?.price != null) await admin.from("product_branch_prices").upsert({ tenant_id: tenantId, product_id: productId, branch_id: branchId, price: Number(b.pivot.price) }, { onConflict: "product_id,branch_id" });
        await admin.from("product_branch_availability").upsert({ tenant_id: tenantId, product_id: productId, branch_id: branchId, available: Boolean(b.pivot?.is_active) && Boolean(b.pivot?.is_in_stock) }, { onConflict: "product_id,branch_id" });
      }
    }

    await admin.from("sync_jobs").update({ status: "succeeded", last_run_at: new Date().toISOString(), cursor: { products: products.length }, error: null, updated_at: new Date().toISOString() }).eq("id", job?.id);
    await admin.from("integration_branch_mappings").update({ last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("integration_id", foodics.integration_id);

    return json({ ok: true, preview: false, counts: { products: products.length, inserted_products: insertedProducts, updated_products: updatedProducts, categories: categoryIds.size, modifier_groups: modifierIds.size, modifier_options: optionIds.size } });
  } catch (error) {
    console.error("foodics-menu-pull", error);
    return json({ error: error instanceof Error ? error.message : "unexpected_error" }, 500);
  }
});
