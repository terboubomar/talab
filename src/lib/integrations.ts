import { supabase } from "@/lib/supabase";

export type IntegrationProvider = {
  provider_id: string;
  provider_slug: string;
  category: string;
  name_ar: string;
  name_en: string;
  logo: string | null;
  config_schema: Record<string, unknown>;
  integration_id: string | null;
  integration_status: "disconnected" | "configured" | "active" | "error" | "disabled";
  has_credentials: boolean;
  settings_json: Record<string, unknown>;
  last_tested_at: string | null;
  last_error: string | null;
  updated_at: string | null;
};

export type IntegrationBranch = {
  id: string;
  brand_id: string;
  name_ar: string;
  name_en: string;
  pos_ref: string | null;
};

export type IntegrationBranchMapping = {
  id: string;
  branch_id: string;
  external_branch_id: string;
  external_branch_name: string | null;
  active: boolean;
  last_synced_at: string | null;
};

export type FoodicsBranch = {
  id: string;
  name: string;
  name_localized: string | null;
  reference: string | null;
};

export type FoodicsSetup = {
  integration_id: string | null;
  settings: Record<string, unknown>;
  menus: Array<{
    id: string;
    brand_id: string;
    name_ar: string;
    name_en: string;
    is_default: boolean;
  }>;
  branches: IntegrationBranch[];
  mappings: IntegrationBranchMapping[];
};

export type FoodicsMenuPreview = {
  ok: boolean;
  preview: boolean;
  counts: {
    products: number;
    categories: number;
    modifier_groups: number;
    modifier_options: number;
    inserted_products?: number;
    updated_products?: number;
  };
  sample?: Array<{
    id: string;
    name: string;
    name_localized: string | null;
    price: number;
    category: string | null;
  }>;
};

export type LoyverseStore = {
  id: string;
  name: string;
  address: string | null;
  phone_number: string | null;
};

export type LoyverseSetup = {
  integration_id: string | null;
  settings: Record<string, unknown>;
  branches: IntegrationBranch[];
  mappings: IntegrationBranchMapping[];
};

export async function fetchIntegrations(): Promise<IntegrationProvider[]> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("staff_integrations");
  if (error) throw error;
  return (data ?? []) as IntegrationProvider[];
}

export async function saveIntegration(input: {
  providerSlug: string;
  credentials?: Record<string, unknown> | null;
  settings?: Record<string, unknown>;
  status?: "configured" | "active" | "disabled";
}): Promise<string> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("staff_save_integration", {
    p_provider_slug: input.providerSlug,
    p_credentials: input.credentials ?? null,
    p_settings: input.settings ?? {},
    p_status: input.status ?? "configured",
  });
  if (error) throw error;
  return String(data);
}

export async function removeIntegration(integrationId: string): Promise<void> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { error } = await supabase.rpc("staff_remove_integration", {
    p_integration_id: integrationId,
  });
  if (error) throw error;
}

export async function fetchFoodicsSetup(): Promise<FoodicsSetup> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("staff_foodics_setup");
  if (error) throw error;
  return data as FoodicsSetup;
}

export async function saveFoodicsSettings(input: {
  targetMenuId: string;
  environment: "production" | "sandbox";
}): Promise<void> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { error } = await supabase.rpc("staff_save_foodics_settings", {
    p_target_menu_id: input.targetMenuId,
    p_environment: input.environment,
  });
  if (error) throw error;
}

export async function saveFoodicsBranchMapping(input: {
  branchId: string;
  externalBranchId: string;
  externalBranchName?: string | null;
  active?: boolean;
}): Promise<string> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("staff_save_foodics_branch_mapping", {
    p_branch_id: input.branchId,
    p_external_branch_id: input.externalBranchId,
    p_external_branch_name: input.externalBranchName ?? null,
    p_active: input.active ?? true,
  });
  if (error) throw error;
  return String(data);
}

export async function testFoodicsConnection(): Promise<{
  ok: boolean;
  environment: "production" | "sandbox";
  branches: FoodicsBranch[];
}> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.functions.invoke("foodics-test", { body: {} });
  if (error) throw error;
  return data;
}

export async function pullFoodicsMenu(apply = false): Promise<FoodicsMenuPreview> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.functions.invoke("foodics-menu-pull", {
    body: { apply },
  });
  if (error) throw error;
  return data as FoodicsMenuPreview;
}

export async function pushOrderToFoodics(orderId: string): Promise<{
  ok: boolean;
  alreadySent: boolean;
  foodicsOrderRef: string;
  attempt?: number;
}> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.functions.invoke("foodics-order-push", {
    body: { orderId },
  });
  if (error) throw error;
  return data;
}

export async function fetchLoyverseSetup(): Promise<LoyverseSetup> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("staff_loyverse_setup");
  if (error) throw error;
  return data as LoyverseSetup;
}

export async function saveLoyverseBranchMapping(input: {
  branchId: string;
  externalBranchId: string;
  externalBranchName?: string | null;
  active?: boolean;
}): Promise<string> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("staff_save_loyverse_branch_mapping", {
    p_branch_id: input.branchId,
    p_external_branch_id: input.externalBranchId,
    p_external_branch_name: input.externalBranchName ?? null,
    p_active: input.active ?? true,
  });
  if (error) throw error;
  return String(data);
}

export async function testLoyverseConnection(): Promise<{
  ok: boolean;
  api_version: "v1.0";
  stores: LoyverseStore[];
}> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.functions.invoke("loyverse-test", { body: {} });
  if (error) throw error;
  return data;
}
