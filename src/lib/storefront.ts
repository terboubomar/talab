import { queryOptions } from "@tanstack/react-query";
import { supabase } from "./supabase";

export const TENANT_SLUG = "past";

export type OrderType = "pickup" | "delivery" | "curbside" | "dinein";
export type CheckoutPaymentMethod = "cash" | "online";

export type Branch = {
  id?: string;
  branch_id?: string;
  name_ar: string;
  name_en?: string | null;
  city_ar: string | null;
  phone: string | null;
  busy: boolean | null;
  order_types: OrderType[] | null;
};

export type Brand = {
  name_ar: string | null;
  logo_url: string | null;
  theme: Record<string, unknown> | null;
};

export type StorefrontPaymentOption = {
  account_id: string;
  provider: "moyasar" | string;
  environment: "test" | "live";
  methods: string[];
  publishable_api_key: string;
  supported_networks: string[];
};

export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  pickup: "استلام",
  delivery: "توصيل",
  curbside: "من السيارة",
  dinein: "محلي",
};

export const branchesQuery = queryOptions({
  queryKey: ["storefront_branches", TENANT_SLUG],
  queryFn: async (): Promise<Branch[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.rpc("storefront_branches", {
      p_tenant_slug: TENANT_SLUG,
    });
    if (error) throw error;
    return (data ?? []) as Branch[];
  },
  enabled: Boolean(supabase),
});

export const brandQuery = queryOptions({
  queryKey: ["storefront_brand", TENANT_SLUG],
  queryFn: async (): Promise<Brand | null> => {
    if (!supabase) return null;
    const { data, error } = await supabase.rpc("storefront_brand", {
      p_tenant_slug: TENANT_SLUG,
    });
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    return (row ?? null) as Brand | null;
  },
  enabled: Boolean(supabase),
  retry: false,
});

export type Selection = {
  branchId: string;
  branchNameAr: string;
  orderType: OrderType;
  delivery?: {
    areaId: string;
    areaNameAr: string;
    lat: number;
    lng: number;
    street: string;
    unitNo: string;
    floor: string;
    apartment: string;
    notes: string;
    label: string;
    fee: number;
    minOrder: number;
    belowMinFee: number;
    etaMinutes: number;
    saveForNextTime: boolean;
    phone: string;
  };
};

const STORAGE_KEY = "talab.selection";

export function saveSelection(selection: Selection) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    /* storage unavailable */
  }
}

export function readSelection(): Selection | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Selection) : null;
  } catch {
    return null;
  }
}

export function branchKey(branch: Branch, index: number) {
  return branch.branch_id ?? branch.id ?? `${branch.name_ar}-${index}`;
}

export type PlaceOrderItem = {
  product_id: string;
  qty: number;
  modifier_ids?: string[];
  note?: string;
};

export type PlaceOrderResult = {
  order_id: string;
  total: number;
};

export async function fetchStorefrontPaymentOption(branchId: string): Promise<StorefrontPaymentOption | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("storefront_payment_options", {
    p_branch_id: branchId,
  });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? null) as StorefrontPaymentOption | null;
}

export async function submitOrder(params: {
  branchId: string;
  orderType: OrderType;
  customerName: string;
  customerPhone: string;
  notes: string | null;
  items: PlaceOrderItem[];
  paymentMethod?: CheckoutPaymentMethod;
  couponReservationId?: string | null;
  areaId?: string;
  lat?: number;
  lng?: number;
  addressText?: string;
}): Promise<PlaceOrderResult> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("storefront_place_order_v3", {
    p_tenant_slug: TENANT_SLUG,
    p_branch_id: params.branchId,
    p_order_type: params.orderType,
    p_customer_name: params.customerName,
    p_customer_phone: params.customerPhone,
    p_notes: params.notes,
    p_items: params.items,
    p_area_id: params.areaId ?? null,
    p_lat: params.lat ?? null,
    p_lng: params.lng ?? null,
    p_address_text: params.addressText ?? null,
    p_payment_method: params.paymentMethod ?? "cash",
    p_coupon_reservation_id: params.couponReservationId ?? null,
    p_source: "web",
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("تعذّر إنشاء الطلب");
  return row as PlaceOrderResult;
}
