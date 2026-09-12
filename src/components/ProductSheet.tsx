import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  Clock3,
  Copy,
  ImageOff,
  Info,
  Minus,
  Plus,
  Share2,
  ShieldCheck,
  X,
} from "lucide-react";

import {
  formatCalories,
  formatSAR,
  productCrossSellsQuery,
  productDetailQuery,
  type CartLine,
  type ModifierGroup,
  type Product,
  type ProductCrossSell,
} from "@/lib/menu";

type Props = {
  product: Product;
  branchId?: string | null;
  onClose: () => void;
  onAdd: (line: CartLine) => void;
  onOpenSuggested?: (productId: string) => void;
};

function groupsOf(product: Product): ModifierGroup[] {
  return (product.modifier_groups ?? []).filter((group) => (group.options ?? []).length > 0);
}

const FOCUSABLE = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function formatScheduleDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("ar-SA", {
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatTime(value: string | null | undefined) {
  if (!value) return null;
  const [hourRaw, minuteRaw] = value.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return value;
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return new Intl.DateTimeFormat("ar-SA", { hour: "numeric", minute: "2-digit" }).format(date);
}

function hasNutrition(values: Array<number | null | undefined>) {
  return values.some((value) => value != null);
}

export function ProductSheet({ product, branchId = null, onClose, onAdd, onOpenSuggested }: Props) {
  const { data: detail, isLoading: detailLoading } = useQuery(productDetailQuery(product.id, branchId));
  const { data: crossSells = [] } = useQuery({
    ...productCrossSellsQuery(product.id, branchId),
    enabled: Boolean(branchId),
  });
  const current = detail ?? product;
  const groups = useMemo(() => groupsOf(current), [current]);
  const step = current.qty_step && current.qty_step > 0 ? current.qty_step : 1;
  const minQty = current.min_qty && current.min_qty > 0 ? current.min_qty : 1;
  const maxQty = current.max_qty && current.max_qty > 0 ? current.max_qty : 99;

  const [quantity, setQuantity] = useState(minQty);
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [activeImage, setActiveImage] = useState(0);
  const [shareState, setShareState] = useState<"idle" | "copied">("idle");
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const images = useMemo(() => {
    if (detail?.images?.length) return detail.images.map((image) => image.url);
    return current.image ? [current.image] : [];
  }, [current.image, detail?.images]);

  useEffect(() => {
    setQuantity(minQty);
    setNote("");
    setSelected({});
    setActiveImage(0);
    setShareState("idle");
  }, [product.id, minQty]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => !element.hasAttribute("disabled") && element.tabIndex !== -1,
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
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

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = originalOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  const basePrice = Number(current.price ?? 0);

  const chosen = useMemo(() => {
    const list: { id: string; name_ar: string; price: number }[] = [];
    for (const group of groups) {
      for (const option of group.options ?? []) {
        if ((selected[group.id] ?? []).includes(option.id)) {
          list.push({ id: option.id, name_ar: option.name_ar, price: Number(option.price ?? 0) });
        }
      }
    }
    return list;
  }, [groups, selected]);

  const unitPrice = basePrice + chosen.reduce((sum, option) => sum + option.price, 0);
  const total = unitPrice * quantity;

  const requiredSatisfied = groups.every((group) => {
    const picked = (selected[group.id] ?? []).length;
    const minimum = Math.max(group.required ? 1 : 0, Number(group.min ?? 0));
    return picked >= minimum;
  });

  function pickRadio(groupId: string, optionId: string) {
    setSelected((previous) => ({ ...previous, [groupId]: [optionId] }));
  }

  function toggleCheckbox(group: ModifierGroup, optionId: string) {
    setSelected((previous) => {
      const currentSelection = previous[group.id] ?? [];
      if (currentSelection.includes(optionId)) {
        return { ...previous, [group.id]: currentSelection.filter((id) => id !== optionId) };
      }
      const cap = group.max && group.max > 0 ? group.max : (group.options ?? []).length;
      if (currentSelection.length >= cap) return previous;
      return { ...previous, [group.id]: [...currentSelection, optionId] };
    });
  }

  async function shareProduct() {
    const url = typeof window === "undefined"
      ? `/menu?product=${encodeURIComponent(product.id)}`
      : `${window.location.origin}/menu?product=${encodeURIComponent(product.id)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: current.name_ar, text: current.name_ar, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShareState("copied");
      window.setTimeout(() => setShareState("idle"), 1800);
    } catch {
      try {
        await navigator.clipboard.writeText(url);
        setShareState("copied");
        window.setTimeout(() => setShareState("idle"), 1800);
      } catch {
        // Sharing is optional; ordering remains usable if clipboard APIs are unavailable.
      }
    }
  }

  function buildLine(): CartLine {
    return {
      key: `${product.id}:${chosen.map((option) => option.id).sort().join(",")}:${note}`,
      productId: product.id,
      nameAr: current.name_ar,
      image: images[0] ?? current.image,
      quantity,
      unitPrice,
      optionNames: chosen.map((option) => option.name_ar),
      modifierIds: chosen.map((option) => option.id),
      note,
    };
  }

  function add() {
    onAdd(buildLine());
  }

  function addMainThenOpenSuggested(productId: string) {
    if (!branchId || !onOpenSuggested || !requiredSatisfied || current.in_stock === false) return;
    onAdd(buildLine());
    onOpenSuggested(productId);
  }

  const nutrition = detail?.nutrition ?? null;
  const schedule = detail?.schedule ?? null;
  const scheduleEnds = formatScheduleDate(schedule?.ends_at);
  const scheduleFrom = formatTime(schedule?.from_time);
  const scheduleTo = formatTime(schedule?.to_time);
  const nutritionVisible = Boolean(
    nutrition && hasNutrition([nutrition.protein_g, nutrition.carbs_g, nutrition.fat_g, nutrition.sugar_g, nutrition.sodium_mg]),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button type="button" aria-label="إغلاق تفاصيل المنتج" onClick={onClose} className="absolute inset-0 bg-ink/50" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`product-sheet-title-${product.id}`}
        aria-describedby={current.desc_ar ? `product-sheet-desc-${product.id}` : undefined}
        className="relative flex max-h-[94dvh] w-full max-w-[480px] flex-col overflow-hidden rounded-t-card bg-background shadow-card sm:rounded-card"
      >
        <div className="relative bg-surface-sunk">
          {images[activeImage] ? (
            <img src={images[activeImage]} alt={current.name_ar} className="h-56 w-full object-cover sm:h-64" />
          ) : (
            <div className="flex h-48 w-full items-center justify-center bg-secondary text-muted-foreground"><ImageOff aria-hidden className="size-8" /></div>
          )}

          <div className="absolute inset-x-0 top-3 flex items-center justify-between px-3">
            <button type="button" onClick={shareProduct} aria-label="مشاركة المنتج" className="grid size-11 place-items-center rounded-pill bg-background/95 text-ink shadow-1">
              {shareState === "copied" ? <Check aria-hidden className="size-4 text-success" /> : <Share2 aria-hidden className="size-4" />}
            </button>
            <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="إغلاق" className="grid size-11 place-items-center rounded-pill bg-background/95 shadow-1">
              <X aria-hidden className="size-4" />
            </button>
          </div>

          {images.length > 1 ? (
            <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5" aria-label="صور المنتج">
              {images.map((_, index) => (
                <button key={index} type="button" onClick={() => setActiveImage(index)} aria-label={`الصورة ${index + 1}`} aria-current={index === activeImage ? "true" : undefined} className={`size-2.5 rounded-pill border border-surface ${index === activeImage ? "bg-brand" : "bg-surface/70"}`} />
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 id={`product-sheet-title-${product.id}`} className="font-heading text-xl font-semibold text-ink">{current.name_ar}</h2>
              {current.name_en ? <p dir="ltr" className="mt-0.5 text-sm text-ink-3">{current.name_en}</p> : null}
            </div>
            <span className="shrink-0 text-base font-semibold text-brand tabular-nums">{formatSAR(basePrice)}</span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-3">
            {current.calories != null ? <span>{formatCalories(current.calories)}</span> : null}
            {detailLoading ? <span>جاري تحميل التفاصيل…</span> : null}
            {!branchId ? <span className="inline-flex items-center gap-1"><Info className="size-3.5" aria-hidden /> السعر النهائي حسب الفرع</span> : null}
          </div>

          {current.desc_ar ? <p id={`product-sheet-desc-${product.id}`} className="mt-3 text-base leading-7 text-ink-2">{current.desc_ar}</p> : null}
          {current.desc_en ? <p dir="ltr" className="mt-2 text-sm leading-6 text-ink-3">{current.desc_en}</p> : null}

          {Number(current.deposit ?? 0) > 0 ? (
            <div className="mt-4 flex items-start gap-3 rounded-card bg-brand-soft p-3">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
              <div>
                <p className="text-sm font-semibold text-ink">تأمين مسترد · <span className="tabular-nums">{formatSAR(Number(current.deposit))}</span></p>
                <p className="mt-0.5 text-xs leading-5 text-ink-2">يُحتسب عند إتمام الطلب ويُسترد حسب سياسة المنتج.</p>
              </div>
            </div>
          ) : null}

          {schedule ? (
            <div className="mt-4 flex items-start gap-3 rounded-card bg-surface-sunk p-3">
              <Clock3 className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
              <div>
                <p className="text-sm font-semibold text-ink">متوفر لفترة محدودة</p>
                <p className="mt-0.5 text-xs leading-5 text-ink-2">{[scheduleEnds ? `حتى ${scheduleEnds}` : null, scheduleFrom || scheduleTo ? `يومياً ${scheduleFrom ?? ""}${scheduleFrom && scheduleTo ? " – " : ""}${scheduleTo ?? ""}` : null].filter(Boolean).join(" · ")}</p>
              </div>
            </div>
          ) : null}

          {detail?.allergens?.length ? (
            <section className="mt-5" aria-labelledby={`allergens-${product.id}`}>
              <div className="flex items-center gap-2"><AlertTriangle className="size-4 text-warning" aria-hidden /><h3 id={`allergens-${product.id}`} className="text-sm font-semibold text-ink">مسببات الحساسية</h3></div>
              <div className="mt-2 flex flex-wrap gap-2">
                {detail.allergens.map((allergen) => <span key={allergen.id} className="rounded-pill bg-surface-sunk px-3 py-1.5 text-xs text-ink-2">{allergen.name_ar}{allergen.name_en ? <span dir="ltr" className="ms-1 text-ink-3">· {allergen.name_en}</span> : null}</span>)}
              </div>
            </section>
          ) : null}

          {nutritionVisible && nutrition ? (
            <section className="mt-5 rounded-card border border-line bg-surface p-4" aria-labelledby={`nutrition-${product.id}`}>
              <div className="flex items-center justify-between gap-3"><h3 id={`nutrition-${product.id}`} className="text-sm font-semibold text-ink">المعلومات الغذائية</h3>{nutrition.serving ? <span className="text-xs text-ink-3">{nutrition.serving}</span> : null}</div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <NutritionValue label="البروتين" value={nutrition.protein_g} unit="غ" />
                <NutritionValue label="الكربوهيدرات" value={nutrition.carbs_g} unit="غ" />
                <NutritionValue label="الدهون" value={nutrition.fat_g} unit="غ" />
                <NutritionValue label="السكر" value={nutrition.sugar_g} unit="غ" />
                <NutritionValue label="الصوديوم" value={nutrition.sodium_mg} unit="ملغ" />
              </div>
            </section>
          ) : null}

          {groups.map((group) => {
            const picked = selected[group.id] ?? [];
            const cap = group.max && group.max > 0 ? group.max : (group.options ?? []).length;
            const minimum = Math.max(group.required ? 1 : 0, Number(group.min ?? 0));
            const singleChoice = cap === 1;
            const capped = !singleChoice && picked.length >= cap;
            const requirement = singleChoice ? minimum > 0 ? "اختر 1 · إلزامي" : "اختر 1" : minimum > 0 ? `اختر ${minimum}–${cap} · إلزامي` : `اختر حتى ${cap}`;

            return (
              <section key={group.id} className="mt-6">
                <div className="flex items-center justify-between gap-2">
                  <div><h3 className="text-sm font-semibold text-ink">{group.name_ar}</h3>{group.name_en ? <p dir="ltr" className="mt-0.5 text-xs text-ink-3">{group.name_en}</p> : null}</div>
                  <span className="chip text-xs">{requirement}</span>
                </div>
                <div className="mt-2 flex flex-col divide-y divide-border rounded-card border border-border bg-background" role={singleChoice ? "radiogroup" : "group"} aria-label={group.name_ar}>
                  {(group.options ?? []).map((option) => {
                    const isPicked = picked.includes(option.id);
                    const disabled = !singleChoice && capped && !isPicked;
                    const price = Number(option.price ?? 0);
                    return (
                      <label key={option.id} className={`flex min-h-11 cursor-pointer items-center gap-3 px-4 py-3 text-sm ${disabled ? "cursor-not-allowed opacity-50" : ""}`}>
                        <input type={singleChoice ? "radio" : "checkbox"} name={group.id} checked={isPicked} disabled={disabled} onChange={() => singleChoice ? pickRadio(group.id, option.id) : toggleCheckbox(group, option.id)} className="size-4 accent-[var(--accent)]" />
                        <span className="flex-1"><span className="block text-ink">{option.name_ar}</span>{option.name_en ? <span dir="ltr" className="mt-0.5 block text-xs text-ink-3">{option.name_en}</span> : null}</span>
                        {price > 0 ? <span className="text-sm font-semibold text-brand tabular-nums">+{formatSAR(price)}</span> : null}
                      </label>
                    );
                  })}
                </div>
              </section>
            );
          })}

          <section className="mt-6">
            <label htmlFor={`product-note-${product.id}`} className="text-sm font-semibold">ملاحظات على المنتج</label>
            <textarea id={`product-note-${product.id}`} value={note} onChange={(event) => setNote(event.target.value)} rows={2} placeholder="مثال: بدون بصل" className="mt-2 w-full rounded-card border border-border bg-background px-4 py-3 text-sm outline-none placeholder:text-ink-3 focus:border-brand" />
          </section>

          <section className="mt-6 flex items-center justify-between">
            <span className="text-sm font-semibold">الكمية</span>
            <div className="flex items-center gap-2 rounded-pill border border-border px-1 py-1">
              <button type="button" aria-label="تقليل الكمية" disabled={quantity - step < minQty} onClick={() => setQuantity((value) => Math.max(minQty, value - step))} className="grid size-11 place-items-center rounded-pill disabled:opacity-40"><Minus aria-hidden className="size-4" /></button>
              <span className="min-w-8 text-center text-sm font-semibold tabular-nums" dir="ltr">{quantity}</span>
              <button type="button" aria-label="زيادة الكمية" disabled={quantity + step > maxQty} onClick={() => setQuantity((value) => Math.min(maxQty, value + step))} className="grid size-11 place-items-center rounded-pill disabled:opacity-40"><Plus aria-hidden className="size-4" /></button>
            </div>
          </section>

          {branchId && crossSells.length > 0 && onOpenSuggested ? (
            <section className="mt-6" aria-labelledby={`cross-sells-${product.id}`}>
              <div>
                <h3 id={`cross-sells-${product.id}`} className="text-sm font-semibold text-ink">أضف مع طلبك</h3>
                <p className="mt-0.5 text-xs leading-5 text-ink-3">
                  اختيار أي إضافة سيضيف <span className="font-semibold text-ink-2">{current.name_ar}</span> إلى السلة أولاً ثم يفتح الإضافة.
                </p>
                {!requiredSatisfied ? <p className="mt-1 text-xs font-medium text-warning">أكمل الخيارات المطلوبة أولاً.</p> : null}
              </div>
              <div className="-mx-4 mt-3 flex gap-3 overflow-x-auto px-4 pb-1 no-scrollbar sm:-mx-5 sm:px-5">
                {crossSells.map((suggested) => (
                  <CrossSellCard
                    key={suggested.id}
                    product={suggested}
                    disabled={!requiredSatisfied || current.in_stock === false}
                    onOpen={() => addMainThenOpenSuggested(suggested.id)}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <div className="border-t border-border bg-background px-4 py-4 sm:px-5">
          {shareState === "copied" ? <div className="mb-2 flex items-center justify-center gap-1.5 text-xs font-medium text-success" role="status"><Copy className="size-3.5" aria-hidden /> تم نسخ رابط المنتج</div> : null}
          <button type="button" disabled={!requiredSatisfied || current.in_stock === false} onClick={add} className="min-h-11 w-full rounded-card bg-brand px-5 py-3 text-sm font-semibold text-brand-ink disabled:opacity-50">
            {current.in_stock === false ? "غير متوفر حالياً" : <>إضافة · <span className="tabular-nums">{formatSAR(total)}</span></>}
          </button>
        </div>
      </div>
    </div>
  );
}

function CrossSellCard({ product, onOpen, disabled = false }: { product: ProductCrossSell; onOpen: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onOpen}
      className="w-[148px] shrink-0 overflow-hidden rounded-card border border-line bg-surface text-start transition-colors hover:border-brand/40 disabled:cursor-not-allowed disabled:opacity-45"
    >
      <div className="aspect-square w-full bg-surface-sunk">
        {product.image ? (
          <img src={product.image} alt={product.name_ar} loading="lazy" className="size-full object-cover" />
        ) : (
          <span className="grid size-full place-items-center text-ink-3"><ImageOff className="size-6" aria-hidden /></span>
        )}
      </div>
      <div className="p-3">
        <p className="line-clamp-2 min-h-10 text-xs font-semibold leading-5 text-ink">{product.name_ar}</p>
        <div className="mt-2 flex items-end justify-between gap-2">
          <span className="text-xs font-semibold text-brand tabular-nums">{formatSAR(Number(product.price))}</span>
          {product.has_options ? <span className="rounded-pill bg-surface-sunk px-2 py-0.5 text-[10px] text-ink-3">خيارات</span> : null}
        </div>
      </div>
    </button>
  );
}

function NutritionValue({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  if (value == null) return null;
  return <div className="rounded-sm bg-surface-sunk p-2.5"><p className="text-[11px] text-ink-3">{label}</p><p className="mt-0.5 text-sm font-semibold text-ink tabular-nums">{Number(value).toLocaleString("ar-SA")} {unit}</p></div>;
}