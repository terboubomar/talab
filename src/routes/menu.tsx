import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ImageOff, ShoppingBag } from "lucide-react";

import { ORDER_TYPE_LABEL, brandQuery, readSelection, type Selection } from "@/lib/storefront";
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
      { name: "description", content: "تصفّح قائمة الفرع المختار وأضف طلبك مباشرة إلى السلة." },
      { property: "og:title", content: "القائمة — طلب" },
      { property: "og:description", content: "تصفّح الأصناف وأكمل طلبك بسهولة." },
      { property: "og:type", content: "website" },
    ],
  }),
  component: MenuPage,
});

function MenuPage() {
  const navigate = useNavigate();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const saved = readSelection();
    if (!saved?.branchId) {
      navigate({ to: "/", replace: true });
      return;
    }
    setSelection(saved);
    setReady(true);
  }, [navigate]);

  if (!ready || !selection) {
    return <main className="min-h-screen bg-secondary px-5 py-10"><div className="mx-auto grid max-w-6xl gap-3">{[0,1,2].map((i)=><div key={i} className="card-surface h-24 animate-pulse opacity-60" />)}</div></main>;
  }

  return <MenuContent selection={selection} />;
}

function MenuContent({ selection }: { selection: Selection }) {
  const navigate = useNavigate();
  const { data: brand } = useQuery(brandQuery);
  const { data, isLoading, isError, error } = useQuery(menuQuery(selection.branchId));

  const [cart, setCart] = useState<CartLine[]>(() => readCart());
  const [active, setActive] = useState<string | null>(null);
  const [openProduct, setOpenProduct] = useState<Product | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => { saveCart(cart); }, [cart]);
  useEffect(() => { applyBrandTheme(brand?.theme); }, [brand?.theme]);

  const categories = useMemo(() => [...(data ?? [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)), [data]);

  useEffect(() => {
    const first = categories[0];
    if (!first) return;
    setActive((prev) => prev ?? first.id);

    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a,b)=>a.boundingClientRect.top-b.boundingClientRect.top)[0];
      if (visible?.target instanceof HTMLElement && visible.target.dataset["categoryId"]) setActive(visible.target.dataset["categoryId"]);
    }, { rootMargin: "-170px 0px -60% 0px", threshold: 0 });

    for (const category of categories) {
      const node = sectionRefs.current[category.id];
      if (node) observer.observe(node);
    }
    return () => observer.disconnect();
  }, [categories]);

  function scrollTo(id: string) {
    setActive(id);
    sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function addToCart(line: CartLine) {
    setCart((prev) => {
      const existing = prev.find((item) => item.key === line.key);
      if (existing) return prev.map((item) => item.key === line.key ? { ...item, quantity: item.quantity + line.quantity } : item);
      return [...prev, line];
    });
    setOpenProduct(null);
  }

  const count = cartCount(cart);
  const total = cartTotal(cart);

  return (
    <main className="min-h-screen bg-secondary pb-32" dir="rtl">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <Link to="/" aria-label="العودة لاختيار الفرع" className="grid size-10 shrink-0 place-items-center rounded-full border border-border bg-background hover:bg-secondary">
              <ArrowRight className="size-4" />
            </Link>
            {brand?.logo_url ? <img src={brand.logo_url} alt={brand.name_ar ?? "الشعار"} className="h-10 w-auto max-w-24 object-contain" /> : null}
            <div className="min-w-0">
              <h1 className="truncate text-base font-black">{brand?.name_ar ?? "طلب"}</h1>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {selection.branchNameAr} · {ORDER_TYPE_LABEL[selection.orderType] ?? selection.orderType}
              </p>
            </div>
          </div>

          <button type="button" disabled={count === 0} onClick={() => count > 0 && navigate({ to: "/checkout" })} className="relative grid size-11 shrink-0 place-items-center rounded-full bg-secondary disabled:opacity-60">
            <ShoppingBag className="size-5" />
            {count > 0 ? <span dir="ltr" className="absolute -end-1 -top-1 min-w-5 rounded-full bg-brand px-1.5 text-center text-[10px] font-extrabold text-brand-ink">{count}</span> : null}
          </button>
        </div>

        {categories.length > 0 ? (
          <nav className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-5 pb-3 no-scrollbar" aria-label="الفئات">
            {categories.map((category) => (
              <button key={category.id} type="button" onClick={() => scrollTo(category.id)} aria-current={active === category.id} className={`shrink-0 rounded-full px-4 py-2 text-sm font-extrabold transition ${active === category.id ? "bg-brand text-brand-ink shadow-sm" : "border border-border bg-background text-muted-foreground"}`}>
                {category.name_ar}
              </button>
            ))}
          </nav>
        ) : null}
      </header>

      <section className="border-b border-border bg-background">
        <div className="mx-auto max-w-6xl px-5 py-6 sm:py-8">
          <p className="text-xs font-bold text-brand">قائمة {selection.branchNameAr}</p>
          <h2 className="mt-1 text-2xl font-black tracking-tight">وش تشتهي اليوم؟</h2>
          <p className="mt-1 text-sm text-muted-foreground">اختر من القائمة، وعدّل الإضافات والكمية قبل إضافة الصنف للسلة.</p>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-5 py-7">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{[0,1,2,3,4,5,6,7].map((i)=><div key={i} className="card-surface h-64 animate-pulse opacity-60" />)}</div>
        ) : isError ? (
          <Notice title="تعذّر تحميل القائمة" body={error instanceof Error ? error.message : "خطأ غير معروف"} />
        ) : categories.length === 0 ? (
          <Notice title="القائمة غير متوفرة" body="لا توجد فئات لهذا الفرع حالياً." />
        ) : (
          <div className="flex flex-col gap-12">
            {categories.map((category) => (
              <CategorySection key={category.id} category={category} onOpen={setOpenProduct} registerRef={(node) => { sectionRefs.current[category.id] = node; }} />
            ))}
          </div>
        )}
      </div>

      {count > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto max-w-3xl">
            <button type="button" onClick={() => navigate({ to: "/checkout" })} className="flex w-full items-center justify-between rounded-2xl bg-brand px-4 py-3.5 text-brand-ink shadow-lg">
              <span className="flex items-center gap-2"><ShoppingBag className="size-4" /><span className="text-sm font-extrabold">عرض السلة</span><span className="rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-bold">{count}</span></span>
              <span className="text-sm font-black">{formatSAR(total)}</span>
            </button>
          </div>
        </div>
      ) : null}

      {openProduct ? <ProductSheet product={openProduct} onClose={() => setOpenProduct(null)} onAdd={addToCart} /> : null}
    </main>
  );
}

function CategorySection({ category, onOpen, registerRef }: { category: Category; onOpen: (product: Product) => void; registerRef: (node: HTMLElement | null) => void }) {
  const products = category.products ?? [];
  return (
    <section ref={registerRef} data-category-id={category.id} className="scroll-mt-40">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div><h2 className="text-xl font-black">{category.name_ar}</h2><p className="mt-1 text-xs text-muted-foreground">{products.length} صنف</p></div>
      </div>
      {products.length === 0 ? <Notice title="لا توجد أصناف" body="هذه الفئة فارغة حالياً في هذا الفرع." /> : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((product) => <ProductCard key={product.id} product={product} onOpen={onOpen} />)}
        </div>
      )}
    </section>
  );
}

function ProductCard({ product, onOpen }: { product: Product; onOpen: (product: Product) => void }) {
  const outOfStock = product.in_stock === false;
  return (
    <article className={`group overflow-hidden rounded-2xl border border-border bg-background shadow-sm transition ${outOfStock ? "opacity-50" : "hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-md"}`}>
      <button type="button" disabled={outOfStock} onClick={() => onOpen(product)} className="flex h-full w-full flex-col text-start">
        <span className="relative block aspect-[4/3] w-full overflow-hidden bg-secondary">
          {product.image ? <img src={product.image} alt={product.name_ar} loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" /> : <span className="flex h-full w-full items-center justify-center text-muted-foreground"><ImageOff className="size-7" /></span>}
          {outOfStock ? <span className="absolute start-2 top-2 rounded-full bg-background/90 px-2.5 py-1 text-[10px] font-extrabold text-danger shadow-sm">غير متوفر</span> : null}
          {product.modifier_groups?.length ? <span className="absolute bottom-2 end-2 rounded-full bg-background/90 px-2 py-1 text-[10px] font-bold shadow-sm">خيارات متاحة</span> : null}
        </span>

        <span className="flex flex-1 flex-col p-3.5">
          <span className="text-sm font-extrabold leading-6">{product.name_ar}</span>
          {product.desc_ar ? <span className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{product.desc_ar}</span> : <span className="mt-1 text-xs text-muted-foreground">اضغط لاختيار الكمية والإضافات</span>}
          <span className="mt-auto flex items-end justify-between gap-2 pt-3">
            <span className="text-sm font-black text-brand">{formatSAR(product.price ?? 0)}</span>
            {product.calories != null ? <span className="text-[10px] text-muted-foreground">{formatCalories(product.calories)}</span> : null}
          </span>
        </span>
      </button>
    </article>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return <div className="rounded-2xl border border-border bg-background p-8 text-center shadow-sm"><h3 className="text-base font-extrabold">{title}</h3><p className="mt-2 text-sm text-muted-foreground">{body}</p></div>;
}
