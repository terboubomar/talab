import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Minus, Plus, Trash2, ImageOff, CheckCircle2, Banknote, CreditCard } from "lucide-react";

import { readSelection, type Selection } from "@/lib/storefront";
import { readCart, saveCart, clearCart } from "@/lib/cart";
import { cartCount, cartTotal, formatSAR, lineTotal, type CartLine } from "@/lib/menu";
import { submitOrder } from "@/lib/storefront";
import { saveAddress } from "@/lib/delivery";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/checkout")({
  head: () => ({
    meta: [{ title: "السلة والدفع — طلب" }],
  }),
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
          {[0, 1, 2].map((i) => (
            <div key={i} className="card-surface h-24 animate-pulse opacity-60" />
          ))}
        </div>
      </main>
    );
  }

  return <CheckoutContent selection={selection} cart={cart} setCart={setCart} />;
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
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ orderId: string; total: number } | null>(null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const estimatedDeliveryFee = useMemo(() => {
    if (!selection.delivery) return 0;
    const { fee, belowMinFee, minOrder } = selection.delivery;
    return cartTotal(cart) >= minOrder ? fee : belowMinFee;
  }, [selection.delivery, cart]);

  const count = cartCount(cart);
  const subtotal = cartTotal(cart);

  const canSubmit = useMemo(
    () => name.trim().length > 0 && phone.trim().length >= 9 && cart.length > 0 && !submitting,
    [name, phone, cart, submitting],
  );

  function updateQty(key: string, delta: number) {
    setCart((prev) =>
      prev
        .map((line) =>
          line.key === key ? { ...line, quantity: Math.max(1, line.quantity + delta) } : line,
        )
        .filter((line) => line.quantity > 0),
    );
  }

  function removeLine(key: string) {
    setCart((prev) => prev.filter((line) => line.key !== key));
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const d = selection.delivery;
      const { order_id, total } = await submitOrder({
        branchId: selection.branchId,
        orderType: selection.orderType,
        customerName: name.trim(),
        customerPhone: phone.trim(),
        notes: notes.trim() || null,
        items: cart.map((line) => ({
          product_id: line.productId,
          qty: line.quantity,
          modifier_ids: line.modifierIds,
          ...(line.note ? { note: line.note } : {}),
        })),
        ...(d
          ? {
              areaId: d.areaId,
              lat: d.lat,
              lng: d.lng,
              addressText: [
                d.street,
                d.unitNo && `مبنى ${d.unitNo}`,
                d.floor && `طابق ${d.floor}`,
                d.apartment && `شقة ${d.apartment}`,
              ]
                .filter(Boolean)
                .join("، "),
            }
          : {}),
      });
      clearCart();
      if (d?.saveForNextTime) {
        saveAddress({
          customerName: name.trim(),
          customerPhone: phone.trim(),
          areaId: d.areaId,
          lat: d.lat,
          lng: d.lng,
          street: d.street,
          unitNo: d.unitNo,
          floor: d.floor,
          apartment: d.apartment,
          notes: d.notes,
          label: d.label,
        }).catch(() => {
          /* saving the address is a convenience, never block on it */
        });
      }
      setResult({ orderId: order_id, total });
    } catch (e) {
      const message = e instanceof Error ? e.message : "حدث خطأ غير متوقع";
      setError(
        message === "order_type_not_available"
          ? "طريقة الطلب هذه غير متاحة لهذا الفرع حالياً"
          : message === "invalid_product"
            ? "أحد الأصناف لم يعد متوفراً، الرجاء مراجعة السلة"
            : message === "qty_below_minimum" || message === "qty_above_maximum"
              ? "الكمية المطلوبة لأحد الأصناف غير صحيحة"
              : message === "missing_delivery_area" || message === "invalid_delivery_area"
                ? "الرجاء اختيار عنوان توصيل صالح"
                : "تعذّر إتمام الطلب، حاول مرة أخرى",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-secondary px-5">
        <div className="card-surface w-full max-w-sm p-8 text-center">
          <CheckCircle2 aria-hidden className="mx-auto size-12 text-brand" />
          <h1 className="mt-4 text-lg font-extrabold">تم استلام طلبك</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            رقم الطلب{" "}
            <span dir="ltr" className="font-bold text-foreground">
              #{result.orderId.slice(0, 8)}
            </span>
          </p>
          <p className="mt-1 text-2xl font-extrabold text-brand">{formatSAR(result.total)}</p>
          <p className="mt-2 text-xs text-muted-foreground">طريقة الدفع: الدفع عند الاستلام</p>
          <Link
            to="/"
            className="mt-6 inline-block w-full rounded-pill bg-brand px-5 py-3 text-sm font-bold text-brand-ink"
          >
            العودة للرئيسية
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-secondary pb-32">
      <header className="sticky top-0 z-30 border-b border-border bg-background px-5 py-4">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <h1 className="text-base font-extrabold">السلة والدفع</h1>
          <Link to="/menu" className="text-sm font-bold text-brand">
            متابعة التسوق
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-5 py-6">
        <section className="card-surface divide-y divide-border">
          {cart.map((line) => (
            <div key={line.key} className="flex gap-3 p-4">
              <span className="relative block size-16 shrink-0 overflow-hidden rounded-card bg-secondary">
                {line.image ? (
                  <img src={line.image} alt={line.nameAr} className="size-full object-cover" />
                ) : (
                  <span className="flex size-full items-center justify-center text-muted-foreground">
                    <ImageOff aria-hidden className="size-5" />
                  </span>
                )}
              </span>
              <div className="flex flex-1 flex-col gap-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-bold">{line.nameAr}</span>
                  <button
                    type="button"
                    aria-label="حذف من السلة"
                    onClick={() => removeLine(line.key)}
                    className="text-muted-foreground"
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </button>
                </div>
                {line.optionNames.length > 0 ? (
                  <span className="text-xs text-muted-foreground">
                    {line.optionNames.join("، ")}
                  </span>
                ) : null}
                {line.note ? (
                  <span className="text-xs text-muted-foreground">ملاحظة: {line.note}</span>
                ) : null}
                <div className="mt-1 flex items-center justify-between">
                  <div className="flex items-center gap-3 rounded-pill border border-border px-2 py-1">
                    <button
                      type="button"
                      aria-label="تقليل"
                      onClick={() => updateQty(line.key, -1)}
                      className="grid size-6 place-items-center"
                    >
                      <Minus aria-hidden className="size-3.5" />
                    </button>
                    <span className="min-w-4 text-center text-xs font-bold" dir="ltr">
                      {line.quantity}
                    </span>
                    <button
                      type="button"
                      aria-label="زيادة"
                      onClick={() => updateQty(line.key, 1)}
                      className="grid size-6 place-items-center"
                    >
                      <Plus aria-hidden className="size-3.5" />
                    </button>
                  </div>
                  <span className="text-sm font-bold text-brand">{formatSAR(lineTotal(line))}</span>
                </div>
              </div>
            </div>
          ))}
        </section>

        <section className="card-surface mt-4 p-4">
          <label htmlFor="order-notes" className="text-sm font-bold">
            ملاحظات على الطلب
          </label>
          <textarea
            id="order-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="مثال: اترك الطلب عند الاستقبال"
            className="mt-2 w-full rounded-card border border-border bg-background px-4 py-3 text-sm outline-none placeholder:text-muted-foreground focus:border-brand"
          />
        </section>

        <section className="card-surface mt-4 p-4">
          <h2 className="text-sm font-bold">بيانات التواصل</h2>
          <div className="mt-3 grid gap-3">
            <div>
              <label htmlFor="customer-name" className="text-xs font-bold text-muted-foreground">
                الاسم
              </label>
              <input
                id="customer-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="الاسم الكامل"
                className="mt-1 w-full rounded-card border border-border bg-background px-4 py-3 text-sm outline-none placeholder:text-muted-foreground focus:border-brand"
              />
            </div>
            <div>
              <label htmlFor="customer-phone" className="text-xs font-bold text-muted-foreground">
                رقم الجوال
              </label>
              <input
                id="customer-phone"
                dir="ltr"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="05xxxxxxxx"
                className="mt-1 w-full rounded-card border border-border bg-background px-4 py-3 text-end text-sm outline-none placeholder:text-muted-foreground focus:border-brand"
              />
            </div>
          </div>
        </section>

        {selection.delivery ? (
          <section className="card-surface mt-4 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-bold">التوصيل إلى {selection.delivery.areaNameAr}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {selection.delivery.street}
              {selection.delivery.unitNo ? `، مبنى ${selection.delivery.unitNo}` : ""}
              {selection.delivery.apartment ? `، شقة ${selection.delivery.apartment}` : ""}
            </p>
          </section>
        ) : null}

        <section className="card-surface mt-4 p-4">
          <h2 className="text-sm font-extrabold">طريقة الدفع</h2>
          <div className="mt-3 grid gap-2">
            <div className="flex items-center gap-3 rounded-card border border-brand bg-brand/5 p-3">
              <span className="grid size-9 place-items-center rounded-full bg-brand/10 text-brand">
                <Banknote aria-hidden className="size-5" />
              </span>
              <div className="flex-1">
                <p className="text-sm font-bold">الدفع عند الاستلام</p>
                <p className="mt-0.5 text-xs text-muted-foreground">متاح الآن</p>
              </div>
              <span className="size-4 rounded-full border-4 border-brand" aria-label="محدد" />
            </div>
            <div className="flex cursor-not-allowed items-center gap-3 rounded-card border border-border p-3 opacity-55" aria-disabled="true">
              <span className="grid size-9 place-items-center rounded-full bg-secondary text-muted-foreground">
                <CreditCard aria-hidden className="size-5" />
              </span>
              <div className="flex-1">
                <p className="text-sm font-bold">الدفع الإلكتروني</p>
                <p className="mt-0.5 text-xs text-muted-foreground">سيُفعّل بعد ربط مزود الدفع</p>
              </div>
              <span className="rounded-pill bg-secondary px-2.5 py-1 text-[10px] font-bold text-muted-foreground">قريباً</span>
            </div>
          </div>
        </section>

        <section className="card-surface mt-4 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{count} أصناف</span>
            <span className="font-bold">{formatSAR(subtotal)}</span>
          </div>
          {selection.delivery ? (
            <div className="mt-1 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">رسوم التوصيل</span>
              <span className="font-bold">{formatSAR(estimatedDeliveryFee)}</span>
            </div>
          ) : null}
          <p className="mt-1 text-xs text-muted-foreground">الأسعار شاملة ضريبة القيمة المضافة</p>
        </section>

        {error ? (
          <div className="mt-4 rounded-card border border-danger/30 bg-danger/10 p-3 text-center text-sm font-bold text-danger">
            {error}
          </div>
        ) : null}
      </div>

      <div className="fixed start-0 end-0 bottom-0 z-30 border-t border-border bg-background px-5 py-3">
        <div className="mx-auto max-w-2xl">
          <button
            type="button"
            disabled={!canSubmit}
            onClick={handleSubmit}
            className="w-full rounded-pill bg-brand px-5 py-3.5 text-sm font-bold text-brand-ink disabled:opacity-50"
          >
            {submitting
              ? "جارٍ إرسال الطلب..."
              : `تأكيد الطلب · ${formatSAR(subtotal + estimatedDeliveryFee)}`}
          </button>
        </div>
      </div>
    </main>
  );
}
