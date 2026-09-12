import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, MapPin, Phone, Search, ShoppingBag } from "lucide-react";

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
      { title: "اطلب الآن — طلب" },
      {
        name: "description",
        content: "اختر الفرع وطريقة الطلب وابدأ طلبك مباشرة من القائمة.",
      },
      { property: "og:title", content: "اطلب الآن — طلب" },
      { property: "og:description", content: "اختر أقرب فرع وطريقة الطلب ثم تصفّح القائمة." },
    ],
  }),
  component: BranchPicker,
});

function BranchPicker() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [openBranch, setOpenBranch] = useState<string | null>(null);

  const { data: brand } = useQuery(brandQuery);
  const { data: branches, isLoading, isError } = useQuery(branchesQuery);

  useEffect(() => {
    applyBrandTheme(brand?.theme);
  }, [brand?.theme]);

  const grouped = useMemo(() => {
    const term = search.trim();
    const list = (branches ?? []).filter((branch) => {
      if (!term) return true;
      return [branch.name_ar, branch.city_ar, branch.phone].filter(Boolean).some((value) => String(value).includes(term));
    });

    const map = new Map<string, Branch[]>();
    for (const branch of list) {
      const city = branch.city_ar?.trim() || "فروع أخرى";
      const bucket = map.get(city);
      if (bucket) bucket.push(branch);
      else map.set(city, [branch]);
    }
    return [...map.entries()];
  }, [branches, search]);

  function choose(branch: Branch, index: number, orderType: OrderType) {
    saveSelection({
      branchId: String(branch.branch_id ?? branch.id ?? branchKey(branch, index)),
      branchNameAr: branch.name_ar,
      orderType,
    });
    navigate({ to: orderType === "delivery" ? "/delivery-address" : "/menu" });
  }

  return (
    <main className="min-h-screen bg-secondary pb-20" dir="rtl">
      <section className="relative overflow-hidden border-b border-border bg-background">
        <div className="pointer-events-none absolute inset-0 opacity-70" aria-hidden>
          <div className="absolute -start-24 -top-24 size-72 rounded-full bg-brand/10 blur-3xl" />
          <div className="absolute -end-24 top-20 size-64 rounded-full bg-brand/5 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-5xl px-5 pb-10 pt-7 sm:pt-10">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              {brand?.logo_url ? (
                <div className="grid size-16 shrink-0 place-items-center rounded-2xl border border-border bg-background p-2 shadow-sm sm:size-20">
                  <img src={brand.logo_url} alt={brand.name_ar ?? "شعار العلامة"} className="max-h-full max-w-full object-contain" />
                </div>
              ) : (
                <div className="grid size-16 shrink-0 place-items-center rounded-2xl bg-brand text-brand-ink sm:size-20">
                  <ShoppingBag className="size-7" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs font-bold text-brand">اطلب مباشرة</p>
                <h1 className="mt-1 truncate text-2xl font-black tracking-tight sm:text-3xl">{brand?.name_ar ?? "طلب"}</h1>
                <p className="mt-1 text-sm text-muted-foreground">اختر فرعك وطريقة الطلب وابدأ من القائمة.</p>
              </div>
            </div>
          </div>

          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            <Benefit icon={<MapPin className="size-4" />} title="اختر أقرب فرع" body="الفروع مرتبة حسب المدينة" />
            <Benefit icon={<ShoppingBag className="size-4" />} title="اختر طريقة الطلب" body="توصيل، استلام، سيارة أو محلي" />
            <Benefit icon={<Check className="size-4" />} title="اطلب مباشرة" body="الأسعار تشمل الضريبة" />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-5xl px-5">
        <div className="sticky top-0 z-20 -mx-5 border-b border-border/60 bg-secondary/95 px-5 py-4 backdrop-blur">
          <div className="mx-auto max-w-3xl">
            <div className="relative">
              <Search className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="ابحث باسم الفرع أو المدينة..."
                aria-label="ابحث عن فرع"
                className="h-13 w-full rounded-2xl border border-border bg-background pe-4 ps-11 text-sm font-medium shadow-sm outline-none placeholder:text-muted-foreground focus:border-brand"
              />
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-3xl pt-6">
          {!isSupabaseConnected ? (
            <Notice title="لم يتم ربط قاعدة البيانات بعد" body="اربط مشروع Talab من إعدادات المشروع، وستظهر الفروع هنا تلقائياً." />
          ) : isLoading ? (
            <div className="grid gap-3">{[0, 1, 2].map((i) => <div key={i} className="card-surface h-36 animate-pulse opacity-60" />)}</div>
          ) : isError ? (
            <Notice title="تعذّر تحميل الفروع" body="حدث خطأ أثناء قراءة الفروع. حدّث الصفحة وحاول مرة أخرى." />
          ) : grouped.length === 0 ? (
            <Notice title="لا توجد فروع مطابقة" body="جرّب اسم فرع أو مدينة أخرى." />
          ) : (
            <div className="space-y-8">
              {grouped.map(([city, list]) => (
                <section key={city}>
                  <div className="mb-3 flex items-center gap-2">
                    <MapPin className="size-4 text-brand" />
                    <h2 className="text-sm font-extrabold">{city}</h2>
                    <span className="text-xs text-muted-foreground">{list.length} فرع</span>
                  </div>

                  <div className="grid gap-3">
                    {list.map((branch, index) => {
                      const key = branchKey(branch, index);
                      const busy = Boolean(branch.busy);
                      const isOpen = openBranch === key;
                      const types = branch.order_types ?? [];

                      return (
                        <article key={key} className={`overflow-hidden rounded-2xl border bg-background shadow-sm transition ${busy ? "opacity-55" : "hover:border-brand/35 hover:shadow-md"}`}>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setOpenBranch(isOpen ? null : key)}
                            className="flex w-full items-start justify-between gap-4 p-4 text-start sm:p-5"
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-base font-extrabold">{branch.name_ar}</h3>
                                {busy ? <span className="rounded-pill bg-danger/10 px-2 py-1 text-[10px] font-bold text-danger">مشغول حالياً</span> : <span className="rounded-pill bg-success/10 px-2 py-1 text-[10px] font-bold text-success">متاح للطلب</span>}
                              </div>
                              <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><MapPin className="size-3.5" /> {branch.city_ar}</p>
                              {branch.phone ? <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground"><Phone className="size-3.5" /><span dir="ltr">{branch.phone}</span></p> : null}
                            </div>
                            {!busy ? <span className={`grid size-9 shrink-0 place-items-center rounded-full bg-secondary transition ${isOpen ? "rotate-180" : ""}`}><ChevronDown className="size-4" /></span> : null}
                          </button>

                          <div className="flex flex-wrap gap-2 px-4 pb-4 sm:px-5">
                            {types.map((type) => <span key={type} className="rounded-pill border border-border bg-secondary/70 px-2.5 py-1 text-[11px] font-bold text-muted-foreground">{ORDER_TYPE_LABEL[type] ?? type}</span>)}
                          </div>

                          {isOpen && !busy ? (
                            <div className="border-t border-border bg-secondary/50 p-4 sm:p-5">
                              <p className="mb-3 text-xs font-extrabold">كيف حاب تستلم طلبك؟</p>
                              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                {types.map((type) => (
                                  <button key={type} type="button" onClick={() => choose(branch, index, type)} className="rounded-xl bg-brand px-3 py-3 text-sm font-extrabold text-brand-ink shadow-sm transition hover:brightness-95">
                                    {ORDER_TYPE_LABEL[type] ?? type}
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
      </div>
    </main>
  );
}

function Benefit({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-border bg-background/80 p-3 shadow-sm backdrop-blur">
      <div className="flex items-center gap-2 text-sm font-extrabold"><span className="grid size-8 place-items-center rounded-full bg-brand/10 text-brand">{icon}</span>{title}</div>
      <p className="mt-1 pe-10 text-xs text-muted-foreground">{body}</p>
    </div>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return <div className="rounded-2xl border border-border bg-background p-8 text-center shadow-sm"><h2 className="text-base font-extrabold">{title}</h2><p className="mt-2 text-sm text-muted-foreground">{body}</p></div>;
}
