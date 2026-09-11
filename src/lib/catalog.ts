import { supabase } from "@/lib/supabase";

export type AdminMenu = {
  id: string;
  name_ar: string;
  name_en: string | null;
  is_default: boolean;
};

export type AdminCategory = {
  id: string;
  menu_id: string;
  name_ar: string;
  name_en: string | null;
  active: boolean;
  sort: number;
  product_count: number;
};

export type AdminProduct = {
  id: string;
  category_id: string;
  name_ar: string;
  name_en: string | null;
  desc_ar: string | null;
  price: number;
  calories: number | null;
  active: boolean;
  orderable: boolean;
  sort: number;
  primary_image_url: string | null;
};

export async function fetchMenus(): Promise<AdminMenu[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("menus")
    .select("id, name_ar, name_en, is_default")
    .is("deleted_at", null)
    .order("sort", { ascending: true });
  if (error) throw error;
  return (data ?? []) as AdminMenu[];
}

export async function fetchCategories(menuId: string): Promise<AdminCategory[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("categories")
    .select("id, menu_id, name_ar, name_en, active, sort, products(count)")
    .eq("menu_id", menuId)
    .is("deleted_at", null)
    .order("sort", { ascending: true });
  if (error) throw error;
  return (
    (data ?? []) as unknown as Array<
      Omit<AdminCategory, "product_count"> & { products: { count: number }[] }
    >
  ).map((c) => ({
    id: c.id,
    menu_id: c.menu_id,
    name_ar: c.name_ar,
    name_en: c.name_en,
    active: c.active,
    sort: c.sort,
    product_count: c.products?.[0]?.count ?? 0,
  }));
}

export async function fetchProducts(categoryId: string): Promise<AdminProduct[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, category_id, name_ar, name_en, desc_ar, price, calories, active, orderable, sort, product_images(url, is_primary)",
    )
    .eq("category_id", categoryId)
    .is("deleted_at", null)
    .order("sort", { ascending: true });
  if (error) throw error;
  return (
    (data ?? []) as unknown as Array<
      Omit<AdminProduct, "primary_image_url"> & {
        product_images: { url: string; is_primary: boolean }[];
      }
    >
  ).map((p) => ({
    id: p.id,
    category_id: p.category_id,
    name_ar: p.name_ar,
    name_en: p.name_en,
    desc_ar: p.desc_ar,
    price: p.price,
    calories: p.calories,
    active: p.active,
    orderable: p.orderable,
    sort: p.sort,
    primary_image_url:
      p.product_images?.find((img) => img.is_primary)?.url ?? p.product_images?.[0]?.url ?? null,
  }));
}

export async function setCategoryActive(id: string, active: boolean) {
  if (!supabase) return;
  const { error } = await supabase.from("categories").update({ active }).eq("id", id);
  if (error) throw error;
}

export async function setProductActive(
  id: string,
  patch: { active?: boolean; orderable?: boolean },
) {
  if (!supabase) return;
  const { error } = await supabase.from("products").update(patch).eq("id", id);
  if (error) throw error;
}

export async function swapCategorySort(a: AdminCategory, b: AdminCategory) {
  if (!supabase) return;
  const { error: e1 } = await supabase.from("categories").update({ sort: b.sort }).eq("id", a.id);
  const { error: e2 } = await supabase.from("categories").update({ sort: a.sort }).eq("id", b.id);
  if (e1 || e2) throw e1 ?? e2;
}

export async function createCategory(params: {
  tenantId: string;
  menuId: string;
  nameAr: string;
  nameEn: string;
}) {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data: existing } = await supabase
    .from("categories")
    .select("sort")
    .eq("menu_id", params.menuId)
    .order("sort", { ascending: false })
    .limit(1);
  const nextSort = ((existing?.[0] as { sort: number } | undefined)?.sort ?? -1) + 1;
  const { error } = await supabase.from("categories").insert({
    tenant_id: params.tenantId,
    menu_id: params.menuId,
    name_ar: params.nameAr,
    name_en: params.nameEn || params.nameAr,
    active: true,
    sort: nextSort,
  });
  if (error) throw error;
}

export type ProductFormValues = {
  nameAr: string;
  nameEn: string;
  descAr: string;
  price: number;
  calories: number | null;
  active: boolean;
  orderable: boolean;
  imageUrl: string;
};

export async function createProduct(params: {
  tenantId: string;
  categoryId: string;
  values: ProductFormValues;
}): Promise<string> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase
    .from("products")
    .insert({
      tenant_id: params.tenantId,
      category_id: params.categoryId,
      name_ar: params.values.nameAr,
      name_en: params.values.nameEn || params.values.nameAr,
      desc_ar: params.values.descAr || null,
      price: params.values.price,
      calories: params.values.calories,
      active: params.values.active,
      orderable: params.values.orderable,
    })
    .select("id")
    .single();
  if (error) throw error;
  const productId = (data as { id: string }).id;
  if (params.values.imageUrl.trim()) {
    await supabase.from("product_images").insert({
      tenant_id: params.tenantId,
      product_id: productId,
      url: params.values.imageUrl.trim(),
      is_primary: true,
    });
  }
  return productId;
}

export async function updateProduct(params: {
  tenantId: string;
  productId: string;
  existingImageUrl: string | null;
  values: ProductFormValues;
}) {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { error } = await supabase
    .from("products")
    .update({
      name_ar: params.values.nameAr,
      name_en: params.values.nameEn || params.values.nameAr,
      desc_ar: params.values.descAr || null,
      price: params.values.price,
      calories: params.values.calories,
      active: params.values.active,
      orderable: params.values.orderable,
    })
    .eq("id", params.productId);
  if (error) throw error;

  const newUrl = params.values.imageUrl.trim();
  if (newUrl && newUrl !== params.existingImageUrl) {
    if (params.existingImageUrl) {
      await supabase
        .from("product_images")
        .update({ url: newUrl })
        .eq("product_id", params.productId)
        .eq("is_primary", true);
    } else {
      await supabase.from("product_images").insert({
        tenant_id: params.tenantId,
        product_id: params.productId,
        url: newUrl,
        is_primary: true,
      });
    }
  }
}
