import { supabase } from "@/lib/supabase";
import { TENANT_SLUG } from "@/lib/storefront";

export type CustomerAccountOrder = {
  id: string;
  branch_name: string;
  order_type: string;
  status: string;
  total: number;
  currency: string;
  payment_method: string | null;
  payment_status: string | null;
  placed_at: string;
  delivery_address: string | null;
};

export type CustomerLedgerEntry = {
  id: string;
  delta: number;
  balance_after: number;
  reason: string;
  at: string;
  expires_at?: string | null;
};

export type CustomerAddress = {
  id: string;
  label: string | null;
  area_name: string | null;
  street: string | null;
  unit_no: string | null;
  floor: string | null;
  apartment: string | null;
  notes: string | null;
  is_default: boolean;
};

export type CustomerAccount = {
  profile: {
    id: string;
    name: string | null;
    phone: string;
    email: string | null;
    status: string | null;
    created_at: string;
  };
  wallet: {
    balance: number;
    currency: string;
    ledger: CustomerLedgerEntry[];
  };
  points: {
    balance: number;
    ledger: CustomerLedgerEntry[];
  };
  orders: CustomerAccountOrder[];
  addresses: CustomerAddress[];
};

export function normalizeSaudiPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("00966") && digits.length === 14) return `+${digits.slice(2)}`;
  if (digits.startsWith("966") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("05") && digits.length === 10) return `+966${digits.slice(1)}`;
  if (digits.startsWith("5") && digits.length === 9) return `+966${digits}`;
  return value.trim().startsWith("+") ? value.trim() : `+${digits}`;
}

export async function requestCustomerOtp(phone: string) {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const normalized = normalizeSaudiPhone(phone);
  const { error } = await supabase.auth.signInWithOtp({ phone: normalized });
  if (error) throw error;
  return normalized;
}

export async function verifyCustomerOtp(phone: string, token: string) {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const normalized = normalizeSaudiPhone(phone);
  const { error } = await supabase.auth.verifyOtp({ phone: normalized, token: token.trim(), type: "sms" });
  if (error) throw error;
}

export async function fetchCustomerAccount(): Promise<CustomerAccount> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("storefront_customer_account", { p_tenant_slug: TENANT_SLUG });
  if (error) throw error;
  return data as CustomerAccount;
}

export async function updateCustomerProfile(name: string, email: string) {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("storefront_update_customer_profile", {
    p_tenant_slug: TENANT_SLUG,
    p_name: name,
    p_email: email || null,
  });
  if (error) throw error;
  return data;
}

export async function signOutCustomer() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
