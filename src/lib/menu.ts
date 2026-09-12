import { queryOptions } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { TENANT_SLUG } from "./storefront";

export type ModifierOption = {
  id: string;
  name_ar: string;
  name_en?: string | null;
  price: number | null;
  calories: number | null;
};

export type ModifierGroup = {
  id: string;
  name_ar: string;
  name_en?: string | null;
  required: boolean | null;
  min: number | null;
  max: number | null;
  options: ModifierOption[] | null;
};

export type Product = {
  id: string;
  name_ar: string;
  name_en?: string | null;
  desc_ar: string | null;
  desc_en?: string | null;
  price: number | null;
  calories: number | null;
  deposit: number | null;
  in_stock: boolean | null;
  min_qty: number | null;
  max_qty: number | null;
  qty_step: number | null;
  image: string | null;
  modifier_groups: ModifierGroup[] | null;
};

export type ProductImage = {
  id: string;
  url: string;
  is_primary: boolean | null;
  sort: number | null;
};

export type ProductAllergen = {
  id: string;
  name_ar: string;
  name_en?: string | null;
  icon?: string | null;
};

export type ProductNutrition = {
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  sugar_g: number | null;
  sodium_mg: number | null;
  serving: string | null;
};

export type ProductSchedule = {
  starts_at: string | null;
  ends_at: string | null;
  weekdays: number[] | null;
  from_time: string | null;
  to_time: string | null;
};

export type ProductDetail = Product & {
  images: ProductImage[];
  allergens: ProductAllergen[];
  nutrition: ProductNutrition | null;
  schedule: ProductSchedule | null;
};

export type ProductCrossSell = {
  id: string;
  name_ar: string;
  name_en?: string | null;
  price: number;
  calories: number | null;
  image: string | null;
  has_options: boolean;
};

export type Category = {
  id: string;
  name_ar: string;
  name_en?: string | null;
  image_url: string | null;
  sort: number | null;
  products: Product[] | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function branchFromUrl() {
  if (typeof window === "undefined") return null;
  const value = new URL(window.location.href).searchParams.get("branch");
  return value && UUID_RE.test(value) ? value : null;
}

function resolvedBranchId(branchId: string | null) {
  return branchId ?? branchFromUrl();
}

/**
 * When no order context is selected, ?branch=<uuid> provides a browse-only
 * branch context for admin-generated e-menu links. Actual ordering still
 * requires a real branch + order-type selection before anything enters cart.
 */
export function menuQuery(branchId: string | null) {
  const resolved = resolvedBranchId(branchId);
  return queryOptions({
    queryKey: resolved
      ? ["storefront_menu", resolved]
      : ["storefront_menu_preview", TENANT_SLUG],
    queryFn: async (): Promise<Category[]> => {
      if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
      if (resolved) {
        const { data, error } = await supabase.rpc("storefront_menu", {
          p_branch_id: resolved,
        });
        if (error) throw error;
        return (data ?? []) as Category[];
      }

      const { data, error } = await supabase.rpc("storefront_menu_preview", {
        p_tenant_slug: TENANT_SLUG,
      });
      if (error) throw error;
      return (data ?? []) as Category[];
    },
  });
}

export function productDetailQuery(productId: string, branchId: string | null) {
  const resolved = resolvedBranchId(branchId);
  return queryOptions({
    queryKey: ["storefront_product_detail", TENANT_SLUG, resolved ?? "preview", productId],
    queryFn: async (): Promise<ProductDetail | null> => {
      if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
      const { data, error } = await supabase.rpc("storefront_product_detail", {
        p_tenant_slug: TENANT_SLUG,
        p_product_id: productId,
        p_branch_id: resolved,
      });
      if (error) throw error;
      if (!data) return null;
      const row = data as Omit<ProductDetail, "image"> & { image?: string | null };
      const images = Array.isArray(row.images) ? row.images : [];
      return {
        ...row,
        images,
        allergens: Array.isArray(row.allergens) ? row.allergens : [],
        image: row.image ?? images[0]?.url ?? null,
      } as ProductDetail;
    },
    retry: false,
  });
}

export function productCrossSellsQuery(productId: string, branchId: string | null) {
  const resolved = resolvedBranchId(branchId);
  return queryOptions({
    queryKey: ["storefront_product_cross_sells", TENANT_SLUG, resolved ?? "preview", productId],
    queryFn: async (): Promise<ProductCrossSell[]> => {
      if (!supabase) return [];
      const { data, error } = await supabase.rpc("storefront_product_cross_sells", {
        p_tenant_slug: TENANT_SLUG,
        p_product_id: productId,
        p_branch_id: resolved,
      });
      if (error) throw error;
      return Array.isArray(data) ? (data as ProductCrossSell[]) : [];
    },
    retry: false,
  });
}

/** Prices already include 15% VAT — never add tax anywhere. */
export function formatSAR(value: number) {
  return `${value.toFixed(2)} ر.س`;
}

export function formatCalories(calories: number) {
  return `${calories} سعرة حرارية`;
}

export type CartLine = {
  key: string;
  productId: string;
  nameAr: string;
  image: string | null;
  quantity: number;
  unitPrice: number;
  optionNames: string[];
  modifierIds: string[];
  note: string;
};

export function lineTotal(line: CartLine) {
  return line.unitPrice * line.quantity;
}

export function cartCount(lines: CartLine[]) {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}

export function cartTotal(lines: CartLine[]) {
  return lines.reduce((sum, l) => sum + lineTotal(l), 0);
}
