import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ChevronDown, ChevronUp, Printer, RefreshCw, RotateCcw, X } from "lucide-react";

import { pushOrderToFoodics } from "@/lib/integrations";
import { formatSAR } from "@/lib/menu";
import { fetchOrderDetail } from "@/lib/order-detail";
import { PAYMENT_STATUS_LABEL } from "@/lib/payments";
import { usePermissions } from "@/lib/permissions";
import { createGatewayRefund, createManualRefund, ORDER_SOURCE_LABEL, ORDER_TYPE_LABEL, STATUS_LABEL } from "@/lib/staff";

export function OrderDetailWorkspace({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [tab, setTab] = useState<"details" | "history">("details");
  const [moreOpen, setMoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");

  const detailQuery = useQuery({
    queryKey: ["staff_order_detail", orderId],
    queryFn: () => fetchOrderDetail(orderId),
  });

  const detail = detailQuery.data;
  const order = detail?.order;
  const refunded = useMemo(
    () => detail?.refunds.filter((row) => row.status === "completed").reduce((sum, row) => sum + Number(row.amount), 0) ?? 0,
    [detail],
  );

  async function resendPos() {
    if (!order) return;
    setBusy(true); setMessage(null);
    try {
      const result = await pushOrderToFoodics(order.id);
      setMessage(result.alreadySent ? "الطلب مرسل مسبقاً إلى Foodics" : "تم إرسال الطلب إلى Foodics");
      await detailQuery.refetch();
      await queryClient.invalidateQueries({ queryKey: ["staff_orders"] });
    } catch {
      setMessage("فشل إرسال الطلب إلى Foodics. راجع الربط أو معرفات المنتجات.");
    } finally { setBusy(false); }
  }

  async function submitRefund() {
    if (!order) return;
    const amount = Number(refundAmount);
    if (!Number.isFinite(amount) || amount <= 0 || !refundReason.trim()) {
      setMessage("أدخل قيمة استرجاع صحيحة وسبب العملية");
      return;
    }
    setBusy(true); setMessage(null);
    try {
      if (order.payment_method === "online") {
        await createGatewayRefund({ orderId: order.id, amount, reason: refundReason.trim(), kind: "order" });
      } else {
        await createManualRefund({ orderId: order.id, amount, reason: refundReason.trim(), kind: "order" });
      }
      setRefundOpen(false); setRefundAmount(""); setRefundReason("");
      setMessage("تم تسجيل الاسترجاع");
      await detailQuery.refetch();
    } catch {
      setMessage("تعذّر تنفيذ الاسترجاع. راجع الصلاحيات والقيمة المتاحة.");
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-background" dir="rtl">
      <div className="flex h-full flex-col">
        <header className="border-b border-border bg-background px-4 py-3 print:border-0">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button type="button" onClick={onClose} className="rounded-full border border-border p-2 hover:bg-secondary print:hidden"><ArrowRight className="size-4" /></button>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-base font-extrabold">طلب {order ? `#${order.id.slice(0, 8)}` : ""}</h1>
                  {order ? <span className="rounded-pill bg-secondary px-2.5 py-1 text-[11px] font-bold">{STATUS_LABEL[order.status]}</span> : null}
                </div>
                {order ? <p className="mt-1 text-xs font-bold text-brand">{order.branch_name || "الفرع غير محدد"}</p> : null}
              </div>
            </div>
            <div className="flex items-center gap-2 print:hidden">
              <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-card border border-border px-3 py-2 text-xs font-bold"><Printer className="size-3.5" /> طباعة</button>
              <button type="button" onClick={() => detailQuery.refetch()} className="rounded-card border border-border p-2"><RefreshCw className="size-4" /></button>
              <button type="button" onClick={onClose} className="rounded-card border border-border p-2"><X className="size-4" /></button>
            </div>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
          <div className="mx-auto max-w-6xl">
            {detailQuery.isLoading ? <div className="grid gap-3 md:grid-cols-3">{[0,1,2].map((i)=><div key={i} className="card-surface h-28 animate-pulse opacity-60" />)}</div> : null}
            {detailQuery.error ? <div className="card-surface p-6 text-center text-sm font-bold text-danger">تعذّر فتح تفاصيل الطلب أو لا تملك صلاحية عرضها.</div> : null}
            {order && detail ? (
              <>
                <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <Info label="الفرع" value={order.branch_name || "—"} emphasize />
                  <Info label="نوع الطلب" value={ORDER_TYPE_LABEL[order.order_type]} />
                  <Info label="الدفع" value={order.payment_method === "cash" ? "عند الاستلام" : PAYMENT_STATUS_LABEL[order.payment_status]} />
                  <Info label="الوقت" value={formatDateTime(order.placed_at)} />
                  <Info label="الإجمالي" value={formatSAR(Number(order.total))} emphasize />
                </section>

                <div className="mt-4 flex gap-2 border-b border-border pb-3 print:hidden">
                  <button type="button" onClick={() => setTab("details")} className={`rounded-pill px-4 py-2 text-xs font-bold ${tab === "details" ? "bg-brand text-brand-ink" : "bg-secondary"}`}>تفاصيل الطلب</button>
                  <button type="button" onClick={() => setTab("history")} className={`rounded-pill px-4 py-2 text-xs font-bold ${tab === "history" ? "bg-brand text-brand-ink" : "bg-secondary"}`}>السجل</button>
                </div>

                {tab === "details" ? (
                  <section className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,.7fr)]">
                    <div className="space-y-4">
                      <section className="card-surface overflow-hidden border border-border">
                        <div className="border-b border-border px-4 py-3"><h2 className="text-sm font-extrabold">الأصناف</h2></div>
                        <div className="divide-y divide-border">
                          {detail.items.map((item) => (
                            <div key={item.id} className="flex items-start justify-between gap-4 px-4 py-3">
                              <div className="min-w-0">
                                <p className="text-sm font-bold">{item.qty}× {item.name_ar}</p>
                                {item.modifiers.length ? <p className="mt-1 text-xs text-muted-foreground">{item.modifiers.map((m)=>m.name_ar).join("، ")}</p> : null}
                                {item.notes ? <p className="mt-1 text-xs text-muted-foreground">ملاحظة: {item.notes}</p> : null}
                              </div>
                              <span className="shrink-0 text-sm font-extrabold">{formatSAR(Number(item.line_total))}</span>
                            </div>
                          ))}
                        </div>
                      </section>

                      {order.delivery_address_text ? <section className="card-surface border border-border p-4"><h3 className="text-sm font-extrabold">التوصيل</h3><p className="mt-2 text-sm">{order.delivery_address_text}</p>{order.driver_name || order.delivery_provider_name ? <p className="mt-2 text-xs text-muted-foreground">المسند إليه: {order.driver_name ?? order.delivery_provider_name}</p> : null}</section> : null}
                      {order.notes ? <section className="card-surface border border-border p-4"><h3 className="text-sm font-extrabold">ملاحظات الطلب</h3><p className="mt-2 text-sm">{order.notes}</p></section> : null}
                    </div>

                    <aside className="space-y-4">
                      <section className="card-surface border border-border p-4">
                        <h3 className="text-sm font-extrabold">العميل</h3>
                        <dl className="mt-3 space-y-2 text-sm"><Row label="الاسم" value={order.customer_name ?? "—"} /><Row label="الجوال" value={order.customer_phone ?? "—"} />{order.source === "call_center" ? <Row label="موظف الخدمة" value={order.created_by_staff_name ?? "—"} /> : null}</dl>
                      </section>

                      <section className="card-surface border border-border p-4">
                        <h3 className="text-sm font-extrabold">الإجمالي</h3>
                        <dl className="mt-3 divide-y divide-border text-sm">
                          <Money label="الأصناف" value={order.subtotal} />
                          {Number(order.discount_total) > 0 ? <Money label="الخصم" value={order.discount_total} negative /> : null}
                          {Number(order.points_total) > 0 ? <Money label="النقاط" value={order.points_total} negative /> : null}
                          {Number(order.wallet_total) > 0 ? <Money label="المحفظة" value={order.wallet_total} negative /> : null}
                          {Number(order.delivery_fee) > 0 ? <Money label="التوصيل" value={order.delivery_fee} /> : null}
                          {Number(order.deposit_total) > 0 ? <Money label="التأمين" value={order.deposit_total} /> : null}
                          <Money label="الإجمالي" value={order.total} strong />
                          {refunded > 0 ? <Money label="المسترجع" value={refunded} negative /> : null}
                        </dl>
                        <p className="mt-2 text-[10px] text-muted-foreground">الأسعار تشمل ضريبة القيمة المضافة.</p>
                        {order.coupon_code ? <p className="mt-2 text-xs font-bold text-brand">كوبون: {order.coupon_code}</p> : null}
                      </section>

                      <section className="card-surface border border-border print:hidden">
                        <button type="button" onClick={() => setMoreOpen((v)=>!v)} className="flex w-full items-center justify-between px-4 py-3 text-sm font-extrabold">
                          إجراءات إضافية
                          {moreOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                        </button>
                        {moreOpen ? <div className="border-t border-border p-4">
                          <div className="space-y-2 text-xs"><Row label="المصدر" value={ORDER_SOURCE_LABEL[order.source] ?? order.source} /><Row label="حالة Foodics" value={posLabel(order.pos_status)} />{order.pos_ref ? <Row label="Foodics ref" value={order.pos_ref} /> : null}{order.pos_last_error ? <p className="rounded-card bg-danger/10 p-2 font-bold text-danger">{order.pos_last_error}</p> : null}</div>
                          <div className="mt-3 grid gap-2">
                            {can("orders.pos.dispatch") && order.pos_status !== "sent" ? <button type="button" disabled={busy} onClick={resendPos} className="rounded-card border border-brand/40 px-3 py-2.5 text-xs font-bold text-brand">{order.pos_status === "failed" ? "إعادة الإرسال إلى Foodics" : "إرسال إلى Foodics"}</button> : null}
                            {can("orders.refund") && Number(order.total) - refunded > 0 ? <button type="button" onClick={() => setRefundOpen((v)=>!v)} className="inline-flex items-center justify-center gap-1.5 rounded-card border border-danger/30 px-3 py-2.5 text-xs font-bold text-danger"><RotateCcw className="size-3.5" /> استرجاع</button> : null}
                          </div>
                          {refundOpen ? <div className="mt-3 grid gap-2 border-t border-border pt-3"><input type="number" min="0.01" step="0.01" value={refundAmount} onChange={(e)=>setRefundAmount(e.target.value)} placeholder="قيمة الاسترجاع" className="rounded-card border border-border bg-background px-3 py-2 text-sm" /><input value={refundReason} onChange={(e)=>setRefundReason(e.target.value)} placeholder="سبب الاسترجاع" className="rounded-card border border-border bg-background px-3 py-2 text-sm" /><button type="button" disabled={busy} onClick={submitRefund} className="rounded-card bg-danger px-3 py-2.5 text-xs font-bold text-white">تنفيذ الاسترجاع</button></div> : null}
                        </div> : null}
                      </section>
                    </aside>
                  </section>
                ) : (
                  <section className="mt-4 card-surface overflow-hidden border border-border">
                    <div className="divide-y divide-border">
                      {detail.status_history.map((row)=><div key={row.id} className="px-4 py-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-bold">{STATUS_LABEL[row.status]}</p><span className="text-[11px] text-muted-foreground">{formatDateTime(row.at)}</span></div><p className="mt-1 text-xs text-muted-foreground">{row.actor_name || "النظام"}{row.note ? ` · ${row.note}` : ""}</p></div>)}
                    </div>
                  </section>
                )}
                {message ? <div className="fixed bottom-5 left-1/2 z-[80] -translate-x-1/2 rounded-card border border-border bg-background px-4 py-3 text-sm font-bold shadow-lg print:hidden">{message}</div> : null}
              </>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}

function Info({ label, value, emphasize=false }: { label: string; value: string; emphasize?: boolean }) { return <div className={`card-surface border p-4 ${emphasize ? "border-brand/30 bg-brand/5" : "border-border"}`}><p className="text-xs font-bold text-muted-foreground">{label}</p><p className={`mt-2 text-sm font-extrabold ${emphasize ? "text-brand" : ""}`}>{value}</p></div>; }
function Row({ label, value }: { label: string; value: string }) { return <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{label}</dt><dd className="text-left font-bold">{value}</dd></div>; }
function Money({ label, value, negative=false, strong=false }: { label: string; value: number; negative?: boolean; strong?: boolean }) { return <div className={`flex justify-between py-2.5 ${strong ? "text-base font-extrabold" : ""}`}><dt>{label}</dt><dd>{negative && Number(value)>0 ? "− " : ""}{formatSAR(Number(value))}</dd></div>; }
function formatDateTime(value: string) { try { return new Intl.DateTimeFormat("ar-SA",{ timeZone:"Asia/Riyadh", dateStyle:"medium", timeStyle:"short" }).format(new Date(value)); } catch { return value; } }
function posLabel(status: string) { if(status==="sent") return "تم الإرسال"; if(status==="failed") return "فشل الإرسال"; if(status==="sending"||status==="queued") return "جاري الإرسال"; return "لم يرسل"; }
