import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ImageOff, Menu as MenuIcon, Search, ShoppingBag, X } from "lucide-react";

import {
  ORDER_TYPE_LABEL,
  bannersQuery,
  brandQuery,
  readSelection,
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

  useEffect(() => {
    const saved = readSelection();
    if (!saved?.branchId) {
      navigate({ to: "/", replace: true });
      return;
    }
    setSelection(saved);
  }, [navigate]);

  if (!selection) {
    return (
      <main className="min-h-screen bg-[#fdfdfd] px-5 py-10">
        <div className="mx-auto h-72 max-w-5xl animate-pulse rounded-[10px] bg-white" />
      </main>
    );
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => saveCart(cart), [cart]);
  useEffect(() => applyBrandTheme(brand?.theme), [brand?.theme]);

  const categories = useMemo(
    () => [...(data ?? [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)),
    [data],
  );

  const filteredCategories = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return categories;
    return categories
      .map((category) => ({
        ...category,
        products: (category.products ?? []).filter((product) =>
          `${product.name_ar} ${product.name_en ?? ""} ${product.desc_ar ?? ""}`.toLowerCase().includes(q),
        ),
      }))
      .filter((category) => (category.products ?? []).length > 0);
  }, [categories, search]);

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
      { rootMargin: "-150px 0px -65% 0px", threshold: 0 },
    );

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
      if (existing) {
        return current.map((item) =>
          item.key === line.key ? { ...item, quantity: item.quantity + line.quantity } : item,
        );
      }
      return [...current, line];
    });
    setOpenProduct(null);
  }

  const count = cartCount(cart);
  const total = cartTotal(cart);

  return (
    <main className="min-h-screen bg-[#fdfdfd] pb-20 text-black lg:pb-0" dir="rtl">
      <TopBar
        selection={selection}
        count={count}
        onMenu={() => setDrawerOpen(true)}
        onOrderType={() => navigate({ to: "/" })}
        onCart={() => navigate({ to: "/checkout" })}
      />

      <SideDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onBranches={() => navigate({ to: "/" })} />

      <SearchOverlay open={searchOpen} value={search} onChange={setSearch} onClose={() => setSearchOpen(false)} />

      <header className="bg-white pt-4 sm:pt-5">
        <div className="mx-auto flex max-w-[1140px] items-center justify-center px-4 pb-4">
          {brand?.logo_url ? (
            <img
              src={brand.logo_url}
              alt={brand.name_ar ?? "شعار المطعم"}
              className="max-h-24 w-auto max-w-[190px] object-contain sm:max-h-28 sm:max-w-[230px]"
            />
          ) : (
            <h1 className="py-3 text-3xl font-black">{brand?.name_ar ?? "طلب"}</h1>
          )}
        </div>
      </header>

      {banners.length > 0 ? <StorefrontHero banners={banners} /> : null}

      <section className="mb-4">
        <div className="mx-auto max-w-[1140px] px-3 sm:px-4">
          <div className="mb-3 flex justify-end lg:hidden">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="inline-flex items-center gap-2 rounded-[5px] border border-[#ededed] bg-white px-3 py-2 text-xs font-bold"
            >
              <Search className="size-4" /> بحث عن ...
            </button>
          </div>

          <MobileCategories categories={categories} active={active} onSelect={scrollTo} />

          <div className="grid gap-4 lg:grid-cols-[minmax(190px,1fr)_minmax(0,2fr)_270px] lg:items-start xl:grid-cols-[260px_minmax(0,560px)_280px] xl:justify-center">
            <DesktopCategories categories={categories} active={active} onSelect={scrollTo} />

            <section className="min-w-0">
              <div className="mb-3 hidden justify-end lg:flex">
                <button
                  type="button"
                  onClick={() => setSearchOpen(true)}
                  className="inline-flex items-center gap-2 rounded-[5px] border border-[#ededed] bg-white px-3 py-2 text-xs font-bold"
                >
                  <Search className="size-4" /> بحث عن ...
                </button>
              </div>

              {isLoading ? (
                <div className="space-y-3">
                  {[0, 1, 2, 3].map((item) => (
                    <div key={item} className="h-32 animate-pulse rounded-[10px] border border-[#ededed] bg-white" />
                  ))}
                </div>
              ) : isError ? (
                <Notice title="تعذّر تحميل القائمة" body={error instanceof Error ? error.message : "حاول مرة أخرى"} />
              ) : filteredCategories.length === 0 ? (
                <Notice title="لا توجد نتائج" body="جرّب كلمة بحث أخرى." />
              ) : (
                <div className="space-y-10">
                  {filteredCategories.map((category) => (
                    <CategorySection
                      key={category.id}
                      category={category}
                      onOpen={setOpenProduct}
                      registerRef={(node) => {
                        sectionRefs.current[category.id] = node;
                      }}
                    />
                  ))}
                </div>
              )}
            </section>

            <aside className="sticky top-[74px] hidden lg:block">
              <DesktopCart cart={cart} total={total} count={count} onCheckout={() => navigate({ to: "/checkout" })} />
            </aside>
          </div>
        </div>
      </section>

      <StorefrontFooter brandName={brand?.name_ar ?? "طلب"} theme={brand?.theme} />

      {count > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#ededed] bg-white p-3 lg:hidden">
          <button
            type="button"
            onClick={() => navigate({ to: "/checkout" })}
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
    </main>
  );
}

function TopBar({
  selection,
  count,
  onMenu,
  onOrderType,
  onCart,
}: {
  selection: Selection;
  count: number;
  onMenu: () => void;
  onOrderType: () => void;
  onCart: () => void;
}) {
  return (
    <div className="sticky top-0 z-50 bg-brand px-2 py-2 shadow-sm">
      <nav className="mx-auto flex h-12 max-w-[1140px] items-stretch gap-2">
        <button
          type="button"
          onClick={onMenu}
          aria-label="القائمة"
          className="grid w-12 shrink-0 place-items-center rounded-[5px] bg-white text-black"
        >
          <MenuIcon className="size-5" />
        </button>

        <button
          type="button"
          onClick={onOrderType}
          className="flex min-w-0 flex-1 items-center justify-between rounded-[5px] bg-white px-3 text-right text-black"
        >
          <span className="min-w-0">
            <small className="block text-[10px] leading-none text-[#777]">نوع الطلب</small>
            <span className="mt-1 block truncate text-xs font-bold">
              {ORDER_TYPE_LABEL[selection.orderType] ?? selection.orderType}
            </span>
          </span>
          <span className="max-w-[45%] truncate text-[10px] text-[#878787]">{selection.branchNameAr}</span>
        </button>

        <button
          type="button"
          onClick={onCart}
          aria-label="السلة"
          className="relative grid w-12 shrink-0 place-items-center rounded-[5px] bg-white text-black"
        >
          <ShoppingBag className="size-5" />
          {count > 0 ? (
            <span className="absolute -end-1 -top-1 min-w-5 rounded-full bg-black px-1 text-center text-[10px] font-extrabold text-white">
              {count}
            </span>
          ) : null}
        </button>
      </nav>
    </div>
  );
}

function SideDrawer({ open, onClose, onBranches }: { open: boolean; onClose: () => void; onBranches: () => void }) {
  if (!open) return null;
  const staticItems = ["الرئيسية", "حسابي", "اتصل بنا", "سياسة الخصوصية", "الشروط والأحكام"];

  return (
    <div className="fixed inset-0 z-[70] bg-black/45 p-3" onClick={onClose}>
      <aside
        className="flex h-full w-[min(86vw,340px)] flex-col overflow-hidden rounded-[10px] bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#ededed] p-3">
          <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-[5px] border border-[#ededed]">
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-sm font-bold">القائمة</span>
        </div>
        <nav className="flex-1 overflow-y-auto p-3">
          {staticItems.map((item) => (
            <a key={item} href={item === "الرئيسية" ? "/menu" : item === "اتصل بنا" ? "#storefront-footer" : "#"} onClick={onClose} className="block border-b border-[#f1f1f1] px-2 py-4 text-sm font-medium">
              {item}
            </a>
          ))}
          <button type="button" onClick={() => { onBranches(); onClose(); }} className="block w-full border-b border-[#f1f1f1] px-2 py-4 text-right text-sm font-medium">
            الفروع
          </button>
          <a href="#" onClick={onClose} className="block px-2 py-4 text-sm font-medium">English</a>
        </nav>
      </aside>
    </div>
  );
}

function SearchOverlay({ open, value, onChange, onClose }: { open: boolean; value: string; onChange: (value: string) => void; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[75] bg-black/35" onClick={onClose}>
      <div className="flex h-16 w-full items-center gap-2 bg-white px-3 shadow-md" onClick={(event) => event.stopPropagation()}>
        <Search className="size-5 text-[#777]" />
        <input autoFocus value={value} onChange={(event) => onChange(event.target.value)} placeholder="بحث عن ..." className="h-full min-w-0 flex-1 border-0 bg-transparent text-sm outline-none" />
        <button type="button" onClick={onClose} className="grid size-10 place-items-center"><X className="size-5" /></button>
      </div>
    </div>
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
    <picture className="block w-full">
      {banner.mobile_image_url ? <source media="(max-width: 639px)" srcSet={banner.mobile_image_url} /> : null}
      <img
        src={banner.image_url}
        alt={banner.title_ar ?? banner.title_en ?? "عرض"}
        className="block h-auto w-full object-cover"
      />
    </picture>
  );

  return (
    <section className="mb-4 w-full overflow-hidden bg-white">
      {banner.link_url ? (
        <a
          href={banner.link_url}
          target={banner.link_url.startsWith("http") ? "_blank" : undefined}
          rel={banner.link_url.startsWith("http") ? "noreferrer" : undefined}
          className="block w-full"
        >
          {picture}
        </a>
      ) : picture}
    </section>
  );
}

function MobileCategories({ categories, active, onSelect }: { categories: Category[]; active: string | null; onSelect: (id: string) => void }) {
  if (!categories.length) return null;
  return (
    <nav className="sticky top-16 z-30 -mx-3 mb-4 flex gap-2 overflow-x-auto bg-[#fdfdfd]/95 px-3 py-2 no-scrollbar lg:hidden">
      {categories.map((category) => (
        <button
          key={category.id}
          type="button"
          onClick={() => onSelect(category.id)}
          className={`shrink-0 rounded-[8px] px-4 py-2 text-xs font-bold ${active === category.id ? "bg-black text-white" : "bg-[#f1f1f1] text-[#777]"}`}
        >
          {category.name_ar}
        </button>
      ))}
    </nav>
  );
}

function DesktopCategories({ categories, active, onSelect }: { categories: Category[]; active: string | null; onSelect: (id: string) => void }) {
  return (
    <aside className="sticky top-[74px] hidden overflow-hidden rounded-[10px] border border-[#ededed] bg-white lg:block">
      {categories.map((category) => (
        <button
          key={category.id}
          type="button"
          onClick={() => onSelect(category.id)}
          className={`block w-full border-b border-[#f1f1f1] px-4 py-4 text-right text-sm font-bold last:border-b-0 ${active === category.id ? "bg-black text-white" : "bg-white text-black hover:bg-[#f7f7f7]"}`}
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
    <section ref={registerRef} data-category-id={category.id} className="scroll-mt-32">
      <div className="mb-3 flex flex-col gap-0.5">
        <h2 className="text-lg font-extrabold">{category.name_ar}</h2>
        {category.name_en ? <p className="text-xs font-normal text-[#878787]">{category.name_en}</p> : null}
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
      className={`flex w-full items-stretch justify-between gap-2 rounded-[10px] border border-[#ededed] bg-white p-2 text-right transition ${outOfStock ? "cursor-not-allowed opacity-45" : "hover:border-black/20"}`}
    >
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-2 p-1">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-extrabold sm:text-base">{product.name_ar}</h3>
            {outOfStock ? <span className="rounded-[5px] bg-danger/10 px-2 py-0.5 text-[10px] font-bold text-danger">غير متوفر</span> : null}
          </div>
          {product.desc_ar ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#777]">{product.desc_ar}</p> : null}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="rounded-[5px] bg-[#f1f1f1] px-2.5 py-1 text-sm font-bold text-black">{formatSAR(Number(product.price ?? 0))}</span>
          {product.calories != null ? <span className="rounded-[5px] bg-[#f1f1f1] px-2.5 py-1 text-[11px] text-[#777]">{formatCalories(product.calories)}</span> : null}
        </div>
      </div>
      <div className="h-[112px] w-[112px] shrink-0 overflow-hidden rounded-[8px] bg-[#f1f1f1] sm:h-[128px] sm:w-[128px]">
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
  if (cart.length === 0) {
    return (
      <div className="rounded-[10px] border border-[#ededed] bg-white p-5 text-center">
        <ShoppingBag className="mx-auto size-9 text-[#878787]" />
        <p className="mt-3 text-sm">أضف اصناف من القائمة</p>
      </div>
    );
  }

  return (
    <div className="rounded-[10px] border border-[#ededed] bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-extrabold">السلة</h3>
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
      <div className="mt-3 flex justify-between border-t border-[#ededed] pt-3 text-sm font-extrabold">
        <span>الإجمالي</span><span>{formatSAR(total)}</span>
      </div>
      <button type="button" onClick={onCheckout} className="mt-3 w-full rounded-[10px] bg-brand px-4 py-3 text-sm font-extrabold text-brand-ink">
        إكمال الطلب
      </button>
    </div>
  );
}

function themeValue(theme: Record<string, unknown> | null | undefined, key: string) {
  const value = theme?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function StorefrontFooter({ brandName, theme }: { brandName: string; theme: Record<string, unknown> | null }) {
  const socials = [
    ["Instagram", themeValue(theme, "instagram_url")],
    ["Tiktok", themeValue(theme, "tiktok_url")],
    ["Snapchat", themeValue(theme, "snapchat_url")],
    ["Whatsapp", themeValue(theme, "whatsapp_url")],
  ].filter((item): item is [string, string] => Boolean(item[1]));
  const apps = [
    ["App Store", themeValue(theme, "app_store_url")],
    ["Google Play", themeValue(theme, "google_play_url")],
  ].filter((item): item is [string, string] => Boolean(item[1]));

  return (
    <footer id="storefront-footer" className="mt-8 bg-black text-white">
      {(socials.length > 0 || apps.length > 0) ? (
        <div className="mx-auto flex max-w-[1140px] flex-col items-center justify-between gap-6 px-5 py-7 sm:flex-row">
          {socials.length > 0 ? (
            <div className="text-center sm:text-right">
              <p className="mb-3 text-sm">تابعنا</p>
              <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
                {socials.map(([label, href]) => <a key={label} href={href} target="_blank" rel="noreferrer" className="rounded-[5px] border border-white/20 px-3 py-1.5 text-xs">{label}</a>)}
              </div>
            </div>
          ) : null}
          {apps.length > 0 ? (
            <div className="text-center sm:text-right">
              <p className="mb-3 text-sm">حمل التطبيق</p>
              <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
                {apps.map(([label, href]) => <a key={label} href={href} target="_blank" rel="noreferrer" className="rounded-[5px] bg-white px-3 py-1.5 text-xs font-bold text-black">{label}</a>)}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="bg-white px-4 py-2 text-black">
        <div className="mx-auto flex max-w-[1140px] items-center justify-between gap-3 text-[11px]">
          <span>جميع الحقوق محفوظة © {brandName}</span>
          <span className="text-[#878787]">Powered by TALAB</span>
        </div>
      </div>
    </footer>
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
