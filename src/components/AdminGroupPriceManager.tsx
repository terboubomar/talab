import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgePercent, X } from "lucide-react";

import { formatSAR } from "@/lib/menu";
import type { AdminProduct } from "@/lib/catalog";
import {
  fetchCustomerGroups,
  fetchProductGroupPrices,
  saveProductGroupPrices,
} from "@/lib/group-pricing-admin";

type Props = {
  product: AdminProduct;
  tenantId: string;
  onClose: () => void;
};

export function AdminGroupPriceManager({ product, tenantId, onClose }: Props) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: groups = [], isLoading: groupsLoading } = useQuery({
    queryKey: ["admin_customer_groups"],
    queryFn: fetchCustomerGroups,
  });
  const { data: prices = [], isLoading: pricesLoading } = useQuery({
    queryKey: ["admin_product_group_prices", product.id],
    queryFn: () => fetchProductGroupPrices(product.id),
  });

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const price of prices) next[price.group_id] = String(price.price);
    setDraft(next);
  }, [prices]);

  const entries = useMemo(
    () =>
      groups
        .map((group) => ({
          group,
          raw: draft[group.id] ?? "",
        }))
        .filter(({ raw }) => raw.trim() !== "")
        .map(({ group, raw }) => ({ groupId: group.id, price: Number(raw) })),
    [draft, groups],
  );

  const invalid = entries.some((entry) => !Number.isFinite(entry.price) || entry.price < 0);
  const loading = groupsLoading || pricesLoading;

  async function save() {
    if (invalid) return;
    setSaving(true);
    setError(null);
    try {
      await saveProductGroupPrices({ tenantId, productId: product.id, prices: entries });
      await queryClient.invalidateQueries({ queryKey: ["admin_product_group_prices", product.id] });
      await queryClient.invalidateQueries({ queryKey: ["storefront_member_price_flags"] });
      onClose();
    } catch {
      setError("تعذّر حفظ أسعار المجموعات. حاول مرة أخرى.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button type="button" aria-label="إغلاق" onClick={onClose} className="absolute inset-0 bg-ink/50" />
      <div role="dialog" aria-modal="true" aria-labelledby="group-price-title" className="relative flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-card bg-background shadow-card sm:rounded-card">
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 id="group-price-title" className="text-base font-extrabold">أسعار الأعضاء</h2>
            <p className="mt-1 truncate text-xs text-muted-foreground">{product.name_ar} · السعر الأساسي {formatSAR(product.price)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="grid size-11 place-items-center rounded-pill">
            <X aria-hidden className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-4 flex items-start gap-3 rounded-card bg-secondary p-3">
            <BadgePercent aria-hidden className="mt-0.5 size-5 shrink-0 text-brand" />
            <div>
              <p className="text-sm font-bold">سعر خاص حسب مجموعة العميل</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">اترك الحقل فارغاً لاستخدام سعر الفرع أو السعر الأساسي. يتم تحديد أهلية العميل من رقم الجوال في الخطوة الأخيرة من الدفع.</p>
            </div>
          </div>

          {loading ? (
            <div className="grid gap-3">{[0, 1].map((item) => <div key={item} className="h-20 animate-pulse rounded-card bg-secondary" />)}</div>
          ) : groups.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">لا توجد مجموعات عملاء بعد.</p>
          ) : (
            <div className="grid gap-3">
              {groups.map((group) => {
                const raw = draft[group.id] ?? "";
                const numeric = raw.trim() === "" ? null : Number(raw);
                const hasSaving = numeric != null && Number.isFinite(numeric) && numeric < product.price;
                return (
                  <section key={group.id} className="rounded-card border border-border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-bold">{group.name_ar}</h3>
                          {group.is_default ? <span className="rounded-pill bg-secondary px-2 py-0.5 text-[10px] font-bold text-muted-foreground">افتراضية</span> : null}
                        </div>
                        {group.name_en ? <p dir="ltr" className="mt-0.5 text-xs text-muted-foreground">{group.name_en}</p> : null}
                      </div>
                      {hasSaving && numeric != null ? <span className="text-xs font-bold text-success">توفير {formatSAR(product.price - numeric)}</span> : null}
                    </div>
                    <label className="mt-3 block text-xs font-bold text-muted-foreground">سعر المجموعة</label>
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        dir="ltr"
                        inputMode="decimal"
                        min="0"
                        value={raw}
                        onChange={(event) => setDraft((current) => ({ ...current, [group.id]: event.target.value }))}
                        placeholder={String(product.price)}
                        className="min-h-11 flex-1 rounded-card border border-border bg-background px-4 text-sm outline-none focus:border-brand"
                      />
                      {raw ? (
                        <button type="button" onClick={() => setDraft((current) => ({ ...current, [group.id]: "" }))} className="min-h-11 rounded-card border border-border px-3 text-xs font-bold text-muted-foreground">
                          استخدام العادي
                        </button>
                      ) : null}
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          {error ? <p className="mt-4 rounded-card border border-danger/30 bg-danger/10 p-3 text-sm font-bold text-danger">{error}</p> : null}
        </div>

        <footer className="border-t border-border bg-background px-5 py-4">
          <button type="button" disabled={loading || saving || invalid} onClick={save} className="min-h-11 w-full rounded-card bg-brand px-5 py-3 text-sm font-bold text-brand-ink disabled:opacity-50">
            {saving ? "جارٍ الحفظ..." : "حفظ أسعار الأعضاء"}
          </button>
        </footer>
      </div>
    </div>
  );
}
