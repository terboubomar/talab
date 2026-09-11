import { supabase } from "@/lib/supabase";
import type { OrderType, PlaceOrderItem } from "@/lib/storefront";

export type CouponScopeType =
  | "order_type"
  | "source"
  | "branch"
  | "product"
  | "category"
  | "customer_group"
  | "customer";

export type CouponScope = { type: CouponScopeType; id: string };

export type CouponQuote = {
  coupon_id: string;
  code: string;
  reservation_id: string;
  discount: number;
  delivery_discount: number;
  subtotal: number;
  total: number;
  expires_at: string;
  success_msg_ar: string | null;
  success_msg_en: string | null;
};

export type Coupon = {
  id: string;
  code: string;
  discount_type: "percent" | "fixed";
  value: number;
  max_discount: number | null;
  free_delivery: boolean;
  min_purchase: number;
  starts_at: string | null;
  ends_at: string | null;
  total_limit: number | null;
  per_customer_limit: number | null;
  auto_apply: boolean;
  day_parting_json: Record<string, unknown>;
  success_msg_ar: string | null;
  success_msg_en: string | null;
  status: "active" | "inactive";
  created_at: string;
  scopes: CouponScope[];
};

export type CouponScopeOptions = {
  branches: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  products: { id: string; name: string; category_id: string }[];
  customer_groups: { id: string; name: string }[];
  customers: { id: string; name: string; phone: string }[];
};

const CART_ID_KEY = "talab.couponCartId";

export function getCouponCartId() {
  if (typeof window === "undefined") return "00000000-0000-4000-8000-000000000001";
  const existing = sessionStorage.getItem(CART_ID_KEY);
  if (existing) return existing;
  const next = crypto.randomUUID();
  sessionStorage.setItem(CART_ID_KEY, next);
  return next;
}

export function resetCouponCartId() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(CART_ID_KEY);
}

export async function quoteCoupon(input: {
  branchId: string;
  orderType: OrderType;
  customerPhone: string;
  code: string;
  items: PlaceOrderItem[];
  cartId: string;
  areaId?: string;
}): Promise<CouponQuote> {
  if (!supabase) throw new Error("database_not_connected");
  const { data, error } = await supabase.rpc("storefront_coupon_quote", {
    p_branch_id: input.branchId,
    p_order_type: input.orderType,
    p_customer_phone: input.customerPhone,
    p_code: input.code,
    p_items: input.items,
    p_cart_id: input.cartId,
    p_area_id: input.areaId ?? null,
    p_source: "web",
  });
  if (error) throw error;
  return data as unknown as CouponQuote;
}

export async function fetchCoupons(): Promise<Coupon[]> {
  if (!supabase) return [];
  const [{ data: coupons, error: couponError }, { data: scopes, error: scopeError }] = await Promise.all([
    supabase
      .from("coupons")
      .select("id,code,discount_type,value,max_discount,free_delivery,min_purchase,starts_at,ends_at,total_limit,per_customer_limit,auto_apply,day_parting_json,success_msg_ar,success_msg_en,status,created_at")
      .order("created_at", { ascending: false }),
    supabase.from("coupon_scopes").select("coupon_id,scope_type,scope_id"),
  ]);
  if (couponError) throw couponError;
  if (scopeError) throw scopeError;
  const byCoupon = new Map<string, CouponScope[]>();
  for (const row of scopes ?? []) {
    const list = byCoupon.get(row.coupon_id) ?? [];
    list.push({ type: row.scope_type as CouponScopeType, id: row.scope_id });
    byCoupon.set(row.coupon_id, list);
  }
  return (coupons ?? []).map((row) => ({
    ...row,
    value: Number(row.value),
    max_discount: row.max_discount == null ? null : Number(row.max_discount),
    min_purchase: Number(row.min_purchase),
    day_parting_json: (row.day_parting_json ?? {}) as Record<string, unknown>,
    scopes: byCoupon.get(row.id) ?? [],
  })) as Coupon[];
}

export async function fetchCouponScopeOptions(): Promise<CouponScopeOptions> {
  if (!supabase) return { branches: [], categories: [], products: [], customer_groups: [], customers: [] };
  const { data, error } = await supabase.rpc("staff_coupon_scope_options");
  if (error) throw error;
  return data as unknown as CouponScopeOptions;
}

export async function saveCoupon(input: {
  couponId?: string | null;
  rule: Record<string, unknown>;
  scopes: CouponScope[];
}) {
  if (!supabase) throw new Error("database_not_connected");
  const { data, error } = await supabase.rpc("admin_save_coupon", {
    p_coupon_id: input.couponId ?? null,
    p_rule: input.rule,
    p_scopes: input.scopes,
  });
  if (error) throw error;
  return data as string;
}

export async function deleteCoupon(couponId: string) {
  if (!supabase) throw new Error("database_not_connected");
  const { error } = await supabase.rpc("admin_delete_coupon", { p_coupon_id: couponId });
  if (error) throw error;
}
