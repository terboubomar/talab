import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Banknote, CreditCard, Minus, Plus, Search, ShoppingBag, Trash2, X } from "lucide-react";

import { MoyasarPaymentForm } from "@/components/moyasar-payment-form";
import {
  createCallCenterOrder,
  fetchCallCenterSetup,
  lookupCallCenterCustomer,
  type CallCenterCustomer,
} from "@/lib/call-center";
import { formatSAR, menuQuery, type Product } from "@/lib/menu";
import {
  fetchStorefrontPaymentOption,
  type CheckoutPaymentMethod,
  type StorefrontPaymentOption,
} from "@/lib/storefront";
import { ORDER_TYPE_LABEL, type OrderType } from "@/lib/staff";

type DraftLine = {
  key: string;
  productId: string;
  name: string;
  qty: number;
  unitPrice: number;
  modifierIds: string[];
  modifierNames: string[];
  modifierUnitTotal: number;
};

type OnlineOrder = {
  orderId: string;
  total: number;
  option: StorefrontPaymentOption;
  branchName: string;
};

export function CallCenterOrderPanel({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (result: { order_id: string; total: number }) => void;
}) {
  const { data: setup, isLoading: setupLoading } = useQuery({
    queryKey: ["call-center-setup"],
    queryFn: fetchCallCenterSetup,
    enabled: open,
  });
  const [branchId, setBranchId] = useState("");
  const [orderType, setOrderType] = useState<OrderType>("pickup");
  const [paymentMethod, setPaymentMethod] = useState<CheckoutPaymentMethod>("cash");
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [areaId, setAreaId] = useState("");
  const [addressText, setAddressText] = useState("");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<DraftLine[]>([]);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editQty, setEditQty] = useState(1);
  const [editModifiers, setEditModifiers] = useState<string[]>([]);
  const [customerMatch, setCustomerMatch] = useState<CallCenterCustomer | null>(null);
  const [busy, setBusy] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [onlineOrder, setOnlineOrder] = useState<OnlineOrder | null>(null);

  const branch = setup?.branches.find((item) => item.id === branchId) ?? null;
  const { data: categories = [], isLoading: menuLoading } = useQuery({
    ...menuQuery(branchId),
    enabled: open && Boolean(branchId),
  });
  const { data: paymentOption = null, isLoading: paymentLoading } = useQuery({
    queryKey: ["call-center-payment-option", branchId],
    queryFn: () => fetchStorefrontPaymentOption(branchId),
    enabled: open && Boolean(branchId),
    retry: false,
  });

  useEffect(() => {
    if (!open || !setup?.branches.length || branchId) return;
    const first = setup.branches[0];
    if (!first) return;
    setBranchId(first.id);
    const preferred = first.order_types.includes("pickup") ? "pickup" : first.order_types[0];
    if (preferred) setOrderType(preferred);
  }, [open, setup, branchId]);

  useEffect(() => {
    if (!branch) return;
    if (!branch.order_types.includes(orderType)) {
      const preferred = branch.order_types.includes("pickup") ? "pickup" : branch.order_types[0];
      if (preferred) setOrderType(preferred);
    }
    if (orderType !== "delivery") setAreaId("");
  }, [branch, orderType]);

  useEffect(() => {
    if (!paymentLoading && paymentMethod === "online" && !paymentOption) {
      setPaymentMethod("cash");
    }
  }, [paymentLoading, paymentMethod, paymentOption]);

  useEffect(() => {
    if (!categories.length) {
      setSelectedCategoryId("");
      return;
    }
    if (!categories.some((category) => category.id === selectedCategoryId)) {
      setSelectedCategoryId(categories[0]?.id ?? "");
    }
  }, [categories, selectedCategoryId]);

  useEffect(() => {
    if (!open) {
      setBranchId(""); setOrderType("pickup"); setPaymentMethod("cash"); setSelectedCategoryId("");
      setName(""); setPhone(""); setNotes(""); setAreaId(""); setAddressText(""); setSearch("");
      setCart([]); setEditingProduct(null); setCustomerMatch(null); setMessage(null); setOnlineOrder(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const normalized = phone.replace(/\D/g, "");
    if (normalized.length < 7) {
      setCustomerMatch(null);
      setLookupBusy(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLookupBusy(true);
      try {
        const customer = await lookupCallCenterCustomer(phone);
        if (cancelled) return;
        setCustomerMatch(customer);
        if (customer) {
          setName(customer.name ?? "");
          const preferred = customer.addresses[0];
          if (preferred && orderType === "delivery") {
            if (preferred.area_id && branch?.delivery_zones.some((item) => item.area_id === preferred.area_id)) {
              setAreaId(preferred.area_id);
            }
            setAddressText([
              preferred.street,
              preferred.unit_no && `مبنى ${preferred.unit_no}`,
              preferred.floor && `طابق ${preferred.floor}`,
              preferred.apartment && `شقة ${preferred.apartment}`,
            ].filter(Boolean).join("، "));
          }
          setMessage("تم التعرف على العميل وتعبئة بياناته تلقائياً");
        } else {
          setCustomerMatch(null);
          setMessage(null);
        }
      } catch {
        if (!cancelled) setCustomerMatch(null);
      } finally {
        if (!cancelled) setLookupBusy(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [phone, open, orderType, branch]);

  const selectedCategory = useMemo(
    () => categories.find((category) => category.id === selectedCategoryId) ?? categories[0] ?? null,
    [categories, selectedCategoryId],
  );
  const filteredProducts = useMemo(() => {
    const products = selectedCategory?.products ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((product) => `${product.name_ar} ${product.name_en ?? ""}`.toLowerCase().includes(q));
  }, [selectedCategory, search]);

  const localSubtotal = cart.reduce((sum, line) => sum + (line.unitPrice + line.modifierUnitTotal) * line.qty, 0);
  const zone = branch?.delivery_zones.find((item) => item.area_id === areaId) ?? null;
  const estimatedDelivery = orderType === "delivery" && zone
    ? (localSubtotal >= Number(zone.min_order) ? Number(zone.fee) : Number(zone.below_min_fee))
    : 0;

  function openProduct(product: Product) {
    setEditingProduct(product);
    setEditQty(Math.max(1, Number(product.min_qty ?? 1)));
    setEditModifiers([]);
  }

  function toggleModifier(groupId: string, modifierId: string, single: boolean) {
    const group = editingProduct?.modifier_groups?.find((item) => item.id === groupId);
    const groupIds = new Set((group?.options ?? []).map((item) => item.id));
    setEditModifiers((current) => {
      if (single) return [...current.filter((id) => !groupIds.has(id)), modifierId];
      return current.includes(modifierId) ? current.filter((id) => id !== modifierId) : [...current, modifierId];
    });
  }

  function addEditedProduct() {
    if (!editingProduct) return;
    for (const group of editingProduct.modifier_groups ?? []) {
      const selectedCount = (group.options ?? []).filter((option) => editModifiers.includes(option.id)).length;
      const min = Number(group.min ?? (group.required ? 1 : 0));
      const max = Number(group.max ?? 999);
      if (selectedCount < min || selectedCount > max) {
        setMessage(`راجع اختيارات مجموعة ${group.name_ar}`);
        return;
      }
    }
    const options = (editingProduct.modifier_groups ?? []).flatMap((group) => group.options ?? []).filter((option) => editModifiers.includes(option.id));
    const modifierUnitTotal = options.reduce((sum, option) => sum + Number(option.price ?? 0), 0);
    setCart((current) => [...current, {
      key: `${editingProduct.id}:${editModifiers.slice().sort().join(",")}:${Date.now()}`,
      productId: editingProduct.id,
      name: editingProduct.name_ar,
      qty: editQty,
      unitPrice: Number(editingProduct.price ?? 0),
      modifierIds: editModifiers,
      modifierNames: options.map((option) => option.name_ar),
      modifierUnitTotal,
    }]);
    setEditingProduct(null); setMessage(null);
  }

  function changeQty(key: string, delta: number) {
    setCart((current) => current.map((line) => line.key === key ? { ...line, qty: Math.max(1, line.qty + delta) } : line));
  }

  async function submit() {
    if (!branchId || !name.trim() || phone.trim().length < 7 || cart.length === 0) {
      setMessage("أكمل بيانات العميل وأضف صنفاً واحداً على الأقل"); return;
    }
    if (orderType === "delivery" && (!areaId || !addressText.trim())) {
      setMessage("اختر منطقة التوصيل وأدخل العنوان"); return;
    }
    if (paymentMethod === "online" && !paymentOption) {
      setMessage("الدفع الإلكتروني غير مفعّل لهذا الفرع"); return;
    }
    setBusy(true); setMessage(null);
    try {
      const result = await createCallCenterOrder({
        branchId, orderType, customerName: name, customerPhone: phone, notes, paymentMethod,
        items: cart.map((line) => ({ product_id: line.productId, qty: line.qty, modifier_ids: line.modifierIds })),
        ...(orderType === "delivery" ? {
          areaId,
          lat: zone?.lat ?? null,
          lng: zone?.lng ?? null,
          addressText,
        } : {}),
      });
      onCreated(result);
      if (paymentMethod === "online" && paymentOption) {
        setOnlineOrder({
          orderId: result.order_id,
          total: result.total,
          option: paymentOption,
          branchName: branch?.name_ar ?? "طلب",
        });
        setMessage(null);
      } else {
        onClose();
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : "";
      setMessage(
        text.includes("online_payment_not_available") ? "الدفع الإلكتروني غير مفعّل لهذا الفرع. اختر الدفع عند الاستلام أو فعّل حساب الدفع أولاً." :
        text.includes("invalid_payment_method") ? "طريقة الدفع غير صحيحة" :
        text.includes("product_not_available") || text.includes("invalid_product") ? "أحد الأصناف لم يعد متاحاً لهذا الفرع" :
        text.includes("invalid_modifier") ? "إحدى الإضافات لم تعد متاحة" :
        text.includes("invalid_delivery_area") ? "منطقة التوصيل غير متاحة لهذا الفرع" :
        text.includes("not_authorized") ? "لا تملك صلاحية إنشاء هذا الطلب" :
        "تعذّر إنشاء الطلب. راجع البيانات وحاول مرة أخرى",
      );
    } finally { setBusy(false); }
  }

  if (!open) return null;

  if (onlineOrder) {
    return (
      <div className="fixed inset-0 z-50 bg-black/35 p-3 sm:p-5" dir="rtl">
        <div className="mx-auto flex h-full max-w-2xl flex-col overflow-y-auto rounded-2xl border border-border bg-background p-5 shadow-xl">
          <div className="flex items-start justify-between gap-3 border-b border-border pb-4">
            <div>
              <h2 className="text-base font-extrabold">إتمام الدفع الإلكتروني</h2>
              <p className="mt-1 text-xs text-muted-foreground">تم إنشاء الطلب بانتظار الدفع. لن ينتقل للمطبخ كطلب مدفوع حتى يؤكد ميسر العملية.</p>
              <p dir="ltr" className="mt-2 text-xs font-bold text-muted-foreground">Order #{onlineOrder.orderId.slice(0, 8)}</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-full p-2 hover:bg-secondary"><X className="size-4" /></button>
          </div>
          <div className="flex flex-1 items-start justify-center py-6">
            <MoyasarPaymentForm orderId={onlineOrder.orderId} total={onlineOrder.total} branchName={onlineOrder.branchName} option={onlineOrder.option} />
          </div>
          <button type="button" onClick={onClose} className="w-full rounded-card border border-border px-4 py-3 text-sm font-bold hover:bg-secondary">العودة إلى الطلبات</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/35 p-3 sm:p-5" dir="rtl">
      <div className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xl">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div><h2 className="text-base font-extrabold">إنشاء طلب جديد</h2><p className="mt-0.5 text-[11px] text-muted-foreground">إدخال طلب بواسطة موظف خدمة العملاء · الأسعار تُحسب من الخادم</p></div>
          <button type="button" onClick={onClose} className="rounded-full p-2 hover:bg-secondary"><X className="size-4" /></button>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[1.5fr_0.9fr]">
          <section className="min-h-0 overflow-y-auto border-b border-border p-4 lg:border-b-0 lg:border-l">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="الفرع"><select value={branchId} onChange={(e) => { setBranchId(e.target.value); setCart([]); setPaymentMethod("cash"); setSelectedCategoryId(""); }} className="cc-input"><option value="">اختر الفرع</option>{setup?.branches.map((item) => <option key={item.id} value={item.id}>{item.name_ar}</option>)}</select></Field>
              <Field label="نوع الطلب"><select value={orderType} onChange={(e) => setOrderType(e.target.value as OrderType)} className="cc-input">{branch?.order_types.map((type) => <option key={type} value={type}>{ORDER_TYPE_LABEL[type]}</option>)}</select></Field>
            </div>

            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
              {categories.map((category) => (
                <button key={category.id} type="button" onClick={() => { setSelectedCategoryId(category.id); setSearch(""); }} className={`shrink-0 rounded-pill px-4 py-2 text-xs font-bold ${selectedCategory?.id === category.id ? "bg-brand text-brand-ink" : "border border-border bg-background"}`}>
                  {category.name_ar}
                  <span className="ms-1 opacity-60">({category.products?.length ?? 0})</span>
                </button>
              ))}
            </div>

            <div className="mt-3 relative"><Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`ابحث في ${selectedCategory?.name_ar ?? "القائمة"}...`} className="cc-input pe-10" /></div>

            {setupLoading || menuLoading ? <div className="mt-4 h-48 animate-pulse rounded-card bg-secondary" /> : filteredProducts.length === 0 ? (
              <p className="mt-6 rounded-card border border-dashed border-border p-8 text-center text-sm text-muted-foreground">لا توجد منتجات في هذه الفئة</p>
            ) : (
              <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {filteredProducts.map((product) => (
                  <button key={product.id} type="button" disabled={!product.in_stock} onClick={() => openProduct(product)} className="rounded-card border border-border p-3 text-right hover:border-brand/50 disabled:cursor-not-allowed disabled:opacity-40">
                    <p className="text-sm font-extrabold">{product.name_ar}</p>
                    <div className="mt-2 flex items-center justify-between text-xs"><span className="font-bold">{formatSAR(Number(product.price ?? 0))}</span><span className="text-muted-foreground">{product.modifier_groups?.length ? `${product.modifier_groups.length} إضافات` : "إضافة مباشرة"}</span></div>
                  </button>
                ))}
              </div>
            )}
          </section>

          <aside className="min-h-0 overflow-y-auto p-4">
            <div className="grid gap-3">
              <Field label="رقم الجوال">
                <div className="relative">
                  <input dir="ltr" value={phone} onChange={(e) => { setPhone(e.target.value); setCustomerMatch(null); }} className="cc-input pe-9" placeholder="05xxxxxxxx" />
                  {lookupBusy ? <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-muted-foreground">...</span> : null}
                </div>
              </Field>
              <Field label="اسم العميل"><input value={name} onChange={(e) => setName(e.target.value)} className="cc-input" placeholder="يُعبأ تلقائياً للعميل المسجل" /></Field>
              {customerMatch ? <p className="rounded-card bg-success/10 px-3 py-2 text-[11px] font-bold text-success">تم التعرف على {customerMatch.name} · {customerMatch.addresses.length} عنوان محفوظ</p> : null}

              {orderType === "delivery" ? <>
                <Field label="منطقة التوصيل"><select value={areaId} onChange={(e) => setAreaId(e.target.value)} className="cc-input"><option value="">اختر المنطقة</option>{branch?.delivery_zones.map((item) => <option key={item.area_id} value={item.area_id}>{item.name_ar} · {formatSAR(Number(item.fee))}</option>)}</select></Field>
                <Field label="عنوان التوصيل"><textarea value={addressText} onChange={(e) => setAddressText(e.target.value)} className="cc-input min-h-20" placeholder="الشارع، المبنى، الدور، الشقة..." /></Field>
              </> : null}

              <div>
                <p className="mb-1.5 text-xs font-bold">طريقة الدفع</p>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setPaymentMethod("cash")} className={`flex items-center gap-2 rounded-card border p-3 text-right text-xs font-bold ${paymentMethod === "cash" ? "border-brand bg-brand/10 text-brand" : "border-border"}`}>
                    <Banknote className="size-4" />
                    <span><span className="block">الدفع عند الاستلام</span><span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">نقدي / تحصيل يدوي</span></span>
                  </button>
                  <button type="button" disabled={paymentLoading || !paymentOption} onClick={() => setPaymentMethod("online")} className={`flex items-center gap-2 rounded-card border p-3 text-right text-xs font-bold disabled:cursor-not-allowed disabled:opacity-45 ${paymentMethod === "online" ? "border-brand bg-brand/10 text-brand" : "border-border"}`}>
                    <CreditCard className="size-4" />
                    <span><span className="block">دفع إلكتروني</span><span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">{paymentLoading ? "جارٍ التحقق…" : paymentOption ? "عبر ميسر" : "غير مفعّل لهذا الفرع"}</span></span>
                  </button>
                </div>
                {paymentMethod === "online" ? <p className="mt-2 text-[10px] leading-5 text-muted-foreground">سيُنشأ الطلب بحالة بانتظار الدفع، ثم يفتح نموذج ميسر الآمن. لا يحفظ طلب بيانات البطاقة.</p> : null}
              </div>

              <Field label="ملاحظات الطلب"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="cc-input min-h-16" /></Field>
            </div>

            <div className="mt-5 flex items-center gap-2"><ShoppingBag className="size-4 text-brand" /><h3 className="text-sm font-extrabold">السلة</h3><span className="text-xs text-muted-foreground">({cart.reduce((sum, line) => sum + line.qty, 0)})</span></div>
            <div className="mt-2 space-y-2">
              {cart.length === 0 ? <p className="rounded-card border border-dashed border-border p-6 text-center text-xs text-muted-foreground">اختر الأصناف من القائمة</p> : cart.map((line) => (
                <div key={line.key} className="rounded-card border border-border p-3">
                  <div className="flex items-start justify-between gap-2"><div><p className="text-xs font-bold">{line.name}</p>{line.modifierNames.length ? <p className="mt-1 text-[10px] text-muted-foreground">{line.modifierNames.join("، ")}</p> : null}</div><button type="button" onClick={() => setCart((current) => current.filter((item) => item.key !== line.key))} className="text-danger"><Trash2 className="size-3.5" /></button></div>
                  <div className="mt-2 flex items-center justify-between"><div className="flex items-center gap-2"><button type="button" onClick={() => changeQty(line.key,-1)} className="rounded border border-border p-1"><Minus className="size-3" /></button><span className="text-xs font-bold">{line.qty}</span><button type="button" onClick={() => changeQty(line.key,1)} className="rounded border border-border p-1"><Plus className="size-3" /></button></div><span className="text-xs font-extrabold">{formatSAR((line.unitPrice+line.modifierUnitTotal)*line.qty)}</span></div>
                </div>
              ))}
            </div>

            <div className="mt-4 space-y-2 border-t border-border pt-4 text-xs"><div className="flex justify-between"><span className="text-muted-foreground">تقدير المنتجات</span><span>{formatSAR(localSubtotal)}</span></div>{orderType === "delivery" ? <div className="flex justify-between"><span className="text-muted-foreground">تقدير التوصيل</span><span>{formatSAR(estimatedDelivery)}</span></div> : null}<div className="flex justify-between"><span className="text-muted-foreground">طريقة الدفع</span><span>{paymentMethod === "cash" ? "عند الاستلام" : "إلكتروني"}</span></div><div className="flex justify-between text-sm font-extrabold"><span>التقدير</span><span>{formatSAR(localSubtotal+estimatedDelivery)}</span></div><p className="text-[10px] text-muted-foreground">القيمة النهائية يعيد الخادم حسابها عند إنشاء الطلب.</p></div>

            {message ? <p className="mt-3 rounded-card bg-secondary px-3 py-2 text-xs font-bold">{message}</p> : null}
            <button type="button" onClick={submit} disabled={busy || cart.length===0} className="mt-4 w-full rounded-card bg-brand px-4 py-3 text-sm font-extrabold text-brand-ink disabled:opacity-50">{busy ? "جاري إنشاء الطلب…" : paymentMethod === "online" ? "إنشاء الطلب والمتابعة للدفع" : "إنشاء الطلب"}</button>
          </aside>
        </div>
      </div>

      {editingProduct ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/25 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-background p-4 shadow-xl">
            <div className="flex items-center justify-between"><div><h3 className="text-base font-extrabold">{editingProduct.name_ar}</h3><p className="mt-1 text-xs text-muted-foreground">{formatSAR(Number(editingProduct.price ?? 0))}</p></div><button type="button" onClick={() => setEditingProduct(null)} className="rounded-full p-2 hover:bg-secondary"><X className="size-4" /></button></div>
            <div className="mt-4 max-h-[50vh] space-y-4 overflow-y-auto">
              {(editingProduct.modifier_groups ?? []).map((group) => {
                const max = Number(group.max ?? 999); const single = max === 1;
                return <div key={group.id}><div className="flex items-center justify-between"><p className="text-xs font-extrabold">{group.name_ar}</p><span className="text-[10px] text-muted-foreground">{group.required ? "مطلوب" : "اختياري"}</span></div><div className="mt-2 grid gap-2">{(group.options ?? []).map((option) => <label key={option.id} className="flex cursor-pointer items-center justify-between rounded-card border border-border px-3 py-2 text-xs"><span className="flex items-center gap-2"><input type={single ? "radio" : "checkbox"} name={single ? group.id : undefined} checked={editModifiers.includes(option.id)} onChange={() => toggleModifier(group.id,option.id,single)} />{option.name_ar}</span><span>{Number(option.price ?? 0)>0 ? `+ ${formatSAR(Number(option.price))}` : ""}</span></label>)}</div></div>;
              })}
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-border pt-4"><div className="flex items-center gap-2"><button type="button" onClick={() => setEditQty((q) => Math.max(Number(editingProduct.min_qty ?? 1),q-1))} className="rounded border border-border p-2"><Minus className="size-3" /></button><span className="min-w-6 text-center text-sm font-bold">{editQty}</span><button type="button" onClick={() => setEditQty((q) => Math.min(Number(editingProduct.max_qty ?? 99),q+1))} className="rounded border border-border p-2"><Plus className="size-3" /></button></div><button type="button" onClick={addEditedProduct} className="rounded-card bg-brand px-5 py-2.5 text-xs font-extrabold text-brand-ink">إضافة للسلة</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1.5 text-xs font-bold"><span>{label}</span>{children}</label>;
}
