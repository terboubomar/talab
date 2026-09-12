import { supabase } from "@/lib/supabase";

export type LoyaltyProgram = {
  id: string;
  earn_rate: number;
  redeem_rate: number;
  min_redeem: number;
  expiry_days: number | null;
  active: boolean;
};

export type CustomerPoints = {
  balance: number;
  next_expiry_at: string | null;
};

export type PointsLedgerEntry = {
  id: string;
  customer_id: string;
  delta: number;
  balance_after: number;
  reason: string;
  ref_type: string | null;
  ref_id: string | null;
  actor_name: string | null;
  expires_at: string | null;
  at: string;
};

/** The tenant's loyalty program row, scoped by RLS only. */
export async function fetchLoyaltyProgram(): Promise<LoyaltyProgram | null> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase
    .from("loyalty_programs")
    .select("id, earn_rate, redeem_rate, min_redeem, expiry_days, active")
    .limit(1);
  if (error) throw error;
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row["id"]),
    earn_rate: Number(row["earn_rate"] ?? 0),
    redeem_rate: Number(row["redeem_rate"] ?? 0),
    min_redeem: Number(row["min_redeem"] ?? 0),
    expiry_days: row["expiry_days"] == null ? null : Number(row["expiry_days"]),
    active: Boolean(row["active"]),
  };
}

export async function saveLoyaltyProgram(input: {
  earnRate: number;
  redeemRate: number;
  minRedeem: number;
  expiryDays: number | null;
  active: boolean;
}): Promise<string> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("admin_save_loyalty_program", {
    p_earn_rate: input.earnRate,
    p_redeem_rate: input.redeemRate,
    p_min_redeem: input.minRedeem,
    p_expiry_days: input.expiryDays,
    p_active: input.active,
  });
  if (error) throw error;
  return String(data);
}

export async function fetchCustomerPoints(customerId: string): Promise<CustomerPoints> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("staff_customer_points", {
    p_customer_id: customerId,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  return {
    balance: Number(row?.["balance"] ?? 0),
    next_expiry_at: (row?.["next_expiry_at"] as string | null) ?? null,
  };
}

export async function fetchPointsLedger(customerId: string): Promise<PointsLedgerEntry[]> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase
    .from("points_ledger")
    .select(
      "id, customer_id, delta, balance_after, reason, ref_type, ref_id, actor_name, expires_at, at",
    )
    .eq("customer_id", customerId)
    .order("at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row["id"]),
    customer_id: String(row["customer_id"]),
    delta: Number(row["delta"] ?? 0),
    balance_after: Number(row["balance_after"] ?? 0),
    reason: String(row["reason"] ?? ""),
    ref_type: (row["ref_type"] as string | null) ?? null,
    ref_id: (row["ref_id"] as string | null) ?? null,
    actor_name: (row["actor_name"] as string | null) ?? null,
    expires_at: (row["expires_at"] as string | null) ?? null,
    at: String(row["at"]),
  }));
}

export type AdjustPointsResult = {
  ledger_id: string;
  balance: number;
};

export async function adjustPoints(
  customerId: string,
  delta: number,
  reason: string,
): Promise<AdjustPointsResult> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("staff_adjust_points", {
    p_customer_id: customerId,
    p_delta: delta,
    p_reason: reason,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row) throw new Error("تعذّر تعديل النقاط");
  return {
    ledger_id: String(row["ledger_id"]),
    balance: Number(row["balance"] ?? 0),
  };
}

/** Human-friendly Arabic label for known backend ledger reasons. */
export function pointsReasonLabel(reason: string): string {
  const key = reason.trim().toLowerCase();
  const map: Record<string, string> = {
    order_completed: "مكافأة إكمال طلب",
    order_completion: "مكافأة إكمال طلب",
    order_earn: "مكافأة إكمال طلب",
    order_redeem: "استبدال نقاط",
    order_redemption: "استبدال نقاط",
    redeem: "استبدال نقاط",
    order_cancelled: "إرجاع نقاط طلب ملغي",
    order_cancellation: "إرجاع نقاط طلب ملغي",
    order_cancel_reversal: "إرجاع نقاط طلب ملغي",
    points_expired: "انتهاء صلاحية النقاط",
    expired: "انتهاء صلاحية النقاط",
  };
  return map[key] ?? reason;
}
