import { supabase } from "@/lib/supabase";
import type { OrderStatus, OrderType, PosStatus } from "@/lib/staff";
import type { PaymentStatus } from "@/lib/payments";

export type OrderDetailItem = {
  id: string;
  product_id: string | null;
  name_ar: string;
  name_en: string | null;
  unit_price: number;
  qty: number;
  line_total: number;
  notes: string | null;
  modifiers: Array<{ id: string; name_ar: string; price: number }>;
};

export type OrderDetailPayload = {
  order: {
    id: string;
    branch_id: string;
    branch_name: string;
    order_type: OrderType;
    status: OrderStatus;
    source: string;
    created_by_staff_id: string | null;
    created_by_staff_name: string | null;
    customer_id: string | null;
    customer_name: string | null;
    customer_phone: string | null;
    customer_email: string | null;
    notes: string | null;
    subtotal: number;
    tax_total: number;
    delivery_fee: number;
    discount_total: number;
    coupon_code: string | null;
    coupon_total: number;
    points_total: number;
    wallet_total: number;
    deposit_total: number;
    total: number;
    currency: string;
    payment_method: "cash" | "online";
    payment_status: PaymentStatus;
    paid_at: string | null;
    placed_at: string;
    scheduled_for: string | null;
    delivery_address_text: string | null;
    delivery_lat: number | null;
    delivery_lng: number | null;
    pos_ref: string | null;
    pos_status: PosStatus;
    pos_last_error: string | null;
    pos_sent_at: string | null;
    driver_id: string | null;
    driver_name: string | null;
    delivery_provider_id: string | null;
    delivery_provider_name: string | null;
    delivery_assignment_type: "driver" | "provider" | null;
    delivery_assigned_at: string | null;
    delivered_at: string | null;
    cancelled_at: string | null;
  };
  items: OrderDetailItem[];
  refunds: Array<{
    id: string;
    kind: "order" | "deposit";
    amount: number;
    reason: string;
    status: string;
    execution_mode: string;
    created_by_name: string | null;
    created_at: string;
    completed_at: string | null;
  }>;
  status_history: Array<{ id: number; status: OrderStatus; at: string; actor_name: string | null; note: string | null }>;
  activity: Array<{ id: number; action: string; actor_name: string | null; diff: Record<string, unknown> | null; at: string }>;
};

export async function fetchOrderDetail(orderId: string): Promise<OrderDetailPayload> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("staff_order_detail", { p_order_id: orderId });
  if (error) throw error;
  return data as OrderDetailPayload;
}
