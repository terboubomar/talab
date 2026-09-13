import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, FileText, RotateCcw, ShieldCheck, WalletCards } from "lucide-react";

export const Route = createFileRoute("/policies")({
  head: () => ({
    meta: [
      { title: "السياسات والشروط — طلب" },
      { name: "description", content: "سياسات استخدام المتجر والخصوصية والطلبات والمحفظة" },
    ],
  }),
  component: PoliciesPage,
});

function PoliciesPage() {
  return (
    <main className="min-h-screen bg-surface-sunk pb-12 text-ink" dir="rtl">
      <header className="border-b border-line bg-surface-raised">
        <div className="mx-auto flex max-w-[860px] items-center gap-3 px-4 py-4">
          <Link to="/menu" className="grid size-10 place-items-center rounded-full border border-line bg-surface" aria-label="العودة للقائمة">
            <ChevronLeft className="size-5 rotate-180" />
          </Link>
          <div>
            <p className="text-xs text-ink-3">مركز المعلومات</p>
            <h1 className="text-lg font-extrabold">السياسات والشروط</h1>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[860px] space-y-4 px-4 py-5">
        <PolicyCard
          icon={<ShieldCheck className="size-5" />}
          title="سياسة الخصوصية"
          intro="نستخدم بيانات العميل فقط لتشغيل تجربة الطلب والحساب والخدمات المرتبطة بها."
        >
          <p>قد تشمل البيانات المستخدمة الاسم، رقم الجوال، البريد الإلكتروني إن تم إدخاله، العناوين المحفوظة، سجل الطلبات، وبيانات المحفظة والنقاط.</p>
          <p>تُستخدم هذه البيانات لتنفيذ الطلبات، عرض سجل الحساب، تقديم الدعم، تحسين الخدمة، ومنع إساءة الاستخدام. لا ينبغي مشاركة رمز التحقق الخاص بالحساب مع أي شخص.</p>
        </PolicyCard>

        <PolicyCard
          icon={<FileText className="size-5" />}
          title="شروط الطلب والاستخدام"
          intro="إرسال الطلب يعني أن العميل راجع الفرع ونوع الطلب والمنتجات والأسعار قبل التأكيد."
        >
          <p>توفر المنتجات ومواعيد التشغيل ورسوم التوصيل والحد الأدنى للطلب قد تختلف حسب الفرع والموقع ونوع الطلب.</p>
          <p>قد يتم رفض أو إلغاء الطلب عند تعذر التنفيذ، إغلاق الفرع، عدم توفر المنتج، أو وجود مشكلة في الدفع أو بيانات التوصيل.</p>
        </PolicyCard>

        <PolicyCard
          icon={<RotateCcw className="size-5" />}
          title="الإلغاء والاسترداد"
          intro="تعتمد إمكانية الإلغاء أو الاسترداد على حالة الطلب وطريقة الدفع وحالة تنفيذ الطلب."
        >
          <p>عند قبول الاسترداد لعملية دفع إلكترونية، قد يحتاج ظهور المبلغ في وسيلة الدفع إلى مدة تختلف حسب مزود الدفع أو البنك.</p>
          <p>المبالغ أو النقاط أو أرصدة المحفظة التي تم حجزها للطلب يتم التعامل معها وفق حالة الطلب وسجل المعاملة في النظام.</p>
        </PolicyCard>

        <PolicyCard
          icon={<WalletCards className="size-5" />}
          title="المحفظة والنقاط"
          intro="المحفظة والنقاط مرتبطة بحساب العميل الموثق ولا يمكن الوصول إليها بمجرد معرفة رقم الجوال."
        >
          <p>قد تخضع النقاط لفترة صلاحية أو قواعد اكتساب واستبدال بحسب إعدادات المطعم. يعرض الحساب الرصيد الحالي وسجل الحركات المتاح.</p>
          <p>عند استخدام رصيد أو نقاط أثناء الطلب قد يتم حجز القيمة مؤقتاً حتى يكتمل الطلب أو يُلغى.</p>
        </PolicyCard>

        <div className="rounded-card border border-line bg-surface-raised p-4 text-xs leading-6 text-ink-3">
          <strong className="block text-ink">ملاحظة</strong>
          هذه الصفحة تمثل سياسة تشغيلية أساسية للمتجر داخل TALAB. يمكن تخصيص الصياغة النهائية لكل مطعم أو مجموعة قبل الإطلاق التجاري بما يتوافق مع نشاطه ومتطلباته القانونية.
        </div>

        <div className="flex flex-wrap gap-2">
          <Link to="/account" className="rounded-card bg-brand px-4 py-2.5 text-xs font-extrabold text-brand-ink">العودة إلى حسابي</Link>
          <Link to="/menu" className="rounded-card border border-line bg-surface-raised px-4 py-2.5 text-xs font-bold">العودة للقائمة</Link>
        </div>
      </div>
    </main>
  );
}

function PolicyCard({ icon, title, intro, children }: { icon: React.ReactNode; title: string; intro: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-card border border-line bg-surface-raised">
      <div className="flex items-start gap-3 border-b border-line p-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand/10 text-brand">{icon}</span>
        <div>
          <h2 className="text-sm font-extrabold">{title}</h2>
          <p className="mt-1 text-xs leading-5 text-ink-3">{intro}</p>
        </div>
      </div>
      <div className="space-y-3 p-4 text-xs leading-6 text-ink-2">{children}</div>
    </section>
  );
}
