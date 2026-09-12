import { supabase } from "@/lib/supabase";

export type CashbackProgram = {
  id: string;
  percent: number;
  cap: number | null;
  min_order: number;
  valid_from: string | null;
  valid_to: string | null;
  active: boolean;
};

/** Returns the cashback program row visible through RLS, or null when none exists. */
export async function fetchCashbackProgram(): Promise<CashbackProgram | null> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase
    .from("cashback_programs")
    .select("id, percent, cap, min_order, valid_from, valid_to, active")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    id: String(row["id"]),
    percent: Number(row["percent"] ?? 0),
    cap: row["cap"] == null ? null : Number(row["cap"]),
    min_order: Number(row["min_order"] ?? 0),
    valid_from: (row["valid_from"] as string | null) ?? null,
    valid_to: (row["valid_to"] as string | null) ?? null,
    active: Boolean(row["active"]),
  };
}

export type SaveCashbackInput = {
  percent: number;
  cap: number | null;
  minOrder: number;
  validFrom: string | null;
  validTo: string | null;
  active: boolean;
};

export async function saveCashbackProgram(input: SaveCashbackInput): Promise<string> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("admin_save_cashback_program", {
    p_percent: Number(input.percent),
    p_cap: input.cap == null ? null : Number(input.cap),
    p_min_order: Number(input.minOrder),
    p_valid_from: input.validFrom,
    p_valid_to: input.validTo,
    p_active: input.active,
  });
  if (error) throw error;
  return String(data);
}
