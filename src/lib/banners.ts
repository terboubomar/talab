import { supabase } from "@/lib/supabase";

export const STOREFRONT_MEDIA_BUCKET = "storefront-media";

export type AdminBanner = {
  id: string;
  tenant_id: string;
  title_ar: string | null;
  title_en: string | null;
  image_url: string;
  mobile_image_url: string | null;
  link_url: string | null;
  sort_order: number;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
};

export type BannerInput = {
  title_ar?: string | null;
  title_en?: string | null;
  image_url: string;
  mobile_image_url?: string | null;
  link_url?: string | null;
  sort_order?: number;
  is_active?: boolean;
  starts_at?: string | null;
  ends_at?: string | null;
};

export async function fetchAdminBanners(): Promise<AdminBanner[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("banners")
    .select("id,tenant_id,title_ar,title_en,image_url,mobile_image_url,link_url,sort_order,is_active,starts_at,ends_at,created_at,updated_at")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as AdminBanner[];
}

export async function createBanner(tenantId: string, input: BannerInput): Promise<AdminBanner> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase
    .from("banners")
    .insert({
      tenant_id: tenantId,
      title_ar: input.title_ar || null,
      title_en: input.title_en || null,
      image_url: input.image_url,
      mobile_image_url: input.mobile_image_url || null,
      link_url: input.link_url || null,
      sort_order: input.sort_order ?? 0,
      is_active: input.is_active ?? true,
      starts_at: input.starts_at || null,
      ends_at: input.ends_at || null,
      updated_at: new Date().toISOString(),
    })
    .select("id,tenant_id,title_ar,title_en,image_url,mobile_image_url,link_url,sort_order,is_active,starts_at,ends_at,created_at,updated_at")
    .single();
  if (error) throw error;
  return data as AdminBanner;
}

export async function updateBanner(id: string, input: Partial<BannerInput>): Promise<void> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const payload: Record<string, unknown> = { ...input, updated_at: new Date().toISOString() };
  if ("title_ar" in payload) payload.title_ar = payload.title_ar || null;
  if ("title_en" in payload) payload.title_en = payload.title_en || null;
  if ("mobile_image_url" in payload) payload.mobile_image_url = payload.mobile_image_url || null;
  if ("link_url" in payload) payload.link_url = payload.link_url || null;
  if ("starts_at" in payload) payload.starts_at = payload.starts_at || null;
  if ("ends_at" in payload) payload.ends_at = payload.ends_at || null;
  const { error } = await supabase.from("banners").update(payload).eq("id", id);
  if (error) throw error;
}

export async function deleteBanner(id: string): Promise<void> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { error } = await supabase.from("banners").delete().eq("id", id);
  if (error) throw error;
}

function fileExtension(file: File) {
  const fromName = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (fromName) return fromName;
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/gif") return "gif";
  return "jpg";
}

export async function uploadBannerImage(file: File, tenantId: string, variant: "desktop" | "mobile") {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  if (!file.type.startsWith("image/")) throw new Error("image_required");
  if (file.size > 8 * 1024 * 1024) throw new Error("image_too_large");

  const token = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = `${tenantId}/banners/${token}-${variant}.${fileExtension(file)}`;
  const { error } = await supabase.storage.from(STOREFRONT_MEDIA_BUCKET).upload(path, file, {
    cacheControl: "31536000",
    upsert: false,
    contentType: file.type,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(STOREFRONT_MEDIA_BUCKET).getPublicUrl(path);
  return { path, publicUrl: data.publicUrl };
}

export async function removeStorefrontMediaByUrl(url: string | null | undefined) {
  if (!supabase || !url) return;
  const marker = `/storage/v1/object/public/${STOREFRONT_MEDIA_BUCKET}/`;
  const index = url.indexOf(marker);
  if (index < 0) return;
  const path = decodeURIComponent(url.slice(index + marker.length));
  if (!path) return;
  await supabase.storage.from(STOREFRONT_MEDIA_BUCKET).remove([path]);
}
