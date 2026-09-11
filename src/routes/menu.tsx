import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ShoppingBag, ImageOff } from "lucide-react";

import {
  ORDER_TYPE_LABEL,
  brandQuery,
  readSelection,
  type Selection,
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
import { ProductSheet } from "@/components/ProductSheet";

export const Route = createFileRoute("/menu")({
  head: () => ({
    meta: [
      { title: "القائمة — طلب" },
      {
        name: "description",
        content:
          "قائمة الأصناف والمنتجات للفرع المختار، الأسعار بالريال السعودي شاملة ضريبة القيمة المضافة.",
      },
      { property: "og:title", content: "القائمة — طلب" },
      {
        property: "og:description",
        content: "تصفّح أصناف الفرع المختار وأضف طلبك إلى السلة.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
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
    return (
      <main className="min-h-screen bg-secondary px-5 py-10">
        <div className="mx-auto grid max-w-5xl gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card-surface h-24 animate-pulse opacity-60" />
          ))}
        </div>
      </main>
    );
  }

  return <MenuContent selection={selection} />;
}

function MenuContent({ selection }: { selection: Selection }) {
  const { data: brand } = useQuery(brandQuery);
  const { data, isLoading, isError, error } = useQuery(menuQuery(selection.branchId));

  const [cart, setCart] = useState<CartLine[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [openProduct, setOpenProduct] = useState<Product | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    applyBrandTheme(brand?.theme);
  }, [brand?.theme]);

  const categories = useMemo(
    () =>
      [...(data ?? [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)),
    [data],
  );

  useEffect(() => {
    if (categories.length === 0) return;
    setActive((prev) => prev ?? categories[0].id);

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target instanceof HTMLElement && visible.target.dataset["categoryId"]) {
          setActive(visible.target.dataset["categoryId"]);
        }
      },
      { rootMargin: "-140px 0px -60% 0px", threshold: 0 },
    );

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
      const existing = prev.find((l) => l.key === line.key);
      if (existing) {
        return prev.map((l) =>
          l.key === line.key ? { ...l, quantity: l.quantity + line.quantity } : l,
        );
      }
      return [...prev, line];
    });
    setOpenProduct(null);
  }

  const count = cartCount(cart);
  const total = cartTotal(cart);

  return (
    <main className="min-h-screen bg-secondary pb-28">
      <header className="sticky top-0 z-30 border-b border-border bg-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-4">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-base font-extrabold">
              {brand?.name_ar ?? "طلب"}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {selection.branchNameAr} ·{" "}
              {ORDER_TYPE_LABEL[selection.orderType] ?? selection.orderType} ·{" "}
              <Link to="/" className="font-bold text-brand">
                تغيير
              </Link>
            </span>
          </div>
          <div className="relative shrink-0">
            <span
              aria-label={`السلة تحتوي ${count} صنف`}
              className="grid size-11 place-items-center rounded-pill bg-secondary"
            >
              <ShoppingBag aria-hidden className="size-5" />
            </span>
            {count > 0 ? (
              <span
                dir="ltr"
                className="absolute -top-1 inset-inline-end-[-4px] min-w-5 rounded-pill bg-brand px-1.5 text-center text-xs font-bold text-brand-ink"
              >
                {count}
              </span>
            ) : null}
          </div>
        </div>

        {categories.length > 0 ? (
          <nav
            aria-label="الفئات"
            className="mx-auto flex max-w-5xl gap-2 overflow-x-auto px-5 pb-3 no-scrollbar"
          >
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => scrollTo(category.id)}
                aria-current={active === category.id}
                className={`shrink-0 rounded-pill px-4 py-2 text-sm font-bold transition-colors ${
                  active === category.id
                    ? "bg-brand text-brand-ink"
                    : "bg-secondary text-muted-foreground"
                }`}
              >
                {category.name_ar}
              </button>
            ))}
          </nav>
        ) : null}
      </header>

      <div className="mx-auto max-w-5xl px-5 py-6">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div key={i} className="card-surface h-56 animate-pulse opacity-60" />
            ))}
          </div>
        ) : isError ? (
          <Notice
            title="تعذّر تحميل القائمة"
            body={error instanceof Error ? error.message : "خطأ غير معروف"}
          />
        ) : categories.length === 0 ? (
          <Notice title="القائمة غير متوفرة" body="لا توجد فئات لهذا الفرع حالياً." />
        ) : (
          <div className="flex flex-col gap-10">
            {categories.map((category) => (
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
      </div>

      {count > 0 ? (
        <div className="fixed inset-inline-0 bottom-0 z-30 border-t border-border bg-background px-5 py-3">
          <div className="mx-auto max-w-5xl">
            <button
              type="button"
              className="w-full rounded-pill bg-brand px-5 py-3.5 text-sm font-bold text-brand-ink"
            >
              عرض السلة · {count} أصناف · {formatSAR(total)}
            </button>
          </div>
        </div>
      ) : null}

      {openProduct ? (
        <ProductSheet
          product={openProduct}
          onClose={() => setOpenProduct(null)}
          onAdd={addToCart}
        />
      ) : null}
    </main>
  );
}

function CategorySection({
  category,
  onOpen,
  registerRef,
}: {
  category: Category;
  onOpen: (product: Product) => void;
  registerRef: (node: HTMLElement | null) => void;
}) {
  const products = category.products ?? [];

  return (
    <section ref={registerRef} data-category-id={category.id} className="scroll-mt-36">
      <h2 className="mb-3 text-lg font-extrabold">{category.name_ar}</h2>
      {products.length === 0 ? (
        <Notice title="لا توجد أصناف" body="هذه الفئة فارغة حالياً في هذا الفرع." />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  );
}

function ProductCard({
  product,
  onOpen,
}: {
  product: Product;
  onOpen: (product: Product) => void;
}) {
  const outOfStock = product.in_stock === false;

  return (
    <article
      className={`card-surface flex flex-col overflow-hidden ${
        outOfStock ? "pointer-events-none opacity-50" : ""
      }`}
    >
      <button
        type="button"
        disabled={outOfStock}
        onClick={() => onOpen(product)}
        className="flex flex-1 flex-col text-start"
      >
        <span className="relative block w-full">
          {product.image ? (
            <img
              src={product.image}
              alt={product.name_ar}
              loading="lazy"
              className="h-32 w-full object-cover"
            />
          ) : (
            <span className="flex h-32 w-full items-center justify-center bg-secondary text-muted-foreground">
              <ImageOff aria-hidden className="size-6" />
            </span>
          )}
          {outOfStock ? (
            <span className="chip absolute top-2 inset-inline-start-2 !bg-danger/10 text-xs font-bold text-danger">
              غير متوفر
            </span>
          ) : null}
        </span>

        <span className="flex flex-1 flex-col gap-1 p-3">
          <span className="text-sm font-bold">{product.name_ar}</span>
          {product.desc_ar ? (
            <span className="line-clamp-2 text-xs text-muted-foreground">
              {product.desc_ar}
            </span>
          ) : null}
          <span className="mt-auto pt-2 text-sm font-bold text-brand">
            {formatSAR(product.price ?? 0)}
          </span>
          {product.calories != null ? (
            <span className="text-xs text-muted-foreground">
              {formatCalories(product.calories)}
            </span>
          ) : null}
        </span>
      </button>
    </article>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="card-surface p-6 text-center">
      <h3 className="text-base font-bold">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
