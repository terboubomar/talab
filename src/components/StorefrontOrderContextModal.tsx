import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Clock3, MapPin, Phone, Search, X } from "lucide-react";

import {
  ORDER_TYPE_LABEL,
  type Branch,
  type Brand,
  type OrderType,
  type Selection,
} from "@/lib/storefront";

type Props = {
  open: boolean;
  branches: Branch[];
  brand?: Brand | null;
  loading: boolean;
  selection: Selection | null;
  onClose: () => void;
  onChoose: (branch: Branch, orderType: OrderType) => void;
};

function branchId(branch: Branch) {
  return String(branch.branch_id ?? branch.id ?? "");
}

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLocaleLowerCase("ar");
}

function formatBusyUntil(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("ar-SA", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Riyadh",
  }).format(date);
}

export function StorefrontOrderContextModal({
  open,
  branches,
  brand = null,
  loading,
  selection,
  onClose,
  onChoose,
}: Props) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const [query, setQuery] = useState("");

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const filteredBranches = useMemo(() => {
    const needle = normalize(query);
    if (!needle) return branches;
    return branches.filter((branch) => {
      const city = branch.city_ar?.trim() || "فروع أخرى";
      return (
        normalize(branch.name_ar).includes(needle) ||
        normalize(branch.name_en).includes(needle) ||
        normalize(city).includes(needle) ||
        normalize(branch.phone).includes(needle)
      );
    });
  }, [branches, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, Branch[]>();
    filteredBranches.forEach((branch) => {
      const city = branch.city_ar?.trim() || "فروع أخرى";
      const bucket = map.get(city) ?? [];
      bucket.push(branch);
      map.set(city, bucket);
    });
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, "ar"));
  }, [filteredBranches]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery("");

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 0);

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
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
  }, [open]);

  if (!open) return null;

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
        aria-labelledby="branch-picker-title"
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-card bg-surface-raised shadow-card sm:max-h-[86vh] sm:rounded-card"
      >
        <header className="relative border-b border-line px-4 pb-4 pt-5 text-center sm:px-6 sm:pt-6">
          <button
            type="button"
            onClick={onClose}
            className="absolute end-4 top-4 grid size-11 place-items-center rounded-pill bg-surface-sunk text-ink sm:end-6"
            aria-label="إغلاق"
          >
            <X className="size-4" aria-hidden />
          </button>

          {brand?.logo_url ? (
            <img
              src={brand.logo_url}
              alt={brand.name_ar ?? "شعار المطعم"}
              className="mx-auto h-14 max-w-[150px] object-contain sm:h-16"
            />
          ) : brand?.name_ar ? (
            <p className="font-heading text-lg font-semibold text-ink">{brand.name_ar}</p>
          ) : null}

          <h2 id="branch-picker-title" className="mt-3 font-heading text-xl font-semibold text-ink">
            اختر الفرع
          </h2>
        </header>

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
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((item) => (
                <div key={item} className="h-32 animate-pulse rounded-card bg-surface-sunk" />
              ))}
            </div>
          ) : grouped.length === 0 ? (
            <div className="rounded-card bg-surface-sunk p-8 text-center">
              <MapPin className="mx-auto size-7 text-ink-3" aria-hidden />
              <h3 className="mt-3 font-semibold text-ink">ما لقينا فرع مطابق</h3>
              <p className="mt-1 text-sm text-ink-2">جرّب اسم فرع أو مدينة أخرى.</p>
            </div>
          ) : (
            <div className="space-y-7">
              {grouped.map(([cityName, cityBranches]) => (
                <section key={cityName} aria-labelledby={`city-${cityName}`}>
                  <div className="mb-3 flex items-center gap-2">
                    <MapPin className="size-4 text-brand" aria-hidden />
                    <h3 id={`city-${cityName}`} className="text-sm font-semibold text-ink">{cityName}</h3>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {cityBranches.map((branch) => {
                      const id = branchId(branch);
                      const isBusy = Boolean(branch.busy);
                      const busyUntil = isBusy ? formatBusyUntil(branch.busy_until) : null;
                      const types = branch.order_types ?? [];
                      const isCurrentBranch = selection?.branchId === id;

                      return (
                        <article
                          key={id || `${cityName}-${branch.name_ar}`}
                          className={`rounded-card border p-4 ${
                            isBusy
                              ? "border-line bg-surface-sunk opacity-60"
                              : isCurrentBranch
                                ? "border-brand bg-brand-soft"
                                : "border-line bg-surface"
                          }`}
                          aria-disabled={isBusy || undefined}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="truncate text-sm font-semibold text-ink">{branch.name_ar}</h4>
                                {isCurrentBranch ? (
                                  <span className="inline-flex items-center gap-1 rounded-pill bg-brand px-2 py-0.5 text-[10px] font-semibold text-brand-ink">
                                    <Check className="size-3" aria-hidden /> الحالي
                                  </span>
                                ) : null}
                              </div>
                              <p className="mt-1 text-xs text-ink-3">{cityName}</p>
                            </div>

                            {isBusy ? (
                              <span className="shrink-0 rounded-pill bg-warning/10 px-2 py-1 text-[10px] font-semibold text-warning">
                                مشغول حالياً
                              </span>
                            ) : null}
                          </div>

                          {isBusy && busyUntil ? (
                            <div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-warning">
                              <Clock3 className="size-3.5" aria-hidden />
                              <span>الفرع مشغول حتى: {busyUntil}</span>
                            </div>
                          ) : null}

                          {branch.phone ? (
                            <div className="mt-3 flex items-center gap-1.5 text-xs text-ink-3" dir="ltr">
                              <Phone className="size-3.5" aria-hidden />
                              <span>{branch.phone}</span>
                            </div>
                          ) : null}

                          <div className="mt-4 flex flex-wrap gap-2" aria-label={`طرق الطلب في ${branch.name_ar}`}>
                            {types.length > 0 ? (
                              types.map((orderType) => {
                                const active = isCurrentBranch && selection?.orderType === orderType;
                                return (
                                  <button
                                    key={orderType}
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() => onChoose(branch, orderType)}
                                    className={`min-h-11 rounded-pill border px-4 text-xs font-semibold transition-colors disabled:cursor-not-allowed ${
                                      active
                                        ? "border-brand bg-brand text-brand-ink"
                                        : "border-line bg-surface-raised text-ink hover:border-brand/50"
                                    }`}
                                  >
                                    {ORDER_TYPE_LABEL[orderType]}
                                  </button>
                                );
                              })
                            ) : (
                              <span className="text-xs text-ink-3">لا توجد طرق طلب مفعلة</span>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
