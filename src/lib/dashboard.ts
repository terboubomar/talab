import { supabase } from "@/lib/supabase";
import type { OrderType } from "@/lib/staff";

export type DashboardKpis = {
  orders: number;
  completed_orders: number;
  loyalty_points: number;
  wallet_log: number;
  delivery_orders: number;
  pickup_orders: number;
  curbside_orders: number;
  dinein_orders: number;
};

export type DashboardDay = {
  day: string;
  orders: number;
  completed_orders: number;
  sales: number;
};

export type DashboardBranch = {
  id: string;
  name_ar: string;
  name_en: string | null;
};

export type DashboardData = {
  kpi_window: { from: string; to: string };
  kpis: DashboardKpis;
  chart: DashboardDay[];
  filters: {
    year: number;
    month: number;
    order_type: OrderType | null;
    branch_id: string | null;
  };
  branches: DashboardBranch[];
  years: number[];
};

export async function fetchDashboardStats(input: {
  year: number;
  month: number;
  orderType?: OrderType | null;
  branchId?: string | null;
}): Promise<DashboardData> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");

  const { data, error } = await supabase.rpc("staff_dashboard_stats", {
    p_year: input.year,
    p_month: input.month,
    p_order_type: input.orderType ?? null,
    p_branch_id: input.branchId || null,
  });

  if (error) throw error;
  const result = data as DashboardData;
  return {
    ...result,
    chart: result.chart.map((row) => ({ ...row, day: row.day.slice(0, 10) })),
  };
}
