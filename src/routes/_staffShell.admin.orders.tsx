import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Clock3, FilterX, RefreshCw, Search, Store, UserRound, Volume2, Wifi, WifiOff } from "lucide-react";

import { DeliveryAssignmentPanel } from "@/components/admin/DeliveryAssignmentPanel";
import { OrderDetailWorkspace } from "@/components/admin/OrderDetailWorkspace";
import { pushOrderToFoodics } from "@/lib/integrations";
import { formatSAR } from "@/lib/menu";
import { PAYMENT_STATUS_LABEL } from "@/lib/payments";
import { usePermissions } from "@/lib/permissions";
import {
  fetchOrderFilterOptions,
  fetchOrderTabCounts,
  fetchStaffOrders,
  updateOrderStatus,
  ORDER_SOURCE_LABEL,
  ORDER_TYPE_LABEL,
  STATUS_LABEL,
  type OrderStatus,
  type OrderType,
  type OrderView,
  type StaffOrder,
} from "@/lib/staff";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/_staffShell/admin/orders")({
  head: () => ({ meta: [{ title: "الطلبات — طلب" }] }),
  component: StaffOrdersPage,
});

const TABS: Array<{ key: OrderView; label: string }> = [
  { key: "active", label: "نشط" },
  { key: "today", label: "اليوم" },
  { key: "scheduled", label: "مجدول" },
  { key: "all", label: "الكل" },
];

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

function statusTone(status: OrderStatus) {
  if (status === "pending") return "border-amber-300/70 bg-amber-50 text-amber-700";
  if (status === "accepted" || status === "preparing") return "border-blue-300/70 bg-blue-50 text-blue-700";
  if (status === "ready") return "border-emerald-300/70 bg-emerald-50 text-emerald-700";
  if (status === "out_for_delivery") return "border-violet-300/70 bg-violet-50 text-violet-700";
  if (status === "completed") return "border-success/30 bg-success/10 text-success";
  return "border-danger/30 bg-danger/10 text-danger";
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
  } catch { return ""; }
}

function elapsed(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "الآن";
  if (minutes < 60) return `منذ ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  return `منذ ${Math.floor(hours / 24)} يوم`;
}

function StaffOrdersPage() {
  const [tab, setTab] = useState<OrderView>("active");
  const [branchId, setBranchId] = useState("");
  const [orderType, setOrderType] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [source, setSource] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
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

  const { data: filterOptions } = useQuery({ queryKey: ["staff_order_filter_options"], queryFn: fetchOrderFilterOptions });
  const { data: counts } = useQuery({
    queryKey: ["staff_order_tab_counts"],
    queryFn: fetchOrderTabCounts,
    refetchInterval: realtimeConnected ? 60_000 : 20_000,
  });
  const { data: orders, isLoading } = useQuery({
    queryKey: ["staff_orders", tab, branchId, orderType, paymentMethod, source, status],
    queryFn: () => fetchStaffOrders(tab, {
      branchId: branchId || null,
      orderType: (orderType || null) as OrderType | null,
      paymentMethod: (paymentMethod || null) as "cash" | "online" | null,
      source: source || null,
      status: (status || null) as OrderStatus | null,
    }),
    refetchInterval: realtimeConnected ? 60_000 : 12_000,
  });

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase().replaceAll(" ", "");
    if (!q) return orders ?? [];
    return (orders ?? []).filter((order) => {
      const haystack = [
        order.id,
        order.id.slice(0, 8),
        order.customers?.phone ?? "",
        order.customers?.name ?? "",
      ].join(" ").toLowerCase().replaceAll(" ", "");
      return haystack.includes(q);
    });
  }, [orders, search]);

  const filtersActive = Boolean(branchId || orderType || paymentMethod || source || status || search);

  function clearFilters() {
    setBranchId(""); setOrderType(""); setPaymentMethod(""); setSource(""); setStatus(""); setSearch("");
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
    first.type = "sine"; first.frequency.setValueAtTime(880, now); first.connect(gain); first.start(now); first.stop(now + 0.18);
    const second = audioContext.createOscillator();
    second.type = "sine"; second.frequency.setValueAtTime(1175, now + 0.2); second.connect(gain); second.start(now + 0.2); second.stop(now + 0.4);
  }

  async function enableSound() {
    if (typeof window === "undefined") return;
    try {
      const audioContext = audioContextRef.current ?? new window.AudioContext();
      audioContextRef.current = audioContext;
      if (audioContext.state === "suspended") await audioContext.resume();
      soundEnabledRef.current = true; setSoundEnabled(true); playNewOrderSound();
    } catch { setActionError("تعذّر تفعيل تنبيه الصوت على هذا الجهاز"); }
  }

  useEffect(() => {
    if (!supabase) { setRealtimeConnected(false); return; }
    let active = true;
    const client = supabase;
    const confirmedStatuses = new Set(["paid", "partially_refunded"]);
    const channel = client.channel("staff-orders-kds").on(
      "postgres_changes",
      { event: "*", schema: "public", table: "orders" },
      (payload) => {
        void queryClient.invalidateQueries({ queryKey: ["staff_orders"] });
        void queryClient.invalidateQueries({ queryKey: ["staff_order_tab_counts"] });
        if (selectedOrderId) void queryClient.invalidateQueries({ queryKey: ["staff_order_detail", selectedOrderId] });
        const next = (payload.new ?? {}) as { payment_method?: string; payment_status?: string };
        const previous = (payload.old ?? {}) as { payment_method?: string; payment_status?: string };
        if (payload.eventType === "INSERT" && next.payment_method !== "online") { playNewOrderSound(); return; }
        if (payload.eventType === "UPDATE" && next.payment_method === "online" && confirmedStatuses.has(next.payment_status ?? "") && !confirmedStatuses.has(previous.payment_status ?? "")) playNewOrderSound();
      },
    ).subscribe((connectionStatus) => { if (active) setRealtimeConnected(connectionStatus === "SUBSCRIBED"); });
    return () => { active = false; setRealtimeConnected(false); void client.removeChannel(channel); };
  }, [queryClient, selectedOrderId]);

  useEffect(() => () => { const audioContext = audioContextRef.current; if (audioContext) void audioContext.close(); }, []);

  async function handleAction(orderId: string, next: OrderStatus) {
    setPendingId(orderId); setActionError(null);
    try {
      await updateOrderStatus(orderId, next);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["staff_orders"] }),
        queryClient.invalidateQueries({ queryKey: ["staff_order_tab_counts"] }),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("payment_not_confirmed")) setActionError("لا يمكن قبول الطلب قبل تأكيد الدفع الإلكتروني.");
      else if (message.includes("delivery_assignment_required")) setActionError("يجب إسناد طلب التوصيل إلى سائق أو شركة توصيل قبل بدء التوصيل.");
      else setActionError("تعذّر تحديث حالة الطلب");
    } finally { setPendingId(null); }
  }

  async function handleFoodicsPush(order: StaffOrder) {
    setPosPendingId(order.id); setActionError(null);
    try {
      const result = await pushOrderToFoodics(order.id);
      setActionError(result.alreadySent ? `الطلب مرسل مسبقاً إلى فودكس: ${result.foodicsOrderRef}` : `تم إرسال الطلب إلى فودكس: ${result.foodicsOrderRef}`);
      await queryClient.invalidateQueries({ queryKey: ["staff_orders"] });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("foodics_branch_not_mapped")) setActionError("فرع الطلب غير مربوط بفرع Foodics من متجر التطبيقات.");
      else if (message.includes("foodics_product_not_mapped") || message.includes("foodics_modifier_not_mapped")) setActionError("يحتوي الطلب على منتج أو إضافة غير مرتبطة بـ Foodics.");
      else setActionError("فشل إرسال الطلب إلى Foodics. راجع حالة الربط.");
    } finally { setPosPendingId(null); }
  }

  return (
    <main className="min-h-screen pb-10">
      <header className="sticky top-0 z-20 border-b border-border bg-background px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h1 className="text-base font-extrabold">الطلبات</h1><p className="mt-0.5 text-[11px] text-muted-foreground">إدارة ومتابعة جميع طلبات الفروع</p></div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-pill border px-2.5 py-1 text-[11px] font-bold ${realtimeConnected ? "border-success/30 bg-success/10 text-success" : "border-border text-muted-foreground"}`}>
              {realtimeConnected ? <Wifi className="size-3" /> : <WifiOff className="size-3" />}{realtimeConnected ? "مباشر" : "تحديث تلقائي"}
            </span>
            <button type="button" onClick={enableSound} className={`inline-flex items-center gap-1 rounded-pill border px-2.5 py-1 text-[11px] font-bold ${soundEnabled ? "border-brand/30 bg-brand/10 text-brand" : "border-border text-muted-foreground"}`}><Volume2 className="size-3" />{soundEnabled ? "الصوت مفعّل" : "تفعيل الصوت"}</button>
          </div>
        </div>
        <nav className="mt-4 flex gap-2 overflow-x-auto">
          {TABS.map((item) => (
            <button key={item.key} type="button" onClick={() => setTab(item.key)} className={`flex shrink-0 items-center gap-2 rounded-pill px-4 py-2 text-sm font-bold ${item.key === tab ? "bg-brand text-brand-ink" : "border border-border text-muted-foreground"}`}>
              {item.label}<span className={`rounded-full px-2 py-0.5 text-[10px] ${item.key === tab ? "bg-black/10" : "bg-secondary"}`}>{counts?.[item.key] ?? "—"}</span>
            </button>
          ))}
        </nav>
      </header>

      <div className="px-5 py-6">
        <section className="mb-4 rounded-card border border-border bg-background p-3">
          <div className="relative mb-3"><Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="ابحث برقم الطلب أو جوال أو اسم العميل..." className="w-full rounded-card border border-border bg-background py-2.5 pe-10 ps-3 text-sm" /></div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <OrderFilter value={branchId} onChange={setBranchId} label="الفرع"><option value="">كل الفروع</option>{filterOptions?.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</OrderFilter>
            <OrderFilter value={status} onChange={setStatus} label="الحالة"><option value="">كل الحالات</option>{(Object.keys(STATUS_LABEL) as OrderStatus[]).map((item)=><option key={item} value={item}>{STATUS_LABEL[item]}</option>)}</OrderFilter>
            <OrderFilter value={orderType} onChange={setOrderType} label="نوع الطلب"><option value="">كل الأنواع</option>{(Object.keys(ORDER_TYPE_LABEL) as OrderType[]).map((type) => <option key={type} value={type}>{ORDER_TYPE_LABEL[type]}</option>)}</OrderFilter>
            <OrderFilter value={source} onChange={setSource} label="المصدر"><option value="">كل المصادر</option>{(filterOptions?.sources ?? []).map((item) => <option key={item} value={item}>{ORDER_SOURCE_LABEL[item] ?? item}</option>)}</OrderFilter>
            <OrderFilter value={paymentMethod} onChange={setPaymentMethod} label="الدفع"><option value="">كل طرق الدفع</option><option value="cash">عند الاستلام</option><option value="online">إلكتروني</option></OrderFilter>
            <div className="flex items-end"><button type="button" onClick={clearFilters} disabled={!filtersActive} className="flex w-full items-center justify-center gap-1.5 rounded-card border border-border px-3 py-2.5 text-xs font-bold disabled:opacity-40"><FilterX className="size-3.5" /> مسح</button></div>
          </div>
        </section>

        {actionError ? <div className="mb-4 rounded-card border border-border bg-secondary p-3 text-center text-sm font-bold">{actionError}</div> : null}
        {isLoading ? <div className="grid gap-3">{[0,1,2].map((i)=><div key={i} className="card-surface h-40 animate-pulse opacity-60" />)}</div> : grouped.length === 0 ? (
          <div className="py-16 text-center"><p className="text-sm font-bold">لا توجد طلبات مطابقة</p><p className="mt-1 text-xs text-muted-foreground">غيّر الفلاتر أو اختر تبويباً آخر.</p></div>
        ) : (
          <div className="grid gap-4">
            {grouped.map((order) => {
              const action = nextAction(order);
              const isPending = pendingId === order.id;
              const isPosPending = posPendingId === order.id;
              const customerName = order.customers?.name ?? "عميل";
              const customerPhone = order.customers?.phone ?? "";
              const itemCount = order.order_items.reduce((sum, item) => sum + Number(item.qty), 0);
              return (
                <article
                  key={order.id}
                  role={canViewDetail ? "button" : undefined}
                  tabIndex={canViewDetail ? 0 : undefined}
                  onClick={() => { if (canViewDetail) setSelectedOrderId(order.id); }}
                  onKeyDown={(event) => { if (canViewDetail && (event.key === "Enter" || event.key === " ")) setSelectedOrderId(order.id); }}
                  className={`group overflow-hidden rounded-2xl border border-border bg-background shadow-sm transition ${canViewDetail ? "cursor-pointer hover:-translate-y-0.5 hover:border-brand/35 hover:shadow-md" : ""}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-secondary/35 px-4 py-3 sm:px-5">
                    <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                      <span className={`rounded-pill border px-2.5 py-1 text-[11px] font-extrabold ${statusTone(order.status)}`}>{STATUS_LABEL[order.status]}</span>
                      <span dir="ltr" className="text-sm font-black tracking-wide">#{order.id.slice(0, 8).toUpperCase()}</span>
                      <span className="hidden h-4 w-px bg-border sm:block" />
                      <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-bold text-foreground"><Store className="size-3.5 shrink-0 text-brand" /><span className="truncate">{order.branches?.name_ar ?? "الفرع غير محدد"}</span></span>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-muted-foreground"><Clock3 className="size-3.5" />{elapsed(order.placed_at)}</span>
                  </div>

                  <div className="grid gap-4 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,.42fr)] lg:gap-6">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"><UserRound className="size-4" /></span>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-extrabold text-foreground">{customerName}</p>
                              {customerPhone ? <p dir="ltr" className="mt-0.5 text-left text-[11px] font-medium text-muted-foreground">{customerPhone}</p> : null}
                            </div>
                          </div>
                        </div>
                        {canViewDetail ? <span className="inline-flex items-center gap-1 text-[11px] font-bold text-muted-foreground transition group-hover:text-brand">عرض التفاصيل <ChevronLeft className="size-3.5" /></span> : null}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <MetaChip>{ORDER_TYPE_LABEL[order.order_type]}</MetaChip>
                        <MetaChip>{ORDER_SOURCE_LABEL[order.source] ?? order.source}</MetaChip>
                        <MetaChip>{order.payment_method === "cash" ? "الدفع عند الاستلام" : PAYMENT_STATUS_LABEL[order.payment_status]}</MetaChip>
                        {order.source === "call_center" && order.created_by_staff?.name ? <MetaChip>الموظف: {order.created_by_staff.name}</MetaChip> : null}
                      </div>

                      <div className="mt-4 rounded-xl border border-border bg-secondary/25 px-3 py-2.5">
                        <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] font-bold text-muted-foreground">
                          <span>الأصناف · {itemCount}</span>
                          <span>{formatPlacedAt(order.placed_at)}</span>
                        </div>
                        <div className="space-y-1.5">
                          {order.order_items.slice(0, 3).map((item) => (
                            <div key={item.id} className="flex items-center justify-between gap-3 text-xs">
                              <span className="min-w-0 truncate font-bold"><span className="me-1 text-brand">{item.qty}×</span>{item.name_ar}</span>
                              <span className="shrink-0 text-muted-foreground">{formatSAR(Number(item.line_total))}</span>
                            </div>
                          ))}
                        </div>
                        {order.order_items.length > 3 ? <p className="mt-2 text-[11px] font-bold text-brand">+ {order.order_items.length - 3} أصناف أخرى</p> : null}
                      </div>

                      {order.scheduled_for ? <p className="mt-2 text-[11px] font-bold text-violet-700">مجدول: {formatPlacedAt(order.scheduled_for)}</p> : null}
                      {order.pos_last_error ? <p className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-[11px] font-bold text-danger">تعذّر إرسال الطلب إلى POS</p> : null}
                    </div>

                    <aside className="flex flex-col justify-between rounded-xl border border-border bg-background p-3.5 lg:border-0 lg:border-r lg:rounded-none lg:ps-5">
                      <div>
                        <p className="text-[11px] font-bold text-muted-foreground">إجمالي الطلب</p>
                        <p className="mt-1 text-xl font-black text-foreground">{formatSAR(Number(order.total))}</p>
                        <p className="mt-1 text-[10px] text-muted-foreground">{order.payment_method === "cash" ? "تحصيل عند الاستلام" : PAYMENT_STATUS_LABEL[order.payment_status]}</p>
                      </div>

                      <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} className="mt-4">
                        {order.order_type === "delivery" && (order.status === "ready" || order.status === "out_for_delivery") ? <DeliveryAssignmentPanel orderId={order.id} status={order.status} /> : null}
                        <div className="mt-3 grid gap-2">
                          {action ? <button type="button" disabled={isPending} onClick={() => handleAction(order.id, action.next)} className="w-full rounded-xl bg-brand px-4 py-3 text-sm font-extrabold text-brand-ink shadow-sm transition hover:brightness-95 disabled:opacity-50">{isPending ? "جاري التحديث…" : action.label}</button> : <span className="rounded-xl bg-secondary px-4 py-3 text-center text-xs font-bold text-muted-foreground">لا يوجد إجراء مطلوب</span>}
                          <div className="flex gap-2">
                            {canManageIntegrations && order.pos_status === "failed" ? <button type="button" disabled={isPosPending} onClick={() => handleFoodicsPush(order)} className="flex-1 rounded-lg border border-brand/30 px-3 py-2 text-[11px] font-bold text-brand disabled:opacity-50">{isPosPending ? "جاري الإرسال…" : "إعادة POS"}</button> : null}
                            {canCancel(order) ? <button type="button" disabled={isPending} onClick={() => handleAction(order.id, "cancelled")} className="flex-1 rounded-lg border border-border px-3 py-2 text-[11px] font-bold text-muted-foreground transition hover:border-danger/30 hover:text-danger disabled:opacity-50">إلغاء الطلب</button> : null}
                          </div>
                        </div>
                      </div>
                    </aside>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {tab === "all" && grouped.length >= 200 ? <p className="mt-4 text-center text-xs text-muted-foreground">يعرض آخر 200 طلب. استخدم البحث والفلاتر لتضييق النتائج.</p> : null}
        <button type="button" onClick={() => { void queryClient.invalidateQueries({ queryKey: ["staff_orders"] }); void queryClient.invalidateQueries({ queryKey: ["staff_order_tab_counts"] }); }} className="mx-auto mt-6 flex items-center gap-1.5 text-xs font-bold text-muted-foreground"><RefreshCw className="size-3.5" />تحديث الآن</button>
      </div>

      {selectedOrderId ? <OrderDetailWorkspace orderId={selectedOrderId} onClose={() => setSelectedOrderId(null)} /> : null}
    </main>
  );
}

function MetaChip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-pill border border-border bg-background px-2.5 py-1 text-[10px] font-bold text-muted-foreground">{children}</span>;
}

function OrderFilter({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return <label className="grid gap-1 text-[11px] font-bold text-muted-foreground">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="rounded-card border border-border bg-background px-3 py-2.5 text-xs font-bold text-foreground">{children}</select></label>;
}
