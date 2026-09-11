import { supabase } from "@/lib/supabase";

export type OrderStatus =
  "pending" | "accepted" | "preparing" | "ready" | "out_for_delivery" | "completed" | "cancelled";

export type OrderType = "delivery" | "pickup" | "curbside" | "dinein";

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "بانتظار القبول",
  accepted: "مقبول",
  preparing: "جاري التجهيز",
  ready: "جاهز",
  out_for_delivery: "جاري التوصيل",
  completed: "مكتمل",
  cancelled: "ملغي",
};

export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  delivery: "توصيل",
  pickup: "استلام",
  curbside: "استلام من السيارة",
  dinein: "محلي",
};

export type StaffOrderItem = {
  id: string;
  name_ar: string;
  qty: number;
  line_total: number;
  notes: string | null;
  order_item_modifiers: { id: string; name_ar: string; price: number }[];
};

export type StaffOrder = {
  id: string;
  branch_id: string;
  order_type: OrderType;
  status: OrderStatus;
  notes: string | null;
  subtotal: number;
  total: number;
  placed_at: string;
  customers: { name: string; phone: string } | null;
  order_items: StaffOrderItem[];
};

export async function staffSignIn(email: string, password: string) {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;

  // Newly invited staff may have confirmed their auth email before their first login.
  // Claiming is idempotent from the UI perspective: already-linked accounts simply
  // receive no_pending_invite, which must not block a valid sign-in.
  await supabase.rpc("staff_claim_invite");
}

export async function staffSignOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function fetchStaffOrders(statuses: OrderStatus[]): Promise<StaffOrder[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, branch_id, order_type, status, notes, subtotal, total, placed_at, customers(name, phone), order_items(id, name_ar, qty, line_total, notes, order_item_modifiers(id, name_ar, price))",
    )
    .in("status", statuses)
    .order("placed_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as StaffOrder[];
}

// Permission-per-transition mapping lives in the staff_update_order_status RPC itself;
// the RPC is the source of truth and returns not_authorized if the caller lacks it.

export async function updateOrderStatus(orderId: string, next: OrderStatus) {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { error } = await supabase.rpc("staff_update_order_status", {
    p_order_id: orderId,
    p_new_status: next,
  });
  if (error) throw error;
}
