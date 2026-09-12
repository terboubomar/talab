import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  fetchCustomerCrmDetail,
  fetchCustomerGroupOptions,
  fetchCustomerOrders,
  updateCustomerCrm,
  type CustomerCrmRow,
} from "@/lib/crm";
import { adjustPoints, fetchCustomerPoints, fetchPointsLedger, pointsReasonLabel } from "@/lib/loyalty";
import { formatSAR } from "@/lib/menu";
import { usePermissions } from "@/lib/permissions";
import { adjustWallet, fetchWalletLedger, walletReasonLabel } from "@/lib/wallet";

export const Route = createFileRoute("/_staffShell/admin/customers/$customerId")({
  head: () => ({ meta: [{ title: "Customer 360 — طلب" }] }),
  component: Customer360Page,
});

type Tab = "profile" | "orders" | "wallet" | "points";

type ProfileForm = {
  name: string;
  email: string;
  gender: "" | "male" | "female" | "unspecified";
  birthDate: string;
  customerGroupId: string;
  status: "active" | "inactive";
  accountSuspended: boolean;
  manualPaymentDisabled: boolean;
};

function formatDateTime(value: string | null) {
  if (!value) return "—";
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

function Customer360Page() {
  const { customerId } = Route.useParams();
  const { loading: permissionsLoading, can } = usePermissions();
  const [tab, setTab] = useState<Tab>("profile");
  const canView = can("customers.view");

  const { data: customer, isLoading, error } = useQuery({
    queryKey: ["customer_crm_detail", customerId],
    queryFn: () => fetchCustomerCrmDetail(customerId),
    enabled: !permissionsLoading && canView,
  });

  if (permissionsLoading || isLoading) {
    return (
      <div className="p-6">
        <div className="card-surface h-40 animate-pulse opacity-60" />
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

  if (error || !customer) {
    return (
      <main className="p-6">
        <Link to="/admin/customers" className="text-xs font-bold text-brand hover:underline">
          العودة إلى العملاء
        </Link>
        <div className="card-surface mt-4 p-6 text-center text-sm font-bold text-danger">
          تعذّر تحميل بيانات العميل
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen pb-12">
      <header className="border-b border-border bg-background px-5 py-5">
        <div className="mb-2 text-xs text-muted-foreground">
          <Link to="/admin/customers" className="hover:text-foreground hover:underline">العملاء</Link>
          <span className="mx-1">›</span>
          <span className="font-bold text-foreground">Customer 360</span>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-extrabold">{customer.name || "بدون اسم"}</h1>
            <p className="mt-1 text-xs text-muted-foreground" dir="ltr">{customer.phone}</p>
          </div>
          <StatusBadge customer={customer} />
        </div>
      </header>

      <div className="space-y-4 px-5 py-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Summary label="الطلبات المكتملة" value={customer.completed_orders.toLocaleString("ar-SA")} />
          <Summary label="إجمالي الإنفاق" value={formatSAR(customer.total_spend)} />
          <Summary label="رصيد المحفظة" value={formatSAR(customer.wallet_balance)} />
          <PointsSummary customerId={customer.id} />
        </div>

        <div className="flex flex-wrap gap-2">
          <TabButton active={tab === "profile"} onClick={() => setTab("profile")}>الملف</TabButton>
          <TabButton active={tab === "orders"} onClick={() => setTab("orders")}>الطلبات</TabButton>
          <TabButton active={tab === "wallet"} onClick={() => setTab("wallet")}>سجل المحفظة</TabButton>
          <TabButton active={tab === "points"} onClick={() => setTab("points")}>سجل النقاط</TabButton>
          <FutureTab label="سجل الانتظار" />
          <FutureTab label="سجل الحجوزات" />
          <FutureTab label="الجلسات" />
        </div>

        {tab === "profile" ? <ProfileTab customer={customer} /> : null}
        {tab === "orders" ? <OrdersTab customerId={customer.id} /> : null}
        {tab === "wallet" ? <WalletTab customer={customer} /> : null}
        {tab === "points" ? <PointsTab customerId={customer.id} /> : null}
      </div>
    </main>
  );
}

function ProfileTab({ customer }: { customer: CustomerCrmRow }) {
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const canUpdate = can("customers.update");
  const canViewGroups = can("customer_groups.view");
  const [form, setForm] = useState<ProfileForm>(() => customerToForm(customer));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => setForm(customerToForm(customer)), [customer]);

  const { data: groups = [] } = useQuery({
    queryKey: ["customer_group_options"],
    queryFn: fetchCustomerGroupOptions,
    enabled: canViewGroups && canUpdate,
  });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    if (form.name.trim().length < 1) {
      setMessage("اسم العميل مطلوب");
      return;
    }
    setSaving(true);
    try {
      await updateCustomerCrm(customer.id, {
        name: form.name.trim(),
        email: form.email.trim() || null,
        gender: form.gender || null,
        birthDate: form.birthDate || null,
        customerGroupId: form.customerGroupId || null,
        status: form.status,
        accountSuspended: form.accountSuspended,
        manualPaymentDisabled: form.manualPaymentDisabled,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["customer_crm_detail", customer.id] }),
        queryClient.invalidateQueries({ queryKey: ["customer_crm_list"] }),
      ]);
      setMessage("تم حفظ بيانات العميل");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "تعذّر حفظ بيانات العميل");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
      <form onSubmit={handleSubmit} className="card-surface space-y-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-extrabold">بيانات العميل</h2>
          {!canUpdate ? <span className="text-[11px] text-muted-foreground">عرض فقط</span> : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="الاسم">
            <input value={form.name} disabled={!canUpdate} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="crm-input" />
          </Field>
          <Field label="البريد الإلكتروني">
            <input type="email" value={form.email} disabled={!canUpdate} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="crm-input" dir="ltr" />
          </Field>
          <Field label="الجنس">
            <select value={form.gender} disabled={!canUpdate} onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value as ProfileForm["gender"] }))} className="crm-input">
              <option value="">—</option>
              <option value="male">ذكر</option>
              <option value="female">أنثى</option>
              <option value="unspecified">غير محدد</option>
            </select>
          </Field>
          <Field label="تاريخ الميلاد">
            <input type="date" value={form.birthDate} disabled={!canUpdate} onChange={(e) => setForm((f) => ({ ...f, birthDate: e.target.value }))} className="crm-input" />
          </Field>
          <Field label="المجموعة">
            {canUpdate && canViewGroups ? (
              <select value={form.customerGroupId} onChange={(e) => setForm((f) => ({ ...f, customerGroupId: e.target.value }))} className="crm-input">
                <option value="">بدون مجموعة</option>
                {groups.map((group) => <option key={group.id} value={group.id}>{group.name_ar}</option>)}
              </select>
            ) : (
              <div className="crm-input">{customer.group_name ?? "بدون مجموعة"}</div>
            )}
          </Field>
          <Field label="الحالة">
            <select value={form.status} disabled={!canUpdate} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as ProfileForm["status"] }))} className="crm-input">
              <option value="active">نشط</option>
              <option value="inactive">غير نشط</option>
            </select>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle
            label="تعليق الحساب"
            description="تسجيل العميل كمعلّق في CRM."
            checked={form.accountSuspended}
            disabled={!canUpdate}
            onChange={(checked) => setForm((f) => ({ ...f, accountSuspended: checked }))}
          />
          <Toggle
            label="إيقاف الدفع اليدوي"
            description="منع استخدام الدفع اليدوي لهذا العميل عند دعم تدفقه."
            checked={form.manualPaymentDisabled}
            disabled={!canUpdate}
            onChange={(checked) => setForm((f) => ({ ...f, manualPaymentDisabled: checked }))}
          />
        </div>

        {message ? <p className="text-xs font-bold text-muted-foreground">{message}</p> : null}
        {canUpdate ? (
          <button type="submit" disabled={saving} className="rounded-card bg-brand px-4 py-2.5 text-sm font-extrabold text-brand-ink disabled:opacity-60">
            {saving ? "جاري الحفظ…" : "حفظ التغييرات"}
          </button>
        ) : null}
      </form>

      <div className="card-surface p-5">
        <h2 className="mb-4 text-sm font-extrabold">بيانات النظام</h2>
        <dl className="space-y-3 text-xs">
          <Info label="رقم العميل UUID" value={customer.id} ltr />
          <Info label="الجوال" value={customer.phone} ltr />
          <Info label="تاريخ التسجيل" value={formatDateTime(customer.created_at)} />
          <Info label="آخر تحديث" value={formatDateTime(customer.updated_at)} />
          <Info label="آخر تسجيل دخول" value={formatDateTime(customer.last_login_at)} />
          <Info label="آخر طلب" value={formatDateTime(customer.last_order_at)} />
        </dl>
      </div>
    </div>
  );
}

function OrdersTab({ customerId }: { customerId: string }) {
  const { data: orders = [], isLoading, error } = useQuery({
    queryKey: ["customer_orders", customerId],
    queryFn: () => fetchCustomerOrders(customerId),
  });
  if (isLoading) return <div className="card-surface h-32 animate-pulse opacity-60" />;
  if (error) return <div className="card-surface p-6 text-center text-sm font-bold text-danger">تعذّر تحميل الطلبات</div>;
  if (!orders.length) return <div className="card-surface p-6 text-center text-sm font-bold text-muted-foreground">لا توجد طلبات مرئية لهذا العميل</div>;
  return (
    <div className="card-surface overflow-x-auto">
      <table className="w-full min-w-[760px] text-right text-sm">
        <thead className="bg-secondary text-xs font-bold text-muted-foreground">
          <tr><th className="px-3 py-2">الطلب</th><th className="px-3 py-2">الفرع</th><th className="px-3 py-2">النوع</th><th className="px-3 py-2">الحالة</th><th className="px-3 py-2">الدفع</th><th className="px-3 py-2">الإجمالي</th><th className="px-3 py-2">التاريخ</th></tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id} className="border-t border-border">
              <td className="px-3 py-2 font-mono text-xs" dir="ltr">{order.id.slice(0, 8)}</td>
              <td className="px-3 py-2">{order.branch_name}</td>
              <td className="px-3 py-2">{orderTypeLabel(order.order_type)}</td>
              <td className="px-3 py-2">{orderStatusLabel(order.status)}</td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{paymentLabel(order.payment_method, order.payment_status)}</td>
              <td className="px-3 py-2 font-extrabold">{formatSAR(order.total)}</td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{formatDateTime(order.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WalletTab({ customer }: { customer: CustomerCrmRow }) {
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const canAdjust = can("customers.wallet.adjust");
  const canSeeLedger = canAdjust || can("customers.activity.view");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const { data: ledger = [], isLoading } = useQuery({
    queryKey: ["wallet_ledger", customer.id],
    queryFn: () => fetchWalletLedger(customer.id),
    enabled: canSeeLedger,
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const delta = Number(amount);
    if (!Number.isFinite(delta) || delta === 0 || reason.trim().length < 2) {
      setMessage("أدخل مبلغاً غير صفري وسبباً واضحاً");
      return;
    }
    try {
      await adjustWallet(customer.id, delta, reason.trim());
      setAmount(""); setReason("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["wallet_ledger", customer.id] }),
        queryClient.invalidateQueries({ queryKey: ["customer_crm_detail", customer.id] }),
        queryClient.invalidateQueries({ queryKey: ["customer_crm_list"] }),
      ]);
      setMessage("تم تعديل المحفظة");
    } catch (e) { setMessage(e instanceof Error ? e.message : "تعذّر تعديل المحفظة"); }
  }

  return (
    <div className="space-y-4">
      {canAdjust ? (
        <form onSubmit={submit} className="card-surface grid gap-3 p-4 sm:grid-cols-[160px_1fr_auto] sm:items-end">
          <Field label="المبلغ (+/-)"><input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="crm-input" /></Field>
          <Field label="السبب"><input value={reason} onChange={(e) => setReason(e.target.value)} className="crm-input" /></Field>
          <button className="rounded-card bg-brand px-4 py-2.5 text-sm font-extrabold text-brand-ink">حفظ</button>
          {message ? <p className="text-xs font-bold text-muted-foreground sm:col-span-3">{message}</p> : null}
        </form>
      ) : null}
      {!canSeeLedger ? <NoActivityPermission /> : isLoading ? <div className="card-surface h-32 animate-pulse opacity-60" /> : (
        <div className="card-surface overflow-x-auto"><table className="w-full min-w-[680px] text-right text-sm"><thead className="bg-secondary text-xs font-bold text-muted-foreground"><tr><th className="px-3 py-2">التاريخ</th><th className="px-3 py-2">التغيير</th><th className="px-3 py-2">الرصيد</th><th className="px-3 py-2">السبب</th><th className="px-3 py-2">الموظف</th></tr></thead><tbody>{ledger.map((entry) => <tr key={entry.id} className="border-t border-border"><td className="px-3 py-2 text-xs text-muted-foreground">{formatDateTime(entry.at)}</td><td className={`px-3 py-2 font-extrabold ${entry.delta >= 0 ? "text-success" : "text-danger"}`}>{formatSAR(entry.delta)}</td><td className="px-3 py-2">{formatSAR(entry.balance_after)}</td><td className="px-3 py-2">{walletReasonLabel(entry.reason)}</td><td className="px-3 py-2 text-muted-foreground">{entry.actor_name ?? "النظام"}</td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

function PointsTab({ customerId }: { customerId: string }) {
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const canAdjust = can("customers.points.adjust");
  const canSeeLedger = canAdjust || can("customers.activity.view");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const { data: ledger = [], isLoading } = useQuery({ queryKey: ["points_ledger", customerId], queryFn: () => fetchPointsLedger(customerId), enabled: canSeeLedger });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const delta = Number(amount);
    if (!Number.isFinite(delta) || delta === 0 || reason.trim().length < 2) { setMessage("أدخل نقاطاً غير صفرية وسبباً واضحاً"); return; }
    try {
      await adjustPoints(customerId, delta, reason.trim());
      setAmount(""); setReason("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["points_ledger", customerId] }),
        queryClient.invalidateQueries({ queryKey: ["customer_points", customerId] }),
      ]);
      setMessage("تم تعديل النقاط");
    } catch (e) { setMessage(e instanceof Error ? e.message : "تعذّر تعديل النقاط"); }
  }

  return (
    <div className="space-y-4">
      {canAdjust ? (
        <form onSubmit={submit} className="card-surface grid gap-3 p-4 sm:grid-cols-[160px_1fr_auto] sm:items-end">
          <Field label="النقاط (+/-)"><input type="number" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} className="crm-input" /></Field>
          <Field label="السبب"><input value={reason} onChange={(e) => setReason(e.target.value)} className="crm-input" /></Field>
          <button className="rounded-card bg-brand px-4 py-2.5 text-sm font-extrabold text-brand-ink">حفظ</button>
          {message ? <p className="text-xs font-bold text-muted-foreground sm:col-span-3">{message}</p> : null}
        </form>
      ) : null}
      {!canSeeLedger ? <NoActivityPermission /> : isLoading ? <div className="card-surface h-32 animate-pulse opacity-60" /> : (
        <div className="card-surface overflow-x-auto"><table className="w-full min-w-[760px] text-right text-sm"><thead className="bg-secondary text-xs font-bold text-muted-foreground"><tr><th className="px-3 py-2">التاريخ</th><th className="px-3 py-2">التغيير</th><th className="px-3 py-2">الرصيد</th><th className="px-3 py-2">السبب</th><th className="px-3 py-2">الموظف</th><th className="px-3 py-2">الانتهاء</th></tr></thead><tbody>{ledger.map((entry) => <tr key={entry.id} className="border-t border-border"><td className="px-3 py-2 text-xs text-muted-foreground">{formatDateTime(entry.at)}</td><td className={`px-3 py-2 font-extrabold ${entry.delta >= 0 ? "text-success" : "text-danger"}`}>{entry.delta.toLocaleString("ar-SA")}</td><td className="px-3 py-2">{entry.balance_after.toLocaleString("ar-SA")}</td><td className="px-3 py-2">{pointsReasonLabel(entry.reason)}</td><td className="px-3 py-2 text-muted-foreground">{entry.actor_name ?? "النظام"}</td><td className="px-3 py-2 text-xs text-muted-foreground">{formatDateTime(entry.expires_at)}</td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

function PointsSummary({ customerId }: { customerId: string }) {
  const { data } = useQuery({ queryKey: ["customer_points", customerId], queryFn: () => fetchCustomerPoints(customerId) });
  return <Summary label="نقاط الولاء" value={`${(data?.balance ?? 0).toLocaleString("ar-SA")} نقطة`} />;
}

function Summary({ label, value }: { label: string; value: string }) { return <div className="card-surface p-4"><p className="text-xs font-bold text-muted-foreground">{label}</p><p className="mt-1 text-xl font-extrabold">{value}</p></div>; }
function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" onClick={onClick} className={`rounded-pill px-3 py-1.5 text-xs font-extrabold ${active ? "bg-brand text-brand-ink" : "bg-secondary text-muted-foreground"}`}>{children}</button>; }
function FutureTab({ label }: { label: string }) { return <span className="inline-flex cursor-not-allowed items-center gap-1 rounded-pill bg-secondary px-3 py-1.5 text-xs font-bold text-muted-foreground opacity-60">{label}<span className="text-[9px]">قريباً</span></span>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="grid gap-1 text-xs font-bold text-muted-foreground">{label}{children}</label>; }
function Info({ label, value, ltr = false }: { label: string; value: string; ltr?: boolean }) { return <div><dt className="font-bold text-muted-foreground">{label}</dt><dd className="mt-0.5 break-all font-bold text-foreground" dir={ltr ? "ltr" : undefined}>{value}</dd></div>; }
function Toggle({ label, description, checked, disabled, onChange }: { label: string; description: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) { return <label className="card-surface flex items-start gap-3 p-3"><input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4" /><span><span className="block text-xs font-extrabold">{label}</span><span className="text-[11px] text-muted-foreground">{description}</span></span></label>; }
function NoActivityPermission() { return <div className="card-surface p-5 text-center text-xs font-bold text-muted-foreground">لا تملك صلاحية عرض سجل النشاط</div>; }

function StatusBadge({ customer }: { customer: CustomerCrmRow }) {
  if (customer.account_suspended) return <span className="rounded-pill bg-danger/10 px-3 py-1.5 text-xs font-extrabold text-danger">الحساب معلّق</span>;
  return customer.status === "active" ? <span className="rounded-pill bg-success/10 px-3 py-1.5 text-xs font-extrabold text-success">نشط</span> : <span className="rounded-pill bg-secondary px-3 py-1.5 text-xs font-extrabold text-muted-foreground">غير نشط</span>;
}

function customerToForm(customer: CustomerCrmRow): ProfileForm {
  return {
    name: customer.name,
    email: customer.email ?? "",
    gender: customer.gender ?? "",
    birthDate: customer.birth_date ?? "",
    customerGroupId: customer.customer_group_id ?? "",
    status: customer.status,
    accountSuspended: customer.account_suspended,
    manualPaymentDisabled: customer.manual_payment_disabled,
  };
}

function orderTypeLabel(value: string) { return ({ delivery: "توصيل", pickup: "استلام", curbside: "من السيارة", dinein: "محلي" } as Record<string, string>)[value] ?? value; }
function orderStatusLabel(value: string) { return ({ pending: "بانتظار القبول", accepted: "مقبول", preparing: "جاري التجهيز", ready: "جاهز", out_for_delivery: "جاري التوصيل", completed: "مكتمل", cancelled: "ملغي" } as Record<string, string>)[value] ?? value; }
function paymentLabel(method: string, status: string) { return `${method === "cash" ? "نقدي" : "إلكتروني"} · ${status}`; }
