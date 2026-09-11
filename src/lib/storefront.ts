import { queryOptions } from "@tanstack/react-query";
import { supabase } from "./supabase";

export const TENANT_SLUG = "past";

export type OrderType = "pickup" | "delivery" | "curbside" | "dinein";

export type Branch = {
  id?: string;
  branch_id?: string;
  name_ar: string;
  name_en?: string | null;
  city_ar: string | null;
  phone: string | null;
  busy: boolean | null;
  order_types: OrderType[] | null;
};

export type Brand = {
  name_ar: string | null;
  logo_url: string | null;
  theme: Record<string, unknown> | null;
};

export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  pickup: "استلام",
  delivery: "توصيل",
  curbside: "من السيارة",
  dinein: "محلي",
};

export const branchesQuery = queryOptions({
  queryKey: ["storefront_branches", TENANT_SLUG],
  queryFn: async (): Promise<Branch[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.rpc("storefront_branches", {
      p_tenant_slug: TENANT_SLUG,
    });
    if (error) throw error;
    return (data ?? []) as Branch[];
  },
  enabled: Boolean(supabase),
});

export const brandQuery = queryOptions({
  queryKey: ["brand", TENANT_SLUG],
  queryFn: async (): Promise<Brand | null> => {
    if (!supabase) return null;
    const { data, error } = await supabase
      .from("brands")
      .select("name_ar, logo_url, theme")
      .limit(1)
      .maybeSingle();
    // The brand row is decorative here — never block the page on it.
    if (error) return null;
    return (data ?? null) as Brand | null;
  },
  enabled: Boolean(supabase),
  retry: false,
});

export type Selection = {
  branchId: string;
  branchNameAr: string;
  orderType: OrderType;
};

const STORAGE_KEY = "talab.selection";

export function saveSelection(selection: Selection) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    /* storage unavailable */
  }
}

export function readSelection(): Selection | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Selection) : null;
  } catch {
    return null;
  }
}

export function branchKey(branch: Branch, index: number) {
  return branch.branch_id ?? branch.id ?? `${branch.name_ar}-${index}`;
}
