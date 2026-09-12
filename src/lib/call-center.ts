import { supabase } from "@/lib/supabase";
import type { OrderType } from "@/lib/staff";
import type { CheckoutPaymentMethod } from "@/lib/storefront";

export type CallCenterZone = {
  area_id: string;
  name_ar: string;
  name_en: string | null;
  lat: number | null;
  lng: number | null;
  eta_minutes: number | null;
  fee: number;
  min_order: number;
  below_min_fee: number;
};

export type CallCenterBranch = {
  id: string;
  name_ar: string;
  name_en: string | null;
  order_types: OrderType[];
  delivery_zones: CallCenterZone[];
};

export type CallCenterSetup = { branches: CallCenterBranch[] };

export type CallCenterCustomer = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  addresses: Array<{
    id: string;
    label: string | null;
    area_id: string | null;
    lat: number | null;
    lng: number | null;
    street: string | null;
    unit_no: string | null;
    floor: string | null;
    apartment: string | null;
    notes: string | null;
  }>;
};

export type CallCenterOrderItem = {
  product_id: string;
  qty: number;
  modifier_ids: string[];
  note?: string;
};

export type CallCenterOrderResult = {
  order_id: string;
  total: number;
  status: "pending";
  payment_method: CheckoutPaymentMethod;
  payment_status: "unpaid" | "pending";
  payment_account_id: string | null;
};

export async function fetchCallCenterSetup(): Promise<CallCenterSetup> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("staff_call_center_setup");
  if (error) throw error;
  return data as CallCenterSetup;
}

export async function lookupCallCenterCustomer(phone: string): Promise<CallCenterCustomer | null> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("staff_call_center_customer_lookup", { p_phone: phone.trim() });
  if (error) throw error;
  return (data ?? null) as CallCenterCustomer | null;
}

export async function createCallCenterOrder(input: {
  branchId: string;
  orderType: OrderType;
  customerName: string;
  customerPhone: string;
  notes?: string | null;
  items: CallCenterOrderItem[];
  paymentMethod: CheckoutPaymentMethod;
  areaId?: string | null;
  lat?: number | null;
  lng?: number | null;
  addressText?: string | null;
}): Promise<CallCenterOrderResult> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("staff_create_call_center_order_v2", {
    p_branch_id: input.branchId,
    p_order_type: input.orderType,
    p_customer_name: input.customerName.trim(),
    p_customer_phone: input.customerPhone.trim(),
    p_notes: input.notes?.trim() || null,
    p_items: input.items,
    p_area_id: input.areaId ?? null,
    p_lat: input.lat ?? null,
    p_lng: input.lng ?? null,
    p_address_text: input.addressText?.trim() || null,
    p_payment_method: input.paymentMethod,
  });
  if (error) throw error;
  return data as CallCenterOrderResult;
}
