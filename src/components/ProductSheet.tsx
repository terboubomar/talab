import { useEffect, useMemo, useRef, useState } from "react";
import { X, Minus, Plus, ImageOff } from "lucide-react";

import {
  formatCalories,
  formatSAR,
  type CartLine,
  type ModifierGroup,
  type Product,
} from "@/lib/menu";

type Props = {
  product: Product;
  onClose: () => void;
  onAdd: (line: CartLine) => void;
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

export function ProductSheet({ product, onClose, onAdd }: Props) {
  const groups = useMemo(() => groupsOf(product), [product]);
  const step = product.qty_step && product.qty_step > 0 ? product.qty_step : 1;
  const minQty = product.min_qty && product.min_qty > 0 ? product.min_qty : 1;
  const maxQty = product.max_qty && product.max_qty > 0 ? product.max_qty : 99;

  const [quantity, setQuantity] = useState(minQty);
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
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
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  const basePrice = product.price ?? 0;

  const chosen = useMemo(() => {
    const list: { id: string; name_ar: string; price: number }[] = [];
    for (const group of groups) {
      for (const option of group.options ?? []) {
        if ((selected[group.id] ?? []).includes(option.id)) {
          list.push({ id: option.id, name_ar: option.name_ar, price: option.price ?? 0 });
        }
      }
    }
    return list;
  }, [groups, selected]);

  const unitPrice = basePrice + chosen.reduce((sum, option) => sum + option.price, 0);
  const total = unitPrice * quantity;

  const requiredSatisfied = groups.every((group) => {
    if (!group.required) return true;
    const picked = (selected[group.id] ?? []).length;
    const min = group.min && group.min > 0 ? group.min : 1;
    return picked >= min;
  });

  function pickRadio(groupId: string, optionId: string) {
    setSelected((previous) => ({ ...previous, [groupId]: [optionId] }));
  }

  function toggleCheckbox(group: ModifierGroup, optionId: string) {
    setSelected((previous) => {
      const current = previous[group.id] ?? [];
      if (current.includes(optionId)) {
        return { ...previous, [group.id]: current.filter((id) => id !== optionId) };
      }
      const cap = group.max && group.max > 0 ? group.max : (group.options ?? []).length;
      if (current.length >= cap) return previous;
      return { ...previous, [group.id]: [...current, optionId] };
    });
  }

  function add() {
    onAdd({
      key: `${product.id}:${chosen
        .map((option) => option.id)
        .sort()
        .join(",")}:${note}`,
      productId: product.id,
      nameAr: product.name_ar,
      image: product.image,
      quantity,
      unitPrice,
      optionNames: chosen.map((option) => option.name_ar),
      modifierIds: chosen.map((option) => option.id),
      note,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="إغلاق تفاصيل المنتج"
        onClick={onClose}
        className="absolute inset-0 bg-ink/50"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`product-sheet-title-${product.id}`}
        aria-describedby={product.desc_ar ? `product-sheet-desc-${product.id}` : undefined}
        className="relative flex max-h-[92dvh] w-full max-w-[434px] flex-col overflow-hidden rounded-t-card bg-background shadow-2xl sm:rounded-card"
      >
        <div className="relative">
          {product.image ? (
            <img src={product.image} alt={product.name_ar} className="h-52 w-full object-cover" />
          ) : (
            <div className="flex h-40 w-full items-center justify-center bg-secondary text-muted-foreground">
              <ImageOff aria-hidden className="size-8" />
            </div>
          )}
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="absolute top-3 end-3 grid size-11 place-items-center rounded-pill bg-background/95 shadow-card"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <h2 id={`product-sheet-title-${product.id}`} className="font-heading text-xl font-semibold">
            {product.name_ar}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm tabular-nums">
            <span className="font-semibold text-brand">{formatSAR(basePrice)}</span>
            {product.calories != null ? (
              <span className="text-ink-3">{formatCalories(product.calories)}</span>
            ) : null}
          </div>
          {product.desc_ar ? (
            <p id={`product-sheet-desc-${product.id}`} className="mt-3 text-base leading-7 text-ink-2">
              {product.desc_ar}
            </p>
          ) : null}

          {groups.map((group) => {
            const picked = selected[group.id] ?? [];
            const cap = group.max && group.max > 0 ? group.max : (group.options ?? []).length;
            const singleChoice = Boolean(group.required) || cap === 1;
            const capped = !singleChoice && picked.length >= cap;

            return (
              <section key={group.id} className="mt-6">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{group.name_ar}</h3>
                  <span className="chip text-xs">
                    {group.required ? "إلزامي" : singleChoice ? "اختيار واحد" : `حتى ${cap}`}
                  </span>
                </div>
                <div
                  className="mt-2 flex flex-col divide-y divide-border rounded-card border border-border bg-background"
                  role={singleChoice ? "radiogroup" : "group"}
                  aria-label={group.name_ar}
                >
                  {(group.options ?? []).map((option) => {
                    const isPicked = picked.includes(option.id);
                    const disabled = !singleChoice && capped && !isPicked;
                    const price = option.price ?? 0;

                    return (
                      <label
                        key={option.id}
                        className={`flex min-h-11 cursor-pointer items-center gap-3 px-4 py-3 text-sm ${
                          disabled ? "cursor-not-allowed opacity-50" : ""
                        }`}
                      >
                        <input
                          type={singleChoice ? "radio" : "checkbox"}
                          name={group.id}
                          checked={isPicked}
                          disabled={disabled}
                          onChange={() =>
                            singleChoice
                              ? pickRadio(group.id, option.id)
                              : toggleCheckbox(group, option.id)
                          }
                          className="size-4 accent-[var(--accent)]"
                        />
                        <span className="flex-1">{option.name_ar}</span>
                        {price > 0 ? (
                          <span className="text-sm font-semibold text-brand tabular-nums">+{formatSAR(price)}</span>
                        ) : null}
                      </label>
                    );
                  })}
                </div>
              </section>
            );
          })}

          <section className="mt-6">
            <label htmlFor="product-note" className="text-sm font-semibold">
              ملاحظات على المنتج
            </label>
            <textarea
              id="product-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              placeholder="مثال: بدون بصل"
              className="mt-2 w-full rounded-card border border-border bg-background px-4 py-3 text-sm outline-none placeholder:text-ink-3 focus:border-brand"
            />
          </section>

          <section className="mt-6 flex items-center justify-between">
            <span className="text-sm font-semibold">الكمية</span>
            <div className="flex items-center gap-2 rounded-pill border border-border px-1 py-1">
              <button
                type="button"
                aria-label="تقليل الكمية"
                disabled={quantity - step < minQty}
                onClick={() => setQuantity((current) => Math.max(minQty, current - step))}
                className="grid size-11 place-items-center rounded-pill disabled:opacity-40"
              >
                <Minus aria-hidden className="size-4" />
              </button>
              <span className="min-w-8 text-center text-sm font-semibold tabular-nums" dir="ltr">
                {quantity}
              </span>
              <button
                type="button"
                aria-label="زيادة الكمية"
                disabled={quantity + step > maxQty}
                onClick={() => setQuantity((current) => Math.min(maxQty, current + step))}
                className="grid size-11 place-items-center rounded-pill disabled:opacity-40"
              >
                <Plus aria-hidden className="size-4" />
              </button>
            </div>
          </section>
        </div>

        <div className="border-t border-border bg-background px-4 py-4 sm:px-5">
          <button
            type="button"
            disabled={!requiredSatisfied}
            onClick={add}
            className="min-h-11 w-full rounded-card bg-brand px-5 py-3 text-sm font-semibold text-brand-ink disabled:opacity-50"
          >
            إضافة · <span className="tabular-nums">{formatSAR(total)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
