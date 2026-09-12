import { supabase } from "@/lib/supabase";

export type BranchOrderType = "pickup" | "delivery" | "curbside" | "dinein";

export type StaffBranchMenu = {
  id: string;
  name_ar: string;
  name_en: string | null;
  pos_ref: string | null;
  is_default: boolean;
};

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
  pos_ref: string | null;
  order_types: BranchOrderType[];
  menu: StaffBranchMenu | null;
  zone_count: number;
  product_count: number;
  unavailable_product_count: number;
};

export type StaffBranchHour = {
  weekday: number;
  opens_at: string | null;
  closes_at: string | null;
  is_24h: boolean;
  closed: boolean;
};

export type StaffBranchOrderType = {
  kind: BranchOrderType;
  enabled: boolean;
};

export type StaffDeliveryZone = {
  id: string;
  area_id: string;
  area_name_ar: string;
  area_name_en: string | null;
  eta_minutes: number;
  fee: number;
  min_order: number;
  below_min_fee: number;
  enabled: boolean;
};

export type StaffBranchProduct = {
  id: string;
  name_ar: string;
  name_en: string | null;
  category_ar: string;
  category_en: string | null;
  active: boolean;
  orderable: boolean;
  branch_available: boolean;
  effective_available: boolean;
  pos_ref: string | null;
};

export type StaffBranchDetail = {
  branch: {
    id: string;
    name_ar: string;
    name_en: string | null;
    city_ar: string | null;
    city_en: string | null;
    phone: string | null;
    lat: number | null;
    lng: number | null;
    status: string;
    busy: boolean;
    busy_until: string | null;
    pos_ref: string | null;
    code: string | null;
  };
  order_types: StaffBranchOrderType[];
  hours: StaffBranchHour[];
  menu: StaffBranchMenu | null;
  delivery_zones: StaffDeliveryZone[];
  products: StaffBranchProduct[];
};

export async function fetchStaffBranchOperations(): Promise<StaffBranchOperation[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("staff_branch_operations");
  if (error) throw error;
  return (data ?? []) as StaffBranchOperation[];
}

export async function fetchStaffBranchDetail(branchId: string): Promise<StaffBranchDetail> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("staff_branch_detail", { p_branch_id: branchId });
  if (error) throw error;
  return data as StaffBranchDetail;
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

export async function setBranchProductAvailability(branchId: string, productId: string, available: boolean) {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("staff_set_branch_product_availability", {
    p_branch_id: branchId,
    p_product_id: productId,
    p_available: available,
  });
  if (error) throw error;
  return data as { branch_id: string; product_id: string; available: boolean };
}

export async function updateDeliveryZone(zone: StaffDeliveryZone) {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("staff_update_delivery_zone", {
    p_zone_id: zone.id,
    p_eta_minutes: Number(zone.eta_minutes),
    p_fee: Number(zone.fee),
    p_min_order: Number(zone.min_order),
    p_below_min_fee: Number(zone.below_min_fee),
    p_enabled: Boolean(zone.enabled),
  });
  if (error) throw error;
  return data as {
    id: string;
    branch_id: string;
    eta_minutes: number;
    fee: number;
    min_order: number;
    below_min_fee: number;
    enabled: boolean;
  };
}
