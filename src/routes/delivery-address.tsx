import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Map, List, Search, MapPin } from "lucide-react";

import { readSelection, saveSelection, type Selection } from "@/lib/storefront";
import {
  fetchDeliveryZones,
  fetchAddressesByPhone,
  nearestZone,
  type DeliveryZone,
  type SavedAddress,
} from "@/lib/delivery";
import { DeliveryMap } from "@/components/DeliveryMap";

export const Route = createFileRoute("/delivery-address")({
  head: () => ({
    meta: [{ title: "عنوان التوصيل — طلب" }],
  }),
  component: DeliveryAddressPage,
});

function DeliveryAddressPage() {
  const navigate = useNavigate();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const saved = readSelection();
    if (!saved?.branchId || saved.orderType !== "delivery") {
      navigate({ to: "/", replace: true });
      return;
    }
    setSelection(saved);
    setReady(true);
  }, [navigate]);

  if (!ready || !selection) {
    return (
      <main className="min-h-screen bg-secondary px-5 py-10">
        <div className="mx-auto max-w-xl">
          <div className="card-surface h-64 animate-pulse opacity-60" />
        </div>
      </main>
    );
  }

  return <DeliveryAddressContent selection={selection} />;
}

function DeliveryAddressContent({ selection }: { selection: Selection }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"map" | "list">("map");
  const [pin, setPin] = useState<[number, number] | null>(null);
  const [selectedZone, setSelectedZone] = useState<DeliveryZone | null>(null);
  const [phone, setPhone] = useState("");
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [lookupTried, setLookupTried] = useState(false);
  const [street, setStreet] = useState("");
  const [unitNo, setUnitNo] = useState("");
  const [floor, setFloor] = useState("");
  const [apartment, setApartment] = useState("");
  const [notes, setNotes] = useState("");
  const [label, setLabel] = useState("المنزل");
  const [saveForNextTime, setSaveForNextTime] = useState(true);

  const { data: zones, isLoading } = useQuery({
    queryKey: ["delivery_zones", selection.branchId],
    queryFn: () => fetchDeliveryZones(selection.branchId),
  });

  const center = useMemo((): [number, number] => {
    if (zones && zones.length > 0) {
      const z = zones[0] as DeliveryZone;
      return [z.lat, z.lng];
    }
    return [24.7136, 46.6753]; // fallback: Riyadh
  }, [zones]);

  function handlePick(lat: number, lng: number) {
    setPin([lat, lng]);
    if (zones && zones.length > 0) {
      setSelectedZone(nearestZone(zones, lat, lng));
    }
  }

  function pickFromList(zone: DeliveryZone) {
    setSelectedZone(zone);
    setPin([zone.lat, zone.lng]);
    setMode("map");
  }

  async function handlePhoneLookup() {
    setLookupTried(true);
    try {
      const results = await fetchAddressesByPhone(phone);
      setSavedAddresses(results);
    } catch {
      setSavedAddresses([]);
    }
  }

  function applySavedAddress(addr: SavedAddress) {
    if (addr.lat != null && addr.lng != null) setPin([addr.lat, addr.lng]);
    if (addr.area_id && zones) {
      const match = zones.find((z) => z.area_id === addr.area_id);
      if (match) setSelectedZone(match);
    }
    setStreet(addr.street ?? "");
    setUnitNo(addr.unit_no ?? "");
    setFloor(addr.floor ?? "");
    setApartment(addr.apartment ?? "");
    setNotes(addr.notes ?? "");
    setLabel(addr.label ?? "المنزل");
  }

  const canContinue = Boolean(selectedZone && pin && street.trim().length > 0);

  function handleContinue() {
    if (!selectedZone || !pin || !canContinue) return;
    saveSelection({
      ...selection,
      delivery: {
        areaId: selectedZone.area_id,
        areaNameAr: selectedZone.name_ar,
        lat: pin[0],
        lng: pin[1],
        street: street.trim(),
        unitNo: unitNo.trim(),
        floor: floor.trim(),
        apartment: apartment.trim(),
        notes: notes.trim(),
        label: label.trim(),
        fee: selectedZone.fee,
        minOrder: selectedZone.min_order,
        belowMinFee: selectedZone.below_min_fee,
        etaMinutes: selectedZone.eta_minutes,
        saveForNextTime,
        phone: phone.trim(),
      },
    });
    navigate({ to: "/menu" });
  }

  return (
    <main className="min-h-screen bg-secondary pb-32">
      <header className="border-b border-border bg-background px-5 py-4">
        <h1 className="text-base font-extrabold">عنوان التوصيل</h1>
        <p className="mt-1 text-sm text-muted-foreground">{selection.branchNameAr}</p>
      </header>

      <div className="mx-auto max-w-xl px-5 py-5">
        <section className="card-surface p-4">
          <label htmlFor="lookup-phone" className="text-xs font-bold text-muted-foreground">
            لديك عنوان محفوظ؟ أدخل جوالك
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="lookup-phone"
              dir="ltr"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="05xxxxxxxx"
              className="flex-1 rounded-card border border-border bg-background px-4 py-2.5 text-end text-sm outline-none placeholder:text-muted-foreground focus:border-brand"
            />
            <button
              type="button"
              onClick={handlePhoneLookup}
              className="flex items-center gap-1.5 rounded-card border border-border px-4 py-2.5 text-sm font-bold"
            >
              <Search aria-hidden className="size-4" />
              بحث
            </button>
          </div>
          {lookupTried ? (
            savedAddresses.length > 0 ? (
              <div className="mt-3 flex flex-col gap-2">
                {savedAddresses.map((addr) => (
                  <button
                    key={addr.id}
                    type="button"
                    onClick={() => applySavedAddress(addr)}
                    className="flex items-center justify-between rounded-card border border-border px-3 py-2 text-start text-sm"
                  >
                    <span>
                      <span className="font-bold">{addr.label ?? "عنوان"}</span>
                      <span className="text-muted-foreground"> · {addr.area_name_ar}</span>
                    </span>
                    <MapPin aria-hidden className="size-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">لا يوجد عنوان محفوظ لهذا الرقم</p>
            )
          ) : null}
        </section>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setMode("map")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-pill py-2.5 text-sm font-bold ${
              mode === "map"
                ? "bg-brand text-brand-ink"
                : "border border-border text-muted-foreground"
            }`}
          >
            <Map aria-hidden className="size-4" />
            الخريطة
          </button>
          <button
            type="button"
            onClick={() => setMode("list")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-pill py-2.5 text-sm font-bold ${
              mode === "list"
                ? "bg-brand text-brand-ink"
                : "border border-border text-muted-foreground"
            }`}
          >
            <List aria-hidden className="size-4" />
            قائمة المناطق
          </button>
        </div>

        {isLoading ? (
          <div className="card-surface mt-4 h-64 animate-pulse opacity-60" />
        ) : !zones || zones.length === 0 ? (
          <div className="card-surface mt-4 p-6 text-center text-sm text-muted-foreground">
            لا توجد مناطق توصيل مفعّلة لهذا الفرع حالياً
          </div>
        ) : mode === "map" ? (
          <div className="mt-4">
            <DeliveryMap center={center} pin={pin} zones={zones} onPick={handlePick} />
            <p className="mt-2 text-center text-xs text-muted-foreground">
              اضغط على الخريطة لتحديد موقعك
            </p>
          </div>
        ) : (
          <div className="mt-4 grid gap-2">
            {zones.map((z) => (
              <button
                key={z.area_id}
                type="button"
                onClick={() => pickFromList(z)}
                className={`card-surface flex items-center justify-between p-4 text-start ${
                  selectedZone?.area_id === z.area_id ? "ring-2 ring-brand" : ""
                }`}
              >
                <span>
                  <span className="text-sm font-bold">{z.name_ar}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {z.eta_minutes} دقيقة تقريباً
                  </span>
                </span>
                <span className="text-sm font-bold text-brand">{z.fee.toFixed(2)} ر.س</span>
              </button>
            ))}
          </div>
        )}

        {selectedZone ? (
          <section className="card-surface mt-4 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-bold">{selectedZone.name_ar}</span>
              <span className="text-muted-foreground">{selectedZone.eta_minutes} دقيقة</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              رسوم التوصيل {selectedZone.fee.toFixed(2)} ر.س، أو{" "}
              {selectedZone.below_min_fee.toFixed(2)} ر.س إذا كان الطلب أقل من{" "}
              {selectedZone.min_order.toFixed(2)} ر.س
            </p>
          </section>
        ) : null}

        <section className="card-surface mt-4 grid gap-3 p-4">
          <h2 className="text-sm font-bold">تفاصيل العنوان</h2>
          <input
            value={street}
            onChange={(e) => setStreet(e.target.value)}
            placeholder="اسم الشارع"
            className="w-full rounded-card border border-border bg-background px-4 py-3 text-sm outline-none placeholder:text-muted-foreground focus:border-brand"
          />
          <div className="grid grid-cols-3 gap-2">
            <input
              value={unitNo}
              onChange={(e) => setUnitNo(e.target.value)}
              placeholder="رقم المبنى"
              className="rounded-card border border-border bg-background px-3 py-3 text-sm outline-none placeholder:text-muted-foreground focus:border-brand"
            />
            <input
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
              placeholder="الطابق"
              className="rounded-card border border-border bg-background px-3 py-3 text-sm outline-none placeholder:text-muted-foreground focus:border-brand"
            />
            <input
              value={apartment}
              onChange={(e) => setApartment(e.target.value)}
              placeholder="الشقة"
              className="rounded-card border border-border bg-background px-3 py-3 text-sm outline-none placeholder:text-muted-foreground focus:border-brand"
            />
          </div>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="تسمية العنوان (المنزل، العمل...)"
            className="w-full rounded-card border border-border bg-background px-4 py-3 text-sm outline-none placeholder:text-muted-foreground focus:border-brand"
          />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="تفاصيل إضافية للمندوب"
            className="w-full rounded-card border border-border bg-background px-4 py-3 text-sm outline-none placeholder:text-muted-foreground focus:border-brand"
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={saveForNextTime}
              onChange={(e) => setSaveForNextTime(e.target.checked)}
              className="size-4 accent-[var(--accent)]"
            />
            حفظ هذا العنوان لطلباتي القادمة
          </label>
        </section>
      </div>

      <div className="fixed start-0 end-0 bottom-0 z-30 border-t border-border bg-background px-5 py-3">
        <div className="mx-auto max-w-xl">
          <button
            type="button"
            disabled={!canContinue}
            onClick={handleContinue}
            className="w-full rounded-pill bg-brand px-5 py-3.5 text-sm font-bold text-brand-ink disabled:opacity-50"
          >
            متابعة إلى القائمة
          </button>
        </div>
      </div>
    </main>
  );
}
