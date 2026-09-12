import { createFileRoute, Link } from "@tanstack/react-router";

import { usePermissions } from "@/lib/permissions";

export const Route = createFileRoute("/_staffShell/admin/marketing-tools")({
  head: () => ({ meta: [{ title: "أدوات التسويق — طلب" }] }),
  component: MarketingToolsPage,
});

type MarketingTool = {
  id: string;
  title: string;
  description: string;
  group: string;
  implemented: boolean;
  to?: string;
  perm?: string;
};

const GROUPS: string[] = [
  "العروض والتخفيضات",
  "الولاء والتحفيز",
  "المنتجات والعروض الخاصة",
  "التواصل مع العملاء",
  "أدوات الواجهة",
];

const TOOLS: MarketingTool[] = [
  {
    id: "coupon-discounts",
    title: "كوبونات الخصومات",
    description: "خصومات بنسبة أو قيمة ثابتة مع نطاقات، حدود استخدام، وتطبيق تلقائي.",
    group: "العروض والتخفيضات",
    implemented: true,
    to: "/admin/coupons",
    perm: "coupons.view",
  },
  {
    id: "points-coupons",
    title: "كوبونات النقاط",
    description: "كوبونات يمكن استبدال النقاط بها عند الطلب.",
    group: "العروض والتخفيضات",
    implemented: false,
  },
  {
    id: "promo-code",
    title: "إعدادات الرمز الترويجي",
    description: "رمز ترويجي عام يُطبق تلقائياً على الطلبات المؤهلة.",
    group: "العروض والتخفيضات",
    implemented: false,
  },
  {
    id: "loyalty-settings",
    title: "إعدادات نقاط الولاء",
    description: "معدل كسب النقاط، قيمة الاستبدال، الحد الأدنى، وصلاحية النقاط.",
    group: "الولاء والتحفيز",
    implemented: true,
    to: "/admin/loyalty",
    perm: "marketing.loyalty",
  },
  {
    id: "rewards",
    title: "المكافآت",
    description: "مكافآت مخصصة للعملاء بناءً على سلوكهم وتفضيلاتهم.",
    group: "الولاء والتحفيز",
    implemented: false,
  },
  {
    id: "cashback-settings",
    title: "إعدادات الكاش باك",
    description: "إرجاع نسبة من قيمة الطلب كرصيد في المحفظة.",
    group: "الولاء والتحفيز",
    implemented: false,
  },
  {
    id: "bundles",
    title: "الباقات",
    description: "تجميع منتجات متعددة في عرض بسعر أو خصم خاص.",
    group: "المنتجات والعروض الخاصة",
    implemented: false,
  },
  {
    id: "gift-cards",
    title: "بطاقات الهدايا",
    description: "بيع واسترداد بطاقات هدايا رقمية.",
    group: "المنتجات والعروض الخاصة",
    implemented: false,
  },
  {
    id: "send-as-gift",
    title: "إرسال الطلب كهدية",
    description: "تمكين العميل من إرسال الطلب مع رسالة هدية.",
    group: "المنتجات والعروض الخاصة",
    implemented: false,
  },
  {
    id: "app-push",
    title: "إرسال تنبيه للتطبيق",
    description: "إرسال إشعارات فورية للعملاء عبر التطبيق.",
    group: "التواصل مع العملاء",
    implemented: false,
  },
  {
    id: "sms",
    title: "إرسال SMS",
    description: "إرسال رسائل نصية قصيرة للحملات والتنبيهات.",
    group: "التواصل مع العملاء",
    implemented: false,
  },
  {
    id: "banners",
    title: "البنرات الاعلانية",
    description: "إدارة البنرات الظاهرة في واجهة المتجر.",
    group: "أدوات الواجهة",
    implemented: false,
  },
  {
    id: "announcement-bar",
    title: "شريط الرسائل",
    description: "شريط إعلاني علوي في المتجر للأخبار والعروض.",
    group: "أدوات الواجهة",
    implemented: false,
  },
  {
    id: "whatsapp-button",
    title: "زر واتساب",
    description: "زر تواصل عبر واتساب في واجهة المتجر.",
    group: "أدوات الواجهة",
    implemented: false,
  },
];

function MarketingToolsPage() {
  const { loading, can } = usePermissions();

  const hasAccess =
    can("marketing.tools") || can("coupons.view") || can("marketing.loyalty");

  if (loading) {
    return (
      <div className="p-6">
        <div className="card-surface h-28 animate-pulse opacity-60" />
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <main className="p-6">
        <div className="card-surface p-6 text-center text-sm font-bold text-danger">
          لا تملك صلاحية الوصول إلى أدوات التسويق
        </div>
      </main>
    );
  }

  const implementedCount = TOOLS.filter((t) => t.implemented).length;
  const plannedCount = TOOLS.filter((t) => !t.implemented).length;

  return (
    <main className="min-h-screen pb-12">
      <header className="border-b border-border bg-background px-5 py-5">
        <h1 className="text-lg font-extrabold">أدوات التسويق</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          مركز إدارة العروض، برامج الولاء، التواصل مع العملاء، وتسويق الواجهة.
        </p>
      </header>

      <div className="space-y-8 px-5 py-6">
        <section className="card-surface flex flex-wrap items-center gap-4 p-4">
          <div className="flex-1">
            <p className="text-sm font-extrabold">حالة أدوات التسويق</p>
            <p className="text-xs text-muted-foreground">
              الأدوات المتاحة حالياً تعتمد على صلاحياتك.
            </p>
          </div>
          <div className="flex gap-3 text-center">
            <div className="rounded-card bg-success/10 px-4 py-2">
              <p className="text-lg font-extrabold text-success">{implementedCount}</p>
              <p className="text-[10px] font-bold text-success">متاح</p>
            </div>
            <div className="rounded-card bg-secondary px-4 py-2">
              <p className="text-lg font-extrabold text-muted-foreground">{plannedCount}</p>
              <p className="text-[10px] font-bold text-muted-foreground">قريباً</p>
            </div>
          </div>
        </section>

        {GROUPS.map((group) => {
          const items = TOOLS.filter((t) => t.group === group);
          if (items.length === 0) return null;
          return (
            <section key={group}>
              <h2 className="mb-3 text-sm font-extrabold">{group}</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((tool) => (
                  <ToolCard key={tool.id} tool={tool} can={can} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}

function ToolCard({
  tool,
  can,
}: {
  tool: MarketingTool;
  can: (key: string) => boolean;
}) {
  const permitted = tool.perm ? can(tool.perm) : false;

  if (!tool.implemented) {
    return (
      <div className="card-surface flex flex-col justify-between gap-3 p-4 opacity-70">
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold">{tool.title}</h3>
            <span className="rounded-pill bg-secondary px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
              قريباً
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{tool.description}</p>
        </div>
      </div>
    );
  }

  if (!permitted) {
    return (
      <div className="card-surface flex flex-col justify-between gap-3 p-4 opacity-70">
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold">{tool.title}</h3>
            <span className="rounded-pill bg-success/10 px-2 py-0.5 text-[10px] font-bold text-success">
              متاح
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{tool.description}</p>
        </div>
        <p className="text-[11px] font-bold text-danger">لا تملك الصلاحية</p>
      </div>
    );
  }

  return (
    <Link
      to={tool.to!}
      className="card-surface flex flex-col justify-between gap-3 p-4 transition-colors hover:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold">{tool.title}</h3>
          <span className="rounded-pill bg-success/10 px-2 py-0.5 text-[10px] font-bold text-success">
            متاح
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{tool.description}</p>
      </div>
      <p className="text-[11px] font-bold text-brand">فتح الأداة</p>
    </Link>
  );
}
