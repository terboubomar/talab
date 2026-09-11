import { useState } from "react";
import { X } from "lucide-react";

import type { AdminProduct, ProductFormValues } from "@/lib/catalog";

type Props = {
  product: AdminProduct | null; // null = creating a new product
  onClose: () => void;
  onSave: (values: ProductFormValues) => Promise<void>;
};

export function AdminProductForm({ product, onClose, onSave }: Props) {
  const [nameAr, setNameAr] = useState(product?.name_ar ?? "");
  const [nameEn, setNameEn] = useState(product?.name_en ?? "");
  const [descAr, setDescAr] = useState(product?.desc_ar ?? "");
  const [price, setPrice] = useState(String(product?.price ?? ""));
  const [calories, setCalories] = useState(
    product?.calories != null ? String(product.calories) : "",
  );
  const [active, setActive] = useState(product?.active ?? true);
  const [orderable, setOrderable] = useState(product?.orderable ?? true);
  const [imageUrl, setImageUrl] = useState(product?.primary_image_url ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = nameAr.trim().length > 0 && Number(price) >= 0 && !Number.isNaN(Number(price));

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        nameAr: nameAr.trim(),
        nameEn: nameEn.trim(),
        descAr: descAr.trim(),
        price: Number(price),
        calories: calories.trim() ? Number(calories) : null,
        active,
        orderable,
        imageUrl,
      });
      onClose();
    } catch {
      setError("تعذّر حفظ الصنف، حاول مرة أخرى");
    } finally {
      setSaving(false);
    }
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
        className="relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-card bg-background sm:rounded-card"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-extrabold">{product ? "تعديل الصنف" : "إضافة صنف"}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="grid size-8 place-items-center"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="grid gap-3">
            <div>
              <label className="text-xs font-bold text-muted-foreground">الاسم بالعربي</label>
              <input
                value={nameAr}
                onChange={(e) => setNameAr(e.target.value)}
                className="mt-1 w-full rounded-card border border-border bg-background px-4 py-3 text-sm outline-none focus:border-brand"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-muted-foreground">الاسم بالإنجليزي</label>
              <input
                dir="ltr"
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
                className="mt-1 w-full rounded-card border border-border bg-background px-4 py-3 text-sm outline-none focus:border-brand"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-muted-foreground">الوصف</label>
              <textarea
                value={descAr}
                onChange={(e) => setDescAr(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-card border border-border bg-background px-4 py-3 text-sm outline-none focus:border-brand"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-muted-foreground">
                  السعر (شامل الضريبة)
                </label>
                <input
                  dir="ltr"
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="mt-1 w-full rounded-card border border-border bg-background px-4 py-3 text-sm outline-none focus:border-brand"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-muted-foreground">السعرات الحرارية</label>
                <input
                  dir="ltr"
                  inputMode="numeric"
                  value={calories}
                  onChange={(e) => setCalories(e.target.value)}
                  className="mt-1 w-full rounded-card border border-border bg-background px-4 py-3 text-sm outline-none focus:border-brand"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-muted-foreground">
                رابط الصورة الرئيسية
              </label>
              <input
                dir="ltr"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://..."
                className="mt-1 w-full rounded-card border border-border bg-background px-4 py-3 text-sm outline-none placeholder:text-muted-foreground focus:border-brand"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="size-4 accent-[var(--accent)]"
              />
              مفعّل (يظهر في القائمة)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={orderable}
                onChange={(e) => setOrderable(e.target.checked)}
                className="size-4 accent-[var(--accent)]"
              />
              قابل للطلب حالياً
            </label>
          </div>
          {error ? (
            <p className="mt-3 rounded-card border border-danger/30 bg-danger/10 p-2 text-center text-sm font-bold text-danger">
              {error}
            </p>
          ) : null}
        </div>

        <div className="border-t border-border bg-background px-5 py-4">
          <button
            type="button"
            disabled={!canSave || saving}
            onClick={handleSave}
            className="w-full rounded-pill bg-brand px-5 py-3.5 text-sm font-bold text-brand-ink disabled:opacity-50"
          >
            {saving ? "جارٍ الحفظ..." : "حفظ"}
          </button>
        </div>
      </div>
    </div>
  );
}
