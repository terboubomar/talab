import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { formatSAR } from "@/lib/menu";
import { usePermissions } from "@/lib/permissions";
import {
  adjustWallet,
  fetchCustomersWithWallet,
  fetchWalletLedger,
  walletReasonLabel,
  type CustomerWalletRow,
} from "@/lib/wallet";
import {
  adjustPoints,
  fetchCustomerPoints,
  fetchPointsLedger,
  pointsReasonLabel,
} from "@/lib/loyalty";

export const Route = createFileRoute("/_staffShell/admin/customers")({
  head: () => ({ meta: [{ title: "العملاء — طلب" }] }),
  component: CustomersPage,
});

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("ar-SA", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ar-SA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CustomersPage() {
  const { loading: permissionsLoading, can } = usePermissions();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const canView = can("customers.view");
  const canAdjust = can("customers.wallet.adjust");
  const canSeeLedger = canAdjust || can("customers.activity.view");
  const canAdjustPoints = can("customers.points.adjust");
  const canSeePointsHistory = canAdjustPoints || can("customers.activity.view");

  const {
    data: customers = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["admin_customers_wallet"],
    queryFn: fetchCustomersWithWallet,
    enabled: !permissionsLoading && canView,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) => (c.name ?? "").toLowerCase().includes(q) || (c.phone ?? "").includes(q),
    );
  }, [customers, search]);

  const kpis = useMemo(() => {
    const withBalance = customers.filter((c) => c.balance > 0).length;
    const total = customers.reduce((sum, c) => sum + c.balance, 0);
    return { count: customers.length, withBalance, total };
  }, [customers]);

  const selected = customers.find((c) => c.id === selectedId) ?? null;

  if (permissionsLoading) {
    return (
      <div className="p-6">
        <div className="card-surface h-28 animate-pulse opacity-60" />
      </div>
    );
  }

  if (!canView) {
    return (
      <main className="p-6">
        <div className="card-surface p-6 text-center text-sm font-bold text-danger">
          لا تملك صلاحية عرض العملاء
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen pb-12">
      <header className="border-b border-border bg-background px-5 py-5">
        <h1 className="text-lg font-extrabold">العملاء</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          المحفظة مبنية على سجل حركات، وكل تغيير في الرصيد مُدقّق ومسجّل باسم الموظف.
        </p>
      </header>

      <div className="space-y-4 px-5 py-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="card-surface p-4">
            <p className="text-xs font-bold text-muted-foreground">إجمالي العملاء</p>
            <p className="mt-1 text-xl font-extrabold">{kpis.count}</p>
          </div>
          <div className="card-surface p-4">
            <p className="text-xs font-bold text-muted-foreground">عملاء برصيد محفظة</p>
            <p className="mt-1 text-xl font-extrabold">{kpis.withBalance}</p>
          </div>
          <div className="card-surface p-4">
            <p className="text-xs font-bold text-muted-foreground">إجمالي أرصدة المحافظ</p>
            <p className="mt-1 text-xl font-extrabold">{formatSAR(kpis.total)}</p>
          </div>
        </div>

        <div className="card-surface p-4">
          <label className="grid max-w-md gap-1 text-xs font-bold text-muted-foreground">
            البحث عن عميل
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="اسم العميل أو رقم الجوال"
              className="rounded-card border border-border bg-background px-3 py-2 text-sm font-bold text-foreground"
            />
          </label>
        </div>

        {error ? (
          <div className="card-surface p-6 text-center text-sm font-bold text-danger">
            تعذّر تحميل العملاء
          </div>
        ) : isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card-surface h-16 animate-pulse opacity-60" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="card-surface p-6 text-center text-sm font-bold text-muted-foreground">
            لا يوجد عملاء مطابقون
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
            <div className="card-surface overflow-hidden">
              <table className="w-full text-right text-sm">
                <thead className="bg-secondary text-xs font-bold text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">العميل</th>
                    <th className="px-3 py-2">الجوال</th>
                    <th className="px-3 py-2">رصيد المحفظة</th>
                    <th className="px-3 py-2">تاريخ التسجيل</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((customer) => (
                    <tr
                      key={customer.id}
                      onClick={() => setSelectedId(customer.id)}
                      className={`cursor-pointer border-t border-border ${
                        selectedId === customer.id ? "bg-secondary" : "hover:bg-secondary/60"
                      }`}
                    >
                      <td className="px-3 py-2.5 font-bold">
                        {customer.name || "بدون اسم"}
                        {customer.email ? (
                          <span className="block text-[11px] font-normal text-muted-foreground" dir="ltr">
                            {customer.email}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground" dir="ltr">
                        {customer.phone ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 font-extrabold">{formatSAR(customer.balance)}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">
                        {formatDate(customer.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selected ? (
              <CustomerDetail
                key={selected.id}
                customer={selected}
                canAdjust={canAdjust}
                canSeeLedger={canSeeLedger}
                canAdjustPoints={canAdjustPoints}
                canSeePointsHistory={canSeePointsHistory}
                onAdjusted={() => {
                  void queryClient.invalidateQueries({ queryKey: ["admin_customers_wallet"] });
                  void queryClient.invalidateQueries({ queryKey: ["wallet_ledger", selected.id] });
                }}
              />
            ) : (
              <div className="card-surface flex items-center justify-center p-6 text-sm font-bold text-muted-foreground">
                اختر عميلاً لعرض المحفظة
              </div>
            )}
          </div>
        )}

        <p className="text-center text-[11px] text-muted-foreground">
          المزيد من بيانات CRM ستضاف في المراحل التالية
        </p>
      </div>
    </main>
  );
}

function CustomerDetail({
  customer,
  canAdjust,
  canSeeLedger,
  canAdjustPoints,
  canSeePointsHistory,
  onAdjusted,
}: {
  customer: CustomerWalletRow;
  canAdjust: boolean;
  canSeeLedger: boolean;
  canAdjustPoints: boolean;
  canSeePointsHistory: boolean;
  onAdjusted: () => void;
}) {
  const [tab, setTab] = useState<"wallet" | "points">("wallet");

  return (
    <div className="space-y-4">
      <div className="card-surface p-4">
        <p className="text-sm font-extrabold">{customer.name || "بدون اسم"}</p>
        <p className="text-xs text-muted-foreground" dir="ltr">
          {customer.phone ?? "—"}
        </p>
        <div className="mt-3 flex gap-2">
          {(["wallet", "points"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-pill px-3 py-1.5 text-xs font-extrabold ${
                tab === key ? "bg-brand text-brand-ink" : "bg-secondary text-muted-foreground"
              }`}
            >
              {key === "wallet" ? "المحفظة" : "النقاط"}
            </button>
          ))}
        </div>
      </div>

      {tab === "wallet" ? (
        <WalletTab
          customer={customer}
          canAdjust={canAdjust}
          canSeeLedger={canSeeLedger}
          onAdjusted={onAdjusted}
        />
      ) : (
        <PointsTab
          customerId={customer.id}
          canAdjustPoints={canAdjustPoints}
          canSeePointsHistory={canSeePointsHistory}
        />
      )}
    </div>
  );
}

function PointsTab({
  customerId,
  canAdjustPoints,
  canSeePointsHistory,
}: {
  customerId: string;
  canAdjustPoints: boolean;
  canSeePointsHistory: boolean;
}) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successBalance, setSuccessBalance] = useState<number | null>(null);

  const {
    data: points,
    isLoading: pointsLoading,
    error: pointsError,
  } = useQuery({
    queryKey: ["customer_points", customerId],
    queryFn: () => fetchCustomerPoints(customerId),
  });

  const {
    data: ledger = [],
    isLoading: ledgerLoading,
    error: ledgerError,
  } = useQuery({
    queryKey: ["points_ledger", customerId],
    queryFn: () => fetchPointsLedger(customerId),
    enabled: canSeePointsHistory,
  });

  async function handleAdjustPoints(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSuccessBalance(null);
    const delta = Number(amount);
    if (!Number.isFinite(delta) || delta === 0) {
      setFormError("أدخل عدد نقاط غير صفري");
      return;
    }
    if (reason.trim().length < 2) {
      setFormError("أدخل سبباً واضحاً (حرفان على الأقل)");
      return;
    }
    setSubmitting(true);
    try {
      const result = await adjustPoints(customerId, delta, reason.trim());
      setSuccessBalance(result.balance);
      setAmount("");
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["customer_points", customerId] });
      void queryClient.invalidateQueries({ queryKey: ["points_ledger", customerId] });
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "تعذّر تعديل النقاط");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card-surface p-4">
        <p className="text-xs font-bold text-muted-foreground">رصيد النقاط الحالي</p>
        {pointsError ? (
          <p className="mt-1 text-sm font-bold text-danger">تعذّر تحميل النقاط</p>
        ) : pointsLoading ? (
          <div className="mt-2 h-8 animate-pulse rounded-card bg-secondary opacity-60" />
        ) : (
          <>
            <p className="mt-1 text-2xl font-extrabold">
              {(points?.balance ?? 0).toLocaleString("ar-SA", { maximumFractionDigits: 2 })} نقطة
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {points?.next_expiry_at
                ? `أقرب انتهاء صلاحية: ${formatDate(points.next_expiry_at)}`
                : "لا توجد نقاط قاربت على الانتهاء"}
            </p>
          </>
        )}
      </div>

      {canAdjustPoints ? (
        <form onSubmit={handleAdjustPoints} className="card-surface space-y-3 p-4">
          <p className="text-sm font-extrabold">تعديل النقاط</p>
          <p className="text-[11px] text-muted-foreground">
            عدد موجب = إضافة نقاط، عدد سالب = خصم نقاط.
          </p>
          <label className="grid gap-1 text-xs font-bold text-muted-foreground">
            عدد النقاط
            <input
              type="number"
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="100 أو -100"
              className="rounded-card border border-border bg-background px-3 py-2 text-sm font-bold text-foreground"
            />
          </label>
          <label className="grid gap-1 text-xs font-bold text-muted-foreground">
            السبب
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="تعويض عن طلب متأخر"
              className="rounded-card border border-border bg-background px-3 py-2 text-sm font-bold text-foreground"
            />
          </label>
          {formError ? <p className="text-xs font-bold text-danger">{formError}</p> : null}
          {successBalance !== null ? (
            <p className="text-xs font-bold text-success">
              تم التعديل. الرصيد الجديد{" "}
              {successBalance.toLocaleString("ar-SA", { maximumFractionDigits: 2 })} نقطة
            </p>
          ) : null}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-card bg-brand px-4 py-2.5 text-sm font-extrabold text-brand-ink disabled:opacity-60"
          >
            {submitting ? "جاري التنفيذ…" : "تنفيذ التعديل"}
          </button>
        </form>
      ) : null}

      {canSeePointsHistory ? (
        <div className="card-surface overflow-hidden">
          <p className="border-b border-border px-4 py-3 text-sm font-extrabold">سجل حركات النقاط</p>
          {ledgerError ? (
            <p className="p-4 text-center text-xs font-bold text-danger">تعذّر تحميل السجل</p>
          ) : ledgerLoading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-card bg-secondary opacity-60" />
              ))}
            </div>
          ) : ledger.length === 0 ? (
            <p className="p-4 text-center text-xs font-bold text-muted-foreground">
              لا توجد حركات على النقاط
            </p>
          ) : (
            <table className="w-full text-right text-xs">
              <thead className="bg-secondary font-bold text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">التاريخ</th>
                  <th className="px-3 py-2">التغيير</th>
                  <th className="px-3 py-2">الرصيد بعدها</th>
                  <th className="px-3 py-2">السبب</th>
                  <th className="px-3 py-2">المنفّذ</th>
                  <th className="px-3 py-2">الصلاحية</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((entry) => (
                  <tr key={entry.id} className="border-t border-border">
                    <td className="px-3 py-2 text-muted-foreground">{formatDateTime(entry.at)}</td>
                    <td
                      className={`px-3 py-2 font-extrabold ${entry.delta >= 0 ? "text-success" : "text-danger"}`}
                    >
                      {entry.delta >= 0 ? "+" : "−"}
                      {Math.abs(entry.delta).toLocaleString("ar-SA", { maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-2 font-bold">
                      {entry.balance_after.toLocaleString("ar-SA", { maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {pointsReasonLabel(entry.reason)}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{entry.actor_name ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {entry.delta > 0 && entry.expires_at ? formatDate(entry.expires_at) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
    </div>
  );
}

function WalletTab({
  customer,
  canAdjust,
  canSeeLedger,
  onAdjusted,
}: {
  customer: CustomerWalletRow;
  canAdjust: boolean;
  canSeeLedger: boolean;
  onAdjusted: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successBalance, setSuccessBalance] = useState<number | null>(null);

  const {
    data: ledger = [],
    isLoading: ledgerLoading,
    error: ledgerError,
  } = useQuery({
    queryKey: ["wallet_ledger", customer.id],
    queryFn: () => fetchWalletLedger(customer.id),
    enabled: canSeeLedger,
  });

  async function handleAdjust(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSuccessBalance(null);
    const delta = Number(amount);
    if (!Number.isFinite(delta) || delta === 0) {
      setFormError("أدخل مبلغاً غير صفري");
      return;
    }
    if (reason.trim().length < 2) {
      setFormError("أدخل سبباً واضحاً (حرفان على الأقل)");
      return;
    }
    setSubmitting(true);
    try {
      const result = await adjustWallet(customer.id, delta, reason.trim());
      setSuccessBalance(result.balance);
      setAmount("");
      setReason("");
      onAdjusted();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "تعذّر تعديل الرصيد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card-surface p-4">
        <div className="rounded-card bg-secondary p-4">
          <p className="text-xs font-bold text-muted-foreground">رصيد المحفظة الحالي</p>
          <p className="mt-1 text-2xl font-extrabold">{formatSAR(customer.balance)}</p>
        </div>
      </div>

      {canAdjust ? (
        <form onSubmit={handleAdjust} className="card-surface space-y-3 p-4">
          <p className="text-sm font-extrabold">تعديل الرصيد</p>
          <p className="text-[11px] text-muted-foreground">
            مبلغ موجب = إضافة رصيد، مبلغ سالب = خصم رصيد.
          </p>
          <label className="grid gap-1 text-xs font-bold text-muted-foreground">
            المبلغ (ريال)
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="50 أو -50"
              className="rounded-card border border-border bg-background px-3 py-2 text-sm font-bold text-foreground"
            />
          </label>
          <label className="grid gap-1 text-xs font-bold text-muted-foreground">
            السبب
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="تعويض عن طلب متأخر"
              className="rounded-card border border-border bg-background px-3 py-2 text-sm font-bold text-foreground"
            />
          </label>
          {formError ? <p className="text-xs font-bold text-danger">{formError}</p> : null}
          {successBalance !== null ? (
            <p className="text-xs font-bold text-success">
              تم التعديل. الرصيد الجديد {formatSAR(successBalance)}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-card bg-brand px-4 py-2.5 text-sm font-extrabold text-brand-ink disabled:opacity-60"
          >
            {submitting ? "جاري التنفيذ…" : "تنفيذ التعديل"}
          </button>
        </form>
      ) : null}

      {canSeeLedger ? (
        <div className="card-surface overflow-hidden">
          <p className="border-b border-border px-4 py-3 text-sm font-extrabold">سجل حركات المحفظة</p>
          {ledgerError ? (
            <p className="p-4 text-center text-xs font-bold text-danger">تعذّر تحميل السجل</p>
          ) : ledgerLoading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-card bg-secondary opacity-60" />
              ))}
            </div>
          ) : ledger.length === 0 ? (
            <p className="p-4 text-center text-xs font-bold text-muted-foreground">
              لا توجد حركات على المحفظة
            </p>
          ) : (
            <table className="w-full text-right text-xs">
              <thead className="bg-secondary font-bold text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">التاريخ</th>
                  <th className="px-3 py-2">التغيير</th>
                  <th className="px-3 py-2">الرصيد بعدها</th>
                  <th className="px-3 py-2">السبب</th>
                  <th className="px-3 py-2">المنفّذ</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((entry) => (
                  <tr key={entry.id} className="border-t border-border">
                    <td className="px-3 py-2 text-muted-foreground">{formatDateTime(entry.at)}</td>
                    <td
                      className={`px-3 py-2 font-extrabold ${entry.delta >= 0 ? "text-success" : "text-danger"}`}
                    >
                      {entry.delta >= 0 ? "+" : "−"}
                      {formatSAR(Math.abs(entry.delta))}
                    </td>
                    <td className="px-3 py-2 font-bold">{formatSAR(entry.balance_after)}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {walletReasonLabel(entry.reason)}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{entry.actor_name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
    </div>
  );
}
