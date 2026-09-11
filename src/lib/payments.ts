import { supabase } from "@/lib/supabase";

export type PaymentStatus =
  | "unpaid"
  | "pending"
  | "authorized"
  | "paid"
  | "failed"
  | "partially_refunded"
  | "refunded"
  | "cancelled";

export type PaymentTransactionStatus = "pending" | "authorized" | "succeeded" | "failed" | "cancelled";

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  unpaid: "غير مدفوع إلكترونياً",
  pending: "بانتظار الدفع",
  authorized: "مصرّح",
  paid: "مدفوع",
  failed: "فشل الدفع",
  partially_refunded: "مسترد جزئياً",
  refunded: "مسترد بالكامل",
  cancelled: "ملغي",
};

export const TRANSACTION_STATUS_LABEL: Record<PaymentTransactionStatus, string> = {
  pending: "قيد الانتظار",
  authorized: "مصرّح",
  succeeded: "ناجح",
  failed: "فشل",
  cancelled: "ملغي",
};

export type PaymentAccount = {
  id: string;
  provider: string;
  display_name: string;
  environment: "test" | "live";
  enabled: boolean;
  methods: string[];
  brand_id: string | null;
  created_at: string;
};

export type PaymentTransaction = {
  id: string;
  order_id: string;
  branch_id: string;
  provider: string;
  kind: "charge" | "refund";
  status: PaymentTransactionStatus;
  amount: number;
  currency: string;
  payment_method: string | null;
  provider_reference: string | null;
  failure_message: string | null;
  created_at: string;
  succeeded_at: string | null;
};

export async function fetchPaymentAccounts(): Promise<PaymentAccount[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("payment_accounts")
    .select("id, provider, display_name, environment, enabled, methods, brand_id, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as PaymentAccount[];
}

export async function fetchRecentPaymentTransactions(limit = 100): Promise<PaymentTransaction[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("payment_transactions")
    .select("id, order_id, branch_id, provider, kind, status, amount, currency, payment_method, provider_reference, failure_message, created_at, succeeded_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as PaymentTransaction[];
}
