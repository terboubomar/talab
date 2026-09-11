import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Minus, Plus, Trash2, ImageOff, CheckCircle2, Banknote, CreditCard, TicketPercent } from "lucide-react";

import {
  fetchStorefrontPaymentOption,
  readSelection,
  submitOrder,
  type CheckoutPaymentMethod,
  type PlaceOrderItem,
  type Selection,
  type StorefrontPaymentOption,
} from "@/lib/storefront";
import { readCart, saveCart, clearCart } from "@/lib/cart";
import { cartCount, cartTotal, formatSAR, lineTotal, type CartLine } from "@/lib/menu";
import { saveAddress } from "@/lib/delivery";
import { supabase } from "@/lib/supabase";
import { getCouponCartId, quoteCoupon, resetCouponCartId, type CouponQuote } from "@/lib/coupons";
import { MoyasarPaymentForm } from "@/components/moyasar-payment-form";

export const Route = createFileRoute("/checkout")({
  head: () => ({ meta: [{ title: "السلة والدفع — طلب" }] }),
  component: CheckoutPage,
});

function CheckoutPage() {
  const navigate = useNavigate();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const savedSelection = readSelection();
    if (!savedSelection?.branchId) {
      navigate({ to: "/", replace: true });
      return;
    }
    const savedCart = readCart();
    if (savedCart.length === 0) {
      navigate({ to: "/menu", replace: true });
      return;
    }
    setSelection(savedSelection);
    setCart(savedCart);
    setReady(true);
  }, [navigate]);

  useEffect(() => {
    if (ready) saveCart(cart);
  }, [cart, ready]);

  if (!ready || !selection) {
    return (
      <main className="min-h-screen bg-secondary px-5 py-10">
        <div className="mx-auto grid max-w-2xl gap-3">
          {[0, 1, 2].map((i) => <div key={i} className="card-surface h-24 animate-pulse opacity-60" />)}
        </div>
      </main>
    );
  }

  return <CheckoutContent selection={selection} cart={cart} setCart={setCart} />;
}

function couponMessage(message: string) {
  if (message.includes("coupon_not_found")) return "رمز الكوبون غير صحيح";
  if (message.includes("coupon_inactive") || message.includes("coupon_not_started") || message.includes("coupon_expired") || message.includes("coupon_outside_schedule")) return "هذا الكوبون غير متاح حالياً";
  if (message.includes("coupon_min_purchase")) return "قيمة السلة أقل من الحد الأدنى لهذا الكوبون";
  if (message.includes("coupon_scope_mismatch")) return "هذا الكوبون لا ينطبق على هذا الطلب";
  if (message.includes("coupon_total_limit")) return "تم الوصول إلى الحد الأقصى لاستخدام هذا الكوبون";
  if (message.includes("coupon_customer_limit")) return "لقد استخدمت هذا الكوبون بالحد المسموح";
  if (message.includes("coupon_reservation")) return "انتهى حجز الكوبون. أعد تطبيقه وحاول مرة أخرى";
  return "تعذّر تطبيق الكوبون، حاول مرة أخرى";
}

function CheckoutContent({ selection, cart, setCart }: {
  selection: Selection;
  cart: CartLine[];
  setCart: React.Dispatch<React.SetStateAction<CartLine[]>>;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<CheckoutPaymentMethod>("cash");
  const [paymentOption, setPaymentOption] = useState<StorefrontPaymentOption | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(true);
  const [couponCartId, setCouponCartId] = useState<string | null>(null);
  const [couponCode, setCouponCode] = useState("");
  const [couponQuote, setCouponQuote] = useState<CouponQuote | null>(null);
  const [couponApplying, setCouponApplying] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    orderId: string;
    total: number;
    paymentMethod: CheckoutPaymentMethod;
    paymentOption: StorefrontPaymentOption | null;
  } | null>(null);

  useEffect(() => {
    setCouponCartId(getCouponCartId());
  }, []);

  useEffect(() => {
    if (selection.delivery?.phone) setPhone(selection.delivery.phone);
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      const user = data.user;
      if (!user) return;
      const meta = user.user_metadata as Record<string, unknown> | null;
      if (typeof meta?.["name"] === "string") setName(meta["name"] as string);
      if (typeof meta?.["phone"] === "string") setPhone(meta["phone"] as string);
      else if (user.phone) setPhone(user.phone);
    });
  }, [selection.delivery?.phone]);

  useEffect(() => {
    let active = true;
    setPaymentLoading(true);
    fetchStorefrontPaymentOption(selection.branchId)
      .then((option) => {
        if (!active) return;
        setPaymentOption(option);
        if (!option) setPaymentMethod("cash");
      })
      .finally(() => { if (active) setPaymentLoading(false); });
    return () => { active = false; };
  }, [selection.branchId]);

  const estimatedDeliveryFee = useMemo(() => {
    if (!selection.delivery) return 0;
    const { fee, belowMinFee, minOrder } = selection.delivery;
    return cartTotal(cart) >= minOrder ? fee : belowMinFee;
  }, [selection.delivery, cart]);

  const orderItems = useMemo<PlaceOrderItem[]>(() => cart.map((line) => ({
    product_id: line.productId,
    qty: line.quantity,
    modifier_ids: line.modifierIds,
    ...(line.note ? { note: line.note } : {}),
  })), [cart]);

  const count = cartCount(cart);
  const subtotal = cartTotal(cart);
  const displayedTotal = couponQuote?.total ?? subtotal + estimatedDeliveryFee;

  const canSubmit = useMemo(() =>
    name.trim().length > 0 && phone.trim().length >= 9 && cart.length > 0 && !submitting &&
    (paymentMethod === "cash" || Boolean(paymentOption)),
  [name, phone, cart, submitting, paymentMethod, paymentOption]);

  function invalidateCoupon() {
    if (couponQuote) {
      setCouponQuote(null);
      setCouponError("تم تعديل السلة. أعد تطبيق الكوبون لتحديث الخصم.");
    }
  }

  function updateQty(key: string, delta: number) {
    invalidateCoupon();
    setCart((prev) => prev.map((line) => line.key === key ? { ...line, quantity: Math.max(1, line.quantity + delta) } : line).filter((line) => line.quantity > 0));
  }

  function removeLine(key: string) {
    invalidateCoupon();
    setCart((prev) => prev.filter((line) => line.key !== key));
  }

  async function applyCoupon() {
    if (!couponCartId || !couponCode.trim()) return;
    if (phone.trim().length < 9) {
      setCouponError("أدخل رقم الجوال أولاً لتطبيق الكوبون");
      return;
    }
    setCouponApplying(true);
    setCouponError(null);
    try {
      const quote = await quoteCoupon({
        branchId: selection.branchId,
        orderType: selection.orderType,
        customerPhone: phone.trim(),
        code: couponCode.trim(),
        items: orderItems,
        cartId: couponCartId,
        areaId: selection.delivery?.areaId,
      });
      setCouponCode(quote.code);
      setCouponQuote(quote);
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      setCouponQuote(null);
      setCouponError(couponMessage(message));
    } finally {
      setCouponApplying(false);
    }
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const d = selection.delivery;
      let refreshedCoupon = couponQuote;
      if (couponQuote && couponCode.trim() && couponCartId) {
        try {
          refreshedCoupon = await quoteCoupon({
            branchId: selection.branchId,
            orderType: selection.orderType,
            customerPhone: phone.trim(),
            code: couponCode.trim(),
            items: orderItems,
            cartId: couponCartId,
            areaId: d?.areaId,
          });
          setCouponQuote(refreshedCoupon);
        } catch (e) {
          const message = e instanceof Error ? e.message : "";
          setCouponQuote(null);
          setCouponError(couponMessage(message));
          throw new Error("coupon_refresh_failed");
        }
      }

      const { order_id, total } = await submitOrder({
        branchId: selection.branchId,
        orderType: selection.orderType,
        customerName: name.trim(),
        customerPhone: phone.trim(),
        notes: notes.trim() || null,
        paymentMethod,
        couponReservationId: refreshedCoupon?.reservation_id ?? null,
        items: orderItems,
        ...(d ? {
          areaId: d.areaId, lat: d.lat, lng: d.lng,
          addressText: [d.street, d.unitNo && `مبنى ${d.unitNo}`, d.floor && `طابق ${d.floor}`, d.apartment && `شقة ${d.apartment}`].filter(Boolean).join("، "),
        } : {}),
      });

      if (paymentMethod === "cash") {
        clearCart();
        resetCouponCartId();
      }
      if (d?.saveForNextTime) {
        saveAddress({ customerName: name.trim(), customerPhone: phone.trim(), areaId: d.areaId, lat: d.lat, lng: d.lng, street: d.street, unitNo: d.unitNo, floor: d.floor, apartment: d.apartment, notes: d.notes, label: d.label }).catch(() => {});
      }

      setResult({ orderId: order_id, total, paymentMethod, paymentOption: paymentMethod === "online" ? paymentOption : null });
    } catch (e) {
      const message = e instanceof Error ? e.message : "حدث خطأ غير متوقع";
      if (message === "coupon_refresh_failed") return;
      setError(
        message.includes("order_type_not_available") ? "طريقة الطلب هذه غير متاحة لهذا الفرع حالياً" :
        message.includes("invalid_product") ? "أحد الأصناف لم يعد متوفراً، الرجاء مراجعة السلة" :
        message.includes("qty_below_minimum") || message.includes("qty_above_maximum") ? "الكمية المطلوبة لأحد الأصناف غير صحيحة" :
        message.includes("missing_delivery_area") || message.includes("invalid_delivery_area") ? "الرجاء اختيار عنوان توصيل صالح" :
        message.includes("online_payment_not_available") ? "الدفع الإلكتروني غير متاح لهذا الفرع حالياً. اختر الدفع عند الاستلام." :
        message.includes("coupon_") ? couponMessage(message) : "تعذّر إتمام الطلب، حاول مرة أخرى",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (result?.paymentMethod === "online" && result.paymentOption) {
    return (
      <main className="flex min-h-screen justify-center bg-secondary px-5 py-10">
        <div className="w-full max-w-lg">
          <div className="card-surface mb-4 p-5 text-center">
            <p className="text-xs font-bold text-muted-foreground">رقم الطلب</p>
            <p dir="ltr" className="mt-1 text-lg font-extrabold">#{result.orderId.slice(0, 8)}</p>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">أكمل الدفع أدناه. الطلب الإلكتروني لن ينتقل إلى المطبخ قبل تأكيد ميسر على الخادم.</p>
          </div>
          <div className="card-surface p-5">
            <MoyasarPaymentForm orderId={result.orderId} total={result.total} branchName={selection.branchNameAr} option={result.paymentOption} />
          </div>
        </div>
      </main>
    );
  }

  if (result) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-secondary px-5">
        <div className="card-surface w-full max-w-sm p-8 text-center">
          <CheckCircle2 aria-hidden className="mx-auto size-12 text-brand" />
          <h1 className="mt-4 text-lg font-extrabold">تم استلام طلبك</h1>
          <p className="mt-2 text-sm text-muted-foreground">رقم الطلب <span dir="ltr" className="font-bold text-foreground">#{result.orderId.slice(0, 8)}</span></p>
          <p className="mt-1 text-2xl font-extrabold text-brand">{formatSAR(result.total)}</p>
          <p className="mt-2 text-xs text-muted-foreground">طريقة الدفع: الدفع عند الاستلام</p>
          <Link to="/" className="mt-6 inline-block w-full rounded-pill bg-brand px-5 py-3 text-sm font-bold text-brand-ink">العودة للرئيسية</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-secondary pb-32">
      <header className="sticky top-0 z-30 border-b border-border bg-background px-5 py-4">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <h1 className="text-base font-extrabold">السلة والدفع</h1>
          <Link to="/menu" className="text-sm font-bold text-brand">متابعة التسوق</Link>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-5 py-6">
        <section className="card-surface divide-y divide-border">
          {cart.map((line) => (
            <div key={line.key} className="flex gap-3 p-4">
              <span className="relative block size-16 shrink-0 overflow-hidden rounded-card bg-secondary">
                {line.image ? <img src={line.image} alt={line.nameAr} className="size-full object-cover" /> : <span className="flex size-full items-center justify-center text-muted-foreground"><ImageOff aria-hidden className="size-5" /></span>}
              </span>
              <div className="flex flex-1 flex-col gap-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-bold">{line.nameAr}</span>
                  <button type="button" aria-label="حذف من السلة" onClick={() => removeLine(line.key)} className="text-muted-foreground"><Trash2 aria-hidden className="size-4" /></button>
                </div>
                {line.optionNames.length > 0 ? <span className="text-xs text-muted-foreground">{line.optionNames.join("، ")}</span> : null}
                {line.note ? <span className="text-xs text-muted-foreground">ملاحظة: {line.note}</span> : null}
                <div className="mt-1 flex items-center justify-between">
                  <div className="flex items-center gap-3 rounded-pill border border-border px-2 py-1">
                    <button type="button" aria-label="تقليل" onClick={() => updateQty(line.key, -1)} className="grid size-6 place-items-center"><Minus aria-hidden className="size-3.5" /></button>
                    <span className="min-w-4 text-center text-xs font-bold" dir="ltr">{line.quantity}</span>
                    <button type="button" aria-label="زيادة" onClick={() => updateQty(line.key, 1)} className="grid size-6 place-items-center"><Plus aria-hidden className="size-3.5" /></button>
                  </div>
                  <span className="text-sm font-bold text-brand">{formatSAR(lineTotal(line))}</span>
                </div>
              </div>
            </div>
          ))}
        </section>

        <section className="card-surface mt-4 p-4">
          <label htmlFor="order-notes" className="text-sm font-bold">ملاحظات على الطلب</label>
          <textarea id="order-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="مثال: اترك الطلب عند الاستقبال" className="mt-2 w-full rounded-card border border-border bg-background px-4 py-3 text-sm outline-none placeholder:text-muted-foreground focus:border-brand" />
        </section>

        <section className="card-surface mt-4 p-4">
          <h2 className="text-sm font-bold">بيانات التواصل</h2>
          <div className="mt-3 grid gap-3">
            <div><label htmlFor="customer-name" className="text-xs font-bold text-muted-foreground">الاسم</label><input id="customer-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="الاسم الكامل" className="mt-1 w-full rounded-card border border-border bg-background px-4 py-3 text-sm outline-none placeholder:text-muted-foreground focus:border-brand" /></div>
            <div><label htmlFor="customer-phone" className="text-xs font-bold text-muted-foreground">رقم الجوال</label><input id="customer-phone" dir="ltr" value={phone} onChange={(e) => { setPhone(e.target.value); if (couponQuote) setCouponQuote(null); }} placeholder="05xxxxxxxx" className="mt-1 w-full rounded-card border border-border bg-background px-4 py-3 text-end text-sm outline-none placeholder:text-muted-foreground focus:border-brand" /></div>
          </div>
        </section>

        {selection.delivery ? (
          <section className="card-surface mt-4 p-4">
            <div className="flex items-center justify-between text-sm"><span className="font-bold">التوصيل إلى {selection.delivery.areaNameAr}</span></div>
            <p className="mt-1 text-xs text-muted-foreground">{selection.delivery.street}{selection.delivery.unitNo ? `، مبنى ${selection.delivery.unitNo}` : ""}{selection.delivery.apartment ? `، شقة ${selection.delivery.apartment}` : ""}</p>
          </section>
        ) : null}

        <section className="card-surface mt-4 p-4">
          <div className="flex items-center gap-2"><TicketPercent aria-hidden className="size-4 text-brand" /><h2 className="text-sm font-extrabold">كوبون خصم</h2></div>
          <div className="mt-3 flex gap-2">
            <input value={couponCode} onChange={(e) => { setCouponCode(e.target.value.toUpperCase()); setCouponQuote(null); setCouponError(null); }} dir="ltr" placeholder="CODE" className="min-w-0 flex-1 rounded-card border border-border bg-background px-4 py-2.5 text-sm font-bold uppercase outline-none focus:border-brand" />
            <button type="button" disabled={couponApplying || !couponCode.trim() || !couponCartId} onClick={applyCoupon} className="rounded-pill border border-brand px-4 py-2.5 text-sm font-bold text-brand disabled:opacity-50">{couponApplying ? "جارٍ..." : "تطبيق"}</button>
          </div>
          {couponQuote ? (
            <div className="mt-3 rounded-card border border-success/30 bg-success/10 p-3 text-xs text-success">
              <p className="font-extrabold">{couponQuote.success_msg_ar || `تم تطبيق ${couponQuote.code}`}</p>
              <p className="mt-1">وفّرت {formatSAR(Number(couponQuote.discount) + Number(couponQuote.delivery_discount))}</p>
            </div>
          ) : null}
          {couponError ? <p className="mt-2 text-xs font-bold text-danger">{couponError}</p> : null}
        </section>

        <section className="card-surface mt-4 p-4">
          <h2 className="text-sm font-extrabold">طريقة الدفع</h2>
          <div className="mt-3 grid gap-2">
            <button type="button" onClick={() => setPaymentMethod("cash")} className={`flex items-center gap-3 rounded-card border p-3 text-start ${paymentMethod === "cash" ? "border-brand bg-brand/5" : "border-border"}`}>
              <span className={`grid size-9 place-items-center rounded-full ${paymentMethod === "cash" ? "bg-brand/10 text-brand" : "bg-secondary text-muted-foreground"}`}><Banknote aria-hidden className="size-5" /></span>
              <div className="flex-1"><p className="text-sm font-bold">الدفع عند الاستلام</p><p className="mt-0.5 text-xs text-muted-foreground">متاح الآن</p></div>
              <span className={`size-4 rounded-full border ${paymentMethod === "cash" ? "border-4 border-brand" : "border-border"}`} aria-label={paymentMethod === "cash" ? "محدد" : undefined} />
            </button>
            <button type="button" disabled={!paymentOption || paymentLoading} onClick={() => paymentOption && setPaymentMethod("online")} className={`flex items-center gap-3 rounded-card border p-3 text-start disabled:cursor-not-allowed disabled:opacity-55 ${paymentMethod === "online" ? "border-brand bg-brand/5" : "border-border"}`}>
              <span className={`grid size-9 place-items-center rounded-full ${paymentMethod === "online" ? "bg-brand/10 text-brand" : "bg-secondary text-muted-foreground"}`}><CreditCard aria-hidden className="size-5" /></span>
              <div className="flex-1"><p className="text-sm font-bold">الدفع الإلكتروني</p><p className="mt-0.5 text-xs text-muted-foreground">{paymentLoading ? "جاري التحقق..." : paymentOption ? `ميسر · ${paymentOption.environment === "test" ? "اختبار" : "إنتاج"}` : "غير مفعّل لهذا الفرع"}</p></div>
              {paymentOption ? <span className={`size-4 rounded-full border ${paymentMethod === "online" ? "border-4 border-brand" : "border-border"}`} /> : <span className="rounded-pill bg-secondary px-2.5 py-1 text-[10px] font-bold text-muted-foreground">غير متاح</span>}
            </button>
          </div>
        </section>

        <section className="card-surface mt-4 p-4">
          <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{count} أصناف</span><span className="font-bold">{formatSAR(subtotal)}</span></div>
          {selection.delivery ? <div className="mt-1 flex items-center justify-between text-sm"><span className="text-muted-foreground">رسوم التوصيل</span><span className={couponQuote?.delivery_discount ? "text-muted-foreground line-through" : "font-bold"}>{formatSAR(estimatedDeliveryFee)}</span></div> : null}
          {couponQuote?.delivery_discount ? <div className="mt-1 flex items-center justify-between text-sm text-success"><span>توصيل مجاني</span><span>− {formatSAR(couponQuote.delivery_discount)}</span></div> : null}
          {couponQuote?.discount ? <div className="mt-1 flex items-center justify-between text-sm text-success"><span>خصم الكوبون</span><span>− {formatSAR(couponQuote.discount)}</span></div> : null}
          {couponQuote ? <div className="mt-3 flex items-center justify-between border-t border-border pt-3"><span className="text-sm font-extrabold">الإجمالي بعد الخصم</span><span className="text-lg font-extrabold text-brand">{formatSAR(couponQuote.total)}</span></div> : null}
          <p className="mt-1 text-xs text-muted-foreground">الأسعار شاملة ضريبة القيمة المضافة</p>
        </section>

        {error ? <div className="mt-4 rounded-card border border-danger/30 bg-danger/10 p-3 text-center text-sm font-bold text-danger">{error}</div> : null}
      </div>

      <div className="fixed start-0 end-0 bottom-0 z-30 border-t border-border bg-background px-5 py-3">
        <div className="mx-auto max-w-2xl">
          <button type="button" disabled={!canSubmit} onClick={handleSubmit} className="w-full rounded-pill bg-brand px-5 py-3.5 text-sm font-bold text-brand-ink disabled:opacity-50">
            {submitting ? "جارٍ إرسال الطلب..." : paymentMethod === "online" ? `المتابعة للدفع · ${formatSAR(displayedTotal)}` : `تأكيد الطلب · ${formatSAR(displayedTotal)}`}
          </button>
        </div>
      </div>
    </main>
  );
}
