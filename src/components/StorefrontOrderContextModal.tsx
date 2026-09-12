import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CarFront,
  Check,
  MapPin,
  Phone,
  Search,
  ShoppingBag,
  Store,
  Truck,
  UtensilsCrossed,
  X,
} from "lucide-react";

import {
  ORDER_TYPE_LABEL,
  type Branch,
  type OrderType,
  type Selection,
} from "@/lib/storefront";

type Props = {
  open: boolean;
  branches: Branch[];
  loading: boolean;
  selection: Selection | null;
  onClose: () => void;
  onChoose: (branch: Branch, orderType: OrderType) => void;
};

type Step = "branch" | "orderType";

const ORDER_TYPE_META: Record<
  OrderType,
  { description: string; icon: typeof Store }
> = {
  pickup: { description: "استلم طلبك جاهزاً من الفرع", icon: ShoppingBag },
  delivery: { description: "نوصل الطلب إلى عنوانك", icon: Truck },
  curbside: { description: "نوصله لك عند السيارة", icon: CarFront },
  dinein: { description: "تناول الطلب داخل الفرع", icon: UtensilsCrossed },
};

function branchId(branch: Branch) {
  return String(branch.branch_id ?? branch.id ?? "");
}

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLocaleLowerCase("ar");
}

export function StorefrontOrderContextModal({
  open,
  branches,
  loading,
  selection,
  onClose,
  onChoose,
}: Props) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [step, setStep] = useState<Step>("branch");
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  const [query, setQuery] = useState("");
  const [city, setCity] = useState<string>("all");

  const cities = useMemo(() => {
    const unique = new Set<string>();
    branches.forEach((branch) => unique.add(branch.city_ar?.trim() || "فروع أخرى"));
    return [...unique].sort((a, b) => a.localeCompare(b, "ar"));
  }, [branches]);

  const filteredBranches = useMemo(() => {
    const needle = normalize(query);
    return branches.filter((branch) => {
      const branchCity = branch.city_ar?.trim() || "فروع أخرى";
      if (city !== "all" && branchCity !== city) return false;
      if (!needle) return true;
      return (
        normalize(branch.name_ar).includes(needle) ||
        normalize(branch.name_en).includes(needle) ||
        normalize(branchCity).includes(needle) ||
        normalize(branch.phone).includes(needle)
      );
    });
  }, [branches, city, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, Branch[]>();
    filteredBranches.forEach((branch) => {
      const branchCity = branch.city_ar?.trim() || "فروع أخرى";
      const bucket = map.get(branchCity) ?? [];
      bucket.push(branch);
      map.set(branchCity, bucket);
    });
    return [...map.entries()];
  }, [filteredBranches]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setStep("branch");
    setSelectedBranch(null);
    setQuery("");
    setCity("all");
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 0);

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      )].filter((element) => !element.hasAttribute("hidden"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = originalOverflow;
      document.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  function chooseBranch(branch: Branch) {
    if (branch.busy || !(branch.order_types ?? []).length) return;
    setSelectedBranch(branch);
    setStep("orderType");
    window.setTimeout(() => {
      dialogRef.current?.querySelector<HTMLButtonElement>('[data-order-type="true"]')?.focus();
    }, 0);
  }

  function backToBranches() {
    setStep("branch");
    setSelectedBranch(null);
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }

  const availableCount = branches.filter((branch) => !branch.busy && (branch.order_types ?? []).length > 0).length;
  const activeBranchId = selection?.branchId ?? null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-ink/50 sm:items-center sm:p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-context-title"
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-card bg-surface-raised shadow-2 sm:max-h-[86vh] sm:rounded-card"
      >
        <header className="border-b border-line px-4 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-medium text-ink-3">
                <span className={step === "branch" ? "text-brand" : ""}>1. الفرع</span>
                <span aria-hidden>←</span>
                <span className={step === "orderType" ? "text-brand" : ""}>2. طريقة الطلب</span>
              </div>
              <h2 id="order-context-title" className="mt-1 font-heading text-xl font-semibold text-ink">
                {step === "branch" ? "اختر الفرع" : "كيف حاب تستلم طلبك؟"}
              </h2>
              <p className="mt-1 text-sm text-ink-2">
                {step === "branch"
                  ? `${availableCount} فرع متاح للطلب الآن`
                  : selectedBranch?.name_ar}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid size-11 shrink-0 place-items-center rounded-pill bg-surface-sunk text-ink"
              aria-label="إغلاق"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </header>

        {step === "branch" ? (
          <>
            <div className="border-b border-line-soft px-4 py-3 sm:px-6">
              <label className="relative block">
                <Search className="pointer-events-none absolute inset-inline-start-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="ابحث باسم الفرع أو المدينة"
                  className="h-12 w-full rounded-card border border-line bg-surface px-10 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-brand"
                />
              </label>

              {cities.length > 1 ? (
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1 no-scrollbar" aria-label="تصفية حسب المدينة">
                  <button
                    type="button"
                    onClick={() => setCity("all")}
                    className={`min-h-11 shrink-0 rounded-pill px-4 text-xs font-medium ${city === "all" ? "bg-ink text-surface" : "bg-surface-sunk text-ink-2"}`}
                  >
                    كل المدن
                  </button>
                  {cities.map((cityName) => (
                    <button
                      key={cityName}
                      type="button"
                      onClick={() => setCity(cityName)}
                      className={`min-h-11 shrink-0 rounded-pill px-4 text-xs font-medium ${city === cityName ? "bg-ink text-surface" : "bg-surface-sunk text-ink-2"}`}
                    >
                      {cityName}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
              {loading ? (
                <div className="space-y-3">
                  {[0, 1, 2].map((item) => <div key={item} className="h-24 animate-pulse rounded-card bg-surface-sunk" />)}
                </div>
              ) : grouped.length === 0 ? (
                <div className="rounded-card bg-surface-sunk p-8 text-center">
                  <MapPin className="mx-auto size-7 text-ink-3" aria-hidden />
                  <h3 className="mt-3 font-semibold text-ink">ما لقينا فرع مطابق</h3>
                  <p className="mt-1 text-sm text-ink-2">غيّر البحث أو اختر مدينة أخرى.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {grouped.map(([cityName, cityBranches]) => (
                    <section key={cityName}>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <MapPin className="size-4 text-brand" aria-hidden />
                          <h3 className="text-sm font-semibold text-ink">{cityName}</h3>
                        </div>
                        <span className="text-xs text-ink-3 tabular-nums">{cityBranches.length} فروع</span>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {cityBranches.map((branch) => {
                          const id = branchId(branch);
                          const isBusy = Boolean(branch.busy);
                          const types = branch.order_types ?? [];
                          const disabled = isBusy || types.length === 0;
                          const isCurrent = Boolean(activeBranchId && id === activeBranchId);
                          return (
                            <button
                              key={id || `${cityName}-${branch.name_ar}`}
                              type="button"
                              disabled={disabled}
                              onClick={() => chooseBranch(branch)}
                              className={`min-h-[104px] rounded-card border p-4 text-start transition-colors ${
                                disabled
                                  ? "cursor-not-allowed border-line bg-surface-sunk opacity-65"
                                  : isCurrent
                                    ? "border-brand bg-accent-soft"
                                    : "border-line bg-surface hover:border-brand/40"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="truncate text-sm font-semibold text-ink">{branch.name_ar}</span>
                                    {isCurrent ? (
                                      <span className="inline-flex items-center gap-1 rounded-pill bg-brand px-2 py-0.5 text-[10px] font-semibold text-brand-ink">
                                        <Check className="size-3" aria-hidden /> الحالي
                                      </span>
                                    ) : null}
                                  </div>
                                  {branch.name_en ? <p className="mt-0.5 truncate text-xs text-ink-3" dir="ltr">{branch.name_en}</p> : null}
                                </div>
                                <span className={`shrink-0 rounded-pill px-2 py-1 text-[10px] font-semibold ${isBusy ? "bg-warn/10 text-warn" : "bg-ok/10 text-ok"}`}>
                                  {isBusy ? "مشغول حالياً" : "متاح"}
                                </span>
                              </div>

                              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
                                {branch.phone ? (
                                  <span className="inline-flex items-center gap-1" dir="ltr">
                                    <Phone className="size-3" aria-hidden /> {branch.phone}
                                  </span>
                                ) : null}
                                <span>{types.length ? `${types.length} طرق طلب` : "لا توجد طرق طلب مفعلة"}</span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : selectedBranch ? (
          <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
            <button
              type="button"
              onClick={backToBranches}
              className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-sm px-1 text-sm font-medium text-ink-2 hover:text-ink"
            >
              <ArrowRight className="size-4" aria-hidden /> تغيير الفرع
            </button>

            <div className="mb-5 rounded-card bg-surface-sunk p-4">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-pill bg-surface text-brand shadow-1">
                  <Store className="size-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-xs text-ink-3">الفرع المختار</p>
                  <h3 className="truncate text-sm font-semibold text-ink">{selectedBranch.name_ar}</h3>
                  <p className="mt-0.5 text-xs text-ink-2">{selectedBranch.city_ar || ""}</p>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {(selectedBranch.order_types ?? []).map((type) => {
                const meta = ORDER_TYPE_META[type];
                const Icon = meta.icon;
                return (
                  <button
                    key={type}
                    type="button"
                    data-order-type="true"
                    onClick={() => onChoose(selectedBranch, type)}
                    className="group flex min-h-[104px] items-center gap-4 rounded-card border border-line bg-surface p-4 text-start transition-colors hover:border-brand/50 hover:bg-accent-soft"
                  >
                    <span className="grid size-12 shrink-0 place-items-center rounded-card bg-surface-sunk text-brand transition-colors group-hover:bg-surface">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-ink">{ORDER_TYPE_LABEL[type]}</span>
                      <span className="mt-1 block text-xs leading-5 text-ink-2">{meta.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
