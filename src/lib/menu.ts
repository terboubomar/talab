import { queryOptions } from "@tanstack/react-query";
import { supabase } from "./supabase";

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

export type Category = {
  id: string;
  name_ar: string;
  name_en?: string | null;
  image_url: string | null;
  sort: number | null;
  products: Product[] | null;
};

export function menuQuery(branchId: string) {
  return queryOptions({
    queryKey: ["storefront_menu", branchId],
    queryFn: async (): Promise<Category[]> => {
      if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
      const { data, error } = await supabase.rpc("storefront_menu", {
        p_branch_id: branchId,
      });
      if (error) throw error;
      return (data ?? []) as Category[];
    },
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
