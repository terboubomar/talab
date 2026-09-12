import { supabase } from "./supabase";

export type AdminCustomerGroup = {
  id: string;
  name_ar: string;
  name_en: string;
  is_default: boolean;
};

export type AdminGroupPrice = {
  group_id: string;
  price: number;
};

export async function fetchCustomerGroups(): Promise<AdminCustomerGroup[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("customer_groups")
    .select("id, name_ar, name_en, is_default")
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as AdminCustomerGroup[];
}

export async function fetchProductGroupPrices(productId: string): Promise<AdminGroupPrice[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("product_group_prices")
    .select("group_id, price")
    .eq("product_id", productId);
  if (error) throw error;
  return ((data ?? []) as Array<{ group_id: string; price: number | string }>).map((row) => ({
    group_id: row.group_id,
    price: Number(row.price),
  }));
}

export async function saveProductGroupPrices(params: {
  tenantId: string;
  productId: string;
  prices: Array<{ groupId: string; price: number }>;
}) {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");

  const clean = params.prices
    .filter((entry) => entry.groupId && Number.isFinite(entry.price) && entry.price >= 0)
    .map((entry) => ({ groupId: entry.groupId, price: Number(entry.price) }));

  const { data: currentRows, error: currentError } = await supabase
    .from("product_group_prices")
    .select("group_id")
    .eq("product_id", params.productId);
  if (currentError) throw currentError;

  const desiredIds = new Set(clean.map((entry) => entry.groupId));
  const removed = ((currentRows ?? []) as Array<{ group_id: string }>)
    .map((row) => row.group_id)
    .filter((groupId) => !desiredIds.has(groupId));

  if (clean.length > 0) {
    const { error } = await supabase.from("product_group_prices").upsert(
      clean.map((entry) => ({
        tenant_id: params.tenantId,
        product_id: params.productId,
        group_id: entry.groupId,
        price: entry.price,
      })),
      { onConflict: "product_id,group_id" },
    );
    if (error) throw error;
  }

  if (removed.length > 0) {
    const { error } = await supabase
      .from("product_group_prices")
      .delete()
      .eq("product_id", params.productId)
      .in("group_id", removed);
    if (error) throw error;
  }
}
