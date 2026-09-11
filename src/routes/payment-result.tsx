import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

import { clearCart } from "@/lib/cart";
import { resetCouponCartId } from "@/lib/coupons";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/payment-result")({
  head: () => ({ meta: [{ title: "نتيجة الدفع — طلب" }] }),
  component: PaymentResultPage,
});

type VerifyResult = {
  ok?: boolean;
  orderId?: string;
  paymentId?: string;
  paymentStatus?: string;
  paid?: boolean;
  error?: string;
};

function PaymentResultPage() {
  const [state, setState] = useState<"checking" | "paid" | "failed" | "pending">("checking");
  const [orderId, setOrderId] = useState<string | null>(null);
  const [message, setMessage] = useState("جارٍ التحقق من عملية الدفع مع ميسر...");

  useEffect(() => {
    let active = true;

    async function verify() {
      if (!supabase || typeof window === "undefined") {
        if (active) {
          setState("failed");
          setMessage("تعذّر الاتصال بخدمة التحقق من الدفع.");
        }
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const paymentId = params.get("id");
      const requestedOrderId = params.get("order");
      const accountId = params.get("account");
      setOrderId(requestedOrderId);

      if (!paymentId || !requestedOrderId || !accountId) {
        setState("failed");
        setMessage("بيانات الرجوع من بوابة الدفع غير مكتملة.");
        return;
      }

      const { data, error } = await supabase.functions.invoke<VerifyResult>("moyasar-verify", {
        body: { paymentId, orderId: requestedOrderId, accountId },
      });

      if (!active) return;
      if (error || !data?.ok) {
        setState("failed");
        setMessage("لم نتمكن من تأكيد الدفع. لم يتم اعتبار الطلب مدفوعاً.");
        return;
      }

      if (data.paid) {
        clearCart();
        resetCouponCartId();
        try {
          sessionStorage.removeItem("talab.pendingPayment");
        } catch {
          /* storage unavailable */
        }
        setState("paid");
        setMessage("تم تأكيد الدفع بنجاح وتم إرسال الطلب للمطعم.");
        return;
      }

      if (data.paymentStatus === "failed" || data.paymentStatus === "voided") {
        setState("failed");
        setMessage("لم تكتمل عملية الدفع. يمكنك العودة إلى السلة والمحاولة مرة أخرى.");
        return;
      }

      setState("pending");
      setMessage("عملية الدفع ما زالت قيد التحقق. لن يظهر الطلب للمطبخ قبل تأكيد الدفع.");
    }

    void verify();
    return () => { active = false; };
  }, []);

  const icon = state === "checking"
    ? <Loader2 aria-hidden className="mx-auto size-12 animate-spin text-brand" />
    : state === "paid"
      ? <CheckCircle2 aria-hidden className="mx-auto size-12 text-success" />
      : <XCircle aria-hidden className="mx-auto size-12 text-danger" />;

  return (
    <main className="flex min-h-screen items-center justify-center bg-secondary px-5">
      <div className="card-surface w-full max-w-sm p-8 text-center">
        {icon}
        <h1 className="mt-4 text-lg font-extrabold">
          {state === "checking" ? "التحقق من الدفع" : state === "paid" ? "تم الدفع" : state === "pending" ? "الدفع قيد التحقق" : "لم يتم تأكيد الدفع"}
        </h1>
        <p className="mt-2 text-sm leading-7 text-muted-foreground">{message}</p>
        {orderId ? <p className="mt-3 text-xs text-muted-foreground">رقم الطلب <span dir="ltr" className="font-bold text-foreground">#{orderId.slice(0, 8)}</span></p> : null}
        {state !== "checking" ? (
          <div className="mt-6 grid gap-2">
            {state !== "paid" ? <Link to="/checkout" className="rounded-pill border border-border px-5 py-3 text-sm font-bold">العودة للدفع</Link> : null}
            <Link to="/" className="rounded-pill bg-brand px-5 py-3 text-sm font-bold text-brand-ink">العودة للرئيسية</Link>
          </div>
        ) : null}
      </div>
    </main>
  );
}
