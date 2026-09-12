import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  Banknote,
  CheckCircle2,
  CreditCard,
  ImageOff,
  Minus,
  Plus,
  TicketPercent,
  Trash2,
} from "lucide-react";

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
import {
  getCouponCartId,
  quoteBestAutoCoupon,
  quoteCoupon,
  resetCouponCartId,
  type CouponQuote,
} from "@/lib/coupons";
import { MoyasarPaymentForm } from "@/components/moyasar-payment-form";

const VAT_RATE = 0.15;

type CheckoutStep = "review" | "contact";

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
      navigate({ to: "/menu", replace: true });
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
      <main className="min-h-screen bg-surface-sunk px-4 py-10">
        <div className="mx-auto grid max-w-2xl gap-3">
          {[0, 1, 2].map((item) => <div key={item} className="card-surface h-24 animate-pulse opacity-60" />)}
        </div>
      </main>
    );
  }

  return <CheckoutContent selection={selection} cart={cart} setCart={setCart} />;
}

function couponMessage(message: string) {
  if (message.includes("coupon_not_found")) return "رمز الكوبون غير صحيح";
  if (
    message.includes("coupon_inactive") ||
    message.includes("coupon_not_started") ||
    message.includes("coupon_expired") ||
    message.includes("coupon_outside_schedule")
  ) return "هذا الكوبون غير متاح حالياً";
  if (message.includes("coupon_min_purchase")) return "قيمة السلة أقل من الحد الأدنى لهذا الكوبون";
  if (message.includes("coupon_scope_mismatch")) return "هذا الكوبون لا ينطبق على هذا الطلب";
  if (message.includes("coupon_total_limit")) return "تم الوصول إلى الحد الأقصى لاستخدام هذا الكوبون";
  if (message.includes("coupon_customer_limit")) return "لقد استخدمت هذا الكوبون بالحد المسموح";
  if (message.includes("coupon_reservation")) return "انتهى حجز الكوبون. أعد تطبيقه وحاول مرة أخرى";
  return "تعذّر تطبيق الكوبون، حاول مرة أخرى";
}

function CheckoutContent({
  selection,
  cart,
  setCart,
}: {
  selection: Selection;
  cart: CartLine[];
  setCart: React.Dispatch<React.SetStateAction<CartLine[]>>;
}) {
  const [step, setStep] = useState<CheckoutStep>("review");
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
      .finally(() => {
        if (active) setPaymentLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selection.branchId]);

  const estimatedDeliveryFee = useMemo(() => {
    if (!selection.delivery) return 0;
    const { fee, belowMinFee, minOrder } = selection.delivery;
    return cartTotal(cart) >= minOrder ? fee : belowMinFee;
  }, [selection.delivery, cart]);

  const orderItems = useMemo<PlaceOrderItem[]>(
    () =>
      cart.map((line) => ({
        product_id: line.productId,
        qty: line.quantity,
        modifier_ids: line.modifierIds,
        ...(line.note ? { note: line.note } : {}),
      })),
    [cart],
  );

  const count = cartCount(cart);
  const subtotal = cartTotal(cart);
  const displayedTotal = Number(couponQuote?.total ?? subtotal + estimatedDeliveryFee);
  const itemDiscount = Number(couponQuote?.discount ?? 0);
  const deliveryDiscount = Number(couponQuote?.delivery_discount ?? 0);
  const totalDiscount = itemDiscount + deliveryDiscount;
  const vatIncluded = displayedTotal > 0 ? displayedTotal * VAT_RATE / (1 + VAT_RATE) : 0;

  const canSubmit = useMemo(
    () =>
      name.trim().length > 0 &&
      phone.trim().length >= 9 &&
      cart.length > 0 &&
      !submitting &&
      (paymentMethod === "cash" || Boolean(paymentOption)),
    [name, phone, cart, submitting, paymentMethod, paymentOption],
  );

  const canContinue = cart.length > 0 && (paymentMethod === "cash" || Boolean(paymentOption));
  const itemsKey = useMemo(() => JSON.stringify(orderItems), [orderItems]);
  const manualCode = couponCode.trim();
  const areaId = selection.delivery?.areaId;

  useEffect(() => {
    if (step !== "contact" || manualCode) return;
    if (!couponCartId || cart.length === 0 || phone.trim().length < 9) return;
    let active = true;
    const timer = setTimeout(() => {
      quoteBestAutoCoupon({
        branchId: selection.branchId,
        orderType: selection.orderType,
        customerPhone: phone.trim(),
        items: orderItems,
        cartId: couponCartId,
        ...(areaId ? { areaId } : {}),
      })
        .then((quote) => {
          if (!active) return;
          if (quote) {
            setCouponQuote({ ...quote, auto_applied: true });
            setCouponError(null);
          } else {
            setCouponQuote((previous) => (previous?.auto_applied ? null : previous));
          }
        })
        .catch(() => {
          if (active) setCouponQuote((previous) => (previous?.auto_applied ? null : previous));
        });
    }, 400);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [step, manualCode, couponCartId, phone, itemsKey, orderItems, cart.length, areaId, selection.branchId, selection.orderType]);

  function invalidateCoupon() {
    if (!couponQuote) return;
    if (couponQuote.auto_applied) {
      setCouponQuote(null);
      return;
    }
    setCouponQuote(null);
    setCouponError("تم تعديل السلة. أعد تطبيق الكوبون لتحديث الخصم.");
  }

  function updateQty(key: string, delta: number) {
    invalidateCoupon();
    setCart((previous) =>
      previous
        .map((line) => (line.key === key ? { ...line, quantity: Math.max(1, line.quantity + delta) } : line))
        .filter((line) => line.quantity > 0),
    );
  }

  function removeLine(key: string) {
    invalidateCoupon();
    setCart((previous) => previous.filter((line) => line.key !== key));
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
        ...(areaId ? { areaId } : {}),
      });
      setCouponCode(quote.code);
      setCouponQuote(quote);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "";
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
      const delivery = selection.delivery;
      let refreshedCoupon = couponQuote;

      if (couponQuote && !couponQuote.auto_applied && couponCode.trim() && couponCartId) {
        try {
          refreshedCoupon = await quoteCoupon({
            branchId: selection.branchId,
            orderType: selection.orderType,
            customerPhone: phone.trim(),
            code: couponCode.trim(),
            items: orderItems,
            cartId: couponCartId,
            ...(delivery?.areaId ? { areaId: delivery.areaId } : {}),
          });
          setCouponQuote(refreshedCoupon);
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : "";
          setCouponQuote(null);
          setCouponError(couponMessage(message));
          throw new Error("coupon_refresh_failed");
        }
      } else if (!couponCode.trim() && couponCartId) {
        try {
          const automatic = await quoteBestAutoCoupon({
            branchId: selection.branchId,
            orderType: selection.orderType,
            customerPhone: phone.trim(),
            items: orderItems,
            cartId: couponCartId,
            ...(delivery?.areaId ? { areaId: delivery.areaId } : {}),
          });
          refreshedCoupon = automatic ? { ...automatic, auto_applied: true } : null;
          setCouponQuote(refreshedCoupon);
        } catch {
          refreshedCoupon = null;
          setCouponQuote(null);
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
        ...(delivery
          ? {
              areaId: delivery.areaId,
              lat: delivery.lat,
              lng: delivery.lng,
              addressText: [
                delivery.street,
                delivery.unitNo && `مبنى ${delivery.unitNo}`,
                delivery.floor && `طابق ${delivery.floor}`,
                delivery.apartment && `شقة ${delivery.apartment}`,
              ]
                .filter(Boolean)
                .join("، "),
            }
          : {}),
      });

      if (paymentMethod === "cash") {
        clearCart();
        resetCouponCartId();
      }
      if (delivery?.saveForNextTime) {
        saveAddress({
          customerName: name.trim(),
          customerPhone: phone.trim(),
          areaId: delivery.areaId,
          lat: delivery.lat,
          lng: delivery.lng,
          street: delivery.street,
          unitNo: delivery.unitNo,
          floor: delivery.floor,
          apartment: delivery.apartment,
          notes: delivery.notes,
          label: delivery.label,
        }).catch(() => {});
      }

      setResult({
        orderId: order_id,
        total,
        paymentMethod,
        paymentOption: paymentMethod === "online" ? paymentOption : null,
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "حدث خطأ غير متوقع";
      if (message === "coupon_refresh_failed") return;
      setError(
        message.includes("order_type_not_available")
          ? "طريقة الطلب هذه غير متاحة لهذا الفرع حالياً"
          : message.includes("invalid_product")
            ? "أحد الأصناف لم يعد متوفراً، الرجاء مراجعة السلة"
            : message.includes("qty_below_minimum") || message.includes("qty_above_maximum")
              ? "الكمية المطلوبة لأحد الأصناف غير صحيحة"
              : message.includes("missing_delivery_area") || message.includes("invalid_delivery_area")
                ? "الرجاء اختيار عنوان توصيل صالح"
                : message.includes("online_payment_not_available")
                  ? "الدفع الإلكتروني غير متاح لهذا الفرع حالياً. اختر الدفع عند الاستلام."
                  : message.includes("coupon_")
                    ? couponMessage(message)
                    : "تعذّر إتمام الطلب، حاول مرة أخرى",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (result?.paymentMethod === "online" && result.paymentOption) {
    return (
      <main className="flex min-h-screen justify-center bg-surface-sunk px-4 py-10">
        <div className="w-full max-w-lg">
          <div className="card-surface mb-4 p-5 text-center">
            <p className="text-xs font-medium text-ink-3">رقم الطلب</p>
            <p dir="ltr" className="mt-1 text-lg font-semibold tabular-nums">#{result.orderId.slice(0, 8)}</p>
            <p className="mt-2 text-xs leading-6 text-ink-2">أكمل الدفع أدناه. الطلب الإلكتروني لن ينتقل إلى المطبخ قبل تأكيد ميسر على الخادم.</p>
          </div>
          <div className="card-surface p-5">
            <MoyasarPaymentForm
              orderId={result.orderId}
              total={result.total}
              branchName={selection.branchNameAr}
              option={result.paymentOption}
            />
          </div>
        </div>
      </main>
    );
  }

  if (result) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface-sunk px-4">
        <div className="card-surface w-full max-w-sm p-8 text-center">
          <CheckCircle2 aria-hidden className="mx-auto size-12 text-brand" />
          <h1 className="mt-4 text-xl font-semibold">تم استلام طلبك</h1>
          <p className="mt-2 text-sm text-ink-2">رقم الطلب <span dir="ltr" className="font-semibold text-ink tabular-nums">#{result.orderId.slice(0, 8)}</span></p>
          <p className="mt-1 text-2xl font-bold text-brand tabular-nums">{formatSAR(result.total)}</p>
          <p className="mt-2 text-xs text-ink-3">طريقة الدفع: الدفع عند الاستلام</p>
          <Link to="/menu" className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-card bg-brand px-5 py-3 text-sm font-semibold text-brand-ink">العودة للقائمة</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-surface-sunk pb-32">
      <header className="sticky top-0 z-30 border-b border-line bg-surface-raised px-4 py-3">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4">
          <div>
            <p className="text-[11px] text-ink-3">{step === "review" ? "الخطوة 1 من 2" : "الخطوة 2 من 2"}</p>
            <h1 className="text-base font-semibold">{step === "review" ? "مراجعة الطلب" : "بيانات التواصل والتأكيد"}</h1>
          </div>
          {step === "review" ? (
            <Link to="/menu" className="inline-flex min-h-11 items-center text-sm font-medium text-brand">متابعة التسوق</Link>
          ) : (
            <button type="button" onClick={() => setStep("review")} className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand">
              <ArrowRight className="size-4" aria-hidden /> رجوع
            </button>
          )}
        </div>
        <div className="mx-auto mt-3 flex max-w-2xl gap-2" aria-hidden>
          <span className="h-1 flex-1 rounded-pill bg-brand" />
          <span className={`h-1 flex-1 rounded-pill ${step === "contact" ? "bg-brand" : "bg-line"}`} />
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-4 py-6">
        {step === "review" ? (
          <>
            <CartItems cart={cart} updateQty={updateQty} removeLine={removeLine} />

            <section className="card-surface mt-4 p-4">
              <label htmlFor="order-notes" className="text-sm font-semibold">ملاحظات على الطلب</label>
              <textarea
                id="order-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={2}
                placeholder="مثال: اترك الطلب عند الاستقبال"
                className="mt-2 w-full rounded-card border border-line bg-surface px-4 py-3 text-sm outline-none placeholder:text-ink-3 focus:border-brand"
              />
            </section>

            {selection.delivery ? (
              <section className="card-surface mt-4 p-4">
                <div className="flex items-center justify-between text-sm"><span className="font-semibold">التوصيل إلى {selection.delivery.areaNameAr}</span></div>
                <p className="mt-1 text-xs text-ink-2">{selection.delivery.street}{selection.delivery.unitNo ? `، مبنى ${selection.delivery.unitNo}` : ""}{selection.delivery.apartment ? `، شقة ${selection.delivery.apartment}` : ""}</p>
              </section>
            ) : null}

            <PaymentMethodSection
              paymentMethod={paymentMethod}
              paymentOption={paymentOption}
              paymentLoading={paymentLoading}
              onChange={setPaymentMethod}
            />

            <OrderSummary
              subtotal={subtotal}
              deliveryFee={estimatedDeliveryFee}
              discount={0}
              vatIncluded={(subtotal + estimatedDeliveryFee) * VAT_RATE / (1 + VAT_RATE)}
              total={subtotal + estimatedDeliveryFee}
            />
          </>
        ) : (
          <>
            <section className="card-surface p-4">
              <div className="mb-3">
                <h2 className="text-sm font-semibold">بيانات التواصل</h2>
                <p className="mt-1 text-xs text-ink-3">آخر خطوة — لن نطلب رقم الجوال قبل أن تراجع طلبك.</p>
              </div>
              <div className="grid gap-3">
                <div>
                  <label htmlFor="customer-name" className="text-xs font-medium text-ink-2">الاسم</label>
                  <input
                    id="customer-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="الاسم الكامل"
                    className="mt-1 min-h-11 w-full rounded-card border border-line bg-surface px-4 py-3 text-sm outline-none placeholder:text-ink-3 focus:border-brand"
                  />
                </div>
                <div>
                  <label htmlFor="customer-phone" className="text-xs font-medium text-ink-2">رقم الجوال</label>
                  <input
                    id="customer-phone"
                    dir="ltr"
                    inputMode="tel"
                    autoComplete="tel"
                    value={phone}
                    onChange={(event) => {
                      setPhone(event.target.value);
                      if (couponQuote) setCouponQuote(null);
                    }}
                    placeholder="05xxxxxxxx"
                    className="mt-1 min-h-11 w-full rounded-card border border-line bg-surface px-4 py-3 text-end text-sm outline-none placeholder:text-ink-3 focus:border-brand"
                  />
                </div>
              </div>
            </section>

            <section className="card-surface mt-4 p-4">
              <div className="flex items-center gap-2"><TicketPercent aria-hidden className="size-4 text-brand" /><h2 className="text-sm font-semibold">كوبون خصم</h2></div>
              <div className="mt-3 flex gap-2">
                <input
                  value={couponCode}
                  onChange={(event) => {
                    setCouponCode(event.target.value.toUpperCase());
                    setCouponQuote(null);
                    setCouponError(null);
                  }}
                  dir="ltr"
                  placeholder="CODE"
                  className="min-h-11 min-w-0 flex-1 rounded-card border border-line bg-surface px-4 py-2.5 text-sm font-semibold uppercase outline-none focus:border-brand"
                />
                <button
                  type="button"
                  disabled={couponApplying || !couponCode.trim() || !couponCartId}
                  onClick={applyCoupon}
                  className="min-h-11 rounded-card border border-brand px-4 py-2.5 text-sm font-semibold text-brand disabled:opacity-50"
                >
                  {couponApplying ? "جارٍ..." : "تطبيق"}
                </button>
              </div>
              {couponQuote ? (
                <div className="mt-3 rounded-card bg-success/10 p-3 text-xs text-success">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    <span>{couponQuote.success_msg_ar || `تم تطبيق ${couponQuote.code}`}</span>
                    {couponQuote.auto_applied ? <span className="rounded-pill bg-success/20 px-2 py-0.5 text-[10px] font-medium">تلقائي</span> : null}
                  </p>
                  {couponQuote.auto_applied ? <p className="mt-1" dir="ltr">{couponQuote.code}</p> : null}
                  <p className="mt-1 tabular-nums">وفّرت {formatSAR(totalDiscount)}</p>
                </div>
              ) : null}
              {couponError ? <p className="mt-2 text-xs font-medium text-danger">{couponError}</p> : null}
            </section>

            <OrderSummary
              subtotal={subtotal}
              deliveryFee={estimatedDeliveryFee}
              discount={totalDiscount}
              vatIncluded={vatIncluded}
              total={displayedTotal}
            />
          </>
        )}

        {error ? <div className="mt-4 rounded-card bg-danger/10 p-3 text-center text-sm font-medium text-danger">{error}</div> : null}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface-raised px-4 py-3">
        <div className="mx-auto max-w-2xl">
          {step === "review" ? (
            <button
              type="button"
              disabled={!canContinue}
              onClick={() => setStep("contact")}
              className="min-h-11 w-full rounded-card bg-brand px-5 py-3.5 text-sm font-semibold text-brand-ink disabled:opacity-50"
            >
              متابعة · <span className="tabular-nums">{formatSAR(subtotal + estimatedDeliveryFee)}</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={!canSubmit}
              onClick={handleSubmit}
              className="min-h-11 w-full rounded-card bg-brand px-5 py-3.5 text-sm font-semibold text-brand-ink disabled:opacity-50"
            >
              {submitting
                ? "جارٍ إرسال الطلب..."
                : paymentMethod === "online"
                  ? `المتابعة للدفع · ${formatSAR(displayedTotal)}`
                  : `تأكيد الطلب · ${formatSAR(displayedTotal)}`}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}

function CartItems({
  cart,
  updateQty,
  removeLine,
}: {
  cart: CartLine[];
  updateQty: (key: string, delta: number) => void;
  removeLine: (key: string) => void;
}) {
  return (
    <section className="card-surface divide-y divide-line-soft">
      {cart.map((line) => (
        <div key={line.key} className="flex gap-3 p-4">
          <span className="relative block size-16 shrink-0 overflow-hidden rounded-sm bg-surface-sunk">
            {line.image ? (
              <img src={line.image} alt={line.nameAr} className="size-full object-cover" />
            ) : (
              <span className="flex size-full items-center justify-center text-ink-3"><ImageOff aria-hidden className="size-5" /></span>
            )}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-semibold">{line.nameAr}</span>
              <button
                type="button"
                aria-label="حذف من السلة"
                onClick={() => removeLine(line.key)}
                className="grid size-11 shrink-0 place-items-center rounded-pill text-ink-3"
              >
                <Trash2 aria-hidden className="size-4" />
              </button>
            </div>
            {line.optionNames.length > 0 ? <span className="text-xs leading-5 text-ink-2">{line.optionNames.join("، ")}</span> : null}
            {line.note ? <span className="text-xs leading-5 text-ink-3">ملاحظة: {line.note}</span> : null}
            <div className="mt-1 flex items-center justify-between gap-3">
              <div className="flex items-center gap-1 rounded-pill border border-line px-1 py-1">
                <button type="button" aria-label="تقليل" onClick={() => updateQty(line.key, -1)} className="grid size-11 place-items-center rounded-pill"><Minus aria-hidden className="size-3.5" /></button>
                <span className="min-w-7 text-center text-xs font-semibold tabular-nums" dir="ltr">{line.quantity}</span>
                <button type="button" aria-label="زيادة" onClick={() => updateQty(line.key, 1)} className="grid size-11 place-items-center rounded-pill"><Plus aria-hidden className="size-3.5" /></button>
              </div>
              <span className="text-sm font-semibold text-brand tabular-nums">{formatSAR(lineTotal(line))}</span>
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}

function PaymentMethodSection({
  paymentMethod,
  paymentOption,
  paymentLoading,
  onChange,
}: {
  paymentMethod: CheckoutPaymentMethod;
  paymentOption: StorefrontPaymentOption | null;
  paymentLoading: boolean;
  onChange: (method: CheckoutPaymentMethod) => void;
}) {
  return (
    <section className="card-surface mt-4 p-4">
      <h2 className="text-sm font-semibold">طريقة الدفع</h2>
      <div className="mt-3 grid gap-2">
        <button
          type="button"
          onClick={() => onChange("cash")}
          className={`flex min-h-11 items-center gap-3 rounded-card border p-3 text-start ${paymentMethod === "cash" ? "border-brand bg-brand-soft" : "border-line"}`}
        >
          <span className={`grid size-11 place-items-center rounded-pill ${paymentMethod === "cash" ? "bg-brand/10 text-brand" : "bg-surface-sunk text-ink-3"}`}><Banknote aria-hidden className="size-5" /></span>
          <div className="flex-1"><p className="text-sm font-semibold">الدفع عند الاستلام</p><p className="mt-0.5 text-xs text-ink-3">متاح الآن</p></div>
          <span className={`size-4 rounded-full border ${paymentMethod === "cash" ? "border-4 border-brand" : "border-line"}`} aria-label={paymentMethod === "cash" ? "محدد" : undefined} />
        </button>
        <button
          type="button"
          disabled={!paymentOption || paymentLoading}
          onClick={() => paymentOption && onChange("online")}
          className={`flex min-h-11 items-center gap-3 rounded-card border p-3 text-start disabled:cursor-not-allowed disabled:opacity-55 ${paymentMethod === "online" ? "border-brand bg-brand-soft" : "border-line"}`}
        >
          <span className={`grid size-11 place-items-center rounded-pill ${paymentMethod === "online" ? "bg-brand/10 text-brand" : "bg-surface-sunk text-ink-3"}`}><CreditCard aria-hidden className="size-5" /></span>
          <div className="flex-1"><p className="text-sm font-semibold">الدفع الإلكتروني</p><p className="mt-0.5 text-xs text-ink-3">{paymentLoading ? "جاري التحقق..." : paymentOption ? `ميسر · ${paymentOption.environment === "test" ? "اختبار" : "إنتاج"}` : "غير مفعّل لهذا الفرع"}</p></div>
          {paymentOption ? <span className={`size-4 rounded-full border ${paymentMethod === "online" ? "border-4 border-brand" : "border-line"}`} /> : <span className="rounded-pill bg-surface-sunk px-2.5 py-1 text-[10px] font-medium text-ink-3">غير متاح</span>}
        </button>
      </div>
    </section>
  );
}

function OrderSummary({
  subtotal,
  deliveryFee,
  discount,
  vatIncluded,
  total,
}: {
  subtotal: number;
  deliveryFee: number;
  discount: number;
  vatIncluded: number;
  total: number;
}) {
  return (
    <section className="card-surface mt-4 p-4" aria-label="ملخص الطلب">
      <h2 className="mb-3 text-sm font-semibold">ملخص الطلب</h2>
      <div className="space-y-2 text-sm">
        <SummaryRow label="المجموع الفرعي" value={subtotal} />
        {discount > 0 ? <SummaryRow label="الخصم" value={-discount} tone="success" /> : null}
        <SummaryRow label="ضريبة القيمة المضافة (15%) · مشمولة" value={vatIncluded} muted />
        <SummaryRow label="رسوم التوصيل" value={deliveryFee} />
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
        <span className="text-sm font-semibold">الإجمالي</span>
        <span className="text-lg font-bold text-brand tabular-nums">{formatSAR(total)}</span>
      </div>
    </section>
  );
}

function SummaryRow({
  label,
  value,
  tone,
  muted,
}: {
  label: string;
  value: number;
  tone?: "success";
  muted?: boolean;
}) {
  const amount = value < 0 ? `− ${formatSAR(Math.abs(value))}` : formatSAR(value);
  return (
    <div className={`flex items-center justify-between gap-3 ${tone === "success" ? "text-success" : muted ? "text-ink-3" : "text-ink-2"}`}>
      <span>{label}</span>
      <span className="font-medium tabular-nums">{amount}</span>
    </div>
  );
}
