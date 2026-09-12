import { supabase } from "./supabase";
import { TENANT_SLUG, type PlaceOrderItem } from "./storefront";

export type MemberPriceLine = {
  product_id: string;
  regular_unit_price: number;
  unit_price: number;
  member_price_applied: boolean;
};

export type MemberPricingQuote = {
  customer_recognized: boolean;
  member_pricing_applied: boolean;
  regular_subtotal: number;
  subtotal: number;
  savings: number;
  prices: MemberPriceLine[];
};

export async function fetchMemberPriceFlags(): Promise<string[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("storefront_member_price_flags", {
    p_tenant_slug: TENANT_SLUG,
  });
  if (error) return [];
  return Array.isArray(data) ? (data as string[]) : [];
}

export async function quoteMemberPricing(params: {
  branchId: string;
  customerPhone: string;
  items: PlaceOrderItem[];
}): Promise<MemberPricingQuote | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("storefront_member_pricing_quote", {
    p_branch_id: params.branchId,
    p_customer_phone: params.customerPhone,
    p_items: params.items,
  });
  if (error || !data) return null;
  const row = data as MemberPricingQuote;
  return {
    customer_recognized: Boolean(row.customer_recognized),
    member_pricing_applied: Boolean(row.member_pricing_applied),
    regular_subtotal: Number(row.regular_subtotal ?? 0),
    subtotal: Number(row.subtotal ?? 0),
    savings: Number(row.savings ?? 0),
    prices: Array.isArray(row.prices)
      ? row.prices.map((price) => ({
          ...price,
          regular_unit_price: Number(price.regular_unit_price ?? 0),
          unit_price: Number(price.unit_price ?? 0),
          member_price_applied: Boolean(price.member_price_applied),
        }))
      : [],
  };
}
