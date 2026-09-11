import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ArrowDown, ArrowUp, ImageOff, Plus } from "lucide-react";

import {
  fetchMenus,
  fetchCategories,
  fetchProducts,
  setCategoryActive,
  setProductActive,
  swapCategorySort,
  createCategory,
  createProduct,
  updateProduct,
  type AdminCategory,
  type AdminProduct,
  type ProductFormValues,
} from "@/lib/catalog";
import { usePermissions } from "@/lib/permissions";
import { formatSAR } from "@/lib/menu";
import { AdminProductForm } from "@/components/AdminProductForm";

export const Route = createFileRoute("/_staffShell/admin/products")({
  head: () => ({
    meta: [{ title: "المنتجات — طلب" }],
  }),
  component: ProductsAdminPage,
});

function ProductsAdminPage() {
  const { can, tenantId } = usePermissions();
  const queryClient = useQueryClient();
  const [menuId, setMenuId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<AdminProduct | null>(null);

  const canWrite = can("menus.update");
  const canCreate = can("menus.create");

  const { data: menus, isLoading: menusLoading } = useQuery({
    queryKey: ["admin_menus"],
    queryFn: fetchMenus,
  });

  const activeMenuId = menuId ?? menus?.[0]?.id ?? null;

  const { data: categories, isLoading: categoriesLoading } = useQuery({
    queryKey: ["admin_categories", activeMenuId],
    queryFn: () => fetchCategories(activeMenuId as string),
    enabled: Boolean(activeMenuId),
  });

  const { data: products, isLoading: productsLoading } = useQuery({
    queryKey: ["admin_products", categoryId],
    queryFn: () => fetchProducts(categoryId as string),
    enabled: Boolean(categoryId),
  });

  const activeCategory = categories?.find((c) => c.id === categoryId) ?? null;

  async function toggleCategoryActive(cat: AdminCategory) {
    await setCategoryActive(cat.id, !cat.active);
    queryClient.invalidateQueries({ queryKey: ["admin_categories", activeMenuId] });
  }

  async function toggleProductActive(p: AdminProduct) {
    await setProductActive(p.id, { active: !p.active });
    queryClient.invalidateQueries({ queryKey: ["admin_products", categoryId] });
  }

  async function moveCategory(index: number, direction: -1 | 1) {
    if (!categories) return;
    const target = categories[index + direction];
    const current = categories[index];
    if (!target || !current) return;
    await swapCategorySort(current, target);
    queryClient.invalidateQueries({ queryKey: ["admin_categories", activeMenuId] });
  }

  async function handleCreateCategory() {
    if (!tenantId || !activeMenuId || !newCategoryName.trim()) return;
    await createCategory({
      tenantId,
      menuId: activeMenuId,
      nameAr: newCategoryName.trim(),
      nameEn: "",
    });
    setNewCategoryName("");
    setShowNewCategory(false);
    queryClient.invalidateQueries({ queryKey: ["admin_categories", activeMenuId] });
  }

  async function handleSaveProduct(values: ProductFormValues) {
    if (!tenantId) return;
    if (editingProduct) {
      await updateProduct({
        tenantId,
        productId: editingProduct.id,
        existingImageUrl: editingProduct.primary_image_url,
        values,
      });
    } else if (categoryId) {
      await createProduct({ tenantId, categoryId, values });
    }
    queryClient.invalidateQueries({ queryKey: ["admin_products", categoryId] });
  }

  return (
    <main className="min-h-screen pb-10">
      <header className="sticky top-0 z-20 border-b border-border bg-background px-5 py-4">
        <h1 className="text-base font-extrabold">المنتجات</h1>
        {menus && menus.length > 1 ? (
          <nav className="mt-3 flex gap-2 overflow-x-auto">
            {menus.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setMenuId(m.id);
                  setCategoryId(null);
                }}
                className={`shrink-0 rounded-pill px-4 py-2 text-sm font-bold ${
                  m.id === activeMenuId
                    ? "bg-brand text-brand-ink"
                    : "border border-border text-muted-foreground"
                }`}
              >
                {m.name_ar}
              </button>
            ))}
          </nav>
        ) : null}
      </header>

      <div className="px-5 py-6">
        {categoryId && activeCategory ? (
          <>
            <button
              type="button"
              onClick={() => setCategoryId(null)}
              className="mb-4 flex items-center gap-1.5 text-sm font-bold text-muted-foreground"
            >
              <ArrowRight aria-hidden className="size-4" />
              الفئات
            </button>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-bold">{activeCategory.name_ar}</h2>
              {canCreate ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditingProduct(null);
                    setFormOpen(true);
                  }}
                  className="flex items-center gap-1.5 rounded-pill bg-brand px-4 py-2 text-sm font-bold text-brand-ink"
                >
                  <Plus aria-hidden className="size-4" />
                  إضافة صنف
                </button>
              ) : null}
            </div>

            {productsLoading ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="card-surface h-48 animate-pulse opacity-60" />
                ))}
              </div>
            ) : !products || products.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">
                لا توجد أصناف في هذه الفئة
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {products.map((p) => (
                  <article key={p.id} className="card-surface overflow-hidden">
                    <div className="relative h-28 w-full bg-secondary">
                      {p.primary_image_url ? (
                        <img
                          src={p.primary_image_url}
                          alt={p.name_ar}
                          className="size-full object-cover"
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center text-muted-foreground">
                          <ImageOff aria-hidden className="size-6" />
                        </div>
                      )}
                      {!p.active ? (
                        <span className="absolute inset-0 flex items-center justify-center bg-ink/40 text-xs font-bold text-white">
                          غير متوفر
                        </span>
                      ) : null}
                    </div>
                    <div className="p-3">
                      <p className="truncate text-sm font-bold">{p.name_ar}</p>
                      <p className="mt-1 text-sm font-bold text-brand">{formatSAR(p.price)}</p>
                      {canWrite ? (
                        <div className="mt-2 flex items-center justify-between">
                          <label className="flex items-center gap-1.5 text-xs">
                            <input
                              type="checkbox"
                              checked={p.active}
                              onChange={() => toggleProductActive(p)}
                              className="size-3.5 accent-[var(--accent)]"
                            />
                            مفعّل
                          </label>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingProduct(p);
                              setFormOpen(true);
                            }}
                            className="text-xs font-bold text-brand"
                          >
                            تعديل
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-bold">الفئات</h2>
              {canCreate ? (
                <button
                  type="button"
                  onClick={() => setShowNewCategory((v) => !v)}
                  className="flex items-center gap-1.5 rounded-pill bg-brand px-4 py-2 text-sm font-bold text-brand-ink"
                >
                  <Plus aria-hidden className="size-4" />
                  إضافة فئة
                </button>
              ) : null}
            </div>

            {showNewCategory ? (
              <div className="card-surface mb-4 flex gap-2 p-3">
                <input
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="اسم الفئة"
                  className="flex-1 rounded-card border border-border bg-background px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-brand"
                />
                <button
                  type="button"
                  onClick={handleCreateCategory}
                  className="rounded-card bg-brand px-4 py-2.5 text-sm font-bold text-brand-ink"
                >
                  حفظ
                </button>
              </div>
            ) : null}

            {menusLoading || categoriesLoading ? (
              <div className="grid gap-3">
                {[0, 1].map((i) => (
                  <div key={i} className="card-surface h-16 animate-pulse opacity-60" />
                ))}
              </div>
            ) : !categories || categories.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">لا توجد فئات بعد</p>
            ) : (
              <div className="grid gap-2">
                {categories.map((cat, index) => (
                  <div key={cat.id} className="card-surface flex items-center justify-between p-4">
                    <button
                      type="button"
                      onClick={() => setCategoryId(cat.id)}
                      className="flex-1 text-start"
                    >
                      <span className="text-sm font-bold">{cat.name_ar}</span>
                      <span className="ms-2 text-xs text-muted-foreground">
                        {cat.product_count} منتج
                      </span>
                    </button>
                    <div className="flex items-center gap-3">
                      {canWrite ? (
                        <>
                          <label className="flex items-center gap-1.5 text-xs">
                            <input
                              type="checkbox"
                              checked={cat.active}
                              onChange={() => toggleCategoryActive(cat)}
                              className="size-3.5 accent-[var(--accent)]"
                            />
                            مفعّلة
                          </label>
                          <button
                            type="button"
                            aria-label="تحريك لأعلى"
                            disabled={index === 0}
                            onClick={() => moveCategory(index, -1)}
                            className="grid size-7 place-items-center text-muted-foreground disabled:opacity-30"
                          >
                            <ArrowUp aria-hidden className="size-4" />
                          </button>
                          <button
                            type="button"
                            aria-label="تحريك لأسفل"
                            disabled={index === categories.length - 1}
                            onClick={() => moveCategory(index, 1)}
                            className="grid size-7 place-items-center text-muted-foreground disabled:opacity-30"
                          >
                            <ArrowDown aria-hidden className="size-4" />
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {formOpen ? (
        <AdminProductForm
          product={editingProduct}
          onClose={() => setFormOpen(false)}
          onSave={handleSaveProduct}
        />
      ) : null}
    </main>
  );
}
