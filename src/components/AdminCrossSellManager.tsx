import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, ImageOff, Plus, Search, Trash2, X } from "lucide-react";

import {
  fetchCrossSellCandidates,
  fetchProductCrossSells,
  saveProductCrossSells,
  type AdminCrossSellCandidate,
  type AdminProduct,
} from "@/lib/catalog";
import { formatSAR } from "@/lib/menu";

type Props = {
  product: AdminProduct;
  menuId: string;
  tenantId: string;
  onClose: () => void;
};

const MAX_CROSS_SELLS = 8;

export function AdminCrossSellManager({ product, menuId, tenantId, onClose }: Props) {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: candidates = [], isLoading: candidatesLoading } = useQuery({
    queryKey: ["admin_cross_sell_candidates", menuId, product.id],
    queryFn: () => fetchCrossSellCandidates(menuId, product.id),
  });

  const { data: savedIds = [], isLoading: selectedLoading } = useQuery({
    queryKey: ["admin_cross_sells", product.id],
    queryFn: () => fetchProductCrossSells(product.id),
  });

  useEffect(() => {
    setSelectedIds(savedIds.slice(0, MAX_CROSS_SELLS));
  }, [product.id, savedIds]);

  const candidateMap = useMemo(
    () => new Map(candidates.map((candidate) => [candidate.id, candidate])),
    [candidates],
  );

  const selectedProducts = useMemo(
    () => selectedIds.map((id) => candidateMap.get(id)).filter(Boolean) as AdminCrossSellCandidate[],
    [candidateMap, selectedIds],
  );

  const filteredCandidates = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("ar");
    if (!needle) return candidates;
    return candidates.filter((candidate) =>
      candidate.name_ar.toLocaleLowerCase("ar").includes(needle) ||
      (candidate.name_en ?? "").toLocaleLowerCase().includes(needle) ||
      candidate.category_name_ar.toLocaleLowerCase("ar").includes(needle),
    );
  }, [candidates, search]);

  function toggleCandidate(id: string) {
    setError(null);
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= MAX_CROSS_SELLS) return current;
      return [...current, id];
    });
  }

  function moveSelected(id: string, direction: -1 | 1) {
    setSelectedIds((current) => {
      const index = current.indexOf(id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await saveProductCrossSells({ tenantId, productId: product.id, suggestedIds: selectedIds });
      await queryClient.invalidateQueries({ queryKey: ["admin_cross_sells", product.id] });
      await queryClient.invalidateQueries({ queryKey: ["storefront_product_cross_sells"] });
      onClose();
    } catch {
      setError("تعذّر حفظ الاقتراحات. حاول مرة أخرى.");
    } finally {
      setSaving(false);
    }
  }

  const loading = candidatesLoading || selectedLoading;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-5">
      <button type="button" aria-label="إغلاق" onClick={onClose} className="absolute inset-0 bg-ink/50" />
      <section role="dialog" aria-modal="true" aria-labelledby="cross-sell-manager-title" className="relative flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-card bg-background shadow-card sm:rounded-card">
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">اقتراحات البيع المتعدد</p>
            <h2 id="cross-sell-manager-title" className="mt-1 truncate text-base font-extrabold">أضف مع طلبك · {product.name_ar}</h2>
            <p className="mt-1 text-xs text-muted-foreground">اختر حتى {MAX_CROSS_SELLS} أصناف، ورتّبها كما تريد ظهورها في المتجر.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="grid size-11 shrink-0 place-items-center rounded-pill bg-secondary">
            <X aria-hidden className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {loading ? (
            <div className="space-y-3">{[0, 1, 2].map((item) => <div key={item} className="h-20 animate-pulse rounded-card bg-secondary" />)}</div>
          ) : (
            <>
              <section>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-bold">المختارة</h3>
                  <span className="text-xs font-medium text-muted-foreground tabular-nums">{selectedIds.length} / {MAX_CROSS_SELLS}</span>
                </div>

                {selectedProducts.length === 0 ? (
                  <div className="rounded-card border border-dashed border-border bg-secondary/40 p-6 text-center">
                    <p className="text-sm font-bold">لا توجد اقتراحات بعد</p>
                    <p className="mt-1 text-xs text-muted-foreground">اختر أصنافاً من القائمة أدناه ليظهر قسم «أضف مع طلبك» للعميل.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedProducts.map((candidate, index) => (
                      <div key={candidate.id} className="flex items-center gap-3 rounded-card border border-border bg-background p-2.5">
                        <ProductThumb candidate={candidate} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold">{candidate.name_ar}</p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">{candidate.category_name_ar} · {formatSAR(candidate.price)}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button type="button" aria-label="تحريك لأعلى" disabled={index === 0} onClick={() => moveSelected(candidate.id, -1)} className="grid size-10 place-items-center rounded-sm text-muted-foreground disabled:opacity-25"><ArrowUp aria-hidden className="size-4" /></button>
                          <button type="button" aria-label="تحريك لأسفل" disabled={index === selectedProducts.length - 1} onClick={() => moveSelected(candidate.id, 1)} className="grid size-10 place-items-center rounded-sm text-muted-foreground disabled:opacity-25"><ArrowDown aria-hidden className="size-4" /></button>
                          <button type="button" aria-label="إزالة" onClick={() => toggleCandidate(candidate.id)} className="grid size-10 place-items-center rounded-sm text-danger"><Trash2 aria-hidden className="size-4" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="mt-6">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-bold">اختر أصنافاً</h3>
                  <span className="text-xs text-muted-foreground">من نفس القائمة</span>
                </div>

                <label className="relative block">
                  <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث باسم الصنف أو الفئة" className="h-12 w-full rounded-card border border-border bg-background px-10 text-sm outline-none placeholder:text-muted-foreground focus:border-brand" />
                </label>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {filteredCandidates.map((candidate) => {
                    const selected = selectedIds.includes(candidate.id);
                    const capReached = selectedIds.length >= MAX_CROSS_SELLS && !selected;
                    return (
                      <button key={candidate.id} type="button" disabled={capReached} onClick={() => toggleCandidate(candidate.id)} className={`flex min-h-[72px] items-center gap-3 rounded-card border p-2.5 text-start transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${selected ? "border-brand bg-brand-soft" : "border-border bg-background hover:border-brand/40"}`}>
                        <ProductThumb candidate={candidate} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold">{candidate.name_ar}</span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{candidate.category_name_ar} · {formatSAR(candidate.price)}</span>
                        </span>
                        <span className={`grid size-9 shrink-0 place-items-center rounded-pill ${selected ? "bg-brand text-brand-ink" : "bg-secondary text-muted-foreground"}`}>
                          {selected ? <Check aria-hidden className="size-4" /> : <Plus aria-hidden className="size-4" />}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {filteredCandidates.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">لا توجد أصناف مطابقة.</p> : null}
              </section>
            </>
          )}

          {error ? <p className="mt-4 rounded-card border border-danger/30 bg-danger/10 p-3 text-center text-sm font-bold text-danger">{error}</p> : null}
        </div>

        <footer className="border-t border-border bg-background px-5 py-4">
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="min-h-11 flex-1 rounded-card border border-border px-4 text-sm font-bold">إلغاء</button>
            <button type="button" disabled={loading || saving} onClick={save} className="min-h-11 flex-[1.5] rounded-card bg-brand px-4 text-sm font-bold text-brand-ink disabled:opacity-50">{saving ? "جارٍ الحفظ..." : "حفظ الاقتراحات"}</button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function ProductThumb({ candidate }: { candidate: AdminCrossSellCandidate }) {
  return (
    <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-sm bg-secondary">
      {candidate.primary_image_url ? <img src={candidate.primary_image_url} alt={candidate.name_ar} className="size-full object-cover" /> : <ImageOff aria-hidden className="size-5 text-muted-foreground" />}
    </span>
  );
}
