import { supabase } from "@/lib/supabase";
import type { PaymentStatus } from "@/lib/payments";

export type OrderStatus =
  "pending" | "accepted" | "preparing" | "ready" | "out_for_delivery" | "completed" | "cancelled";

export type OrderType = "delivery" | "pickup" | "curbside" | "dinein";
export type RefundKind = "order" | "deposit";
export type PosStatus = "not_sent" | "queued" | "sending" | "sent" | "failed";
export type OrderSource = "web" | "call_center" | string;

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

export const ORDER_SOURCE_LABEL: Record<string, string> = {
  web: "الموقع الإلكتروني",
  call_center: "خدمة العملاء",
  app: "التطبيق",
  qr: "QR",
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
  deposit_total: number;
  total: number;
  payment_method: "cash" | "online";
  payment_status: PaymentStatus;
  paid_at: string | null;
  placed_at: string;
  source: OrderSource;
  created_by_staff_id: string | null;
  branches: { name_ar: string } | null;
  created_by_staff: { name: string } | null;
  pos_ref: string | null;
  pos_status: PosStatus;
  pos_last_error: string | null;
  pos_sent_at: string | null;
  driver_id: string | null;
  delivery_provider_id: string | null;
  delivery_assignment_type: "driver" | "provider" | null;
  delivery_assigned_at: string | null;
  delivered_at: string | null;
  customers: { name: string; phone: string } | null;
  order_items: StaffOrderItem[];
};

export type OrderFilterOptions = {
  branches: Array<{ id: string; name: string }>;
  sources: string[];
};

export type StaffOrderFilters = {
  branchId?: string | null;
  orderType?: OrderType | null;
  paymentMethod?: "cash" | "online" | null;
  source?: string | null;
};

export type OrderRefund = {
  id: string;
  order_id: string;
  kind: RefundKind;
  amount: number;
  currency: string;
  reason: string;
  status: "pending" | "completed" | "failed" | "cancelled";
  execution_mode: "manual" | "gateway";
  created_by_name: string | null;
  created_at: string;
  completed_at: string | null;
};

export async function staffSignIn(email: string, password: string) {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  await supabase.rpc("staff_claim_invite");
}

export async function staffSignOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function fetchOrderFilterOptions(): Promise<OrderFilterOptions> {
  if (!supabase) return { branches: [], sources: [] };
  const { data, error } = await supabase.rpc("staff_order_filter_options");
  if (error) throw error;
  return data as OrderFilterOptions;
}

export async function fetchStaffOrders(statuses: OrderStatus[], filters: StaffOrderFilters = {}): Promise<StaffOrder[]> {
  if (!supabase) return [];
  let query = supabase
    .from("orders")
    .select(
      "id, branch_id, order_type, status, notes, subtotal, deposit_total, total, payment_method, payment_status, paid_at, placed_at, source, created_by_staff_id, branches(name_ar), created_by_staff:staff!orders_created_by_staff_id_fkey(name), pos_ref, pos_status, pos_last_error, pos_sent_at, driver_id, delivery_provider_id, delivery_assignment_type, delivery_assigned_at, delivered_at, customers(name, phone), order_items(id, name_ar, qty, line_total, notes, order_item_modifiers(id, name_ar, price))",
    )
    .in("status", statuses)
    .or("payment_method.eq.cash,payment_status.in.(paid,partially_refunded)");

  if (filters.branchId) query = query.eq("branch_id", filters.branchId);
  if (filters.orderType) query = query.eq("order_type", filters.orderType);
  if (filters.paymentMethod) query = query.eq("payment_method", filters.paymentMethod);
  if (filters.source) query = query.eq("source", filters.source);

  const { data, error } = await query.order("placed_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as StaffOrder[];
}

export async function fetchOrderRefunds(orderId: string): Promise<OrderRefund[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("order_refunds")
    .select("id, order_id, kind, amount, currency, reason, status, execution_mode, created_by_name, created_at, completed_at")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as OrderRefund[];
}

export async function createManualRefund(input: { orderId: string; amount: number; reason: string; kind: RefundKind }) {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("staff_create_manual_refund", {
    p_order_id: input.orderId, p_amount: input.amount, p_reason: input.reason, p_kind: input.kind,
  });
  if (error) throw error;
  return data as { id: string; order_id: string; kind: RefundKind; amount: number; currency: string; status: "completed"; execution_mode: "manual"; remaining: number };
}

export async function createGatewayRefund(input: { orderId: string; amount: number; reason: string; kind: RefundKind }) {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.functions.invoke("moyasar-refund", { body: { orderId: input.orderId, amount: input.amount, reason: input.reason, kind: input.kind } });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error ?? "gateway_refund_failed");
  return data as { ok: true; refund: { id: string; order_id: string; status: "completed"; amount: number; currency: string; payment_transaction_id: string }; provider: { id: string; status: string } };
}

export async function updateOrderStatus(orderId: string, next: OrderStatus) {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { error } = await supabase.rpc("staff_update_order_status", { p_order_id: orderId, p_new_status: next });
  if (error) throw error;
}
