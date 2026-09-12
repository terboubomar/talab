import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ImageOff, MapPin, ShoppingBag, X } from "lucide-react";

import {
  ORDER_TYPE_LABEL,
  bannersQuery,
  branchesQuery,
  brandQuery,
  readSelection,
  saveSelection,
  type Branch,
  type OrderType,
  type Selection,
  type StorefrontBanner,
} from "@/lib/storefront";
import {
  cartCount,
  cartTotal,
  formatCalories,
  formatSAR,
  menuQuery,
  type CartLine,
  type Category,
  type Product,
} from "@/lib/menu";
import { applyBrandTheme } from "@/lib/theme";
import { readCart, saveCart } from "@/lib/cart";
import { ProductSheet } from "@/components/ProductSheet";

export const Route = createFileRoute("/menu")({
  head: () => ({
    meta: [
      { title: "القائمة — طلب" },
      { name: "description", content: "صفحة القائمة" },
    ],
  }),
  component: MenuPage,
});

function MenuPage() {
  const navigate = useNavigate();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [cart, setCart] = useState<CartLine[]>(() => readCart());
  const [active, setActive] = useState<string | null>(null);
  const [openProduct, setOpenProduct] = useState<Product | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [pendingProductId, setPendingProductId] = useState<string | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  const { data: brand } = useQuery(brandQuery);
  const { data: banners = [] } = useQuery(bannersQuery);
  const { data: branches = [], isLoading: branchesLoading } = useQuery(branchesQuery);
  const { data, isLoading, isError, error } = useQuery(menuQuery(selection?.branchId ?? null));

  useEffect(() => {
    setSelection(readSelection());
  }, []);

  useEffect(() => saveCart(cart), [cart]);
  useEffect(() => applyBrandTheme(brand?.theme), [brand?.theme]);

  const categories = useMemo(
    () => [...(data ?? [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)),
    [data],
  );

  useEffect(() => {
    const first = categories[0];
    if (!first) return;
    setActive((previous) => previous ?? first.id);

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target instanceof HTMLElement && visible.target.dataset["categoryId"]) {
          setActive(visible.target.dataset["categoryId"]);
        }
      },
      { rootMargin: "-88px 0px -65% 0px", threshold: 0 },
    );

    categories.forEach((category) => {
      const node = sectionRefs.current[category.id];
      if (node) observer.observe(node);
    });
    return () => observer.disconnect();
  }, [categories]);

  useEffect(() => {
    if (!selection || !pendingProductId || !data) return;
    const product = (data as Category[])
      .flatMap((category) => category.products ?? [])
      .find((item) => item.id === pendingProductId);
    setPendingProductId(null);
    if (product && product.in_stock !== false) setOpenProduct(product);
  }, [data, pendingProductId, selection]);

  function scrollTo(id: string) {
    setActive(id);
    sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function requestProduct(product: Product) {
    if (!selection?.branchId) {
      setPendingProductId(product.id);
      setSelectorOpen(true);
      return;
    }
    setOpenProduct(product);
  }

  function addToCart(line: CartLine) {
    setCart((current) => {
      const existing = current.find((item) => item.key === line.key);
      if (existing) {
        return current.map((item) =>
          item.key === line.key ? { ...item, quantity: item.quantity + line.quantity } : item,
        );
      }
      return [...current, line];
    });
    setOpenProduct(null);
  }

  function chooseOrderContext(branch: Branch, orderType: OrderType) {
    const branchId = String(branch.branch_id ?? branch.id ?? "");
    if (!branchId) return;

    if (selection?.branchId && selection.branchId !== branchId && cart.length > 0) {
      setCart([]);
    }

    const next: Selection = {
      branchId,
      branchNameAr: branch.name_ar,
      orderType,
    };
    saveSelection(next);
    setSelection(next);
    setSelectorOpen(false);

    if (orderType === "delivery") {
      setPendingProductId(null);
      navigate({ to: "/delivery-address" });
    }
  }

  function checkout() {
    if (!selection?.branchId) {
      setPendingProductId(null);
      setSelectorOpen(true);
      return;
    }
    navigate({ to: "/checkout" });
  }

  const count = cartCount(cart);
  const total = cartTotal(cart);

  return (
    <main className="min-h-screen bg-[#fdfdfd] pb-20 text-black lg:pb-6" dir="rtl">
      {banners.length > 0 ? <StorefrontHero banners={banners} /> : null}

      <section className="menuPage mb-3 flex-grow">
        <div className="mx-auto w-full max-w-[1140px] px-[15px]">
          <MobileCategories categories={categories} active={active} onSelect={scrollTo} />

          <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
            <div className="hidden lg:col-span-3 lg:block">
              <DesktopCategories categories={categories} active={active} onSelect={scrollTo} />
            </div>

            <section className="min-w-0 lg:col-span-6">
              {isLoading ? (
                <div className="space-y-3">
                  {[0, 1, 2, 3].map((item) => (
                    <div key={item} className="h-[136px] animate-pulse rounded-[10px] border border-[#ededed] bg-white" />
                  ))}
                </div>
              ) : isError ? (
                <Notice title="تعذّر تحميل القائمة" body={error instanceof Error ? error.message : "حاول مرة أخرى"} />
              ) : categories.length === 0 ? (
                <Notice title="القائمة غير متاحة حالياً" body="حاول مرة أخرى بعد قليل." />
              ) : (
                <div className="space-y-10">
                  {categories.map((category) => (
                    <CategorySection
                      key={category.id}
                      category={category}
                      onOpen={requestProduct}
                      registerRef={(node) => {
                        sectionRefs.current[category.id] = node;
                      }}
                    />
                  ))}
                </div>
              )}
            </section>

            <aside className="hidden lg:col-span-3 lg:block">
              {cart.length > 0 ? (
                <div className="sticky top-5">
                  <DesktopCart cart={cart} total={total} count={count} onCheckout={checkout} />
                </div>
              ) : null}
            </aside>
          </div>
        </div>
      </section>

      {count > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#ededed] bg-white p-3 lg:hidden">
          <button
            type="button"
            onClick={checkout}
            className="mx-auto flex w-full max-w-lg items-center justify-between rounded-[10px] bg-brand px-5 py-3.5 text-sm font-extrabold text-brand-ink"
          >
            <span>عرض السلة</span>
            <span>{count} · {formatSAR(total)}</span>
          </button>
        </div>
      ) : null}

      {openProduct ? (
        <ProductSheet product={openProduct} onClose={() => setOpenProduct(null)} onAdd={addToCart} />
      ) : null}

      <OrderContextModal
        open={selectorOpen}
        branches={branches}
        loading={branchesLoading}
        onClose={() => {
          setSelectorOpen(false);
          setPendingProductId(null);
        }}
        onChoose={chooseOrderContext}
      />
    </main>
  );
}

function StorefrontHero({ banners }: { banners: StorefrontBanner[] }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (banners.length <= 1) return;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % banners.length), 5000);
    return () => window.clearInterval(timer);
  }, [banners.length]);

  useEffect(() => {
    if (index >= banners.length) setIndex(0);
  }, [banners.length, index]);

  const banner = banners[index];
  if (!banner) return null;

  const picture = (
    <picture className="block h-full w-full">
      {banner.mobile_image_url ? <source media="(max-width: 639px)" srcSet={banner.mobile_image_url} /> : null}
      <img
        src={banner.image_url}
        alt={banner.title_ar ?? banner.title_en ?? "عرض"}
        className="block h-full w-full object-cover"
      />
    </picture>
  );

  return (
    <section className="mx-auto mb-3 w-full max-w-[1140px] px-[15px]">
      <div className="w-full overflow-hidden bg-white" style={{ aspectRatio: "1110 / 410" }}>
        {banner.link_url ? (
          <a
            href={banner.link_url}
            target={banner.link_url.startsWith("http") ? "_blank" : undefined}
            rel={banner.link_url.startsWith("http") ? "noreferrer" : undefined}
            className="block h-full w-full"
          >
            {picture}
          </a>
        ) : picture}
      </div>
    </section>
  );
}

function MobileCategories({ categories, active, onSelect }: { categories: Category[]; active: string | null; onSelect: (id: string) => void }) {
  if (!categories.length) return null;
  return (
    <nav className="sticky top-0 z-30 -mx-[15px] mb-4 flex gap-2 overflow-x-auto bg-[#fdfdfd]/95 px-[15px] py-2 no-scrollbar lg:hidden">
      {categories.map((category) => (
        <button
          key={category.id}
          type="button"
          onClick={() => onSelect(category.id)}
          className={`shrink-0 rounded-[8px] px-4 py-2 text-xs font-bold ${active === category.id ? "bg-[#090306] text-white" : "bg-[#f1f1f1] text-[#777]"}`}
        >
          {category.name_ar}
        </button>
      ))}
    </nav>
  );
}

function DesktopCategories({ categories, active, onSelect }: { categories: Category[]; active: string | null; onSelect: (id: string) => void }) {
  if (!categories.length) return null;
  return (
    <aside className="sticky top-5 overflow-hidden rounded-[10px] border border-[#ededed] bg-white">
      {categories.map((category) => (
        <button
          key={category.id}
          type="button"
          onClick={() => onSelect(category.id)}
          className={`block w-full border-b border-[#f1f1f1] px-4 py-4 text-right text-sm font-bold last:border-b-0 ${active === category.id ? "bg-[#090306] text-white" : "bg-white text-black hover:bg-[#f7f7f7]"}`}
        >
          {category.name_ar}
        </button>
      ))}
    </aside>
  );
}

function CategorySection({ category, onOpen, registerRef }: { category: Category; onOpen: (product: Product) => void; registerRef: (node: HTMLElement | null) => void }) {
  const products = category.products ?? [];
  return (
    <section ref={registerRef} data-category-id={category.id} className="scroll-mt-20">
      <div className="mb-3 flex flex-col gap-0.5">
        <h2 className="text-base font-bold sm:text-lg">{category.name_ar}</h2>
        {category.name_en ? <small className="text-xs font-normal text-[#878787]">{category.name_en}</small> : null}
      </div>
      <div className="space-y-3">
        {products.map((product) => <ProductRow key={product.id} product={product} onOpen={onOpen} />)}
      </div>
    </section>
  );
}

function ProductRow({ product, onOpen }: { product: Product; onOpen: (product: Product) => void }) {
  const outOfStock = product.in_stock === false;
  return (
    <button
      type="button"
      disabled={outOfStock}
      onClick={() => onOpen(product)}
      className={`flex w-full items-stretch justify-between gap-2 rounded-[10px] border border-[#ededed] bg-white p-2 text-right ${outOfStock ? "cursor-not-allowed opacity-45" : ""}`}
    >
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-2 p-1">
        <div className="flex-grow">
          <h3 className="text-sm font-bold sm:text-base">{product.name_ar}</h3>
          {product.desc_ar ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#878787]">{product.desc_ar}</p> : null}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="rounded-[6px] px-2 py-1 text-sm font-medium text-black">{formatSAR(Number(product.price ?? 0))}</span>
          {product.calories != null ? <span className="rounded-[6px] px-2 py-1 text-[11px] text-[#878787]">{formatCalories(product.calories)}</span> : null}
        </div>
      </div>
      <div className="h-[100px] w-[100px] shrink-0 overflow-hidden rounded-[8px] bg-[#f1f1f1] sm:h-[120px] sm:w-[120px]">
        {product.image ? (
          <img src={product.image} alt={product.name_ar} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span className="grid h-full w-full place-items-center text-[#878787]"><ImageOff className="size-6" /></span>
        )}
      </div>
    </button>
  );
}

function DesktopCart({ cart, total, count, onCheckout }: { cart: CartLine[]; total: number; count: number; onCheckout: () => void }) {
  return (
    <div className="rounded-[10px] border border-[#ededed] bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold">السلة</h3>
        <span className="text-xs text-[#878787]">{count} صنف</span>
      </div>
      <div className="mt-3 divide-y divide-[#ededed]">
        {cart.slice(0, 6).map((line) => (
          <div key={line.key} className="py-2 text-xs">
            <div className="flex justify-between gap-2">
              <span>{line.quantity}× {line.nameAr}</span>
              <span className="font-bold">{formatSAR(line.unitPrice * line.quantity)}</span>
            </div>
          </div>
        ))}
        {cart.length > 6 ? <p className="py-2 text-xs text-[#878787]">+ {cart.length - 6} أصناف أخرى</p> : null}
      </div>
      <div className="mt-3 flex justify-between border-t border-[#ededed] pt-3 text-sm font-bold">
        <span>الإجمالي</span><span>{formatSAR(total)}</span>
      </div>
      <button type="button" onClick={onCheckout} className="mt-3 w-full rounded-[10px] bg-brand px-4 py-3 text-sm font-bold text-brand-ink">
        إكمال الطلب
      </button>
    </div>
  );
}

function OrderContextModal({
  open,
  branches,
  loading,
  onClose,
  onChoose,
}: {
  open: boolean;
  branches: Branch[];
  loading: boolean;
  onClose: () => void;
  onChoose: (branch: Branch, orderType: OrderType) => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, Branch[]>();
    branches.forEach((branch) => {
      if (branch.busy) return;
      const city = branch.city_ar?.trim() || "فروع أخرى";
      const bucket = map.get(city) ?? [];
      bucket.push(branch);
      map.set(city, bucket);
    });
    return [...map.entries()];
  }, [branches]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 sm:items-center sm:p-5" onClick={onClose}>
      <section className="max-h-[88vh] w-full max-w-xl overflow-hidden rounded-t-[18px] bg-white shadow-2xl sm:rounded-[14px]" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-[#ededed] px-4 py-4">
          <div>
            <h2 className="text-base font-bold">ابدأ طلبك</h2>
            <p className="mt-1 text-xs text-[#878787]">اختر الفرع وطريقة الطلب</p>
          </div>
          <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-full bg-[#f1f1f1]" aria-label="إغلاق">
            <X className="size-4" />
          </button>
        </header>

        <div className="max-h-[calc(88vh-78px)] overflow-y-auto p-4">
          {loading ? (
            <div className="space-y-3">{[0, 1, 2].map((item) => <div key={item} className="h-28 animate-pulse rounded-[10px] bg-[#f1f1f1]" />)}</div>
          ) : grouped.length === 0 ? (
            <Notice title="لا توجد فروع متاحة" body="حاول مرة أخرى بعد قليل." />
          ) : (
            <div className="space-y-6">
              {grouped.map(([city, cityBranches]) => (
                <section key={city}>
                  <div className="mb-2 flex items-center gap-2 text-sm font-bold"><MapPin className="size-4" /> {city}</div>
                  <div className="space-y-2">
                    {cityBranches.map((branch) => (
                      <article key={String(branch.branch_id ?? branch.id)} className="rounded-[10px] border border-[#ededed] p-3">
                        <h3 className="text-sm font-bold">{branch.name_ar}</h3>
                        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {(branch.order_types ?? []).map((type) => (
                            <button
                              key={type}
                              type="button"
                              onClick={() => onChoose(branch, type)}
                              className="rounded-[8px] bg-[#090306] px-3 py-2.5 text-xs font-bold text-white"
                            >
                              {ORDER_TYPE_LABEL[type] ?? type}
                            </button>
                          ))}
                        </div>
                      </article>
                    ))}
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

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[10px] border border-[#ededed] bg-white p-6 text-center">
      <h3 className="font-bold">{title}</h3>
      <p className="mt-2 text-sm text-[#878787]">{body}</p>
    </div>
  );
}
