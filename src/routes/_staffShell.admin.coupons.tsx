import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, TicketPercent, Trash2, X } from "lucide-react";

import { usePermissions } from "@/lib/permissions";
import {
  deleteCoupon,
  fetchCoupons,
  fetchCouponScopeOptions,
  saveCoupon,
  type Coupon,
  type CouponScope,
  type CouponScopeOptions,
  type CouponScopeType,
} from "@/lib/coupons";
import { formatSAR } from "@/lib/menu";

export const Route = createFileRoute("/_staffShell/admin/coupons")({
  head: () => ({ meta: [{ title: "الكوبونات — طلب" }] }),
  component: CouponsPage,
});

type EditorState = {
  id: string | null;
  code: string;
  discountType: "percent" | "fixed";
  value: string;
  maxDiscount: string;
  freeDelivery: boolean;
  autoApply: boolean;

  minPurchase: string;
  startsAt: string;
  endsAt: string;
  totalLimit: string;
  perCustomerLimit: string;
  successAr: string;
  successEn: string;
  status: "active" | "inactive";
  useSchedule: boolean;
  weekdays: number[];
  startTime: string;
  endTime: string;
  scopes: CouponScope[];
};

const EMPTY: EditorState = {
  id: null,
  code: "",
  discountType: "percent",
  value: "10",
  maxDiscount: "",
  freeDelivery: false,
  minPurchase: "0",
  startsAt: "",
  endsAt: "",
  totalLimit: "",
  perCustomerLimit: "",
  successAr: "تم تطبيق الكوبون بنجاح",
  successEn: "Coupon applied successfully",
  status: "active",
  useSchedule: false,
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  startTime: "00:00",
  endTime: "23:59",
  scopes: [],
};

const DAY_LABELS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const ORDER_TYPES = [
  ["pickup", "استلام"],
  ["delivery", "توصيل"],
  ["curbside", "من السيارة"],
  ["dinein", "محلي"],
] as const;
const SOURCES = [["web", "Web"], ["mobile", "Mobile"], ["call_center", "Call Center"]] as const;

function localInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function fromCoupon(coupon: Coupon): EditorState {
  const windows = Array.isArray(coupon.day_parting_json?.['windows'])
    ? coupon.day_parting_json['windows'] as Array<Record<string, unknown>>
    : [];
  const first = windows[0];
  return {
    id: coupon.id,
    code: coupon.code,
    discountType: coupon.discount_type,
    value: String(coupon.value),
    maxDiscount: coupon.max_discount == null ? "" : String(coupon.max_discount),
    freeDelivery: coupon.free_delivery,
    minPurchase: String(coupon.min_purchase),
    startsAt: localInput(coupon.starts_at),
    endsAt: localInput(coupon.ends_at),
    totalLimit: coupon.total_limit == null ? "" : String(coupon.total_limit),
    perCustomerLimit: coupon.per_customer_limit == null ? "" : String(coupon.per_customer_limit),
    successAr: coupon.success_msg_ar ?? "",
    successEn: coupon.success_msg_en ?? "",
    status: coupon.status,
    useSchedule: Boolean(first),
    weekdays: Array.isArray(first?.['weekdays']) ? first['weekdays'].map(Number) : [0, 1, 2, 3, 4, 5, 6],
    startTime: typeof first?.['start'] === "string" ? first['start'] : "00:00",
    endTime: typeof first?.['end'] === "string" ? first['end'] : "23:59",
    scopes: coupon.scopes,
  };
}

function CouponsPage() {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const couponsQuery = useQuery({ queryKey: ["coupons"], queryFn: fetchCoupons });
  const optionsQuery = useQuery({ queryKey: ["coupon_scope_options"], queryFn: fetchCouponScopeOptions });
  const coupons = couponsQuery.data ?? [];
  const options = optionsQuery.data ?? { branches: [], categories: [], products: [], customer_groups: [], customers: [] };

  const stats = useMemo(() => ({
    total: coupons.length,
    active: coupons.filter((c) => c.status === "active").length,
    scheduled: coupons.filter((c) => c.starts_at || c.ends_at).length,
  }), [coupons]);

  async function persist() {
    if (!editor) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await saveCoupon({
        couponId: editor.id,
        rule: {
          code: editor.code.trim().toUpperCase(),
          discount_type: editor.discountType,
          value: editor.value || "0",
          max_discount: editor.maxDiscount,
          free_delivery: editor.freeDelivery,
          min_purchase: editor.minPurchase || "0",
          starts_at: editor.startsAt ? new Date(editor.startsAt).toISOString() : "",
          ends_at: editor.endsAt ? new Date(editor.endsAt).toISOString() : "",
          total_limit: editor.totalLimit,
          per_customer_limit: editor.perCustomerLimit,
          auto_apply: false,
          day_parting_json: editor.useSchedule
            ? { windows: [{ weekdays: editor.weekdays, start: editor.startTime, end: editor.endTime }] }
            : {},
          success_msg_ar: editor.successAr,
          success_msg_en: editor.successEn,
          status: editor.status,
        },
        scopes: editor.scopes,
      });
      await queryClient.invalidateQueries({ queryKey: ["coupons"] });
      setMessage(editor.id ? "تم تحديث الكوبون" : "تم إنشاء الكوبون");
      setEditor(null);
    } catch (e) {
      const text = e instanceof Error ? e.message : "";
      setError(text.includes("coupons_tenant_code_uidx") ? "رمز الكوبون مستخدم مسبقاً" : text.includes("not_authorized") ? "لا تملك صلاحية تنفيذ هذا الإجراء" : "تعذّر حفظ الكوبون");
    } finally {
      setSaving(false);
    }
  }

  async function remove(coupon: Coupon) {
    if (!window.confirm(`حذف الكوبون ${coupon.code}؟`)) return;
    setError(null);
    try {
      await deleteCoupon(coupon.id);
      await queryClient.invalidateQueries({ queryKey: ["coupons"] });
      setMessage("تم حذف الكوبون");
      if (editor?.id === coupon.id) setEditor(null);
    } catch {
      setError("تعذّر حذف الكوبون");
    }
  }

  return (
    <main className="min-h-screen pb-12">
      <header className="border-b border-border bg-background px-5 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-extrabold">كوبونات الخصم</h1>
            <p className="mt-1 text-xs text-muted-foreground">قواعد الخصم والحجوزات المؤقتة تُحسب وتُفرض على الخادم.</p>
          </div>
          {can("coupons.create") ? (
            <button type="button" onClick={() => { setEditor({ ...EMPTY, scopes: [] }); setError(null); }} className="inline-flex items-center gap-1.5 rounded-pill bg-brand px-4 py-2.5 text-sm font-bold text-brand-ink">
              <Plus aria-hidden className="size-4" /> كوبون جديد
            </button>
          ) : null}
        </div>
      </header>

      <div className="space-y-5 px-5 py-6">
        <section className="grid gap-3 sm:grid-cols-3">
          <Kpi label="إجمالي الكوبونات" value={String(stats.total)} />
          <Kpi label="مفعّلة" value={String(stats.active)} />
          <Kpi label="بصلاحية زمنية" value={String(stats.scheduled)} />
        </section>

        {message ? <div className="rounded-card border border-success/30 bg-success/10 p-3 text-sm font-bold text-success">{message}</div> : null}
        {error ? <div className="rounded-card border border-danger/30 bg-danger/10 p-3 text-sm font-bold text-danger">{error}</div> : null}

        {editor ? (
          <CouponEditor editor={editor} setEditor={setEditor} options={options} saving={saving} canSave={editor.id ? can("coupons.update") : can("coupons.create")} onSave={persist} onClose={() => setEditor(null)} />
        ) : null}

        <section className="card-surface overflow-hidden">
          <div className="border-b border-border p-4"><h2 className="text-sm font-extrabold">الكوبونات</h2></div>
          {couponsQuery.isLoading ? <div className="h-40 animate-pulse bg-secondary/40" /> : coupons.length === 0 ? (
            <div className="px-5 py-12 text-center"><TicketPercent aria-hidden className="mx-auto size-8 text-muted-foreground" /><p className="mt-3 text-sm font-bold">لا توجد كوبونات بعد</p></div>
          ) : (
            <div className="divide-y divide-border">
              {coupons.map((coupon) => (
                <div key={coupon.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span dir="ltr" className="text-sm font-extrabold">{coupon.code}</span>
                      <span className={`rounded-pill px-2.5 py-1 text-[10px] font-bold ${coupon.status === "active" ? "bg-success/10 text-success" : "bg-secondary text-muted-foreground"}`}>{coupon.status === "active" ? "مفعّل" : "متوقف"}</span>
                      {coupon.free_delivery ? <span className="rounded-pill bg-brand/10 px-2.5 py-1 text-[10px] font-bold text-brand">توصيل مجاني</span> : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {coupon.discount_type === "percent" ? `${coupon.value}%` : formatSAR(coupon.value)}
                      {coupon.max_discount != null ? ` · حد أقصى ${formatSAR(coupon.max_discount)}` : ""}
                      {coupon.min_purchase > 0 ? ` · حد أدنى ${formatSAR(coupon.min_purchase)}` : ""}
                      {coupon.scopes.length ? ` · ${coupon.scopes.length} نطاق` : " · كل الطلبات"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {can("coupons.update") ? <button type="button" onClick={() => setEditor(fromCoupon(coupon))} className="rounded-pill border border-border px-3 py-2 text-xs font-bold">تعديل</button> : null}
                    {can("coupons.delete") ? <button type="button" onClick={() => void remove(coupon)} className="rounded-pill border border-danger/40 px-3 py-2 text-xs font-bold text-danger"><Trash2 aria-hidden className="size-3.5" /></button> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function CouponEditor({ editor, setEditor, options, saving, canSave, onSave, onClose }: {
  editor: EditorState;
  setEditor: React.Dispatch<React.SetStateAction<EditorState | null>>;
  options: CouponScopeOptions;
  saving: boolean;
  canSave: boolean;
  onSave: () => void | Promise<void>;
  onClose: () => void;
}) {
  function patch(next: Partial<EditorState>) { setEditor((current) => current ? { ...current, ...next } : current); }
  function toggleScope(type: CouponScopeType, id: string) {
    const exists = editor.scopes.some((s) => s.type === type && s.id === id);
    patch({ scopes: exists ? editor.scopes.filter((s) => !(s.type === type && s.id === id)) : [...editor.scopes, { type, id }] });
  }
  function hasScope(type: CouponScopeType, id: string) { return editor.scopes.some((s) => s.type === type && s.id === id); }

  return (
    <section className="card-surface p-5">
      <div className="flex items-center justify-between gap-3"><h2 className="text-base font-extrabold">{editor.id ? "تعديل الكوبون" : "كوبون جديد"}</h2><button type="button" onClick={onClose}><X aria-hidden className="size-5" /></button></div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Field label="رمز الكوبون"><input dir="ltr" value={editor.code} onChange={(e) => patch({ code: e.target.value.toUpperCase() })} className="input" placeholder="WELCOME10" /></Field>
        <Field label="الحالة"><select value={editor.status} onChange={(e) => patch({ status: e.target.value as EditorState["status"] })} className="input"><option value="active">مفعّل</option><option value="inactive">متوقف</option></select></Field>
        <Field label="نوع الخصم"><select value={editor.discountType} onChange={(e) => patch({ discountType: e.target.value as EditorState["discountType"] })} className="input"><option value="percent">نسبة %</option><option value="fixed">مبلغ ثابت</option></select></Field>
        <Field label="قيمة الخصم"><input type="number" min="0" step="0.01" value={editor.value} onChange={(e) => patch({ value: e.target.value })} className="input" /></Field>
        <Field label="الحد الأقصى للخصم"><input type="number" min="0" step="0.01" value={editor.maxDiscount} onChange={(e) => patch({ maxDiscount: e.target.value })} className="input" placeholder="بدون حد" /></Field>
        <Field label="الحد الأدنى للشراء"><input type="number" min="0" step="0.01" value={editor.minPurchase} onChange={(e) => patch({ minPurchase: e.target.value })} className="input" /></Field>
        <Field label="بداية الصلاحية"><input type="datetime-local" value={editor.startsAt} onChange={(e) => patch({ startsAt: e.target.value })} className="input" /></Field>
        <Field label="نهاية الصلاحية"><input type="datetime-local" value={editor.endsAt} onChange={(e) => patch({ endsAt: e.target.value })} className="input" /></Field>
        <Field label="حد الاستخدام الإجمالي"><input type="number" min="1" value={editor.totalLimit} onChange={(e) => patch({ totalLimit: e.target.value })} className="input" placeholder="بدون حد" /></Field>
        <Field label="الحد لكل عميل"><input type="number" min="1" value={editor.perCustomerLimit} onChange={(e) => patch({ perCustomerLimit: e.target.value })} className="input" placeholder="بدون حد" /></Field>
      </div>

      <label className="mt-4 flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={editor.freeDelivery} onChange={(e) => patch({ freeDelivery: e.target.checked })} /> توصيل مجاني مع الكوبون</label>
      <label className="mt-2 flex items-center gap-2 text-sm font-bold text-muted-foreground"><input type="checkbox" disabled /> التطبيق التلقائي — سيُفعّل بعد اختبار اختيار أفضل كوبون تلقائياً</label>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Field label="رسالة النجاح بالعربية"><input value={editor.successAr} onChange={(e) => patch({ successAr: e.target.value })} className="input" /></Field>
        <Field label="Success message (EN)"><input dir="ltr" value={editor.successEn} onChange={(e) => patch({ successEn: e.target.value })} className="input" /></Field>
      </div>

      <div className="mt-5 rounded-card border border-border p-4">
        <label className="flex items-center gap-2 text-sm font-extrabold"><input type="checkbox" checked={editor.useSchedule} onChange={(e) => patch({ useSchedule: e.target.checked })} /> تخصيص أيام وأوقات عمل الكوبون</label>
        {editor.useSchedule ? (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap gap-2">{DAY_LABELS.map((label, day) => <button key={day} type="button" onClick={() => patch({ weekdays: editor.weekdays.includes(day) ? editor.weekdays.filter((d) => d !== day) : [...editor.weekdays, day].sort() })} className={`rounded-pill px-3 py-1.5 text-xs font-bold ${editor.weekdays.includes(day) ? "bg-brand text-brand-ink" : "border border-border"}`}>{label}</button>)}</div>
            <div className="grid gap-3 sm:grid-cols-2"><Field label="من"><input type="time" value={editor.startTime} onChange={(e) => patch({ startTime: e.target.value })} className="input" /></Field><Field label="إلى"><input type="time" value={editor.endTime} onChange={(e) => patch({ endTime: e.target.value })} className="input" /></Field></div>
          </div>
        ) : null}
      </div>

      <div className="mt-5 space-y-4">
        <ScopeGroup title="أنواع الطلب" items={ORDER_TYPES.map(([id, name]) => ({ id, name }))} type="order_type" selected={hasScope} toggle={toggleScope} />
        <ScopeGroup title="مصدر الطلب" items={SOURCES.map(([id, name]) => ({ id, name }))} type="source" selected={hasScope} toggle={toggleScope} />
        <ScopeGroup title="الفروع" items={options.branches} type="branch" selected={hasScope} toggle={toggleScope} />
        <ScopeGroup title="الأقسام" items={options.categories} type="category" selected={hasScope} toggle={toggleScope} />
        <ScopeGroup title="المنتجات" items={options.products} type="product" selected={hasScope} toggle={toggleScope} limitHeight />
        <ScopeGroup title="مجموعات العملاء" items={options.customer_groups} type="customer_group" selected={hasScope} toggle={toggleScope} />
        <ScopeGroup title="عملاء محددون" items={options.customers.map((c) => ({ id: c.id, name: `${c.name} · ${c.phone}` }))} type="customer" selected={hasScope} toggle={toggleScope} limitHeight />
      </div>

      <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-pill border border-border px-4 py-2.5 text-sm font-bold">إلغاء</button><button type="button" disabled={!canSave || saving || !editor.code.trim()} onClick={() => void onSave()} className="rounded-pill bg-brand px-5 py-2.5 text-sm font-bold text-brand-ink disabled:opacity-50">{saving ? "جارٍ الحفظ..." : "حفظ الكوبون"}</button></div>
    </section>
  );
}

function ScopeGroup({ title, items, type, selected, toggle, limitHeight = false }: {
  title: string;
  items: { id: string; name: string }[];
  type: CouponScopeType;
  selected: (type: CouponScopeType, id: string) => boolean;
  toggle: (type: CouponScopeType, id: string) => void;
  limitHeight?: boolean;
}) {
  if (!items.length) return null;
  return <div><p className="mb-2 text-xs font-extrabold text-muted-foreground">{title} <span className="font-normal">(بدون اختيار = الكل)</span></p><div className={`flex flex-wrap gap-2 ${limitHeight ? "max-h-32 overflow-y-auto rounded-card border border-border p-2" : ""}`}>{items.map((item) => <button key={item.id} type="button" onClick={() => toggle(type, item.id)} className={`rounded-pill px-3 py-1.5 text-xs font-bold ${selected(type, item.id) ? "bg-brand text-brand-ink" : "border border-border"}`}>{item.name}</button>)}</div></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-xs font-bold text-muted-foreground">{label}</span><div className="mt-1">{children}</div></label>;
}

function Kpi({ label, value }: { label: string; value: string }) {
  return <div className="card-surface p-4"><p className="text-xs font-bold text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-extrabold">{value}</p></div>;
}
