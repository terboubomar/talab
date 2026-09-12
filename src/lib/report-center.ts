import { supabase } from "@/lib/supabase";

export type DriverReportRow = {
  driver_id: string;
  driver_name: string;
  orders: number;
  sales: number;
  last_delivery_at: string | null;
};

export type CustomerReportRow = {
  customer_id: string;
  name: string;
  phone: string;
  orders: number;
  sales: number;
  average_order_value: number;
  last_order_at: string | null;
};

export type LedgerSummary = {
  movements: number;
  credits?: number;
  debits?: number;
  awarded?: number;
  redeemed?: number;
  net: number;
};

export type ReportCenterSupport = {
  drivers: DriverReportRow[];
  customers: CustomerReportRow[];
  wallet_summary: LedgerSummary;
  wallet_by_day: Array<{ day: string; credits: number; debits: number; movements: number }>;
  points_summary: LedgerSummary;
  points_by_day: Array<{ day: string; awarded: number; redeemed: number; movements: number }>;
  ledger_branch_filter_applies: boolean;
};

export async function fetchReportCenterSupport(from: string, to: string, branchId?: string | null): Promise<ReportCenterSupport> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("staff_report_center_support", {
    p_from: from,
    p_to: to,
    p_branch_id: branchId || null,
  });
  if (error) throw error;
  return data as ReportCenterSupport;
}

export function downloadCsv(filename: string, rows: Array<Record<string, string | number | null | undefined>>) {
  if (typeof window === "undefined" || rows.length === 0) return;
  const headers = Object.keys(rows[0] ?? {});
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = `\uFEFF${headers.map(escape).join(",")}\n${rows.map((row) => headers.map((header) => escape(row[header])).join(",")).join("\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
