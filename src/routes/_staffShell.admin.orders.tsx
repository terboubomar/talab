import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Volume2, Wifi, WifiOff } from "lucide-react";

import { pushOrderToFoodics } from "@/lib/integrations";
import { formatSAR } from "@/lib/menu";
import { PAYMENT_STATUS_LABEL } from "@/lib/payments";
import { usePermissions } from "@/lib/permissions";
import {
  fetchStaffOrders,
  updateOrderStatus,
  ORDER_TYPE_LABEL,
  STATUS_LABEL,
  type OrderStatus,
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
function canCancel(order: StaffOrder) { return order.status !== "completed" && order.status !== "cancelled"; }

function StaffOrdersPage() {
  const [tab, setTab] = useState(DEFAULT_TAB.key);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [posPendingId, setPosPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const canManageIntegrations = can("integrations.manage");
  const audioContextRef = useRef<AudioContext | null>(null);
  const soundEnabledRef = useRef(false);
  const activeTab = TABS.find((t) => t.key === tab) ?? DEFAULT_TAB;

  const { data: orders, isLoading } = useQuery({
    queryKey: ["staff_orders", activeTab.statuses],
    queryFn: () => fetchStaffOrders(activeTab.statuses),
    refetchInterval: realtimeConnected ? 60_000 : 12_000,
  });
  const grouped = useMemo(() => orders ?? [], [orders]);

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
        const next = (payload.new ?? {}) as { payment_method?: string; payment_status?: string };
        const previous = (payload.old ?? {}) as { payment_method?: string; payment_status?: string };
        if (payload.eventType === "INSERT" && next.payment_method !== "online") { playNewOrderSound(); return; }
        if (payload.eventType === "UPDATE" && next.payment_method === "online" && confirmedStatuses.has(next.payment_status ?? "") && !confirmedStatuses.has(previous.payment_status ?? "")) playNewOrderSound();
      },
    ).subscribe((status) => { if (active) setRealtimeConnected(status === "SUBSCRIBED"); });
    return () => { active = false; setRealtimeConnected(false); void client.removeChannel(channel); };
  }, [queryClient]);

  useEffect(() => () => { const audioContext = audioContextRef.current; if (audioContext) void audioContext.close(); }, []);

  async function handleAction(orderId: string, next: OrderStatus) {
    setPendingId(orderId); setActionError(null);
    try {
      await updateOrderStatus(orderId, next);
      await queryClient.invalidateQueries({ queryKey: ["staff_orders"] });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setActionError(message.includes("payment_not_confirmed") ? "لا يمكن قبول الطلب قبل تأكيد الدفع الإلكتروني." : "تعذّر تحديث حالة الطلب");
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
      else if (message.includes("foodics_product_not_mapped") || message.includes("foodics_modifier_not_mapped")) setActionError("يحتوي الطلب على منتج أو إضافة غير مرتبطة بـ Foodics. اسحب القائمة أو راجع POS ID.");
      else setActionError("فشل إرسال الطلب إلى Foodics. راجع حالة الربط وسجل الإرسال.");
      await queryClient.invalidateQueries({ queryKey: ["staff_orders"] });
    } finally { setPosPendingId(null); }
  }

  return (
    <main className="min-h-screen pb-10">
      <header className="sticky top-0 z-20 border-b border-border bg-background px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-base font-extrabold">طلبات الفرع</h1>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-pill border px-2.5 py-1 text-[11px] font-bold ${realtimeConnected ? "border-success/30 bg-success/10 text-success" : "border-border text-muted-foreground"}`}>
              {realtimeConnected ? <Wifi aria-hidden className="size-3" /> : <WifiOff aria-hidden className="size-3" />}{realtimeConnected ? "مباشر" : "تحديث تلقائي"}
            </span>
            <button type="button" onClick={enableSound} className={`inline-flex items-center gap-1 rounded-pill border px-2.5 py-1 text-[11px] font-bold ${soundEnabled ? "border-brand/30 bg-brand/10 text-brand" : "border-border text-muted-foreground"}`}>
              <Volume2 aria-hidden className="size-3" />{soundEnabled ? "الصوت مفعّل" : "تفعيل الصوت"}
            </button>
          </div>
        </div>
        <nav className="mt-3 flex gap-2 overflow-x-auto">
          {TABS.map((t) => <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`shrink-0 rounded-pill px-4 py-2 text-sm font-bold ${t.key === tab ? "bg-brand text-brand-ink" : "border border-border text-muted-foreground"}`}>{t.label}</button>)}
        </nav>
      </header>

      <div className="px-5 py-6">
        {actionError ? <div className="mb-4 rounded-card border border-border bg-secondary p-3 text-center text-sm font-bold">{actionError}</div> : null}
        {isLoading ? (
          <div className="grid gap-3">{[0, 1].map((i) => <div key={i} className="card-surface h-28 animate-pulse opacity-60" />)}</div>
        ) : grouped.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">لا توجد طلبات في هذه القائمة حالياً</p>
        ) : (
          <div className="grid gap-3">
            {grouped.map((order) => {
              const action = nextAction(order);
              const isPending = pendingId === order.id;
              const isPosPending = posPendingId === order.id;
              return (
                <article key={order.id} className="card-surface p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-sm font-bold">{order.customers?.name ?? "عميل"}</span>
                      <span dir="ltr" className="ms-2 text-xs text-muted-foreground">{order.customers?.phone}</span>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="chip">{ORDER_TYPE_LABEL[order.order_type]}</span>
                        <span className="chip">{STATUS_LABEL[order.status]}</span>
                        <span className="chip">{order.payment_method === "cash" ? "الدفع عند الاستلام" : PAYMENT_STATUS_LABEL[order.payment_status]}</span>
                        <PosBadge order={order} />
                      </div>
                    </div>
                    <span className="text-sm font-bold text-brand">{formatSAR(order.total)}</span>
                  </div>

                  <ul className="mt-3 divide-y divide-border border-t border-border pt-2 text-sm">
                    {order.order_items.map((item) => <li key={item.id} className="flex flex-col gap-0.5 py-1.5"><div className="flex items-center justify-between"><span>{item.qty}× {item.name_ar}</span><span className="text-muted-foreground">{formatSAR(item.line_total)}</span></div>{item.order_item_modifiers.length > 0 ? <span className="text-xs text-muted-foreground">{item.order_item_modifiers.map((m) => m.name_ar).join("، ")}</span> : null}{item.notes ? <span className="text-xs text-muted-foreground">ملاحظة: {item.notes}</span> : null}</li>)}
                  </ul>
                  {order.notes ? <p className="mt-2 text-xs text-muted-foreground">ملاحظات الطلب: {order.notes}</p> : null}
                  {order.pos_last_error ? <p className="mt-2 rounded-card bg-danger/10 px-3 py-2 text-[11px] font-bold text-danger">فشل POS: {order.pos_last_error}</p> : null}
                  {order.pos_ref ? <p className="mt-2 text-[11px] text-muted-foreground" dir="ltr">Foodics ref: {order.pos_ref}</p> : null}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {action ? <button type="button" disabled={isPending} onClick={() => handleAction(order.id, action.next)} className="min-w-40 flex-1 rounded-pill bg-brand px-4 py-2.5 text-sm font-bold text-brand-ink disabled:opacity-50">{action.label}</button> : null}
                    {canManageIntegrations && order.pos_status !== "sent" ? <button type="button" disabled={isPosPending} onClick={() => handleFoodicsPush(order)} className="rounded-pill border border-brand/40 px-4 py-2.5 text-sm font-bold text-brand disabled:opacity-50">{isPosPending ? "جاري الإرسال…" : order.pos_status === "failed" ? "إعادة الإرسال إلى فودكس" : "إرسال إلى فودكس"}</button> : null}
                    {canCancel(order) ? <button type="button" disabled={isPending} onClick={() => handleAction(order.id, "cancelled")} className="rounded-pill border border-danger/40 px-4 py-2.5 text-sm font-bold text-danger disabled:opacity-50">إلغاء</button> : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <button type="button" onClick={() => queryClient.invalidateQueries({ queryKey: ["staff_orders"] })} className="mx-auto mt-6 flex items-center gap-1.5 text-xs font-bold text-muted-foreground"><RefreshCw aria-hidden className="size-3.5" />تحديث الآن</button>
      </div>
    </main>
  );
}

function PosBadge({ order }: { order: StaffOrder }) {
  if (order.pos_status === "sent") return <span className="rounded-pill bg-success/10 px-2 py-1 text-[10px] font-bold text-success">Foodics: تم الإرسال</span>;
  if (order.pos_status === "sending" || order.pos_status === "queued") return <span className="rounded-pill bg-brand/10 px-2 py-1 text-[10px] font-bold text-brand">Foodics: جاري الإرسال</span>;
  if (order.pos_status === "failed") return <span className="rounded-pill bg-danger/10 px-2 py-1 text-[10px] font-bold text-danger">Foodics: فشل الإرسال</span>;
  return <span className="rounded-pill bg-secondary px-2 py-1 text-[10px] font-bold text-muted-foreground">Foodics: لم يرسل</span>;
}
