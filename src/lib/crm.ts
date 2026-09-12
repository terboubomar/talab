import { supabase } from "@/lib/supabase";

export type CustomerCrmRow = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  gender: "male" | "female" | "unspecified" | null;
  birth_date: string | null;
  customer_group_id: string | null;
  group_name: string | null;
  status: "active" | "inactive";
  account_suspended: boolean;
  manual_payment_disabled: boolean;
  completed_orders: number;
  total_spend: number;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  last_order_at: string | null;
  wallet_balance: number;
};

export type CustomerOrderSummary = {
  id: string;
  branch_name: string;
  status: string;
  order_type: string;
  total: number;
  payment_method: string;
  payment_status: string;
  created_at: string;
};

export type CustomerGroupOption = {
  id: string;
  name_ar: string;
  name_en: string;
};

function mapCustomer(row: Record<string, unknown>): CustomerCrmRow {
  return {
    id: String(row["id"]),
    name: String(row["name"] ?? ""),
    phone: String(row["phone"] ?? ""),
    email: (row["email"] as string | null) ?? null,
    gender: (row["gender"] as CustomerCrmRow["gender"]) ?? null,
    birth_date: (row["birth_date"] as string | null) ?? null,
    customer_group_id: (row["customer_group_id"] as string | null) ?? null,
    group_name: (row["group_name"] as string | null) ?? null,
    status: (row["status"] as CustomerCrmRow["status"]) ?? "active",
    account_suspended: Boolean(row["account_suspended"]),
    manual_payment_disabled: Boolean(row["manual_payment_disabled"]),
    completed_orders: Number(row["completed_orders"] ?? 0),
    total_spend: Number(row["total_spend"] ?? 0),
    created_at: String(row["created_at"]),
    updated_at: String(row["updated_at"]),
    last_login_at: (row["last_login_at"] as string | null) ?? null,
    last_order_at: (row["last_order_at"] as string | null) ?? null,
    wallet_balance: Number(row["wallet_balance"] ?? 0),
  };
}

export async function fetchCustomerCrmList(): Promise<CustomerCrmRow[]> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("staff_customer_crm_list");
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(mapCustomer);
}

export async function fetchCustomerCrmDetail(customerId: string): Promise<CustomerCrmRow> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("staff_customer_crm_detail", {
    p_customer_id: customerId,
  });
  if (error) throw error;
  const row = data as Record<string, unknown> | null;
  if (!row) throw new Error("العميل غير موجود");
  return mapCustomer(row);
}

export async function fetchCustomerOrders(customerId: string): Promise<CustomerOrderSummary[]> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("staff_customer_orders", {
    p_customer_id: customerId,
  });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row["id"]),
    branch_name: String(row["branch_name"] ?? "—"),
    status: String(row["status"] ?? ""),
    order_type: String(row["order_type"] ?? ""),
    total: Number(row["total"] ?? 0),
    payment_method: String(row["payment_method"] ?? ""),
    payment_status: String(row["payment_status"] ?? ""),
    created_at: String(row["created_at"]),
  }));
}

export async function fetchCustomerGroupOptions(): Promise<CustomerGroupOption[]> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase
    .from("customer_groups")
    .select("id, name_ar, name_en")
    .order("name_ar");
  if (error) throw error;
  return (data ?? []) as CustomerGroupOption[];
}

export type UpdateCustomerCrmInput = {
  name: string;
  email: string | null;
  gender: CustomerCrmRow["gender"];
  birthDate: string | null;
  customerGroupId: string | null;
  status: CustomerCrmRow["status"];
  accountSuspended: boolean;
  manualPaymentDisabled: boolean;
};

export async function updateCustomerCrm(
  customerId: string,
  input: UpdateCustomerCrmInput,
): Promise<void> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { error } = await supabase.rpc("staff_update_customer_crm", {
    p_customer_id: customerId,
    p_name: input.name,
    p_email: input.email,
    p_gender: input.gender,
    p_birth_date: input.birthDate,
    p_customer_group_id: input.customerGroupId,
    p_status: input.status,
    p_account_suspended: input.accountSuspended,
    p_manual_payment_disabled: input.manualPaymentDisabled,
  });
  if (error) throw error;
}
