import { supabase } from "@/lib/supabase";

export type StaffBranchOperation = {
  id: string;
  name_ar: string;
  name_en: string | null;
  city_ar: string | null;
  city_en: string | null;
  phone: string | null;
  busy: boolean;
  busy_until: string | null;
  status: string;
  sort: number;
};

export async function fetchStaffBranchOperations(): Promise<StaffBranchOperation[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("staff_branch_operations");
  if (error) throw error;
  return (data ?? []) as StaffBranchOperation[];
}

export async function setBranchBusyUntil(branchId: string, busyUntil: string | null) {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("staff_set_branch_busy", {
    p_branch_id: branchId,
    p_busy_until: busyUntil,
  });
  if (error) throw error;
  return data as { id: string; busy: boolean; busy_until: string | null };
}
