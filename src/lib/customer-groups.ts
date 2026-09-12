import { supabase } from "@/lib/supabase";

export type CustomerGroup = {
  id: string;
  name_ar: string;
  name_en: string;
  is_default: boolean;
  member_count: number;
  created_at: string;
};

export async function fetchCustomerGroups(): Promise<CustomerGroup[]> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("staff_customer_groups");
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row["id"]),
    name_ar: String(row["name_ar"] ?? ""),
    name_en: String(row["name_en"] ?? ""),
    is_default: Boolean(row["is_default"]),
    member_count: Number(row["member_count"] ?? 0),
    created_at: String(row["created_at"]),
  }));
}

export async function saveCustomerGroup(input: {
  groupId?: string | null;
  nameAr: string;
  nameEn: string;
  isDefault: boolean;
}): Promise<string> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("staff_save_customer_group", {
    p_group_id: input.groupId ?? null,
    p_name_ar: input.nameAr,
    p_name_en: input.nameEn,
    p_is_default: input.isDefault,
  });
  if (error) throw error;
  return String(data);
}

export async function deleteCustomerGroup(groupId: string): Promise<void> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { error } = await supabase.rpc("staff_delete_customer_group", {
    p_group_id: groupId,
  });
  if (error) throw error;
}
