import { supabase } from "@/lib/supabase";

export type ReportSummary = {
  all_orders: number;
  completed_orders: number;
  cancelled_orders: number;
  gross_sales: number;
  refunds: number;
  order_refunds: number;
  deposit_refunds: number;
  refund_count: number;
  net_sales: number;
  subtotal: number;
  tax_total: number;
  delivery_fees: number;
  discounts: number;
  average_order_value: number;
  cancellation_rate: number;
};

export type DailyReportRow = {
  day: string;
  orders: number;
  completed_orders: number;
  sales: number;
  refunds: number;
  net_sales: number;
};

export type StatusReportRow = { status: string; orders: number };
export type TypeReportRow = {
  order_type: string;
  orders: number;
  completed_orders: number;
  sales: number;
  refunds: number;
  net_sales: number;
};
export type BranchReportRow = {
  branch_id: string;
  branch_name: string;
  orders: number;
  completed_orders: number;
  sales: number;
  refunds: number;
  net_sales: number;
};
export type ReportBranch = { id: string; name: string };

export type OrderReport = {
  from: string;
  to: string;
  summary: ReportSummary;
  by_day: DailyReportRow[];
  by_status: StatusReportRow[];
  by_order_type: TypeReportRow[];
  by_branch: BranchReportRow[];
  branches: ReportBranch[];
};

export async function fetchOrderReport(from: string, to: string, branchId?: string | null) {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");

  const { data, error } = await supabase.rpc("staff_order_report", {
    p_from: from,
    p_to: to,
    p_branch_id: branchId || null,
  });

  if (error) throw error;
  return data as unknown as OrderReport;
}
