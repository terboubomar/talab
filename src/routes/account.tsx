import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ChevronLeft,
  ClipboardList,
  Coins,
  FileText,
  LogOut,
  MapPin,
  Phone,
  ShieldCheck,
  UserRound,
  WalletCards,
} from "lucide-react";

import {
  fetchCustomerAccount,
  requestCustomerOtp,
  signOutCustomer,
  updateCustomerProfile,
  verifyCustomerOtp,
  type CustomerAccount,
} from "@/lib/customer-account";
import { formatSAR } from "@/lib/menu";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/account")({
  head: () => ({
    meta: [
      { title: "حسابي — طلب" },
      { name: "description", content: "حساب العميل والطلبات والمحفظة والنقاط" },
    ],
  }),
  component: AccountPage,
});

type AccountTab = "overview" | "orders" | "wallet" | "points" | "addresses" | "profile";

const ORDER_STATUS: Record<string, string> = {
  pending: "بانتظار القبول",
  accepted: "تم القبول",
  preparing: "قيد التحضير",
  ready: "جاهز",
  out_for_delivery: "في الطريق",
  completed: "مكتمل",
  cancelled: "ملغي",
};

const ORDER_TYPE: Record<string, string> = {
  pickup: "استلام",
  delivery: "توصيل",
  curbside: "من السيارة",
  dinein: "محلي",
};

function AccountPage() {
  const [checking, setChecking] = useState(true);
  const [account, setAccount] = useState<CustomerAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<AccountTab>("overview");

  useEffect(() => {
    if (!supabase) {
      setChecking(false);
      return;
    }

    let active = true;
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      if (!data.session) {
        setChecking(false);
        return;
      }
      try {
        const next = await fetchCustomerAccount();
        if (active) setAccount(next);
      } catch (cause) {
        if (active) setError(accountErrorMessage(cause));
      } finally {
        if (active) setChecking(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") setAccount(null);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function authenticated() {
    setChecking(true);
    setError(null);
    try {
      setAccount(await fetchCustomerAccount());
    } catch (cause) {
      setError(accountErrorMessage(cause));
    } finally {
      setChecking(false);
    }
  }

  async function logout() {
    await signOutCustomer();
    setAccount(null);
    setTab("overview");
  }

  if (checking) return <AccountLoading />;
  if (!account) return <CustomerLogin onAuthenticated={authenticated} error={error} />;

  const customerName = account.profile.name || "أهلاً بك";
  const completed = account.orders.filter((order) => order.status === "completed").length;

  return (
    <main className="min-h-screen bg-surface-sunk pb-12 text-ink" dir="rtl">
      <header className="border-b border-line bg-surface-raised">
        <div className="mx-auto flex max-w-[1040px] items-center justify-between gap-3 px-4 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link to="/menu" className="grid size-10 shrink-0 place-items-center rounded-full border border-line bg-surface" aria-label="العودة للقائمة">
              <ChevronLeft className="size-5 rotate-180" />
            </Link>
            <div className="min-w-0">
              <p className="text-xs text-ink-3">حسابي</p>
              <h1 className="truncate text-lg font-extrabold">{customerName}</h1>
            </div>
          </div>
          <button type="button" onClick={logout} className="inline-flex min-h-10 items-center gap-2 rounded-card border border-line px-3 text-xs font-bold text-ink-2 hover:bg-surface-sunk">
            <LogOut className="size-4" /> تسجيل الخروج
          </button>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1040px] gap-5 px-4 py-5 lg:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-5 lg:self-start">
          <div className="flex gap-2 overflow-x-auto pb-1 lg:grid lg:overflow-visible lg:rounded-card lg:border lg:border-line lg:bg-surface-raised lg:p-2">
            <AccountNav active={tab === "overview"} onClick={() => setTab("overview")} icon={<UserRound className="size-4" />}>نظرة عامة</AccountNav>
            <AccountNav active={tab === "orders"} onClick={() => setTab("orders")} icon={<ClipboardList className="size-4" />}>طلباتي</AccountNav>
            <AccountNav active={tab === "wallet"} onClick={() => setTab("wallet")} icon={<WalletCards className="size-4" />}>المحفظة</AccountNav>
            <AccountNav active={tab === "points"} onClick={() => setTab("points")} icon={<Coins className="size-4" />}>النقاط</AccountNav>
            <AccountNav active={tab === "addresses"} onClick={() => setTab("addresses")} icon={<MapPin className="size-4" />}>عناويني</AccountNav>
            <AccountNav active={tab === "profile"} onClick={() => setTab("profile")} icon={<UserRound className="size-4" />}>البيانات الشخصية</AccountNav>
            <Link to="/policies" className="inline-flex min-w-max items-center gap-2 rounded-card px-3 py-2.5 text-xs font-bold text-ink-2 transition hover:bg-surface-sunk lg:w-full">
              <FileText className="size-4" /> السياسات والشروط
            </Link>
          </div>
        </aside>

        <section className="min-w-0">
          {tab === "overview" ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <SummaryCard label="رصيد المحفظة" value={formatSAR(Number(account.wallet.balance))} icon={<WalletCards className="size-5" />} onClick={() => setTab("wallet")} />
                <SummaryCard label="نقاطي" value={formatNumber(account.points.balance)} icon={<Coins className="size-5" />} onClick={() => setTab("points")} />
                <SummaryCard label="الطلبات المكتملة" value={String(completed)} icon={<ClipboardList className="size-5" />} onClick={() => setTab("orders")} />
              </div>
              <Panel title="آخر الطلبات" action={<button type="button" onClick={() => setTab("orders")} className="text-xs font-bold text-brand">عرض الكل</button>}>
                <OrdersList orders={account.orders.slice(0, 4)} />
              </Panel>
              <Link to="/policies" className="flex items-center justify-between rounded-card border border-line bg-surface-raised p-4 transition hover:border-brand/40">
                <span className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-full bg-brand/10 text-brand"><ShieldCheck className="size-5" /></span>
                  <span><strong className="block text-sm">السياسات والشروط</strong><span className="mt-1 block text-xs text-ink-3">الخصوصية، الطلبات، الإلغاء والاسترداد، والمحفظة والنقاط</span></span>
                </span>
                <ChevronLeft className="size-4 text-ink-3" />
              </Link>
            </div>
          ) : null}

          {tab === "orders" ? <Panel title="طلباتي"><OrdersList orders={account.orders} /></Panel> : null}
          {tab === "wallet" ? <LedgerView title="المحفظة" balance={formatSAR(Number(account.wallet.balance))} rows={account.wallet.ledger} money /> : null}
          {tab === "points" ? <LedgerView title="نقاطي" balance={formatNumber(account.points.balance)} rows={account.points.ledger} /> : null}
          {tab === "addresses" ? <AddressesView addresses={account.addresses} /> : null}
          {tab === "profile" ? <ProfileView account={account} onUpdated={authenticated} /> : null}
        </section>
      </div>
    </main>
  );
}

function CustomerLogin({ onAuthenticated, error }: { onAuthenticated: () => Promise<void>; error: string | null }) {
  const [phone, setPhone] = useState("");
  const [verifiedPhone, setVerifiedPhone] = useState("");
  const [token, setToken] = useState("");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(error);

  async function sendOtp(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const normalized = await requestCustomerOtp(phone);
      setVerifiedPhone(normalized);
      setStep("otp");
    } catch (cause) {
      setMessage(authErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await verifyCustomerOtp(verifiedPhone || phone, token);
      await onAuthenticated();
    } catch (cause) {
      setMessage(authErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-surface-sunk px-4 py-8 text-ink" dir="rtl">
      <div className="mx-auto max-w-md">
        <Link to="/menu" className="mb-5 inline-flex items-center gap-2 text-xs font-bold text-ink-2"><ChevronLeft className="size-4 rotate-180" /> العودة للقائمة</Link>
        <div className="rounded-card border border-line bg-surface-raised p-5 shadow-1 sm:p-7">
          <div className="mx-auto grid size-14 place-items-center rounded-full bg-brand/10 text-brand"><UserRound className="size-7" /></div>
          <div className="mt-4 text-center">
            <h1 className="text-xl font-extrabold">حسابي</h1>
            <p className="mt-2 text-sm leading-6 text-ink-3">سجل الدخول برقم الجوال للوصول إلى طلباتك، محفظتك، نقاطك وعناوينك المحفوظة.</p>
          </div>

          {step === "phone" ? (
            <form onSubmit={sendOtp} className="mt-6 space-y-4">
              <label className="grid gap-2 text-xs font-bold text-ink-2">
                رقم الجوال
                <div className="flex items-center rounded-card border border-line bg-surface px-3 focus-within:border-brand">
                  <Phone className="size-4 text-ink-3" />
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="05xxxxxxxx" className="min-h-12 w-full bg-transparent px-3 text-sm outline-none" required />
                </div>
              </label>
              <button type="submit" disabled={busy || phone.trim().length < 9} className="min-h-12 w-full rounded-card bg-brand px-4 text-sm font-extrabold text-brand-ink disabled:opacity-50">{busy ? "جاري الإرسال…" : "إرسال رمز التحقق"}</button>
            </form>
          ) : (
            <form onSubmit={verify} className="mt-6 space-y-4">
              <div className="rounded-card bg-surface-sunk px-3 py-2 text-center text-xs text-ink-3">تم إرسال الرمز إلى <bdi>{verifiedPhone}</bdi></div>
              <label className="grid gap-2 text-xs font-bold text-ink-2">رمز التحقق<input value={token} onChange={(e) => setToken(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="••••••" className="min-h-12 rounded-card border border-line bg-surface px-4 text-center text-xl tracking-[0.35em] outline-none focus:border-brand" required /></label>
              <button type="submit" disabled={busy || token.length < 6} className="min-h-12 w-full rounded-card bg-brand px-4 text-sm font-extrabold text-brand-ink disabled:opacity-50">{busy ? "جاري التحقق…" : "دخول"}</button>
              <button type="button" onClick={() => { setStep("phone"); setToken(""); setMessage(null); }} className="w-full text-xs font-bold text-ink-3">تغيير رقم الجوال</button>
            </form>
          )}

          {message ? <p className="mt-4 rounded-card bg-danger/10 px-3 py-2 text-xs font-bold text-danger">{message}</p> : null}
          <p className="mt-5 text-center text-[11px] leading-5 text-ink-3">بالمتابعة أنت توافق على <Link to="/policies" className="font-bold text-brand">الشروط وسياسة الخصوصية</Link>.</p>
        </div>
      </div>
    </main>
  );
}

function AccountNav({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return <button type="button" onClick={onClick} className={`inline-flex min-w-max items-center gap-2 rounded-card px-3 py-2.5 text-xs font-bold transition lg:w-full ${active ? "bg-brand text-brand-ink" : "bg-surface-raised text-ink-2 hover:bg-surface-sunk"}`}>{icon}{children}</button>;
}

function SummaryCard({ label, value, icon, onClick }: { label: string; value: string; icon: ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="rounded-card border border-line bg-surface-raised p-4 text-start transition hover:border-brand/40"><span className="mb-4 grid size-9 place-items-center rounded-full bg-brand/10 text-brand">{icon}</span><span className="block text-xs font-bold text-ink-3">{label}</span><strong className="mt-1 block text-xl font-extrabold tabular-nums">{value}</strong></button>;
}

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <section className="overflow-hidden rounded-card border border-line bg-surface-raised"><div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3"><h2 className="text-sm font-extrabold">{title}</h2>{action}</div><div className="p-4">{children}</div></section>;
}

function OrdersList({ orders }: { orders: CustomerAccount["orders"] }) {
  if (!orders.length) return <Empty icon={<ClipboardList className="size-6" />} text="لا توجد طلبات مرتبطة بهذا الحساب بعد." />;
  return <div className="divide-y divide-line">{orders.map((order) => <article key={order.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm">طلب #{order.id.slice(0, 8)}</strong><span className="rounded-pill bg-surface-sunk px-2 py-1 text-[10px] font-bold text-ink-3">{ORDER_STATUS[order.status] ?? order.status}</span></div><p className="mt-1 text-xs text-ink-3">{order.branch_name} · {ORDER_TYPE[order.order_type] ?? order.order_type} · {formatDate(order.placed_at)}</p></div><strong className="text-sm tabular-nums">{formatSAR(Number(order.total))}</strong></article>)}</div>;
}

function LedgerView({ title, balance, rows, money = false }: { title: string; balance: string; rows: CustomerAccount["wallet"]["ledger"]; money?: boolean }) {
  return <div className="space-y-4"><div className="rounded-card bg-brand p-5 text-brand-ink"><p className="text-xs font-bold opacity-70">{title === "المحفظة" ? "الرصيد المتاح" : "الرصيد الحالي"}</p><p className="mt-2 text-3xl font-extrabold tabular-nums">{balance}</p></div><Panel title="سجل الحركات">{rows.length ? <div className="divide-y divide-line">{rows.map((row) => <div key={row.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"><div><p className="text-xs font-bold">{row.reason || "حركة رصيد"}</p><p className="mt-1 text-[11px] text-ink-3">{formatDate(row.at)}</p></div><div className="text-end"><strong className={`text-sm tabular-nums ${Number(row.delta) >= 0 ? "text-success" : "text-danger"}`}>{Number(row.delta) >= 0 ? "+" : ""}{money ? formatSAR(Number(row.delta)) : formatNumber(Number(row.delta))}</strong><p className="mt-1 text-[10px] text-ink-3">الرصيد: {money ? formatSAR(Number(row.balance_after)) : formatNumber(Number(row.balance_after))}</p></div></div>)}</div> : <Empty icon={money ? <WalletCards className="size-6" /> : <Coins className="size-6" />} text="لا توجد حركات حتى الآن." />}</Panel></div>;
}

function AddressesView({ addresses }: { addresses: CustomerAccount["addresses"] }) {
  return <Panel title="عناويني">{addresses.length ? <div className="grid gap-3 sm:grid-cols-2">{addresses.map((address) => <div key={address.id} className="rounded-card border border-line p-4"><div className="flex items-center justify-between gap-2"><strong className="text-sm">{address.label || "عنوان محفوظ"}</strong>{address.is_default ? <span className="rounded-pill bg-brand/10 px-2 py-1 text-[10px] font-bold text-brand">الافتراضي</span> : null}</div><p className="mt-2 text-xs leading-6 text-ink-3">{[address.area_name, address.street, address.unit_no ? `وحدة ${address.unit_no}` : null].filter(Boolean).join("، ") || "تفاصيل العنوان محفوظة"}</p></div>)}</div> : <Empty icon={<MapPin className="size-6" />} text="لا توجد عناوين محفوظة بعد. يمكنك حفظ عنوان أثناء طلب التوصيل." />}</Panel>;
}

function ProfileView({ account, onUpdated }: { account: CustomerAccount; onUpdated: () => Promise<void> }) {
  const [name, setName] = useState(account.profile.name ?? "");
  const [email, setEmail] = useState(account.profile.email ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await updateCustomerProfile(name, email);
      await onUpdated();
      setMessage("تم حفظ بياناتك.");
    } catch (cause) {
      setMessage(accountErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return <Panel title="البيانات الشخصية"><form onSubmit={save} className="grid max-w-xl gap-4"><label className="grid gap-2 text-xs font-bold text-ink-2">الاسم<input value={name} onChange={(e) => setName(e.target.value)} className="min-h-11 rounded-card border border-line bg-surface px-3 text-sm outline-none focus:border-brand" required /></label><label className="grid gap-2 text-xs font-bold text-ink-2">رقم الجوال<input value={account.profile.phone} disabled className="min-h-11 rounded-card border border-line bg-surface-sunk px-3 text-sm text-ink-3" /></label><label className="grid gap-2 text-xs font-bold text-ink-2">البريد الإلكتروني <span className="font-normal text-ink-3">(اختياري)</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="min-h-11 rounded-card border border-line bg-surface px-3 text-sm outline-none focus:border-brand" /></label><button type="submit" disabled={busy || name.trim().length < 2} className="min-h-11 rounded-card bg-brand px-4 text-sm font-extrabold text-brand-ink disabled:opacity-50">{busy ? "جاري الحفظ…" : "حفظ التغييرات"}</button>{message ? <p className="text-xs font-bold text-ink-3">{message}</p> : null}</form></Panel>;
}

function Empty({ icon, text }: { icon: ReactNode; text: string }) { return <div className="py-8 text-center text-ink-3"><span className="mx-auto mb-2 grid size-10 place-items-center rounded-full bg-surface-sunk">{icon}</span><p className="text-xs">{text}</p></div>; }
function AccountLoading() { return <main className="min-h-screen bg-surface-sunk p-4"><div className="mx-auto grid max-w-[1040px] gap-4 pt-16 sm:grid-cols-3">{[0,1,2,3,4,5].map((i) => <div key={i} className="h-28 animate-pulse rounded-card bg-surface-raised" />)}</div></main>; }
function formatDate(value: string) { return new Intl.DateTimeFormat("ar-SA", { timeZone: "Asia/Riyadh", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function formatNumber(value: number) { return new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 2 }).format(Number(value || 0)); }
function authErrorMessage(cause: unknown) { const message = cause instanceof Error ? cause.message : String(cause ?? ""); if (/rate|60 second|sms/i.test(message)) return "تعذّر إرسال الرمز الآن. حاول مرة أخرى بعد قليل."; if (/invalid.*otp|token.*expired|otp.*expired/i.test(message)) return "رمز التحقق غير صحيح أو انتهت صلاحيته."; return "تعذّر تسجيل الدخول. تأكد من رقم الجوال وحاول مرة أخرى."; }
function accountErrorMessage(cause: unknown) { const message = cause instanceof Error ? cause.message : String(cause ?? ""); if (message.includes("phone_already_linked")) return "رقم الجوال مرتبط بحساب آخر."; if (message.includes("customer_phone_ambiguous")) return "تعذّر ربط الحساب تلقائياً. تواصل مع خدمة العملاء."; if (message.includes("phone_auth_required")) return "يجب تسجيل الدخول برقم جوال موثّق."; return "تعذّر تحميل الحساب حالياً. حاول مرة أخرى."; }
