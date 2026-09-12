import { supabase } from "@/lib/supabase";

export type TaxSettings = {
  vat_rate: number;
  tax_inclusive: boolean;
};

export type BusinessInfo = {
  support_phone: string;
  support_email: string;
  address_ar: string;
  about_ar: string;
};

export async function fetchTaxSettings(tenantId: string): Promise<TaxSettings> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase
    .from("tenants")
    .select("vat_rate, tax_inclusive")
    .eq("id", tenantId)
    .single();
  if (error) throw error;
  return data as TaxSettings;
}

export async function updateTaxSettings(tenantId: string, values: TaxSettings) {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { error } = await supabase
    .from("tenants")
    .update({ vat_rate: values.vat_rate, tax_inclusive: values.tax_inclusive })
    .eq("id", tenantId);
  if (error) throw error;
}

const DEFAULT_BUSINESS_INFO: BusinessInfo = {
  support_phone: "",
  support_email: "",
  address_ar: "",
  about_ar: "",
};

export async function fetchBusinessInfo(tenantId: string): Promise<BusinessInfo> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase
    .from("tenant_settings")
    .select("value")
    .eq("tenant_id", tenantId)
    .eq("group_key", "business_info")
    .is("brand_id", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return DEFAULT_BUSINESS_INFO;
  return { ...DEFAULT_BUSINESS_INFO, ...(data.value as Partial<BusinessInfo>) };
}

export async function updateBusinessInfo(tenantId: string, value: BusinessInfo) {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { error } = await supabase
    .from("tenant_settings")
    .upsert(
      { tenant_id: tenantId, brand_id: null, group_key: "business_info", value },
      { onConflict: "tenant_id,group_key,brand_scope" },
    );
  if (error) throw error;
}
