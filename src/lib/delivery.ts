import { supabase } from "@/lib/supabase";
import { TENANT_SLUG } from "@/lib/storefront";

export type DeliveryZone = {
  area_id: string;
  name_ar: string;
  name_en: string | null;
  lat: number;
  lng: number;
  eta_minutes: number;
  fee: number;
  min_order: number;
  below_min_fee: number;
};

export type SavedAddress = {
  id: string;
  area_id: string | null;
  area_name_ar: string | null;
  label: string | null;
  lat: number | null;
  lng: number | null;
  street: string | null;
  unit_no: string | null;
  floor: string | null;
  apartment: string | null;
  notes: string | null;
  is_default: boolean;
};

export async function fetchDeliveryZones(branchId: string): Promise<DeliveryZone[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("storefront_delivery_zones", {
    p_branch_id: branchId,
  });
  if (error) throw error;
  return (data ?? []) as DeliveryZone[];
}

export async function fetchAddressesByPhone(phone: string): Promise<SavedAddress[]> {
  if (!supabase || phone.trim().length < 9) return [];
  const { data, error } = await supabase.rpc("storefront_addresses_by_phone", {
    p_tenant_slug: TENANT_SLUG,
    p_phone: phone.trim(),
  });
  if (error) throw error;
  return (data ?? []) as SavedAddress[];
}

export async function saveAddress(params: {
  customerName: string;
  customerPhone: string;
  areaId: string;
  lat: number;
  lng: number;
  street: string;
  unitNo: string;
  floor: string;
  apartment: string;
  notes: string;
  label: string;
}): Promise<string> {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");
  const { data, error } = await supabase.rpc("storefront_save_address", {
    p_tenant_slug: TENANT_SLUG,
    p_customer_name: params.customerName,
    p_customer_phone: params.customerPhone,
    p_area_id: params.areaId,
    p_lat: params.lat,
    p_lng: params.lng,
    p_street: params.street || null,
    p_unit_no: params.unitNo || null,
    p_floor: params.floor || null,
    p_apartment: params.apartment || null,
    p_notes: params.notes || null,
    p_label: params.label || null,
  });
  if (error) throw error;
  return data as string;
}

/** Great-circle distance in km between two lat/lng points. */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Finds the nearest zone to a dropped pin. There's no polygon/boundary data yet —
 * this is an approximation by distance to each area's center point, not a true
 * coverage check. Good enough to pre-select a sensible default; the person can
 * still pick a different area from the list. */
export function nearestZone(zones: DeliveryZone[], lat: number, lng: number): DeliveryZone | null {
  if (zones.length === 0) return null;
  let best = zones[0] as DeliveryZone;
  let bestDist = haversineKm(lat, lng, best.lat, best.lng);
  for (const zone of zones.slice(1)) {
    const dist = haversineKm(lat, lng, zone.lat, zone.lng);
    if (dist < bestDist) {
      best = zone;
      bestDist = dist;
    }
  }
  return best;
}
