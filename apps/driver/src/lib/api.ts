import type { Session } from "@supabase/supabase-js";

import { supabase } from "./supabase";

export type DriverProfile = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  tenant_id: string;
  branches: Array<{ id: string; name_ar: string; name_en: string | null }>;
};

export type DriverOrderStatus = "accepted" | "preparing" | "ready" | "out_for_delivery";

export type DriverOrder = {
  id: string;
  branch_id: string;
  branch_name_ar: string;
  status: DriverOrderStatus;
  placed_at: string;
  scheduled_for: string | null;
  total: number;
  payment_method: "cash" | "online";
  payment_status: string;
  delivery_address_text: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  notes: string | null;
  customer: { name: string; phone: string };
  items_count: number;
};

export type DriverOrderDetail = {
  id: string;
  status: DriverOrderStatus | "completed";
  branch_id: string;
  branch: { name_ar: string; name_en: string | null; phone: string | null };
  customer: { name: string; phone: string };
  delivery_address_text: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  notes: string | null;
  total: number;
  payment_method: "cash" | "online";
  payment_status: string;
  placed_at: string;
  scheduled_for: string | null;
  items: Array<{
    id: string;
    name_ar: string;
    qty: number;
    notes: string | null;
    modifiers: Array<{ name_ar: string }>;
  }>;
};

function client() {
  if (!supabase) throw new Error("driver_app_not_configured");
  return supabase;
}

export async function currentSession(): Promise<Session | null> {
  const { data, error } = await client().auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await client().auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const { error } = await client().auth.signOut();
  if (error) throw error;
}

export async function fetchDriverProfile(): Promise<DriverProfile> {
  const { data, error } = await client().rpc("driver_my_profile");
  if (error) throw error;
  return data as DriverProfile;
}

export async function fetchDriverOrders(): Promise<DriverOrder[]> {
  const { data, error } = await client().rpc("driver_my_orders");
  if (error) throw error;
  return (data ?? []) as DriverOrder[];
}

export async function fetchDriverOrderDetail(orderId: string): Promise<DriverOrderDetail> {
  const { data, error } = await client().rpc("driver_order_detail", { p_order_id: orderId });
  if (error) throw error;
  return data as DriverOrderDetail;
}

export async function updateDriverOrderStatus(
  orderId: string,
  status: "out_for_delivery" | "completed",
): Promise<void> {
  const { error } = await client().rpc("driver_update_delivery_status", {
    p_order_id: orderId,
    p_new_status: status,
  });
  if (error) throw error;
}
