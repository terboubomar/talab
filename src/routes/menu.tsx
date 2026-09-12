import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ImageOff, Menu as MenuIcon, Search, ShoppingBag } from "lucide-react";

import { ORDER_TYPE_LABEL, bannersQuery, brandQuery, readSelection, type Selection, type StorefrontBanner } from "@/lib/storefront";
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
      { name: "description", content: "تصفح قائمة المطعم واطلب مباشرة من الفرع المختار." },
    ],
  }),
  component: MenuPage,
});

function MenuPage() {
  const navigate = useNavigate();
  const [selection, setSelection] = useState<Selection | null>(null);

  useEffect(() => {
    const saved = readSelection();
    if (!saved?.branchId) {
      navigate({ to: "/", replace: true });
      return;
    }
    setSelection(saved);
  }, [navigate]);

  if (!selection) {
    return <main className="min-h-screen bg-secondary px-5 py-10"><div className="mx-auto h-72 max-w-5xl animate-pulse rounded-card bg-background" /></main>;
  }

  return <MenuContent selection={selection} />;
}

function MenuContent({ selection }: { selection: Selection }) {
  const navigate = useNavigate();
  const { data: brand } = useQuery(brandQuery);
  const { data: banners = [] } = useQuery(bannersQuery);
  const { data, isLoading, isError, error } = useQuery(menuQuery(selection.branchId));
  const [cart, setCart] = useState<CartLine[]>(() => readCart());
  const [active, setActive] = useState<string | null>(null);
  const [openProduct, setOpenProduct] = useState<Product | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => saveCart(cart), [cart]);
  useEffect(() => applyBrandTheme(brand?.theme), [brand?.theme]);

  const categories = useMemo(() => [...(data ?? [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)), [data]);
  const filteredCategories = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return categories;
    return categories
      .map((category) => ({
        ...category,
        products: (category.products ?? []).filter((product) => `${product.name_ar} ${product.name_en ?? ""} ${product.desc_ar ?? ""}`.toLowerCase().includes(q)),
      }))
      .filter((category) => (category.products ?? []).length > 0);
  }, [categories, search]);

  useEffect(() => {
    const first = categories[0];
    if (!first) return;
    setActive((prev) => prev ?? first.id);
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible?.target instanceof HTMLElement && visible.target.dataset["categoryId"]) setActive(visible.target.dataset["categoryId"]);
    }, { rootMargin: "-160px 0px -65% 0px", threshold: 0 });
    categories.forEach((category) => {
      const node = sectionRefs.current[category.id];
      if (node) observer.observe(node);
    });
    return () => observer.disconnect();
  }, [categories]);

  function scrollTo(id: string) {
    setActive(id);
    sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function addToCart(line: CartLine) {
    setCart((current) => {
      const existing = current.find((item) => item.key === line.key);
      if (existing) return current.map((item) => item.key === line.key ? { ...item, quantity: item.quantity + line.quantity } : item);
      return [...current, line];
    });
    setOpenProduct(null);
  }

  const count = cartCount(cart);
  const total = cartTotal(cart);

  return (
    <main className="min-h-screen bg-[#f7f7f7] pb-24 lg:pb-0" dir="rtl">
      <div className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-stretch justify-between px-4">
          <button type="button" className="grid w-12 place-items-center border-s border-border" aria-label="القائمة"><MenuIcon className="size-5" /></button>
          <button type="button" onClick={() => navigate({ to: "/" })} className="flex min-w-0 flex-1 items-center justify-center gap-2 px-4 py-2 text-center">
            <span className="min-w-0"><span className="block text-[10px] text-muted-foreground">نوع الطلب</span><span className="block truncate text-xs font-extrabold">{ORDER_TYPE_LABEL[selection.orderType] ?? selection.orderType} · {selection.branchNameAr}</span></span>
          </button>
          <button type="button" onClick={() => navigate({ to: "/checkout" })} className="relative grid w-12 place-items-center border-e border-border" aria-label="السلة"><ShoppingBag className="size-5" />{count > 0 ? <span className="absolute right-1 top-1 min-w-5 rounded-full bg-brand px-1 text-center text-[10px] font-extrabold text-brand-ink">{count}</span> : null}</button>
        </div>
      </div>

      <header className="bg-background">
        <div className="mx-auto flex max-w-6xl flex-col items-center px-5 py-6">
          {brand?.logo_url ? <img src={brand.logo_url} alt={brand.name_ar ?? "شعار المطعم"} className="h-20 w-auto object-contain sm:h-24" /> : <h1 className="text-2xl font-black">{brand?.name_ar ?? "طلب"}</h1>}
          <div className="mt-4 flex items-center gap-2">
            <button type="button" onClick={() => setSearchOpen((value) => !value)} className="inline-flex items-center gap-2 rounded-card border border-border px-3 py-2 text-xs font-bold"><Search className="size-4" /> بحث</button>
            <Link to="/" className="rounded-card border border-border px-3 py-2 text-xs font-bold">تغيير الفرع</Link>
          </div>
          {searchOpen ? <div className="mt-3 w-full max-w-xl"><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث عن صنف..." className="w-full rounded-card border border-border bg-background px-4 py-3 text-sm outline-none focus:border-brand" /></div> : null}
        </div>
      </header>

      {banners.length > 0 ? <StorefrontHero banners={banners} /> : null}

      <div className="mx-auto max-w-6xl px-4 pb-8">
        <nav className="sticky top-[49px] z-30 -mx-4 mb-5 flex gap-2 overflow-x-auto border-y border-border bg-[#f7f7f7]/95 px-4 py-3 no-scrollbar lg:hidden">
          {categories.map((category) => <button key={category.id} type="button" onClick={() => scrollTo(category.id)} className={`shrink-0 rounded-lg px-4 py-2 text-xs font-extrabold ${active === category.id ? "bg-foreground text-background" : "bg-background text-muted-foreground"}`}>{category.name_ar}</button>)}
        </nav>

        <div className="grid gap-5 lg:grid-cols-[210px_minmax(0,1fr)_280px] lg:items-start">
          <aside className="sticky top-20 hidden rounded-card border border-border bg-background p-2 lg:block">
            {categories.map((category) => <button key={category.id} type="button" onClick={() => scrollTo(category.id)} className={`w-full rounded-lg px-3 py-3 text-right text-sm font-bold transition ${active === category.id ? "bg-foreground text-background" : "hover:bg-secondary"}`}>{category.name_ar}</button>)}
          </aside>

          <section className="min-w-0">
            {isLoading ? <div className="space-y-3">{[0,1,2,3].map((i) => <div key={i} className="h-32 animate-pulse rounded-card bg-background" />)}</div> : isError ? <Notice title="تعذّر تحميل القائمة" body={error instanceof Error ? error.message : "حاول مرة أخرى"} /> : filteredCategories.length === 0 ? <Notice title="لا توجد نتائج" body="جرّب كلمة بحث أخرى." /> : <div className="space-y-9">{filteredCategories.map((category) => <CategorySection key={category.id} category={category} onOpen={setOpenProduct} registerRef={(node) => { sectionRefs.current[category.id] = node; }} />)}</div>}
          </section>

          <aside className="sticky top-20 hidden lg:block"><DesktopCart cart={cart} total={total} count={count} onCheckout={() => navigate({ to: "/checkout" })} /></aside>
        </div>
      </div>

      <footer className="mt-8 bg-neutral-950 text-white"><div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-5 py-6 text-center text-xs sm:flex-row"><span>{brand?.name_ar ?? "طلب"}</span><span className="text-white/60">جميع الحقوق محفوظة ©</span></div></footer>

      {count > 0 ? <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background p-3 lg:hidden"><button type="button" onClick={() => navigate({ to: "/checkout" })} className="mx-auto flex w-full max-w-lg items-center justify-between rounded-card bg-brand px-5 py-3.5 text-sm font-extrabold text-brand-ink"><span>عرض السلة</span><span>{count} · {formatSAR(total)}</span></button></div> : null}
      {openProduct ? <ProductSheet product={openProduct} onClose={() => setOpenProduct(null)} onAdd={addToCart} /> : null}
    </main>
  );
}

function StorefrontHero({ banners }: { banners: StorefrontBanner[] }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (banners.length <= 1) return;
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % banners.length), 5000);
    return () => window.clearInterval(timer);
  }, [banners.length]);

  useEffect(() => {
    if (index >= banners.length) setIndex(0);
  }, [banners.length, index]);

  const banner = banners[index];
  if (!banner) return null;

  const visual = (
    <picture className="block w-full">
      {banner.mobile_image_url ? <source media="(max-width: 639px)" srcSet={banner.mobile_image_url} /> : null}
      <img src={banner.image_url} alt={banner.title_ar ?? banner.title_en ?? "عرض"} className="aspect-[16/6] w-full object-cover sm:aspect-[16/5]" />
    </picture>
  );

  return (
    <section className="mx-auto mb-5 max-w-6xl overflow-hidden bg-background sm:px-4">
      <div className="relative overflow-hidden sm:rounded-card">
        {banner.link_url ? <a href={banner.link_url} className="block" target={banner.link_url.startsWith("http") ? "_blank" : undefined} rel={banner.link_url.startsWith("http") ? "noreferrer" : undefined}>{visual}</a> : visual}
        {banners.length > 1 ? (
          <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
            {banners.map((item, dotIndex) => (
              <button key={item.id} type="button" onClick={() => setIndex(dotIndex)} aria-label={`عرض ${dotIndex + 1}`} className={`h-1.5 rounded-full shadow-sm transition-all ${dotIndex === index ? "w-7 bg-white" : "w-1.5 bg-white/60"}`} />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function CategorySection({ category, onOpen, registerRef }: { category: Category; onOpen: (product: Product) => void; registerRef: (node: HTMLElement | null) => void }) {
  const products = category.products ?? [];
  return <section ref={registerRef} data-category-id={category.id} className="scroll-mt-32"><div className="mb-3"><h2 className="text-lg font-black">{category.name_ar}</h2>{category.name_en ? <p className="text-xs text-muted-foreground">{category.name_en}</p> : null}</div><div className="space-y-3">{products.map((product) => <ProductRow key={product.id} product={product} onOpen={onOpen} />)}</div></section>;
}

function ProductRow({ product, onOpen }: { product: Product; onOpen: (product: Product) => void }) {
  const outOfStock = product.in_stock === false;
  return <button type="button" disabled={outOfStock} onClick={() => onOpen(product)} className={`flex w-full items-stretch gap-3 rounded-card border border-border bg-background p-2 text-right transition hover:border-brand/40 ${outOfStock ? "cursor-not-allowed opacity-45" : ""}`}><div className="flex min-w-0 flex-1 flex-col justify-between gap-2 p-1"><div><div className="flex items-center gap-2"><h3 className="font-extrabold">{product.name_ar}</h3>{outOfStock ? <span className="rounded-md bg-danger/10 px-2 py-0.5 text-[10px] font-bold text-danger">غير متوفر</span> : null}</div>{product.desc_ar ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{product.desc_ar}</p> : null}</div><div className="flex flex-wrap items-center gap-2"><span className="rounded-md bg-secondary px-2.5 py-1 text-sm font-extrabold">{formatSAR(Number(product.price ?? 0))}</span>{product.calories != null ? <span className="rounded-md bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground">{formatCalories(product.calories)}</span> : null}</div></div><div className="h-28 w-28 shrink-0 overflow-hidden rounded-lg bg-secondary sm:h-32 sm:w-32">{product.image ? <img src={product.image} alt={product.name_ar} loading="lazy" className="h-full w-full object-cover" /> : <span className="grid h-full w-full place-items-center text-muted-foreground"><ImageOff className="size-6" /></span>}</div></button>;
}

function DesktopCart({ cart, total, count, onCheckout }: { cart: CartLine[]; total: number; count: number; onCheckout: () => void }) {
  if (cart.length === 0) return <div className="rounded-card border border-border bg-background p-6 text-center"><ShoppingBag className="mx-auto size-8 text-muted-foreground" /><p className="mt-3 text-sm font-bold">أضف أصناف من القائمة</p></div>;
  return <div className="rounded-card border border-border bg-background p-4"><div className="flex items-center justify-between"><h3 className="font-extrabold">السلة</h3><span className="text-xs text-muted-foreground">{count} صنف</span></div><div className="mt-3 divide-y divide-border">{cart.slice(0,5).map((line) => <div key={line.key} className="py-2 text-xs"><div className="flex justify-between gap-2"><span>{line.quantity}× {line.nameAr}</span><span className="font-bold">{formatSAR(line.unitPrice * line.quantity)}</span></div></div>)}{cart.length > 5 ? <p className="py-2 text-xs text-muted-foreground">+ {cart.length - 5} أصناف أخرى</p> : null}</div><div className="mt-3 flex justify-between border-t border-border pt-3 text-sm font-extrabold"><span>الإجمالي</span><span>{formatSAR(total)}</span></div><button type="button" onClick={onCheckout} className="mt-3 w-full rounded-card bg-brand px-4 py-3 text-sm font-extrabold text-brand-ink">إكمال الطلب</button></div>;
}

function Notice({ title, body }: { title: string; body: string }) { return <div className="rounded-card border border-border bg-background p-6 text-center"><h3 className="font-bold">{title}</h3><p className="mt-2 text-sm text-muted-foreground">{body}</p></div>; }
