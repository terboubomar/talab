import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { formatSAR } from "@/lib/menu";
import {
  createGatewayRefund,
  createManualRefund,
  fetchOrderRefunds,
  type RefundKind,
  type StaffOrder,
} from "@/lib/staff";

type Props = {
  order: StaffOrder;
  canRefundDeposit: boolean;
  onDone?: () => void | Promise<void>;
};

const REFUND_STATUS_LABEL = {
  pending: "قيد التنفيذ",
  completed: "مكتمل",
  failed: "فشل",
  cancelled: "ملغي",
} as const;

export function RefundPanel({ order, canRefundDeposit, onDone }: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<RefundKind>("order");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const gatewayRefund = order.payment_method === "online";

  const { data: refunds = [], isLoading } = useQuery({
    queryKey: ["order_refunds", order.id],
    queryFn: () => fetchOrderRefunds(order.id),
    enabled: open,
  });

  const totals = useMemo(() => {
    let orderReserved = 0;
    let depositReserved = 0;
    for (const refund of refunds) {
      if (refund.status !== "completed" && refund.status !== "pending") continue;
      if (refund.kind === "deposit") depositReserved += Number(refund.amount);
      else orderReserved += Number(refund.amount);
    }
    return { orderReserved, depositReserved };
  }, [refunds]);

  const orderRemaining = Math.max(Number(order.total) - totals.orderReserved, 0);
  const depositRemaining = Math.max(Number(order.deposit_total) - totals.depositReserved, 0);
  const remaining = kind === "deposit" ? depositRemaining : orderRemaining;

  function chooseKind(next: RefundKind) {
    setKind(next);
    setAmount("");
    setError(null);
    setSuccess(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError("أدخل مبلغ استرداد صحيح");
      return;
    }
    if (numericAmount > remaining) {
      setError("المبلغ أكبر من الرصيد المتبقي للاسترداد");
      return;
    }
    if (reason.trim().length < 3) {
      setError("اكتب سبب الاسترداد");
      return;
    }

    setSubmitting(true);
    try {
      const input = {
        orderId: order.id,
        amount: numericAmount,
        reason: reason.trim(),
        kind,
      };

      if (gatewayRefund) await createGatewayRefund(input);
      else await createManualRefund(input);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["order_refunds", order.id] }),
        queryClient.invalidateQueries({ queryKey: ["staff_orders"] }),
        queryClient.invalidateQueries({ queryKey: ["payment_transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["staff_order_report"] }),
      ]);
      setAmount("");
      setReason("");
      setSuccess(
        gatewayRefund
          ? "تم تنفيذ الاسترداد عبر ميسر وتسجيله في طلب"
          : "تم تسجيل الاسترداد اليدوي بنجاح",
      );
      await onDone?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message.includes("refund_exceeds_remaining")) {
        setError("المبلغ أكبر من الرصيد المتبقي للاسترداد");
      } else if (message.includes("not_authorized")) {
        setError("لا تملك صلاحية تنفيذ هذا الاسترداد");
      } else if (message.includes("order_not_terminal")) {
        setError("لا يمكن استرداد هذا الطلب قبل اكتماله أو إلغائه");
      } else if (message.includes("gateway_refund_not_available")) {
        setError("لا توجد عملية دفع إلكتروني مؤكدة قابلة للاسترداد لهذا الطلب");
      } else if (message.includes("moyasar_secret_not_configured")) {
        setError("حساب ميسر لم يكتمل إعداده على الخادم بعد");
      } else if (message.includes("provider_outcome_unknown") || message.includes("refund_ledger_pending")) {
        setError("حالة الاسترداد تحتاج إلى مطابقة مع ميسر قبل إعادة المحاولة");
      } else {
        setError(gatewayRefund ? "تعذّر تنفيذ الاسترداد عبر ميسر" : "تعذّر تسجيل الاسترداد");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="rounded-pill border border-border px-4 py-2 text-xs font-bold text-foreground"
      >
        {open ? "إغلاق الاسترداد" : "استرداد"}
      </button>

      {open ? (
        <div className="mt-3 rounded-card border border-border bg-secondary/40 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-extrabold">
                {gatewayRefund ? "استرداد عبر ميسر" : "تسجيل استرداد يدوي"}
              </h3>
              <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
                {gatewayRefund
                  ? "سيتم إرسال الاسترداد إلى ميسر أولاً، ولن يُسجل كمكتمل داخل طلب إلا بعد نجاح عملية البوابة."
                  : "هذا الإجراء يسجل المبلغ كمُعاد للعميل داخل طلب. لا يرسل أموالاً عبر بوابة دفع أو بنك."}
              </p>
            </div>
            <div className="text-left text-xs text-muted-foreground">
              <div>
                المتاح للاسترداد من الطلب:{" "}
                <strong className="text-foreground">{formatSAR(orderRemaining)}</strong>
              </div>
              {Number(order.deposit_total) > 0 ? (
                <div className="mt-1">
                  المتاح من التأمين:{" "}
                  <strong className="text-foreground">{formatSAR(depositRemaining)}</strong>
                </div>
              ) : null}
            </div>
          </div>

          {canRefundDeposit && Number(order.deposit_total) > 0 ? (
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => chooseKind("order")}
                className={`rounded-pill px-3 py-1.5 text-xs font-bold ${kind === "order" ? "bg-brand text-brand-ink" : "border border-border"}`}
              >
                قيمة الطلب
              </button>
              <button
                type="button"
                onClick={() => chooseKind("deposit")}
                className={`rounded-pill px-3 py-1.5 text-xs font-bold ${kind === "deposit" ? "bg-brand text-brand-ink" : "border border-border"}`}
              >
                التأمين
              </button>
            </div>
          ) : null}

          <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-[160px_1fr_auto] sm:items-end">
            <div>
              <label className="text-xs font-bold text-muted-foreground">المبلغ</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                max={remaining}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1 w-full rounded-card border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-brand"
                placeholder={remaining.toFixed(2)}
              />
            </div>
            <div>
              <label className="text-xs font-bold text-muted-foreground">سبب الاسترداد</label>
              <input
                type="text"
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="mt-1 w-full rounded-card border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-brand"
                placeholder="مثال: خطأ في الطلب أو تعويض العميل"
              />
            </div>
            <button
              type="submit"
              disabled={submitting || remaining <= 0}
              className="rounded-pill bg-brand px-4 py-2.5 text-sm font-bold text-brand-ink disabled:opacity-50"
            >
              {submitting
                ? gatewayRefund
                  ? "جارٍ الاسترداد..."
                  : "جارٍ التسجيل..."
                : gatewayRefund
                  ? "استرداد عبر ميسر"
                  : "تسجيل الاسترداد"}
            </button>
          </form>

          {error ? <p className="mt-3 text-xs font-bold text-danger">{error}</p> : null}
          {success ? <p className="mt-3 text-xs font-bold text-success">{success}</p> : null}

          <div className="mt-4 border-t border-border pt-3">
            <h4 className="text-xs font-extrabold">سجل الاستردادات</h4>
            {isLoading ? (
              <p className="mt-2 text-xs text-muted-foreground">جارٍ التحميل...</p>
            ) : refunds.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">لا توجد استردادات مسجلة لهذا الطلب</p>
            ) : (
              <div className="mt-2 grid gap-2">
                {refunds.map((refund) => (
                  <div
                    key={refund.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border bg-background px-3 py-2 text-xs"
                  >
                    <div>
                      <span className="font-bold">
                        {refund.kind === "deposit" ? "تأمين" : "طلب"} — {formatSAR(Number(refund.amount))}
                      </span>
                      <span className="ms-2 text-muted-foreground">{refund.reason}</span>
                      <span className="ms-2 rounded-pill bg-secondary px-2 py-0.5 font-bold text-muted-foreground">
                        {refund.execution_mode === "gateway" ? "ميسر" : "يدوي"} · {REFUND_STATUS_LABEL[refund.status]}
                      </span>
                    </div>
                    <span className="text-muted-foreground">
                      {refund.created_by_name ?? "النظام"} · {new Date(refund.created_at).toLocaleString("ar-SA")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
