import { useMemo, useState } from "react";
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
  return (product.modifier_groups ?? []).filter((g) => (g.options ?? []).length > 0);
}

export function ProductSheet({ product, onClose, onAdd }: Props) {
  const groups = useMemo(() => groupsOf(product), [product]);
  const step = product.qty_step && product.qty_step > 0 ? product.qty_step : 1;
  const minQty = product.min_qty && product.min_qty > 0 ? product.min_qty : 1;
  const maxQty = product.max_qty && product.max_qty > 0 ? product.max_qty : 99;

  const [quantity, setQuantity] = useState(minQty);
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<Record<string, string[]>>({});

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

  const unitPrice = basePrice + chosen.reduce((sum, o) => sum + o.price, 0);
  const total = unitPrice * quantity;

  const requiredSatisfied = groups.every((group) => {
    if (!group.required) return true;
    const picked = (selected[group.id] ?? []).length;
    const min = group.min && group.min > 0 ? group.min : 1;
    return picked >= min;
  });

  function pickRadio(groupId: string, optionId: string) {
    setSelected((prev) => ({ ...prev, [groupId]: [optionId] }));
  }

  function toggleCheckbox(group: ModifierGroup, optionId: string) {
    setSelected((prev) => {
      const current = prev[group.id] ?? [];
      if (current.includes(optionId)) {
        return { ...prev, [group.id]: current.filter((id) => id !== optionId) };
      }
      const cap = group.max && group.max > 0 ? group.max : (group.options ?? []).length;
      if (current.length >= cap) return prev;
      return { ...prev, [group.id]: [...current, optionId] };
    });
  }

  function add() {
    onAdd({
      key: `${product.id}:${chosen.map((o) => o.id).sort().join(",")}:${note}`,
      productId: product.id,
      nameAr: product.name_ar,
      image: product.image,
      quantity,
      unitPrice,
      optionNames: chosen.map((o) => o.name_ar),
      note,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="إغلاق"
        onClick={onClose}
        className="absolute inset-0 bg-ink/50"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={product.name_ar}
        className="relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-card bg-background sm:rounded-card"
      >
        <div className="relative">
          {product.image ? (
            <img
              src={product.image}
              alt={product.name_ar}
              className="h-52 w-full object-cover"
            />
          ) : (
            <div className="flex h-40 w-full items-center justify-center bg-secondary text-muted-foreground">
              <ImageOff aria-hidden className="size-8" />
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="absolute top-3 inset-inline-end-3 grid size-9 place-items-center rounded-pill bg-background/90 shadow-card"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <h2 className="text-lg font-extrabold">{product.name_ar}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-bold text-brand">{formatSAR(basePrice)}</span>
            {product.calories != null ? (
              <span className="text-muted-foreground">
                {formatCalories(product.calories)}
              </span>
            ) : null}
          </div>
          {product.desc_ar ? (
            <p className="mt-3 text-sm text-muted-foreground">{product.desc_ar}</p>
          ) : null}

          {groups.map((group) => {
            const picked = selected[group.id] ?? [];
            const cap = group.max && group.max > 0 ? group.max : (group.options ?? []).length;
            const capped = !group.required && picked.length >= cap;

            return (
              <section key={group.id} className="mt-6">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold">{group.name_ar}</h3>
                  <span className="chip text-xs">
                    {group.required ? "إلزامي" : `حتى ${cap}`}
                  </span>
                </div>
                <div
                  className="mt-2 flex flex-col divide-y divide-border rounded-card border border-border"
                  role={group.required ? "radiogroup" : undefined}
                  aria-label={group.name_ar}
                >
                  {(group.options ?? []).map((option) => {
                    const isPicked = picked.includes(option.id);
                    const disabled = !group.required && capped && !isPicked;
                    const price = option.price ?? 0;

                    return (
                      <label
                        key={option.id}
                        className={`flex cursor-pointer items-center gap-3 px-4 py-3 text-sm ${
                          disabled ? "cursor-not-allowed opacity-50" : ""
                        }`}
                      >
                        <input
                          type={group.required ? "radio" : "checkbox"}
                          name={group.id}
                          checked={isPicked}
                          disabled={disabled}
                          onChange={() =>
                            group.required
                              ? pickRadio(group.id, option.id)
                              : toggleCheckbox(group, option.id)
                          }
                          className="size-4 accent-[var(--accent)]"
                        />
                        <span className="flex-1">{option.name_ar}</span>
                        {price > 0 ? (
                          <span className="text-sm font-bold text-brand">
                            +{formatSAR(price)}
                          </span>
                        ) : null}
                      </label>
                    );
                  })}
                </div>
              </section>
            );
          })}

          <section className="mt-6">
            <label htmlFor="product-note" className="text-sm font-bold">
              ملاحظات على المنتج
            </label>
            <textarea
              id="product-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="مثال: بدون بصل"
              className="mt-2 w-full rounded-card border border-border bg-background px-4 py-3 text-sm outline-none placeholder:text-muted-foreground focus:border-brand"
            />
          </section>

          <section className="mt-6 flex items-center justify-between">
            <span className="text-sm font-bold">الكمية</span>
            <div className="flex items-center gap-4 rounded-pill border border-border px-3 py-1.5">
              <button
                type="button"
                aria-label="تقليل الكمية"
                disabled={quantity - step < minQty}
                onClick={() => setQuantity((q) => Math.max(minQty, q - step))}
                className="grid size-8 place-items-center rounded-pill disabled:opacity-40"
              >
                <Minus aria-hidden className="size-4" />
              </button>
              <span className="min-w-6 text-center text-sm font-bold" dir="ltr">
                {quantity}
              </span>
              <button
                type="button"
                aria-label="زيادة الكمية"
                disabled={quantity + step > maxQty}
                onClick={() => setQuantity((q) => Math.min(maxQty, q + step))}
                className="grid size-8 place-items-center rounded-pill disabled:opacity-40"
              >
                <Plus aria-hidden className="size-4" />
              </button>
            </div>
          </section>
        </div>

        <div className="border-t border-border bg-background px-5 py-4">
          <button
            type="button"
            disabled={!requiredSatisfied}
            onClick={add}
            className="w-full rounded-pill bg-brand px-5 py-3.5 text-sm font-bold text-brand-ink disabled:opacity-50"
          >
            إضافة للسلة · {formatSAR(total)}
          </button>
        </div>
      </div>
    </div>
  );
}
