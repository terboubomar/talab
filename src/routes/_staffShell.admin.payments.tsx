import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CreditCard, ShieldCheck } from "lucide-react";

import {
  fetchPaymentAccounts,
  fetchRecentPaymentTransactions,
  TRANSACTION_STATUS_LABEL,
} from "@/lib/payments";
import { formatSAR } from "@/lib/menu";

export const Route = createFileRoute("/_staffShell/admin/payments")({
  head: () => ({ meta: [{ title: "المدفوعات — طلب" }] }),
  component: PaymentsPage,
});

function PaymentsPage() {
  const accountsQuery = useQuery({
    queryKey: ["payment_accounts"],
    queryFn: fetchPaymentAccounts,
  });
  const transactionsQuery = useQuery({
    queryKey: ["payment_transactions", "recent"],
    queryFn: () => fetchRecentPaymentTransactions(100),
  });

  const transactions = transactionsQuery.data ?? [];
  const stats = useMemo(() => {
    const succeeded = transactions.filter((t) => t.kind === "charge" && t.status === "succeeded");
    const failed = transactions.filter((t) => t.kind === "charge" && t.status === "failed");
    return {
      captured: succeeded.reduce((sum, item) => sum + Number(item.amount), 0),
      successful: succeeded.length,
      failed: failed.length,
      pending: transactions.filter((t) => t.kind === "charge" && ["pending", "authorized"].includes(t.status)).length,
    };
  }, [transactions]);

  const loading = accountsQuery.isLoading || transactionsQuery.isLoading;
  const error = accountsQuery.error || transactionsQuery.error;
  const accounts = accountsQuery.data ?? [];

  return (
    <main className="min-h-screen pb-12">
      <header className="border-b border-border bg-background px-5 py-5">
        <h1 className="text-lg font-extrabold">المدفوعات</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          مركز متابعة بوابات الدفع والحركات الإلكترونية. مفاتيح وأسرار مزود الدفع لا تُخزّن في لوحة التحكم أو المتصفح.
        </p>
      </header>

      <div className="space-y-5 px-5 py-6">
        <section className="rounded-card border border-brand/20 bg-brand/5 p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-brand" />
            <div>
              <p className="text-sm font-extrabold">بنية الدفع جاهزة للربط</p>
              <p className="mt-1 text-xs leading-6 text-muted-foreground">
                عند اختيار مزود الدفع سيتم حفظ مفاتيح API وتوقيع الـ Webhook كأسرار على الخادم فقط، ثم تُسجّل الحالات المؤكدة في سجل الحركات أدناه.
              </p>
            </div>
          </div>
        </section>

        {error ? (
          <div className="rounded-card border border-danger/30 bg-danger/10 p-4 text-sm font-bold text-danger">
            تعذّر تحميل بيانات المدفوعات. تأكد من صلاحية عرض المدفوعات.
          </div>
        ) : null}

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <div key={i} className="card-surface h-28 animate-pulse opacity-60" />)}
          </div>
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label="المبالغ المحصّلة إلكترونياً" value={formatSAR(stats.captured)} />
              <Kpi label="حركات ناجحة" value={String(stats.successful)} />
              <Kpi label="بانتظار التأكيد" value={String(stats.pending)} />
              <Kpi label="حركات فاشلة" value={String(stats.failed)} />
            </section>

            <section className="card-surface overflow-hidden">
              <div className="border-b border-border p-4">
                <h2 className="text-sm font-extrabold">حسابات بوابات الدفع</h2>
              </div>
              {accounts.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <CreditCard aria-hidden className="mx-auto size-8 text-muted-foreground" />
                  <p className="mt-3 text-sm font-bold">لم يتم ربط بوابة دفع بعد</p>
                  <p className="mx-auto mt-1 max-w-lg text-xs leading-6 text-muted-foreground">
                    الدفع عند الاستلام يعمل كالمعتاد. الدفع الإلكتروني سيُفعّل بعد اختيار مزود الدفع وربط حساب التاجر واختبار الـ Webhook.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {accounts.map((account) => (
                    <div key={account.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div>
                        <p className="text-sm font-extrabold">{account.display_name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {account.provider} · {account.environment === "live" ? "إنتاج" : "اختبار"}
                          {account.methods.length ? ` · ${account.methods.join("، ")}` : ""}
                        </p>
                      </div>
                      <span className={`rounded-pill px-3 py-1 text-xs font-bold ${account.enabled ? "bg-success/10 text-success" : "bg-secondary text-muted-foreground"}`}>
                        {account.enabled ? "مفعّلة" : "متوقفة"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="card-surface overflow-hidden">
              <div className="border-b border-border p-4">
                <h2 className="text-sm font-extrabold">أحدث الحركات الإلكترونية</h2>
              </div>
              {transactions.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-muted-foreground">لا توجد حركات دفع إلكترونية حتى الآن</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="bg-secondary text-xs text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 text-start">الطلب</th>
                        <th className="px-4 py-3 text-start">المزود</th>
                        <th className="px-4 py-3 text-start">الطريقة</th>
                        <th className="px-4 py-3 text-start">الحالة</th>
                        <th className="px-4 py-3 text-start">المبلغ</th>
                        <th className="px-4 py-3 text-start">الوقت</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {transactions.map((tx) => (
                        <tr key={tx.id}>
                          <td dir="ltr" className="px-4 py-3 font-bold">#{tx.order_id.slice(0, 8)}</td>
                          <td className="px-4 py-3">{tx.provider}</td>
                          <td className="px-4 py-3">{tx.payment_method || "—"}</td>
                          <td className="px-4 py-3">{TRANSACTION_STATUS_LABEL[tx.status]}</td>
                          <td className="px-4 py-3 font-bold">{tx.kind === "refund" ? "− " : ""}{formatSAR(Number(tx.amount))}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(tx.created_at).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-surface p-4">
      <p className="text-xs font-bold text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-extrabold">{value}</p>
    </div>
  );
}
