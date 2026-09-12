import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ImageOff, MapPin, ShoppingBag } from "lucide-react";

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
import { StorefrontOrderContextModal } from "@/components/StorefrontOrderContextModal";

const PENDING_PRODUCT_KEY = "talab.pendingProduct";

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
  const [urlProductId, setUrlProductId] = useState<string | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  const { data: brand } = useQuery(brandQuery);
  const { data: banners = [] } = useQuery(bannersQuery);
  const { data: branches = [], isLoading: branchesLoading } = useQuery(branchesQuery);
  const { data, isLoading, isError, error } = useQuery(menuQuery(selection?.branchId ?? null));

  useEffect(() => {
    setSelection(readSelection());
    if (typeof window === "undefined") return;

    const readUrlProduct = () => {
      const productId = new URL(window.location.href).searchParams.get("product");
      setUrlProductId(productId);
      if (!productId) setOpenProduct(null);
    };

    readUrlProduct();
    const pending = window.sessionStorage.getItem(PENDING_PRODUCT_KEY);
    if (pending) {
      window.sessionStorage.removeItem(PENDING_PRODUCT_KEY);
      setPendingProductId(pending);
      setUrlProductId(pending);
      replaceProductUrl(pending);
    }

    window.addEventListener("popstate", readUrlProduct);
    return () => window.removeEventListener("popstate", readUrlProduct);
  }, []);

  useEffect(() => saveCart(cart), [cart]);
  useEffect(() => applyBrandTheme(brand?.theme), [brand?.theme]);

  const categories = useMemo(
    () => [...(data ?? [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)),
    [data],
  );

  const allProducts = useMemo(
    () => categories.flatMap((category) => category.products ?? []),
    [categories],
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
      { rootMargin: "-126px 0px -65% 0px", threshold: 0 },
    );

    categories.forEach((category) => {
      const node = sectionRefs.current[category.id];
      if (node) observer.observe(node);
    });
    return () => observer.disconnect();
  }, [categories]);

  useEffect(() => {
    if (!urlProductId || !data || selectorOpen || pendingProductId) return;
    const product = allProducts.find((item) => item.id === urlProductId);
    if (product && openProduct?.id !== product.id) setOpenProduct(product);
  }, [allProducts, data, openProduct?.id, pendingProductId, selectorOpen, urlProductId]);

  useEffect(() => {
    if (!selection || !pendingProductId || !data || selectorOpen) return;
    const product = allProducts.find((item) => item.id === pendingProductId);
    if (!product) return;
    setPendingProductId(null);
    setUrlProductId(product.id);
    replaceProductUrl(product.id);
    setOpenProduct(product);
  }, [allProducts, data, pendingProductId, selection, selectorOpen]);

  function scrollTo(id: string) {
    setActive(id);
    sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function requestProduct(product: Product) {
    setOpenProduct(product);
    setUrlProductId(product.id);
    pushProductUrl(product.id);
  }

  function closeProduct() {
    setOpenProduct(null);
    setUrlProductId(null);
    replaceProductUrl(null);
  }

  function addToCart(line: CartLine) {
    if (!selection?.branchId) {
      setPendingProductId(line.productId);
      setOpenProduct(null);
      setSelectorOpen(true);
      return;
    }

    setCart((current) => {
      const existing = current.find((item) => item.key === line.key);
      if (existing) {
        return current.map((item) =>
          item.key === line.key ? { ...item, quantity: item.quantity + line.quantity } : item,
        );
      }
      return [...current, line];
    });
    closeProduct();
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
      if (pendingProductId && typeof window !== "undefined") {
        window.sessionStorage.setItem(PENDING_PRODUCT_KEY, pendingProductId);
      }
      navigate({ to: "/delivery-address" });
    }
  }

  function closeOrderContext() {
    setSelectorOpen(false);
    if (!pendingProductId) return;
    const product = allProducts.find((item) => item.id === pendingProductId);
    setPendingProductId(null);
    if (product) setOpenProduct(product);
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
    <main className="min-h-screen bg-surface-sunk pb-20 text-ink lg:pb-8" dir="rtl">
      <OrderContextBar selection={selection} count={count} onSelect={() => setSelectorOpen(true)} onCart={checkout} />

      {banners.length > 0 ? <StorefrontHero banners={banners} /> : null}

      <section className="mb-3 flex-grow">
        <div className="mx-auto w-full max-w-[1140px] px-4 sm:px-[15px]">
          <CategoryNav categories={categories} active={active} onSelect={scrollTo} />

          <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
            <section className="min-w-0 lg:col-span-9">
              {isLoading ? (
                <div className="space-y-3">{[0, 1, 2, 3].map((item) => <div key={item} className="h-[136px] animate-pulse rounded-card bg-surface-raised" />)}</div>
              ) : isError ? (
                <Notice title="تعذّر تحميل القائمة" body={error instanceof Error ? error.message : "حاول مرة أخرى"} />
              ) : categories.length === 0 ? (
                <Notice title="القائمة غير متاحة حالياً" body="حاول مرة أخرى بعد قليل." />
              ) : (
                <div className="space-y-12">
                  {categories.map((category) => (
                    <CategorySection key={category.id} category={category} onOpen={requestProduct} registerRef={(node) => { sectionRefs.current[category.id] = node; }} />
                  ))}
                </div>
              )}
            </section>

            <aside className="hidden lg:col-span-3 lg:block">
              {cart.length > 0 ? <div className="sticky top-32"><DesktopCart cart={cart} total={total} count={count} onCheckout={checkout} /></div> : null}
            </aside>
          </div>
        </div>
      </section>

      {count > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface-raised p-3 lg:hidden">
          <button type="button" onClick={checkout} className="mx-auto flex min-h-11 w-full max-w-lg items-center justify-between rounded-card bg-brand px-5 py-3 text-sm font-semibold text-brand-ink">
            <span>عرض السلة</span><span className="tabular-nums">{count} · {formatSAR(total)}</span>
          </button>
        </div>
      ) : null}

      {openProduct ? <ProductSheet product={openProduct} branchId={selection?.branchId ?? null} onClose={closeProduct} onAdd={addToCart} /> : null}

      <StorefrontOrderContextModal
        open={selectorOpen}
        branches={branches}
        loading={branchesLoading}
        selection={selection}
        onClose={closeOrderContext}
        onChoose={chooseOrderContext}
      />
    </main>
  );
}

function pushProductUrl(productId: string) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.pathname = "/menu";
  url.searchParams.set("product", productId);
  window.history.pushState(window.history.state, "", `${url.pathname}${url.search}`);
}

function replaceProductUrl(productId: string | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.pathname = "/menu";
  if (productId) url.searchParams.set("product", productId);
  else url.searchParams.delete("product");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
}

function OrderContextBar({ selection, count, onSelect, onCart }: { selection: Selection | null; count: number; onSelect: () => void; onCart: () => void }) {
  return (
    <header className="sticky top-0 z-40 bg-brand px-2 py-2">
      <div className="mx-auto flex h-12 max-w-[1110px] gap-2">
        <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-3 rounded-sm bg-surface px-3 text-start text-ink shadow-1">
          <MapPin className="size-4 shrink-0 text-brand" aria-hidden />
          {selection ? (
            <span className="min-w-0 flex-1"><span className="block text-[11px] leading-none text-ink-3">{ORDER_TYPE_LABEL[selection.orderType] ?? selection.orderType}</span><span className="mt-1 block truncate text-[13px] font-semibold">{selection.branchNameAr}</span></span>
          ) : (
            <span className="min-w-0 flex-1"><span className="block text-[11px] leading-none text-ink-3">نوع الطلب والفرع</span><span className="mt-1 block truncate text-[13px] font-semibold">اختر لبدء الطلب</span></span>
          )}
        </button>
        <button type="button" onClick={onCart} aria-label="السلة" className="relative grid size-12 shrink-0 place-items-center rounded-sm bg-surface text-ink shadow-1">
          <ShoppingBag className="size-5" aria-hidden />
          {count > 0 ? <span className="absolute -end-1 -top-1 min-w-5 rounded-pill bg-ink px-1 text-center text-[10px] font-semibold text-surface tabular-nums">{count}</span> : null}
        </button>
      </div>
    </header>
  );
}

function StorefrontHero({ banners }: { banners: StorefrontBanner[] }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (banners.length <= 1) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % banners.length), 5000);
    return () => window.clearInterval(timer);
  }, [banners.length]);

  useEffect(() => { if (index >= banners.length) setIndex(0); }, [banners.length, index]);
  const banner = banners[index];
  if (!banner) return null;

  const picture = (
    <picture className="block h-full w-full">
      {banner.mobile_image_url ? <source media="(max-width: 639px)" srcSet={banner.mobile_image_url} /> : null}
      <img src={banner.image_url} alt={banner.title_ar ?? banner.title_en ?? "عرض"} className="block h-full w-full object-cover" />
    </picture>
  );

  return (
    <section className="mx-auto mb-3 w-full max-w-[1140px] px-4 pt-3 sm:px-[15px]">
      <div className="w-full overflow-hidden bg-surface" style={{ aspectRatio: "1110 / 410" }}>
        {banner.link_url ? <a href={banner.link_url} target={banner.link_url.startsWith("http") ? "_blank" : undefined} rel={banner.link_url.startsWith("http") ? "noreferrer" : undefined} className="block h-full w-full">{picture}</a> : picture}
      </div>
    </section>
  );
}

function CategoryNav({ categories, active, onSelect }: { categories: Category[]; active: string | null; onSelect: (id: string) => void }) {
  if (!categories.length) return null;
  return (
    <nav aria-label="فئات القائمة" className="sticky top-16 z-30 -mx-4 mb-6 flex gap-2 overflow-x-auto bg-surface-sunk/95 px-4 py-2 backdrop-blur no-scrollbar sm:-mx-[15px] sm:px-[15px]">
      {categories.map((category) => (
        <button key={category.id} type="button" onClick={() => onSelect(category.id)} aria-current={active === category.id ? "true" : undefined} className={`min-h-11 shrink-0 rounded-sm px-4 text-[13px] font-medium transition-colors ${active === category.id ? "bg-ink text-surface" : "bg-surface-raised text-ink-2 hover:text-ink"}`}>{category.name_ar}</button>
      ))}
    </nav>
  );
}

function CategorySection({ category, onOpen, registerRef }: { category: Category; onOpen: (product: Product) => void; registerRef: (node: HTMLElement | null) => void }) {
  const products = category.products ?? [];
  return (
    <section ref={registerRef} data-category-id={category.id} className="scroll-mt-32">
      <div className="mb-4 flex flex-col gap-1"><h2 className="font-heading text-xl font-semibold text-ink">{category.name_ar}</h2>{category.name_en ? <small className="text-xs text-ink-3">{category.name_en}</small> : null}</div>
      <div className="space-y-3">{products.map((product) => <ProductRow key={product.id} product={product} onOpen={onOpen} />)}</div>
    </section>
  );
}

function ProductRow({ product, onOpen }: { product: Product; onOpen: (product: Product) => void }) {
  const outOfStock = product.in_stock === false;
  return (
    <button type="button" disabled={outOfStock} onClick={() => onOpen(product)} className={`flex w-full items-stretch justify-between gap-3 rounded-card border border-line bg-surface-raised p-2 text-start transition-colors ${outOfStock ? "cursor-not-allowed opacity-50" : "hover:border-brand/35"}`}>
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-2 p-1">
        <div className="flex-grow"><div className="flex items-center gap-2"><h3 className="text-[13px] font-medium leading-5 text-ink sm:text-[15px]">{product.name_ar}</h3>{outOfStock ? <span className="rounded-pill bg-danger/10 px-2 py-0.5 text-[10px] font-medium text-danger">غير متوفر</span> : null}</div>{product.desc_ar ? <p className="mt-1 line-clamp-2 text-sm leading-[1.6] text-ink-2">{product.desc_ar}</p> : null}</div>
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-semibold text-ink tabular-nums">{formatSAR(Number(product.price ?? 0))}</span>{product.calories != null ? <span className="text-xs text-ink-3">{formatCalories(product.calories)}</span> : null}</div>
      </div>
      <div className="size-[104px] shrink-0 overflow-hidden rounded-sm bg-surface-sunk sm:size-[110px]">{product.image ? <img src={product.image} alt={product.name_ar} loading="lazy" className="h-full w-full object-cover" /> : <span className="grid h-full w-full place-items-center text-ink-3"><ImageOff className="size-6" aria-hidden /></span>}</div>
    </button>
  );
}

function DesktopCart({ cart, total, count, onCheckout }: { cart: CartLine[]; total: number; count: number; onCheckout: () => void }) {
  return (
    <div className="rounded-card border border-line bg-surface-raised p-4">
      <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">السلة</h3><span className="text-xs text-ink-3 tabular-nums">{count} صنف</span></div>
      <div className="mt-3 divide-y divide-line-soft">
        {cart.slice(0, 6).map((line) => <div key={line.key} className="py-3 text-xs"><div className="flex justify-between gap-2"><span className="font-medium text-ink">{line.quantity}× {line.nameAr}</span><span className="shrink-0 font-semibold text-ink tabular-nums">{formatSAR(line.unitPrice * line.quantity)}</span></div>{line.optionNames.length > 0 ? <p className="mt-1 leading-5 text-ink-2">{line.optionNames.join("، ")}</p> : null}{line.note ? <p className="mt-1 leading-5 text-ink-3">ملاحظة: {line.note}</p> : null}</div>)}
        {cart.length > 6 ? <p className="py-2 text-xs text-ink-3">+ {cart.length - 6} أصناف أخرى</p> : null}
      </div>
      <div className="mt-3 flex justify-between border-t border-line pt-3 text-sm font-semibold"><span>الإجمالي</span><span className="tabular-nums">{formatSAR(total)}</span></div>
      <button type="button" onClick={onCheckout} className="mt-3 min-h-11 w-full rounded-card bg-brand px-4 py-3 text-sm font-semibold text-brand-ink">تنفيذ الطلب</button>
    </div>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return <div className="rounded-card border border-line bg-surface-raised p-6 text-center"><h3 className="font-semibold">{title}</h3><p className="mt-2 text-sm text-ink-2">{body}</p></div>;
}
