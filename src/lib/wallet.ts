import { supabase } from "@/lib/supabase";

export type CustomerWalletRow = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  created_at: string;
  wallet_id: string | null;
  balance: number;
  currency: string;
};

export type WalletLedgerEntry = {
  id: string;
  customer_id: string;
  delta: number;
  balance_after: number;
  reason: string | null;
  ref_type: string | null;
  ref_id: string | null;
  actor_name: string | null;
  at: string;
};

type CustomerRow = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  created_at: string;
};

type WalletRow = {
  id: string;
  customer_id: string;
  balance: number | string | null;
  currency: string | null;
};

/** Customers plus their wallet, merged client-side. RLS is the only authority on scope. */
export async function fetchCustomersWithWallet(): Promise<CustomerWalletRow[]> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");

  const [customersResult, walletsResult] = await Promise.all([
    supabase
      .from("customers")
      .select("id, name, phone, email, created_at")
      .order("created_at", { ascending: false }),
    supabase.from("wallets").select("id, customer_id, balance, currency"),
  ]);

  if (customersResult.error) throw customersResult.error;
  if (walletsResult.error) throw walletsResult.error;

  const wallets = new Map<string, WalletRow>();
  for (const wallet of (walletsResult.data ?? []) as WalletRow[]) {
    wallets.set(wallet.customer_id, wallet);
  }

  return ((customersResult.data ?? []) as CustomerRow[]).map((customer) => {
    const wallet = wallets.get(customer.id);
    return {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      created_at: customer.created_at,
      wallet_id: wallet?.id ?? null,
      balance: wallet ? Number(wallet.balance ?? 0) : 0,
      currency: wallet?.currency ?? "SAR",
    };
  });
}

export async function fetchWalletLedger(customerId: string): Promise<WalletLedgerEntry[]> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase
    .from("wallet_ledger")
    .select("id, customer_id, delta, balance_after, reason, ref_type, ref_id, actor_name, at")
    .eq("customer_id", customerId)
    .order("at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row["id"]),
    customer_id: String(row["customer_id"]),
    delta: Number(row["delta"] ?? 0),
    balance_after: Number(row["balance_after"] ?? 0),
    reason: (row["reason"] as string | null) ?? null,
    ref_type: (row["ref_type"] as string | null) ?? null,
    ref_id: (row["ref_id"] as string | null) ?? null,
    actor_name: (row["actor_name"] as string | null) ?? null,
    at: String(row["at"]),
  }));
}

export type AdjustWalletResult = {
  ledger_id: string;
  balance: number;
  idempotent: boolean;
};

export async function adjustWallet(
  customerId: string,
  delta: number,
  reason: string,
): Promise<AdjustWalletResult> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("staff_adjust_wallet", {
    p_customer_id: customerId,
    p_delta: delta,
    p_reason: reason,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row) throw new Error("تعذّر تعديل المحفظة");
  return {
    ledger_id: String(row["ledger_id"]),
    balance: Number(row["balance"] ?? 0),
    idempotent: Boolean(row["idempotent"]),
  };
}
