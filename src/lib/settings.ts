import { supabase } from "@/lib/supabase";

export type SettingsGroupKey =
  | "general"
  | "order"
  | "dinein"
  | "checkout"
  | "application"
  | "website"
  | "pages"
  | "text-control"
  | "delivery-areas"
  | "working-times"
  | "notifications"
  | "payment"
  | "links-page"
  | "activity-log"
  | "other";

export type AddressFieldSetting = {
  enabled: boolean;
  required: boolean;
};

export type GeneralSettings = {
  languages: string[];
  default_language: string;
  vat_number: string;
  tax_inclusive: boolean;
  tax_certificate_path: string | null;
  customer_addresses_enabled: boolean;
  address_fields: {
    unit_type: AddressFieldSetting;
    street: AddressFieldSetting;
    unit_no: AddressFieldSetting;
    floor: AddressFieldSetting;
    apartment: AddressFieldSetting;
    description: AddressFieldSetting;
  };
  complete_customer_before_purchase: boolean;
  required_customer_fields: {
    name: boolean;
    email: boolean;
    gender: boolean;
    dob: boolean;
  };
  payments_for: {
    wallet_topup: boolean;
    gift_cards: boolean;
    packages: boolean;
  };
  payment_receiving_branch_id: string | null;
};

export type OrderSettings = {
  order_types: {
    pickup: boolean;
    delivery: boolean;
    curbside: boolean;
    dinein: boolean;
  };
  time_options: {
    asap: boolean;
    scheduled: boolean;
  };
  add_to_cart_before_order_type: boolean;
  show_driver_info: boolean;
  pickup_confirmation_message: boolean;
  customer_cancel_while_waiting: boolean;
  show_branch_phone: boolean;
  show_delivery_time_in_cart: boolean;
  send_details_whatsapp: boolean;
  handed_to_driver_button: boolean;
  location_time_before_products: boolean;
  product_suggestions: boolean;
  location_method: "map" | string;
  order_expiry_minutes: number;
};

export type CheckoutSettings = {
  show_customer_info: boolean;
  show_delivery_info: boolean;
  show_pickup_info: boolean;
  show_curbside_info: boolean;
  show_time: boolean;
  show_coupon_codes: boolean;
  show_order_details: boolean;
  show_price_details: boolean;
  show_product_notes: boolean;
  show_order_notes: boolean;
  order_notes_required: boolean;
  allow_quantity_edit: boolean;
  show_price_while_adding: boolean;
  show_preparation_prompt: boolean;
  show_expected_arrival_time: boolean;
  success_popup: {
    image_path: string | null;
    line1_ar: string;
    line1_en: string;
    line2_ar: string;
    line2_en: string;
  };
};

export type PaymentSettings = {
  cash_enabled: boolean;
  pos_device_enabled: boolean;
  stc_pay_barcode_enabled: boolean;
  wallet_with_cash_enabled: boolean;
  tamara_banners_enabled: boolean;
  wallet_max_per_order: number | null;
  online_payment_name_ar: string;
  online_payment_name_en: string;
  online_payment_logo_path: string | null;
};

export async function fetchSettings<T extends Record<string, unknown>>(groupKey: SettingsGroupKey): Promise<T> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("staff_settings_read", { p_group_key: groupKey });
  if (error) throw error;
  return (data ?? {}) as T;
}

export async function saveSettings<T extends Record<string, unknown>>(
  groupKey: SettingsGroupKey,
  value: T,
): Promise<T> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("staff_settings_save", {
    p_group_key: groupKey,
    p_value: value,
  });
  if (error) throw error;
  return (data ?? value) as T;
}

const PRIVATE_DOCUMENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const PUBLIC_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SETTINGS_FILE_SIZE = 8 * 1024 * 1024;

function safeFileName(name: string) {
  const extension = name.includes(".") ? `.${name.split(".").pop()?.toLowerCase()}` : "";
  const stem = name
    .replace(/\.[^.]+$/, "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "file";
  return `${stem}${extension}`;
}

function validateFile(file: File, allowed: Set<string>) {
  if (!allowed.has(file.type)) throw new Error("نوع الملف غير مدعوم");
  if (file.size > MAX_SETTINGS_FILE_SIZE) throw new Error("الحد الأقصى لحجم الملف هو 8MB");
}

export async function uploadTaxCertificate(tenantId: string, file: File) {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  validateFile(file, PRIVATE_DOCUMENT_TYPES);
  const path = `${tenantId}/tax-certificates/${Date.now()}-${safeFileName(file.name)}`;
  const { error } = await supabase.storage.from("tenant-documents").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type,
  });
  if (error) throw error;
  return path;
}

export async function createTaxCertificateSignedUrl(path: string) {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.storage.from("tenant-documents").createSignedUrl(path, 600);
  if (error) throw error;
  return data.signedUrl;
}

export async function uploadSettingsPublicImage(
  tenantId: string,
  area: "checkout" | "payment",
  file: File,
) {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  validateFile(file, PUBLIC_IMAGE_TYPES);
  const path = `${tenantId}/settings/${area}/${Date.now()}-${safeFileName(file.name)}`;
  const { error } = await supabase.storage.from("storefront-media").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type,
  });
  if (error) throw error;
  const { data } = supabase.storage.from("storefront-media").getPublicUrl(path);
  return data.publicUrl;
}
