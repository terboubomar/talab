import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, ShieldCheck } from "lucide-react";

import {
  fetchPaymentAccounts,
  fetchRecentPaymentTransactions,
  saveMoyasarPublicConfig,
  TRANSACTION_STATUS_LABEL,
} from "@/lib/payments";
import { formatSAR } from "@/lib/menu";
import { usePermissions } from "@/lib/permissions";

export const Route = createFileRoute("/_staffShell/admin/payments")({
  head: () => ({ meta: [{ title: "المدفوعات — طلب" }] }),
  component: PaymentsPage,
});

function PaymentsPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const canManage = can("settings.manage");
  const [environment, setEnvironment] = useState<"test" | "live">("test");
  const [publishableKey, setPublishableKey] = useState("");
  const [applePay, setApplePay] = useState(true);
  const [saving, setSaving] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupSuccess, setSetupSuccess] = useState<string | null>(null);

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
  const moyasarAccount = accounts.find((account) => account.provider === "moyasar") ?? null;

  async function saveSetup(e: React.FormEvent) {
    e.preventDefault();
    setSetupError(null);
    setSetupSuccess(null);

    const key = publishableKey.trim();
    const expectedPrefix = environment === "test" ? "pk_test_" : "pk_live_";
    if (!key.startsWith(expectedPrefix)) {
      setSetupError(`مفتاح ${environment === "test" ? "الاختبار" : "الإنتاج"} يجب أن يبدأ بـ ${expectedPrefix}`);
      return;
    }

    setSaving(true);
    try {
      await saveMoyasarPublicConfig({
        environment,
        publishableApiKey: key,
        enableApplePay: applePay,
      });
      setPublishableKey("");
      await queryClient.invalidateQueries({ queryKey: ["payment_accounts"] });
      setSetupSuccess(
        "تم حفظ المفتاح العام فقط. الحساب بقي متوقفاً حتى يتم إعداد MOYASAR_SECRET_KEY و MOYASAR_WEBHOOK_SECRET على الخادم واختبار الـ Webhook.",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setSetupError(
        message.includes("not_authorized")
          ? "لا تملك صلاحية تعديل إعدادات الدفع"
          : message.includes("invalid_moyasar")
            ? "مفتاح ميسر العام لا يطابق بيئة الاختبار/الإنتاج المحددة"
            : "تعذّر حفظ إعداد ميسر",
      );
    } finally {
      setSaving(false);
    }
  }

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
              <p className="text-sm font-extrabold">ميسر — بنية الدفع جاهزة</p>
              <p className="mt-1 text-xs leading-6 text-muted-foreground">
                الواجهة تحفظ فقط مفتاح ميسر العام pk_* وخيارات العرض. مفتاح sk_* وسر الـ Webhook يبقيان كأسرار على خادم Supabase فقط.
              </p>
            </div>
          </div>
        </section>

        {canManage ? (
          <section className="card-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-extrabold">إعداد ميسر</h2>
                <p className="mt-1 max-w-2xl text-xs leading-6 text-muted-foreground">
                  أدخل المفتاح العام فقط. حفظ الإعداد يوقف الحساب تلقائياً كإجراء أمان إلى أن تُضاف أسرار الخادم ويُختبر مسار الدفع والـ Webhook.
                </p>
              </div>
              {moyasarAccount ? (
                <span className={`rounded-pill px-3 py-1 text-xs font-bold ${moyasarAccount.enabled ? "bg-success/10 text-success" : "bg-secondary text-muted-foreground"}`}>
                  {moyasarAccount.enabled ? "ميسر مفعّلة" : "ميسر محفوظة — بانتظار التفعيل"}
                </span>
              ) : null}
            </div>

            <form onSubmit={saveSetup} className="mt-4 grid gap-3 lg:grid-cols-[150px_1fr_auto_auto] lg:items-end">
              <div>
                <label className="text-xs font-bold text-muted-foreground">البيئة</label>
                <select
                  value={environment}
                  onChange={(e) => setEnvironment(e.target.value as "test" | "live")}
                  className="mt-1 w-full rounded-card border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-brand"
                >
                  <option value="test">اختبار</option>
                  <option value="live">إنتاج</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-muted-foreground">Publishable API Key</label>
                <input
                  dir="ltr"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={publishableKey}
                  onChange={(e) => setPublishableKey(e.target.value)}
                  placeholder={environment === "test" ? "pk_test_..." : "pk_live_..."}
                  className="mt-1 w-full rounded-card border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-brand"
                />
              </div>
              <label className="flex items-center gap-2 rounded-card border border-border px-3 py-2.5 text-xs font-bold">
                <input type="checkbox" checked={applePay} onChange={(e) => setApplePay(e.target.checked)} />
                Apple Pay
              </label>
              <button
                type="submit"
                disabled={saving || !publishableKey.trim()}
                className="rounded-pill bg-brand px-4 py-2.5 text-sm font-bold text-brand-ink disabled:opacity-50"
              >
                {saving ? "جارٍ الحفظ..." : "حفظ إعداد ميسر"}
              </button>
            </form>

            <div className="mt-4 rounded-card border border-border bg-secondary/50 p-3 text-xs leading-6 text-muted-foreground">
              <p><strong className="text-foreground">أسرار الخادم المطلوبة:</strong> <span dir="ltr">MOYASAR_SECRET_KEY</span> و <span dir="ltr">MOYASAR_WEBHOOK_SECRET</span>.</p>
              <p><strong className="text-foreground">Webhook:</strong> استخدم دالة <span dir="ltr">/functions/v1/moyasar-webhook</span> واشترك في أحداث الدفع، بما فيها <span dir="ltr">payment_refunded</span>.</p>
            </div>

            {setupError ? <p className="mt-3 text-xs font-bold text-danger">{setupError}</p> : null}
            {setupSuccess ? <p className="mt-3 text-xs font-bold text-success">{setupSuccess}</p> : null}
          </section>
        ) : null}

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
                    الدفع عند الاستلام يعمل كالمعتاد. احفظ إعداد ميسر أعلاه، ثم أضف أسرار الخادم واختبر الـ Webhook قبل التفعيل.
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
