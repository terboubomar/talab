import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Printer, RefreshCw, RotateCcw, X } from "lucide-react";

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
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button type="button" onClick={onClose} className="rounded-full border border-border p-2 hover:bg-secondary print:hidden"><ArrowRight className="size-4" /></button>
              <div>
                <h1 className="text-base font-extrabold">تفاصيل الطلب {order ? `#${order.id.slice(0, 8)}` : ""}</h1>
                {order ? <p className="mt-0.5 text-[11px] text-muted-foreground">{order.branch_name} · {formatDateTime(order.placed_at)}</p> : null}
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
          <div className="mx-auto max-w-7xl">
            {detailQuery.isLoading ? <div className="grid gap-3 md:grid-cols-3">{[0,1,2,3,4,5].map((i)=><div key={i} className="card-surface h-28 animate-pulse opacity-60" />)}</div> : null}
            {detailQuery.error ? <div className="card-surface p-6 text-center text-sm font-bold text-danger">تعذّر فتح تفاصيل الطلب أو لا تملك صلاحية عرضها.</div> : null}
            {order && detail ? (
              <>
                <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Info label="الحالة" value={STATUS_LABEL[order.status]} />
                  <Info label="نوع الطلب" value={ORDER_TYPE_LABEL[order.order_type]} />
                  <Info label="مصدر الطلب" value={ORDER_SOURCE_LABEL[order.source] ?? order.source} />
                  <Info label="طريقة الدفع" value={order.payment_method === "cash" ? "الدفع عند الاستلام" : PAYMENT_STATUS_LABEL[order.payment_status]} />
                </section>

                <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,.8fr)]">
                  <div className="space-y-4">
                    <div className="card-surface overflow-hidden border border-border">
                      <div className="flex gap-2 border-b border-border p-3 print:hidden">
                        <button type="button" onClick={() => setTab("details")} className={`rounded-pill px-4 py-2 text-xs font-bold ${tab === "details" ? "bg-brand text-brand-ink" : "bg-secondary"}`}>تفاصيل الطلب</button>
                        <button type="button" onClick={() => setTab("history")} className={`rounded-pill px-4 py-2 text-xs font-bold ${tab === "history" ? "bg-brand text-brand-ink" : "bg-secondary"}`}>السجل</button>
                      </div>

                      {tab === "details" ? (
                        <div className="p-4">
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[850px] text-sm">
                              <thead><tr className="bg-secondary text-xs text-muted-foreground"><th className="px-3 py-2 text-start">الصنف</th><th className="px-3 py-2 text-start">الكمية</th><th className="px-3 py-2 text-start">السعر</th><th className="px-3 py-2 text-start">الكوبون</th><th className="px-3 py-2 text-start">النقاط</th><th className="px-3 py-2 text-start">المحفظة</th><th className="px-3 py-2 text-start">الإجمالي</th></tr></thead>
                              <tbody className="divide-y divide-border">
                                {detail.items.map((item) => {
                                  const ratio = Number(order.subtotal) > 0 ? Number(item.line_total) / Number(order.subtotal) : 0;
                                  return <tr key={item.id}>
                                    <td className="px-3 py-3"><p className="font-bold">{item.name_ar}</p>{item.modifiers.length ? <p className="mt-1 text-xs text-muted-foreground">{item.modifiers.map((m)=>m.name_ar).join("، ")}</p> : null}{item.notes ? <p className="mt-1 text-xs text-muted-foreground">ملاحظة: {item.notes}</p> : null}</td>
                                    <td className="px-3 py-3">{item.qty}</td>
                                    <td className="px-3 py-3">{formatSAR(Number(item.unit_price))}</td>
                                    <td className="px-3 py-3">{formatSAR(Number(order.coupon_total) * ratio)}</td>
                                    <td className="px-3 py-3">{formatSAR(Number(order.points_total) * ratio)}</td>
                                    <td className="px-3 py-3">{formatSAR(Number(order.wallet_total) * ratio)}</td>
                                    <td className="px-3 py-3 font-extrabold">{formatSAR(Number(item.line_total))}</td>
                                  </tr>;
                                })}
                              </tbody>
                            </table>
                          </div>
                          <p className="mt-3 text-[10px] text-muted-foreground">توزيع الكوبون/النقاط/المحفظة على الأسطر للعرض فقط؛ القيم المحاسبية الرسمية محفوظة على مستوى الطلب.</p>
                        </div>
                      ) : (
                        <div className="divide-y divide-border">
                          {[...detail.status_history.map((row)=>({ key:`s-${row.id}`, at:row.at, title:`الحالة: ${STATUS_LABEL[row.status]}`, actor:row.actor_name, note:row.note })), ...detail.activity.map((row)=>({ key:`a-${row.id}`, at:row.at, title:row.action, actor:row.actor_name, note:row.diff ? JSON.stringify(row.diff) : null }))]
                            .sort((a,b)=>new Date(b.at).getTime()-new Date(a.at).getTime())
                            .map((row)=><div key={row.key} className="px-4 py-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-bold">{row.title}</p><span className="text-[11px] text-muted-foreground">{formatDateTime(row.at)}</span></div><p className="mt-1 text-xs text-muted-foreground">{row.actor || "النظام"}{row.note ? ` · ${row.note}` : ""}</p></div>)}
                        </div>
                      )}
                    </div>

                    {order.delivery_address_text ? <section className="card-surface border border-border p-4"><h3 className="text-sm font-extrabold">بيانات التوصيل</h3><p className="mt-2 text-sm">{order.delivery_address_text}</p>{order.driver_name || order.delivery_provider_name ? <p className="mt-2 text-xs text-muted-foreground">المسند إليه: {order.driver_name ?? order.delivery_provider_name}</p> : null}</section> : null}
                    {order.notes ? <section className="card-surface border border-border p-4"><h3 className="text-sm font-extrabold">ملاحظات الطلب</h3><p className="mt-2 text-sm">{order.notes}</p></section> : null}
                  </div>

                  <aside className="space-y-4">
                    <section className="card-surface border border-border p-4">
                      <h3 className="text-sm font-extrabold">العميل</h3>
                      <dl className="mt-3 space-y-2 text-sm"><Row label="الاسم" value={order.customer_name ?? "—"} /><Row label="الجوال" value={order.customer_phone ?? "—"} /><Row label="البريد" value={order.customer_email ?? "—"} /><Row label="موظف خدمة العملاء" value={order.created_by_staff_name ?? "—"} /></dl>
                    </section>

                    <section className="card-surface border border-border p-4">
                      <h3 className="text-sm font-extrabold">الملخص المالي</h3>
                      <dl className="mt-3 divide-y divide-border text-sm"><Money label="المجموع الفرعي" value={order.subtotal} /><Money label="الخصومات" value={order.discount_total} negative /><Money label="نقاط الولاء" value={order.points_total} negative /><Money label="المحفظة" value={order.wallet_total} negative /><Money label="التوصيل" value={order.delivery_fee} /><Money label="الضريبة" value={order.tax_total} /><Money label="التأمين" value={order.deposit_total} /><Money label="الإجمالي" value={order.total} strong /><Money label="المسترجع" value={refunded} negative /></dl>
                      {order.coupon_code ? <p className="mt-2 text-xs text-muted-foreground">كوبون: {order.coupon_code}</p> : null}
                    </section>

                    <section className="card-surface border border-border p-4 print:hidden">
                      <h3 className="text-sm font-extrabold">POS والاسترجاع</h3>
                      <div className="mt-3 space-y-2 text-xs"><Row label="حالة Foodics" value={posLabel(order.pos_status)} /><Row label="Foodics ref" value={order.pos_ref ?? "—"} />{order.pos_last_error ? <p className="rounded-card bg-danger/10 p-2 font-bold text-danger">{order.pos_last_error}</p> : null}</div>
                      <div className="mt-3 grid gap-2">
                        {can("orders.pos.dispatch") && order.pos_status !== "sent" ? <button type="button" disabled={busy} onClick={resendPos} className="rounded-card border border-brand/40 px-3 py-2.5 text-xs font-bold text-brand">{order.pos_status === "failed" ? "إعادة الإرسال إلى Foodics" : "إرسال إلى Foodics"}</button> : null}
                        {can("orders.refund") && Number(order.total) - refunded > 0 ? <button type="button" onClick={() => setRefundOpen((v)=>!v)} className="inline-flex items-center justify-center gap-1.5 rounded-card border border-danger/30 px-3 py-2.5 text-xs font-bold text-danger"><RotateCcw className="size-3.5" /> استرجاع</button> : null}
                      </div>
                      {refundOpen ? <div className="mt-3 grid gap-2 border-t border-border pt-3"><input type="number" min="0.01" step="0.01" value={refundAmount} onChange={(e)=>setRefundAmount(e.target.value)} placeholder="قيمة الاسترجاع" className="rounded-card border border-border bg-background px-3 py-2 text-sm" /><input value={refundReason} onChange={(e)=>setRefundReason(e.target.value)} placeholder="سبب الاسترجاع" className="rounded-card border border-border bg-background px-3 py-2 text-sm" /><button type="button" disabled={busy} onClick={submitRefund} className="rounded-card bg-danger px-3 py-2.5 text-xs font-bold text-white">تنفيذ الاسترجاع</button></div> : null}
                    </section>

                    {detail.refunds.length ? <section className="card-surface border border-border p-4"><h3 className="text-sm font-extrabold">عمليات الاسترجاع</h3><div className="mt-3 space-y-2">{detail.refunds.map((row)=><div key={row.id} className="rounded-card bg-secondary p-3 text-xs"><div className="flex justify-between gap-2"><span className="font-bold">{formatSAR(Number(row.amount))}</span><span>{row.status}</span></div><p className="mt-1 text-muted-foreground">{row.reason}</p></div>)}</div></section> : null}
                  </aside>
                </section>
                {message ? <div className="fixed bottom-5 left-1/2 z-[80] -translate-x-1/2 rounded-card border border-border bg-background px-4 py-3 text-sm font-bold shadow-lg print:hidden">{message}</div> : null}
              </>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) { return <div className="card-surface border border-border p-4"><p className="text-xs font-bold text-muted-foreground">{label}</p><p className="mt-2 text-sm font-extrabold">{value}</p></div>; }
function Row({ label, value }: { label: string; value: string }) { return <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{label}</dt><dd className="text-left font-bold">{value}</dd></div>; }
function Money({ label, value, negative=false, strong=false }: { label: string; value: number; negative?: boolean; strong?: boolean }) { return <div className={`flex justify-between py-2.5 ${strong ? "font-extrabold" : ""}`}><dt>{label}</dt><dd>{negative && Number(value)>0 ? "− " : ""}{formatSAR(Number(value))}</dd></div>; }
function formatDateTime(value: string) { try { return new Intl.DateTimeFormat("ar-SA",{ timeZone:"Asia/Riyadh", dateStyle:"medium", timeStyle:"short" }).format(new Date(value)); } catch { return value; } }
function posLabel(status: string) { if(status==="sent") return "تم الإرسال"; if(status==="failed") return "فشل الإرسال"; if(status==="sending"||status==="queued") return "جاري الإرسال"; return "لم يرسل"; }
