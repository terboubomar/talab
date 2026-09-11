import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search, Phone, Check } from "lucide-react";

import {
  ORDER_TYPE_LABEL,
  branchKey,
  branchesQuery,
  brandQuery,
  saveSelection,
  type Branch,
  type OrderType,
} from "@/lib/storefront";
import { isSupabaseConnected } from "@/lib/supabase";
import { applyBrandTheme } from "@/lib/theme";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "اختر الفرع — طلب" },
      {
        name: "description",
        content:
          "اختر أقرب فرع وطريقة الطلب: استلام، توصيل، من السيارة أو محلي. الأسعار تشمل ضريبة القيمة المضافة.",
      },
      { property: "og:title", content: "اختر الفرع — طلب" },
      {
        property: "og:description",
        content: "اختر أقرب فرع وطريقة الطلب، ثم تابع إلى القائمة.",
      },
    ],
  }),
  component: BranchPicker,
});

function BranchPicker() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [openBranch, setOpenBranch] = useState<string | null>(null);

  const { data: brand } = useQuery(brandQuery);
  const {
    data: branches,
    isLoading,
    isError,
  } = useQuery(branchesQuery);

  useEffect(() => {
    applyBrandTheme(brand?.theme);
  }, [brand?.theme]);

  const grouped = useMemo(() => {
    const term = search.trim();
    const list = (branches ?? []).filter((b) => {
      if (!term) return true;
      return (
        (b.name_ar ?? "").includes(term) ||
        (b.city_ar ?? "").includes(term) ||
        (b.phone ?? "").includes(term)
      );
    });

    const map = new Map<string, Branch[]>();
    for (const b of list) {
      const city = b.city_ar?.trim() || "فروع أخرى";
      const bucket = map.get(city);
      if (bucket) bucket.push(b);
      else map.set(city, [b]);
    }
    return [...map.entries()];
  }, [branches, search]);

  function choose(branch: Branch, index: number, orderType: OrderType) {
    saveSelection({
      branchId: String(branch.branch_id ?? branch.id ?? branchKey(branch, index)),
      branchNameAr: branch.name_ar,
      orderType,
    });
    navigate({ to: "/menu" });
  }

  return (
    <main className="min-h-screen bg-secondary pb-16">
      <header className="bg-background border-b border-border">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 px-5 py-8 text-center">
          {brand?.logo_url ? (
            <img
              src={brand.logo_url}
              alt={brand.name_ar ?? "شعار العلامة"}
              className="h-16 w-auto object-contain"
            />
          ) : null}
          <h1 className="text-2xl font-extrabold tracking-tight">
            {brand?.name_ar ?? "طلب"}
          </h1>
          <p className="text-sm text-muted-foreground">
            اختر الفرع الأقرب لك وطريقة استلام طلبك
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-5">
        <div className="sticky top-0 z-10 -mx-5 bg-secondary px-5 py-4">
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute inset-inline-start-0 top-1/2 ms-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث باسم الفرع أو المدينة"
              aria-label="ابحث عن فرع"
              className="h-12 w-full rounded-pill border border-border bg-background ps-10 pe-4 text-sm outline-none placeholder:text-muted-foreground focus:border-brand"
            />
          </div>
        </div>

        {!isSupabaseConnected ? (
          <Notice
            title="لم يتم ربط قاعدة البيانات بعد"
            body="اربط مشروع Talab من إعدادات المشروع ← Connectors ← Supabase، وبعدها تظهر الفروع هنا تلقائياً."
          />
        ) : isLoading ? (
          <div className="grid gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card-surface h-28 animate-pulse opacity-60" />
            ))}
          </div>
        ) : isError ? (
          <Notice
            title="تعذّر تحميل الفروع"
            body="حدث خطأ أثناء قراءة الفروع من قاعدة البيانات. حدّث الصفحة وحاول مرة أخرى."
          />
        ) : grouped.length === 0 ? (
          <Notice title="لا توجد فروع مطابقة" body="جرّب كلمة بحث أخرى." />
        ) : (
          <div className="flex flex-col gap-7">
            {grouped.map(([city, list]) => (
              <section key={city}>
                <h2 className="mb-3 text-sm font-bold text-muted-foreground">{city}</h2>
                <div className="grid gap-3">
                  {list.map((branch, index) => {
                    const key = branchKey(branch, index);
                    const busy = Boolean(branch.busy);
                    const isOpen = openBranch === key;
                    const types = branch.order_types ?? [];

                    return (
                      <article
                        key={key}
                        className={`card-surface p-4 transition-opacity ${
                          busy ? "pointer-events-none opacity-50" : ""
                        }`}
                      >
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setOpenBranch(isOpen ? null : key)}
                          className="flex w-full items-start justify-between gap-3 text-start"
                        >
                          <span className="flex flex-col gap-1">
                            <span className="flex items-center gap-2">
                              <span className="text-base font-bold">{branch.name_ar}</span>
                              {busy ? (
                                <span className="chip !bg-danger/10 font-medium text-danger">
                                  مشغول حالياً
                                </span>
                              ) : null}
                            </span>
                            <span className="text-sm text-muted-foreground">
                              {branch.city_ar}
                            </span>
                            {branch.phone ? (
                              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <Phone aria-hidden className="size-3.5" />
                                <span dir="ltr">{branch.phone}</span>
                              </span>
                            ) : null}
                          </span>
                          <span className="text-xs font-medium text-brand">
                            {isOpen ? "إخفاء" : "اختر"}
                          </span>
                        </button>

                        <div className="mt-3 flex flex-wrap gap-2">
                          {types.map((t) => (
                            <span key={t} className="chip">
                              {ORDER_TYPE_LABEL[t] ?? t}
                            </span>
                          ))}
                        </div>

                        {isOpen && !busy ? (
                          <div className="mt-4 border-t border-border pt-4">
                            <p className="mb-2 text-xs font-bold text-muted-foreground">
                              اختر طريقة الطلب
                            </p>
                            <div className="grid grid-cols-2 gap-2">
                              {types.map((t) => (
                                <button
                                  key={t}
                                  type="button"
                                  onClick={() => choose(branch, index, t)}
                                  className="flex items-center justify-center gap-1.5 rounded-pill bg-brand px-4 py-2.5 text-sm font-bold text-brand-ink"
                                >
                                  <Check aria-hidden className="size-4" />
                                  {ORDER_TYPE_LABEL[t] ?? t}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="card-surface p-6 text-center">
      <h2 className="text-base font-bold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
