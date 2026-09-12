import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FilterX, RefreshCw, Volume2, Wifi, WifiOff } from "lucide-react";

import { DeliveryAssignmentPanel } from "@/components/admin/DeliveryAssignmentPanel";
import { OrderDetailWorkspace } from "@/components/admin/OrderDetailWorkspace";
import { pushOrderToFoodics } from "@/lib/integrations";
import { formatSAR } from "@/lib/menu";
import { PAYMENT_STATUS_LABEL } from "@/lib/payments";
import { usePermissions } from "@/lib/permissions";
import {
  fetchOrderFilterOptions,
  fetchStaffOrders,
  updateOrderStatus,
  ORDER_SOURCE_LABEL,
  ORDER_TYPE_LABEL,
  STATUS_LABEL,
  type OrderStatus,
  type OrderType,
  type StaffOrder,
} from "@/lib/staff";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/_staffShell/admin/orders")({
  head: () => ({ meta: [{ title: "طلبات الفرع — طلب" }] }),
  component: StaffOrdersPage,
});

const TABS: { key: string; label: string; statuses: OrderStatus[] }[] = [
  { key: "pending", label: "بانتظار القبول", statuses: ["pending"] },
  { key: "active", label: "قيد التجهيز", statuses: ["accepted", "preparing"] },
  { key: "ready", label: "جاهزة", statuses: ["ready", "out_for_delivery"] },
  { key: "done", label: "مكتملة", statuses: ["completed", "cancelled"] },
];
const DEFAULT_TAB = TABS[0] as (typeof TABS)[number];

function nextAction(order: StaffOrder): { label: string; next: OrderStatus } | null {
  switch (order.status) {
    case "pending": return { label: "قبول الطلب", next: "accepted" };
    case "accepted": return { label: "بدء التجهيز", next: "preparing" };
    case "preparing": return { label: "جاهز", next: "ready" };
    case "ready": return order.order_type === "delivery" ? { label: "بدء التوصيل", next: "out_for_delivery" } : { label: "إكمال الطلب", next: "completed" };
    case "out_for_delivery": return { label: "تم التوصيل", next: "completed" };
    default: return null;
  }
}

function canCancel(order: StaffOrder) {
  return order.status !== "completed" && order.status !== "cancelled";
}

function formatPlacedAt(value: string) {
  try {
    return new Intl.DateTimeFormat("ar-SA", {
      timeZone: "Asia/Riyadh",
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

function StaffOrdersPage() {
  const [tab, setTab] = useState(DEFAULT_TAB.key);
  const [branchId, setBranchId] = useState("");
  const [orderType, setOrderType] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [source, setSource] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [posPendingId, setPosPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const canManageIntegrations = can("integrations.manage");
  const canViewDetail = can("orders.detail.view");
  const audioContextRef = useRef<AudioContext | null>(null);
  const soundEnabledRef = useRef(false);
  const activeTab = TABS.find((t) => t.key === tab) ?? DEFAULT_TAB;

  const { data: filterOptions } = useQuery({
    queryKey: ["staff_order_filter_options"],
    queryFn: fetchOrderFilterOptions,
  });

  const { data: orders, isLoading } = useQuery({
    queryKey: ["staff_orders", activeTab.statuses, branchId, orderType, paymentMethod, source],
    queryFn: () => fetchStaffOrders(activeTab.statuses, {
      branchId: branchId || null,
      orderType: (orderType || null) as OrderType | null,
      paymentMethod: (paymentMethod || null) as "cash" | "online" | null,
      source: source || null,
    }),
    refetchInterval: realtimeConnected ? 60_000 : 12_000,
  });
  const grouped = useMemo(() => orders ?? [], [orders]);
  const filtersActive = Boolean(branchId || orderType || paymentMethod || source);

  function clearFilters() {
    setBranchId("");
    setOrderType("");
    setPaymentMethod("");
    setSource("");
  }

  function playNewOrderSound() {
    if (!soundEnabledRef.current) return;
    const audioContext = audioContextRef.current;
    if (!audioContext || audioContext.state !== "running") return;
    const now = audioContext.currentTime;
    const gain = audioContext.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    gain.connect(audioContext.destination);
    const first = audioContext.createOscillator();
    first.type = "sine";
    first.frequency.setValueAtTime(880, now);
    first.connect(gain);
    first.start(now);
    first.stop(now + 0.18);
    const second = audioContext.createOscillator();
    second.type = "sine";
    second.frequency.setValueAtTime(1175, now + 0.2);
    second.connect(gain);
    second.start(now + 0.2);
    second.stop(now + 0.4);
  }

  async function enableSound() {
    if (typeof window === "undefined") return;
    try {
      const audioContext = audioContextRef.current ?? new window.AudioContext();
      audioContextRef.current = audioContext;
      if (audioContext.state === "suspended") await audioContext.resume();
      soundEnabledRef.current = true;
      setSoundEnabled(true);
      playNewOrderSound();
    } catch {
      setActionError("تعذّر تفعيل تنبيه الصوت على هذا الجهاز");
    }
  }

  useEffect(() => {
    if (!supabase) {
      setRealtimeConnected(false);
      return;
    }
    let active = true;
    const client = supabase;
    const confirmedStatuses = new Set(["paid", "partially_refunded"]);
    const channel = client.channel("staff-orders-kds").on(
      "postgres_changes",
      { event: "*", schema: "public", table: "orders" },
      (payload) => {
        void queryClient.invalidateQueries({ queryKey: ["staff_orders"] });
        if (selectedOrderId) void queryClient.invalidateQueries({ queryKey: ["staff_order_detail", selectedOrderId] });
        const next = (payload.new ?? {}) as { payment_method?: string; payment_status?: string };
        const previous = (payload.old ?? {}) as { payment_method?: string; payment_status?: string };
        if (payload.eventType === "INSERT" && next.payment_method !== "online") {
          playNewOrderSound();
          return;
        }
        if (
          payload.eventType === "UPDATE" && next.payment_method === "online" &&
          confirmedStatuses.has(next.payment_status ?? "") && !confirmedStatuses.has(previous.payment_status ?? "")
        ) playNewOrderSound();
      },
    ).subscribe((status) => {
      if (active) setRealtimeConnected(status === "SUBSCRIBED");
    });
    return () => {
      active = false;
      setRealtimeConnected(false);
      void client.removeChannel(channel);
    };
  }, [queryClient, selectedOrderId]);

  useEffect(() => () => {
    const audioContext = audioContextRef.current;
    if (audioContext) void audioContext.close();
  }, []);

  async function handleAction(orderId: string, next: OrderStatus) {
    setPendingId(orderId);
    setActionError(null);
    try {
      await updateOrderStatus(orderId, next);
      await queryClient.invalidateQueries({ queryKey: ["staff_orders"] });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("payment_not_confirmed")) setActionError("لا يمكن قبول الطلب قبل تأكيد الدفع الإلكتروني.");
      else if (message.includes("delivery_assignment_required")) setActionError("يجب إسناد طلب التوصيل إلى سائق أو شركة توصيل قبل بدء التوصيل.");
      else setActionError("تعذّر تحديث حالة الطلب");
    } finally {
      setPendingId(null);
    }
  }

  async function handleFoodicsPush(order: StaffOrder) {
    setPosPendingId(order.id);
    setActionError(null);
    try {
      const result = await pushOrderToFoodics(order.id);
      setActionError(result.alreadySent ? `الطلب مرسل مسبقاً إلى فودكس: ${result.foodicsOrderRef}` : `تم إرسال الطلب إلى فودكس: ${result.foodicsOrderRef}`);
      await queryClient.invalidateQueries({ queryKey: ["staff_orders"] });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("foodics_branch_not_mapped")) setActionError("فرع الطلب غير مربوط بفرع Foodics من متجر التطبيقات.");
      else if (message.includes("foodics_product_not_mapped") || message.includes("foodics_modifier_not_mapped")) setActionError("يحتوي الطلب على منتج أو إضافة غير مرتبطة بـ Foodics. اسحب القائمة أو راجع POS ID.");
      else setActionError("فشل إرسال الطلب إلى Foodics. راجع حالة الربط وسجل الإرسال.");
      await queryClient.invalidateQueries({ queryKey: ["staff_orders"] });
    } finally {
      setPosPendingId(null);
    }
  }

  return (
    <main className="min-h-screen pb-10">
      <header className="sticky top-0 z-20 border-b border-border bg-background px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-base font-extrabold">طلبات الفرع</h1>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{grouped.length} طلب في العرض الحالي</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-pill border px-2.5 py-1 text-[11px] font-bold ${realtimeConnected ? "border-success/30 bg-success/10 text-success" : "border-border text-muted-foreground"}`}>
              {realtimeConnected ? <Wifi aria-hidden className="size-3" /> : <WifiOff aria-hidden className="size-3" />}
              {realtimeConnected ? "مباشر" : "تحديث تلقائي"}
            </span>
            <button type="button" onClick={enableSound} className={`inline-flex items-center gap-1 rounded-pill border px-2.5 py-1 text-[11px] font-bold ${soundEnabled ? "border-brand/30 bg-brand/10 text-brand" : "border-border text-muted-foreground"}`}>
              <Volume2 aria-hidden className="size-3" />{soundEnabled ? "الصوت مفعّل" : "تفعيل الصوت"}
            </button>
          </div>
        </div>
        <nav className="mt-3 flex gap-2 overflow-x-auto">
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`shrink-0 rounded-pill px-4 py-2 text-sm font-bold ${t.key === tab ? "bg-brand text-brand-ink" : "border border-border text-muted-foreground"}`}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="px-5 py-6">
        <section className="mb-4 rounded-card border border-border bg-background p-3">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <OrderFilter value={branchId} onChange={setBranchId} label="الفرع">
              <option value="">كل الفروع</option>
              {filterOptions?.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </OrderFilter>
            <OrderFilter value={orderType} onChange={setOrderType} label="نوع الطلب">
              <option value="">كل الأنواع</option>
              {(Object.keys(ORDER_TYPE_LABEL) as OrderType[]).map((type) => <option key={type} value={type}>{ORDER_TYPE_LABEL[type]}</option>)}
            </OrderFilter>
            <OrderFilter value={paymentMethod} onChange={setPaymentMethod} label="طريقة الدفع">
              <option value="">كل طرق الدفع</option>
              <option value="cash">الدفع عند الاستلام</option>
              <option value="online">دفع إلكتروني</option>
            </OrderFilter>
            <OrderFilter value={source} onChange={setSource} label="مصدر الطلب">
              <option value="">كل المصادر</option>
              {(filterOptions?.sources ?? []).map((item) => <option key={item} value={item}>{ORDER_SOURCE_LABEL[item] ?? item}</option>)}
            </OrderFilter>
            <div className="flex items-end">
              <button type="button" onClick={clearFilters} disabled={!filtersActive} className="flex w-full items-center justify-center gap-1.5 rounded-card border border-border px-3 py-2.5 text-xs font-bold disabled:opacity-40">
                <FilterX className="size-3.5" /> مسح الفلاتر
              </button>
            </div>
          </div>
        </section>

        {actionError ? <div className="mb-4 rounded-card border border-border bg-secondary p-3 text-center text-sm font-bold">{actionError}</div> : null}
        {isLoading ? (
          <div className="grid gap-3">{[0, 1].map((i) => <div key={i} className="card-surface h-28 animate-pulse opacity-60" />)}</div>
        ) : grouped.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm font-bold">لا توجد طلبات مطابقة</p>
            <p className="mt-1 text-xs text-muted-foreground">غيّر الحالة أو امسح بعض الفلاتر.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {grouped.map((order) => {
              const action = nextAction(order);
              const isPending = pendingId === order.id;
              const isPosPending = posPendingId === order.id;
              const sourceLabel = ORDER_SOURCE_LABEL[order.source] ?? order.source;
              return (
                <article
                  key={order.id}
                  role={canViewDetail ? "button" : undefined}
                  tabIndex={canViewDetail ? 0 : undefined}
                  onClick={() => { if (canViewDetail) setSelectedOrderId(order.id); }}
                  onKeyDown={(event) => { if (canViewDetail && (event.key === "Enter" || event.key === " ")) setSelectedOrderId(order.id); }}
                  className={`card-surface p-4 ${order.source === "call_center" ? "border-brand/30" : ""} ${canViewDetail ? "cursor-pointer transition hover:border-brand/40 hover:shadow-sm" : ""}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold">{order.customers?.name ?? "عميل"}</span>
                        <span dir="ltr" className="text-xs text-muted-foreground">{order.customers?.phone}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="chip">{ORDER_TYPE_LABEL[order.order_type]}</span>
                        <span className="chip">{STATUS_LABEL[order.status]}</span>
                        <span className="chip">{order.payment_method === "cash" ? "الدفع عند الاستلام" : PAYMENT_STATUS_LABEL[order.payment_status]}</span>
                        <span className={`rounded-pill px-2 py-1 text-[10px] font-bold ${order.source === "call_center" ? "bg-brand/10 text-brand" : "bg-secondary text-muted-foreground"}`}>{sourceLabel}</span>
                        {order.branches?.name_ar ? <span className="chip">{order.branches.name_ar}</span> : null}
                        <PosBadge order={order} />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                        <span>#{order.id.slice(0, 8)}</span>
                        <span>{formatPlacedAt(order.placed_at)}</span>
                        {order.source === "call_center" ? <span>موظف خدمة العملاء: <strong className="text-foreground">{order.created_by_staff?.name ?? "غير محدد"}</strong></span> : null}
                      </div>
                    </div>
                    <span className="shrink-0 text-sm font-bold text-brand">{formatSAR(order.total)}</span>
                  </div>

                  <ul className="mt-3 divide-y divide-border border-t border-border pt-2 text-sm">
                    {order.order_items.map((item) => (
                      <li key={item.id} className="flex flex-col gap-0.5 py-1.5">
                        <div className="flex items-center justify-between"><span>{item.qty}× {item.name_ar}</span><span className="text-muted-foreground">{formatSAR(item.line_total)}</span></div>
                        {item.order_item_modifiers.length > 0 ? <span className="text-xs text-muted-foreground">{item.order_item_modifiers.map((m) => m.name_ar).join("، ")}</span> : null}
                        {item.notes ? <span className="text-xs text-muted-foreground">ملاحظة: {item.notes}</span> : null}
                      </li>
                    ))}
                  </ul>
                  {order.notes ? <p className="mt-2 text-xs text-muted-foreground">ملاحظات الطلب: {order.notes}</p> : null}
                  {order.pos_last_error ? <p className="mt-2 rounded-card bg-danger/10 px-3 py-2 text-[11px] font-bold text-danger">فشل POS: {order.pos_last_error}</p> : null}
                  {order.pos_ref ? <p className="mt-2 text-[11px] text-muted-foreground" dir="ltr">Foodics ref: {order.pos_ref}</p> : null}

                  <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                    {order.order_type === "delivery" ? <DeliveryAssignmentPanel orderId={order.id} status={order.status} /> : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {action ? <button type="button" disabled={isPending} onClick={() => handleAction(order.id, action.next)} className="min-w-40 flex-1 rounded-pill bg-brand px-4 py-2.5 text-sm font-bold text-brand-ink disabled:opacity-50">{action.label}</button> : null}
                      {canManageIntegrations && order.pos_status !== "sent" ? <button type="button" disabled={isPosPending} onClick={() => handleFoodicsPush(order)} className="rounded-pill border border-brand/40 px-4 py-2.5 text-sm font-bold text-brand disabled:opacity-50">{isPosPending ? "جاري الإرسال…" : order.pos_status === "failed" ? "إعادة الإرسال إلى فودكس" : "إرسال إلى فودكس"}</button> : null}
                      {canCancel(order) ? <button type="button" disabled={isPending} onClick={() => handleAction(order.id, "cancelled")} className="rounded-pill border border-danger/40 px-4 py-2.5 text-sm font-bold text-danger disabled:opacity-50">إلغاء</button> : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <button type="button" onClick={() => queryClient.invalidateQueries({ queryKey: ["staff_orders"] })} className="mx-auto mt-6 flex items-center gap-1.5 text-xs font-bold text-muted-foreground"><RefreshCw aria-hidden className="size-3.5" />تحديث الآن</button>
      </div>

      {selectedOrderId ? <OrderDetailWorkspace orderId={selectedOrderId} onClose={() => setSelectedOrderId(null)} /> : null}
    </main>
  );
}

function OrderFilter({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-[11px] font-bold text-muted-foreground">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="rounded-card border border-border bg-background px-3 py-2.5 text-xs font-bold text-foreground">
        {children}
      </select>
    </label>
  );
}

function PosBadge({ order }: { order: StaffOrder }) {
  if (order.pos_status === "sent") return <span className="rounded-pill bg-success/10 px-2 py-1 text-[10px] font-bold text-success">Foodics: تم الإرسال</span>;
  if (order.pos_status === "sending" || order.pos_status === "queued") return <span className="rounded-pill bg-brand/10 px-2 py-1 text-[10px] font-bold text-brand">Foodics: جاري الإرسال</span>;
  if (order.pos_status === "failed") return <span className="rounded-pill bg-danger/10 px-2 py-1 text-[10px] font-bold text-danger">Foodics: فشل الإرسال</span>;
  return <span className="rounded-pill bg-secondary px-2 py-1 text-[10px] font-bold text-muted-foreground">Foodics: لم يرسل</span>;
}
