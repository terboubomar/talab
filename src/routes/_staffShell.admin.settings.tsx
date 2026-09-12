import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FileText, Settings2, Upload } from "lucide-react";

import { usePermissions } from "@/lib/permissions";
import {
  createTaxCertificateSignedUrl,
  fetchSettings,
  fetchSettingsBranchOptions,
  saveSettings,
  uploadSettingsPublicImage,
  uploadTaxCertificate,
  type CheckoutSettings,
  type GeneralSettings,
  type OrderSettings,
  type PaymentSettings,
  type SettingsGroupKey,
} from "@/lib/settings";

export const Route = createFileRoute("/_staffShell/admin/settings")({
  head: () => ({ meta: [{ title: "الإعدادات — طلب" }] }),
  component: SettingsPage,
});

type SettingsPageItem = {
  key: SettingsGroupKey;
  label: string;
  description: string;
  documented: boolean;
};

const SETTINGS_PAGES: SettingsPageItem[] = [
  { key: "general", label: "الإعدادات العامة", description: "اللغة والضريبة والعملاء والمدفوعات العامة", documented: true },
  { key: "order", label: "إعدادات الطلبات", description: "أنواع الطلب والوقت وسلوك الطلب", documented: true },
  { key: "dinein", label: "إعدادات المحلي", description: "إعدادات الطلب المحلي", documented: false },
  { key: "checkout", label: "إعدادات إتمام الطلب", description: "محتوى صفحة الإتمام ورسالة النجاح", documented: true },
  { key: "application", label: "إعدادات التطبيق", description: "إعدادات تطبيق العميل", documented: false },
  { key: "website", label: "إعدادات الموقع", description: "إعدادات واجهة الموقع", documented: false },
  { key: "pages", label: "إعدادات الصفحات", description: "الصفحات والمحتوى", documented: false },
  { key: "text-control", label: "التحكم بالنصوص", description: "النصوص القابلة للتخصيص", documented: false },
  { key: "delivery-areas", label: "مناطق التوصيل", description: "إعدادات نطاقات التوصيل", documented: false },
  { key: "working-times", label: "أوقات العمل", description: "إعدادات ساعات العمل", documented: false },
  { key: "notifications", label: "مركز الإشعارات", description: "إعدادات الإشعارات", documented: false },
  { key: "payment", label: "إعدادات الدفع", description: "طرق الدفع والمحفظة وهوية الدفع الأونلاين", documented: true },
  { key: "links-page", label: "صفحة الروابط", description: "إعدادات صفحة الروابط", documented: false },
  { key: "activity-log", label: "سجل النشاط", description: "نشاط وتغييرات الإعدادات", documented: false },
  { key: "other", label: "أخرى", description: "إعدادات إضافية", documented: false },
];

function SettingsPage() {
  const { tenantId, can, loading } = usePermissions();
  const canManage = can("settings.manage");
  const [active, setActive] = useState<SettingsGroupKey>("general");
  const current = SETTINGS_PAGES.find((page) => page.key === active) ?? SETTINGS_PAGES[0];

  if (loading || !tenantId) {
    return <main className="min-h-screen px-5 py-6"><div className="card-surface h-40 animate-pulse opacity-60" /></main>;
  }

  return (
    <main className="min-h-screen pb-10" dir="rtl">
      <header className="sticky top-0 z-20 border-b border-border bg-background px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-card bg-secondary text-brand"><Settings2 className="size-5" aria-hidden /></span>
          <div>
            <h1 className="text-base font-extrabold">الإعدادات</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">إدارة إعدادات المتجر والطلبات والدفع من مكان واحد</p>
          </div>
        </div>
      </header>

      <div className="grid gap-5 px-5 py-6 lg:grid-cols-[270px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <nav className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1" aria-label="أقسام الإعدادات">
            {SETTINGS_PAGES.map((page) => (
              <button
                key={page.key}
                type="button"
                onClick={() => setActive(page.key)}
                aria-current={active === page.key ? "page" : undefined}
                className={`rounded-card border px-3 py-3 text-start transition-colors ${active === page.key ? "border-brand bg-brand/10" : "border-border bg-background hover:border-brand/40"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-extrabold">{page.label}</span>
                  {page.documented ? <span className="rounded-pill bg-success/10 px-2 py-0.5 text-[10px] font-bold text-success">متاح</span> : null}
                </div>
                <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-muted-foreground">{page.description}</p>
              </button>
            ))}
          </nav>
        </aside>

        <section className="min-w-0">
          <div className="mb-4">
            <h2 className="text-lg font-extrabold">{current.label}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{current.description}</p>
          </div>

          {active === "general" ? <GeneralSettingsPanel tenantId={tenantId} canManage={canManage} /> : null}
          {active === "order" ? <OrderSettingsPanel canManage={canManage} /> : null}
          {active === "checkout" ? <CheckoutSettingsPanel tenantId={tenantId} canManage={canManage} /> : null}
          {active === "payment" ? <PaymentSettingsPanel tenantId={tenantId} canManage={canManage} /> : null}
          {!current.documented ? <UndocumentedSettingsPage page={current} /> : null}
        </section>
      </div>
    </main>
  );
}

function useSettingsForm<T extends object>(groupKey: SettingsGroupKey) {
  const query = useQuery({
    queryKey: ["staff_settings", groupKey],
    queryFn: () => fetchSettings<T>(groupKey),
    retry: false,
  });
  const [form, setForm] = useState<T | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) setForm(query.data);
  }, [query.data]);

  async function save() {
    if (!form) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await saveSettings(groupKey, form);
      setForm(result as T);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "تعذّر حفظ الإعدادات");
    } finally {
      setSaving(false);
    }
  }

  return { ...query, form, setForm, saving, saved, saveError, save };
}

function GeneralSettingsPanel({ tenantId, canManage }: { tenantId: string; canManage: boolean }) {
  const settings = useSettingsForm<GeneralSettings>("general");
  const branches = useQuery({ queryKey: ["settings_branch_options"], queryFn: fetchSettingsBranchOptions, retry: false });
  const [uploading, setUploading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const form = settings.form;

  if (settings.isLoading || !form) return <SettingsSkeleton />;
  if (settings.isError) return <SettingsError error={settings.error} />;

  function toggleLanguage(language: "ar" | "en") {
    const exists = form.languages.includes(language);
    if (exists && form.languages.length === 1) return;
    const languages = exists ? form.languages.filter((item) => item !== language) : [...form.languages, language];
    const defaultLanguage = languages.includes(form.default_language) ? form.default_language : languages[0];
    settings.setForm({ ...form, languages, default_language: defaultLanguage });
  }

  async function uploadCertificate(file: File) {
    setUploading(true);
    setFileError(null);
    try {
      const path = await uploadTaxCertificate(tenantId, file);
      settings.setForm({ ...form, tax_certificate_path: path });
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "تعذّر رفع الشهادة الضريبية");
    } finally {
      setUploading(false);
    }
  }

  async function viewCertificate() {
    if (!form.tax_certificate_path) return;
    try {
      const url = await createTaxCertificateSignedUrl(form.tax_certificate_path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "تعذّر فتح الشهادة");
    }
  }

  return (
    <div className="space-y-4">
      <SettingsCard title="اللغة والضريبة" description="الإعدادات الأساسية الظاهرة للعملاء والفواتير.">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <FieldLabel>اللغات المتاحة</FieldLabel>
            <div className="mt-2 flex gap-2">
              <ChoiceButton active={form.languages.includes("ar")} disabled={!canManage} onClick={() => toggleLanguage("ar")}>العربية</ChoiceButton>
              <ChoiceButton active={form.languages.includes("en")} disabled={!canManage} onClick={() => toggleLanguage("en")}>English</ChoiceButton>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">يجب إبقاء لغة واحدة على الأقل مفعلة.</p>
          </div>
          <label>
            <FieldLabel>اللغة الافتراضية</FieldLabel>
            <select disabled={!canManage} value={form.default_language} onChange={(e) => settings.setForm({ ...form, default_language: e.target.value })} className="field mt-2">
              {form.languages.includes("ar") ? <option value="ar">العربية</option> : null}
              {form.languages.includes("en") ? <option value="en">English</option> : null}
            </select>
          </label>
          <label>
            <FieldLabel>الرقم الضريبي</FieldLabel>
            <input dir="ltr" disabled={!canManage} value={form.vat_number} onChange={(e) => settings.setForm({ ...form, vat_number: e.target.value })} className="field mt-2 text-end" placeholder="310xxxxxxxxxxx" />
          </label>
          <ToggleRow label="جميع الأسعار شاملة الضريبة" checked={form.tax_inclusive} disabled={!canManage} onChange={(checked) => settings.setForm({ ...form, tax_inclusive: checked })} />
        </div>

        <div className="mt-5 rounded-card border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-extrabold">الشهادة الضريبية</p>
              <p className="mt-1 text-xs text-muted-foreground">PDF أو صورة، بحد أقصى 8MB. الملف محفوظ بشكل خاص.</p>
            </div>
            <div className="flex gap-2">
              {form.tax_certificate_path ? (
                <button type="button" onClick={viewCertificate} className="inline-flex min-h-11 items-center gap-2 rounded-card border border-border px-4 text-xs font-bold"><ExternalLink className="size-4" aria-hidden /> عرض</button>
              ) : null}
              {canManage ? (
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-card bg-foreground px-4 text-xs font-bold text-background">
                  <Upload className="size-4" aria-hidden /> {uploading ? "جارٍ الرفع..." : "رفع ملف"}
                  <input type="file" className="sr-only" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={uploading} onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadCertificate(file); e.currentTarget.value = ""; }} />
                </label>
              ) : null}
            </div>
          </div>
          {form.tax_certificate_path ? <p dir="ltr" className="mt-2 truncate text-[11px] text-muted-foreground">{form.tax_certificate_path.split("/").pop()}</p> : null}
          {fileError ? <p className="mt-2 text-xs font-bold text-destructive">{fileError}</p> : null}
        </div>
      </SettingsCard>

      <SettingsCard title="عناوين العملاء" description="فعّل حقول العنوان وحدد الحقول الإجبارية.">
        <ToggleRow label="ميزة عناوين العملاء" checked={form.customer_addresses_enabled} disabled={!canManage} onChange={(checked) => settings.setForm({ ...form, customer_addresses_enabled: checked })} />
        <div className="mt-4 overflow-x-auto rounded-card border border-border">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-secondary text-xs"><tr><th className="px-4 py-3 text-start">الحقل</th><th className="px-4 py-3">مفعّل</th><th className="px-4 py-3">إجباري</th></tr></thead>
            <tbody className="divide-y divide-border">
              {([
                ["unit_type", "نوع الوحدة"], ["street", "الشارع"], ["unit_no", "رقم الوحدة"], ["floor", "الطابق"], ["apartment", "الشقة"], ["description", "الوصف"],
              ] as const).map(([key, label]) => {
                const row = form.address_fields[key];
                return <tr key={key}><td className="px-4 py-3 font-bold">{label}</td><td className="px-4 py-3 text-center"><input type="checkbox" disabled={!canManage || !form.customer_addresses_enabled} checked={row.enabled} onChange={(e) => settings.setForm({ ...form, address_fields: { ...form.address_fields, [key]: { enabled: e.target.checked, required: e.target.checked ? row.required : false } } })} className="size-4 accent-[var(--accent)]" /></td><td className="px-4 py-3 text-center"><input type="checkbox" disabled={!canManage || !form.customer_addresses_enabled || !row.enabled} checked={row.required} onChange={(e) => settings.setForm({ ...form, address_fields: { ...form.address_fields, [key]: { ...row, required: e.target.checked } } })} className="size-4 accent-[var(--accent)]" /></td></tr>;
              })}
            </tbody>
          </table>
        </div>
      </SettingsCard>

      <SettingsCard title="بيانات العميل قبل الشراء" description="حدد إن كان العميل مطالباً بإكمال بيانات إضافية قبل تنفيذ الطلب.">
        <ToggleRow label="طلب إكمال بيانات العميل قبل الشراء" checked={form.complete_customer_before_purchase} disabled={!canManage} onChange={(checked) => settings.setForm({ ...form, complete_customer_before_purchase: checked })} />
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {([ ["name", "الاسم"], ["email", "البريد الإلكتروني"], ["gender", "الجنس"], ["dob", "تاريخ الميلاد"] ] as const).map(([key, label]) => (
            <ToggleRow key={key} label={label} checked={form.required_customer_fields[key]} disabled={!canManage || !form.complete_customer_before_purchase} onChange={(checked) => settings.setForm({ ...form, required_customer_fields: { ...form.required_customer_fields, [key]: checked } })} compact />
          ))}
        </div>
      </SettingsCard>

      <SettingsCard title="استخدام الدفع" description="حدد الخدمات الإضافية التي يمكن الدفع لها واختر الفرع المستقبل للمدفوعات.">
        <div className="grid gap-2 sm:grid-cols-3">
          <ToggleRow compact label="شحن الرصيد" checked={form.payments_for.wallet_topup} disabled={!canManage} onChange={(checked) => settings.setForm({ ...form, payments_for: { ...form.payments_for, wallet_topup: checked } })} />
          <ToggleRow compact label="بطاقات الهدايا" checked={form.payments_for.gift_cards} disabled={!canManage} onChange={(checked) => settings.setForm({ ...form, payments_for: { ...form.payments_for, gift_cards: checked } })} />
          <ToggleRow compact label="الباقات" checked={form.payments_for.packages} disabled={!canManage} onChange={(checked) => settings.setForm({ ...form, payments_for: { ...form.payments_for, packages: checked } })} />
        </div>
        <label className="mt-4 block max-w-xl">
          <FieldLabel>الفرع المستقبل للمدفوعات</FieldLabel>
          <select disabled={!canManage || branches.isLoading} value={form.payment_receiving_branch_id ?? ""} onChange={(e) => settings.setForm({ ...form, payment_receiving_branch_id: e.target.value || null })} className="field mt-2">
            <option value="">بدون تحديد</option>
            {(branches.data ?? []).map((branch) => <option key={branch.id} value={branch.id}>{branch.name_ar}{branch.status !== "active" ? " — غير نشط" : ""}</option>)}
          </select>
        </label>
      </SettingsCard>

      <SaveBar canManage={canManage} saving={settings.saving} saved={settings.saved} error={settings.saveError} onSave={settings.save} />
    </div>
  );
}

function OrderSettingsPanel({ canManage }: { canManage: boolean }) {
  const settings = useSettingsForm<OrderSettings>("order");
  const form = settings.form;
  if (settings.isLoading || !form) return <SettingsSkeleton />;
  if (settings.isError) return <SettingsError error={settings.error} />;

  const toggles: Array<[keyof OrderSettings, string, string?]> = [
    ["add_to_cart_before_order_type", "الإضافة للسلة قبل اختيار نوع الطلب"],
    ["show_driver_info", "عرض معلومات السائق"],
    ["pickup_confirmation_message", "رسالة تأكيد الاستلام"],
    ["customer_cancel_while_waiting", "السماح للعميل بالإلغاء أثناء الانتظار"],
    ["show_branch_phone", "عرض رقم هاتف الفرع"],
    ["show_delivery_time_in_cart", "عرض وقت التوصيل في السلة"],
    ["send_details_whatsapp", "إرسال التفاصيل بالواتساب"],
    ["handed_to_driver_button", "زر تم التسليم للمندوب"],
    ["location_time_before_products", "اختيار الموقع والوقت قبل المنتجات"],
    ["product_suggestions", "اقتراحات المنتجات"],
  ];

  return <div className="space-y-4">
    <SettingsCard title="أنواع الطلبات" description="أنواع الطلب المسموح بها على مستوى المتجر.">
      <div className="grid gap-2 sm:grid-cols-2">
        {([ ["pickup", "استلام"], ["delivery", "توصيل"], ["curbside", "من السيارة"], ["dinein", "محلي"] ] as const).map(([key, label]) => <ToggleRow key={key} compact label={label} checked={form.order_types[key]} disabled={!canManage} onChange={(checked) => settings.setForm({ ...form, order_types: { ...form.order_types, [key]: checked } })} />)}
      </div>
    </SettingsCard>
    <SettingsCard title="خيارات الوقت" description="حدد ما إذا كان الطلب بأسرع وقت أو يمكن جدولته مسبقاً.">
      <div className="grid gap-2 sm:grid-cols-2">
        <ToggleRow compact label="أسرع وقت" checked={form.time_options.asap} disabled={!canManage} onChange={(checked) => settings.setForm({ ...form, time_options: { ...form.time_options, asap: checked } })} />
        <ToggleRow compact label="الطلب المسبق" checked={form.time_options.scheduled} disabled={!canManage} onChange={(checked) => settings.setForm({ ...form, time_options: { ...form.time_options, scheduled: checked } })} />
      </div>
    </SettingsCard>
    <SettingsCard title="سلوك الطلب" description="الخيارات المرصودة في ملف المشروع لإدارة تجربة الطلب.">
      <div className="grid gap-2 lg:grid-cols-2">
        {toggles.map(([key, label]) => <ToggleRow key={String(key)} compact label={label} checked={Boolean(form[key])} disabled={!canManage} onChange={(checked) => settings.setForm({ ...form, [key]: checked })} />)}
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label><FieldLabel>طريقة اختيار الموقع</FieldLabel><select disabled={!canManage} value={form.location_method} onChange={(e) => settings.setForm({ ...form, location_method: e.target.value })} className="field mt-2"><option value="map">خريطة</option></select></label>
        <label><FieldLabel>عدد الدقائق قبل انتهاء صلاحية الطلب</FieldLabel><input type="number" min={1} max={1440} disabled={!canManage} value={form.order_expiry_minutes} onChange={(e) => settings.setForm({ ...form, order_expiry_minutes: Math.max(1, Number(e.target.value) || 1) })} className="field mt-2" /></label>
      </div>
    </SettingsCard>
    <SaveBar canManage={canManage} saving={settings.saving} saved={settings.saved} error={settings.saveError} onSave={settings.save} />
  </div>;
}

function CheckoutSettingsPanel({ tenantId, canManage }: { tenantId: string; canManage: boolean }) {
  const settings = useSettingsForm<CheckoutSettings>("checkout");
  const [uploading, setUploading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const form = settings.form;
  if (settings.isLoading || !form) return <SettingsSkeleton />;
  if (settings.isError) return <SettingsError error={settings.error} />;

  const toggles: Array<[keyof CheckoutSettings, string]> = [
    ["show_customer_info", "عرض معلومات العميل"], ["show_delivery_info", "عرض معلومات التوصيل"], ["show_pickup_info", "عرض معلومات الاستلام"], ["show_curbside_info", "عرض معلومات من السيارة"], ["show_time", "عرض الوقت"], ["show_coupon_codes", "عرض أكواد الخصم"], ["show_order_details", "عرض تفاصيل الطلب"], ["show_price_details", "عرض تفاصيل السعر"], ["show_product_notes", "عرض ملاحظات المنتج"], ["show_order_notes", "عرض ملاحظات الطلب"], ["order_notes_required", "ملاحظات الطلب إجبارية"], ["allow_quantity_edit", "السماح بتعديل الكمية"], ["show_price_while_adding", "عرض السعر أثناء الإضافة"], ["show_preparation_prompt", "عرض كيف حاب نجهز طلبك"], ["show_expected_arrival_time", "عرض وقت الوصول المتوقع"],
  ];

  async function uploadSuccessImage(file: File) {
    setUploading(true); setFileError(null);
    try { const url = await uploadSettingsPublicImage(tenantId, "checkout", file); settings.setForm({ ...form, success_popup: { ...form.success_popup, image_path: url } }); }
    catch (error) { setFileError(error instanceof Error ? error.message : "تعذّر رفع الصورة"); }
    finally { setUploading(false); }
  }

  return <div className="space-y-4">
    <SettingsCard title="محتوى صفحة إتمام الطلب" description="تحكم بالعناصر التي تظهر للعميل أثناء مراجعة الطلب.">
      <div className="grid gap-2 lg:grid-cols-2">{toggles.map(([key, label]) => <ToggleRow key={String(key)} compact label={label} checked={Boolean(form[key])} disabled={!canManage} onChange={(checked) => settings.setForm({ ...form, [key]: checked })} />)}</div>
    </SettingsCard>
    <SettingsCard title="نافذة نجاح الطلب" description="صورة ورسالتان بالعربية والإنجليزية بعد نجاح الطلب.">
      <div className="grid gap-3 md:grid-cols-2">
        <TextField label="السطر الأول — عربي" disabled={!canManage} value={form.success_popup.line1_ar} onChange={(value) => settings.setForm({ ...form, success_popup: { ...form.success_popup, line1_ar: value } })} />
        <TextField label="Line 1 — English" dir="ltr" disabled={!canManage} value={form.success_popup.line1_en} onChange={(value) => settings.setForm({ ...form, success_popup: { ...form.success_popup, line1_en: value } })} />
        <TextField label="السطر الثاني — عربي" disabled={!canManage} value={form.success_popup.line2_ar} onChange={(value) => settings.setForm({ ...form, success_popup: { ...form.success_popup, line2_ar: value } })} />
        <TextField label="Line 2 — English" dir="ltr" disabled={!canManage} value={form.success_popup.line2_en} onChange={(value) => settings.setForm({ ...form, success_popup: { ...form.success_popup, line2_en: value } })} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {form.success_popup.image_path ? <img src={form.success_popup.image_path} alt="صورة نجاح الطلب" className="h-20 w-28 rounded-card border border-border object-cover" /> : <div className="grid h-20 w-28 place-items-center rounded-card border border-dashed border-border text-xs text-muted-foreground">بدون صورة</div>}
        {canManage ? <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-card border border-border px-4 text-xs font-bold"><Upload className="size-4" aria-hidden />{uploading ? "جارٍ الرفع..." : "رفع صورة"}<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadSuccessImage(file); e.currentTarget.value = ""; }} /></label> : null}
        {form.success_popup.image_path && canManage ? <button type="button" onClick={() => settings.setForm({ ...form, success_popup: { ...form.success_popup, image_path: null } })} className="min-h-11 rounded-card px-4 text-xs font-bold text-destructive">إزالة الصورة</button> : null}
      </div>
      {fileError ? <p className="mt-2 text-xs font-bold text-destructive">{fileError}</p> : null}
    </SettingsCard>
    <SaveBar canManage={canManage} saving={settings.saving} saved={settings.saved} error={settings.saveError} onSave={settings.save} />
  </div>;
}

function PaymentSettingsPanel({ tenantId, canManage }: { tenantId: string; canManage: boolean }) {
  const settings = useSettingsForm<PaymentSettings>("payment");
  const [uploading, setUploading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const form = settings.form;
  if (settings.isLoading || !form) return <SettingsSkeleton />;
  if (settings.isError) return <SettingsError error={settings.error} />;

  async function uploadLogo(file: File) {
    setUploading(true); setFileError(null);
    try { const url = await uploadSettingsPublicImage(tenantId, "payment", file); settings.setForm({ ...form, online_payment_logo_path: url }); }
    catch (error) { setFileError(error instanceof Error ? error.message : "تعذّر رفع الشعار"); }
    finally { setUploading(false); }
  }

  return <div className="space-y-4">
    <SettingsCard title="طرق الدفع" description="الخيارات المرصودة في ملف المشروع.">
      <div className="grid gap-2 md:grid-cols-2">
        <ToggleRow compact label="نقداً" checked={form.cash_enabled} disabled={!canManage} onChange={(checked) => settings.setForm({ ...form, cash_enabled: checked })} />
        <ToggleRow compact label="جهاز POS" checked={form.pos_device_enabled} disabled={!canManage} onChange={(checked) => settings.setForm({ ...form, pos_device_enabled: checked })} />
        <ToggleRow compact label="STC Pay باركود" checked={form.stc_pay_barcode_enabled} disabled={!canManage} onChange={(checked) => settings.setForm({ ...form, stc_pay_barcode_enabled: checked })} />
        <ToggleRow compact label="المحفظة مع الدفع النقدي" checked={form.wallet_with_cash_enabled} disabled={!canManage} onChange={(checked) => settings.setForm({ ...form, wallet_with_cash_enabled: checked })} />
        <ToggleRow compact label="بنرات تمارا (BNPL)" checked={form.tamara_banners_enabled} disabled={!canManage} onChange={(checked) => settings.setForm({ ...form, tamara_banners_enabled: checked })} />
      </div>
      <label className="mt-4 block max-w-sm"><FieldLabel>الحد الأقصى للمحفظة لكل طلب</FieldLabel><input type="number" min={0} step="0.01" disabled={!canManage} value={form.wallet_max_per_order ?? ""} onChange={(e) => settings.setForm({ ...form, wallet_max_per_order: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })} className="field mt-2" placeholder="بدون حد" /></label>
    </SettingsCard>
    <SettingsCard title="هوية طريقة الدفع الأونلاين" description="اسم وشعار مخصص لطريقة الدفع التي يراها العميل.">
      <div className="grid gap-3 md:grid-cols-2">
        <TextField label="الاسم بالعربية" disabled={!canManage} value={form.online_payment_name_ar} onChange={(value) => settings.setForm({ ...form, online_payment_name_ar: value })} />
        <TextField label="Name in English" dir="ltr" disabled={!canManage} value={form.online_payment_name_en} onChange={(value) => settings.setForm({ ...form, online_payment_name_en: value })} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {form.online_payment_logo_path ? <img src={form.online_payment_logo_path} alt="شعار الدفع" className="size-20 rounded-card border border-border object-contain p-2" /> : <div className="grid size-20 place-items-center rounded-card border border-dashed border-border text-xs text-muted-foreground">بدون شعار</div>}
        {canManage ? <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-card border border-border px-4 text-xs font-bold"><Upload className="size-4" aria-hidden />{uploading ? "جارٍ الرفع..." : "رفع شعار"}<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadLogo(file); e.currentTarget.value = ""; }} /></label> : null}
        {form.online_payment_logo_path && canManage ? <button type="button" onClick={() => settings.setForm({ ...form, online_payment_logo_path: null })} className="min-h-11 rounded-card px-4 text-xs font-bold text-destructive">إزالة الشعار</button> : null}
      </div>
      {fileError ? <p className="mt-2 text-xs font-bold text-destructive">{fileError}</p> : null}
    </SettingsCard>
    <SaveBar canManage={canManage} saving={settings.saving} saved={settings.saved} error={settings.saveError} onSave={settings.save} />
  </div>;
}

function UndocumentedSettingsPage({ page }: { page: SettingsPageItem }) {
  return <div className="card-surface p-8 text-center"><FileText className="mx-auto size-8 text-muted-foreground" aria-hidden /><h3 className="mt-3 font-extrabold">{page.label}</h3><p className="mx-auto mt-2 max-w-xl text-sm leading-7 text-muted-foreground">هذه الصفحة موجودة ضمن هيكل الإعدادات في ملف المشروع، لكن الحقول الداخلية الخاصة بها غير موثقة في المصدر المرفوع بعد. لن نضيف إعدادات افتراضية أو نخمن سلوكها قبل توثيقها.</p><span className="mt-4 inline-flex rounded-pill bg-secondary px-3 py-1.5 text-xs font-bold text-muted-foreground">قيد الاستكمال من المصدر</span></div>;
}

function SettingsCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return <section className="card-surface p-5"><div className="border-b border-border pb-4"><h3 className="text-sm font-extrabold">{title}</h3>{description ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p> : null}</div><div className="pt-4">{children}</div></section>;
}

function ToggleRow({ label, description, checked, onChange, disabled, compact = false }: { label: string; description?: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; compact?: boolean }) {
  return <label className={`flex cursor-pointer items-center justify-between gap-4 rounded-card border border-border bg-background ${compact ? "px-3 py-3" : "px-4 py-4"}`}><span className="min-w-0"><span className="block text-sm font-bold">{label}</span>{description ? <span className="mt-1 block text-xs text-muted-foreground">{description}</span> : null}</span><input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="size-4 shrink-0 accent-[var(--accent)] disabled:opacity-50" /></label>;
}

function ChoiceButton({ active, disabled, onClick, children }: { active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" disabled={disabled} onClick={onClick} className={`min-h-11 rounded-card border px-4 text-sm font-bold ${active ? "border-brand bg-brand/10 text-brand" : "border-border bg-background"} disabled:opacity-50`}>{children}</button>;
}

function FieldLabel({ children }: { children: React.ReactNode }) { return <span className="text-xs font-bold text-muted-foreground">{children}</span>; }

function TextField({ label, value, onChange, disabled, dir }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean; dir?: "rtl" | "ltr" }) {
  return <label><FieldLabel>{label}</FieldLabel><input dir={dir} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} className={`field mt-2 ${dir === "ltr" ? "text-start" : ""}`} /></label>;
}

function SaveBar({ canManage, saving, saved, error, onSave }: { canManage: boolean; saving: boolean; saved: boolean; error: string | null; onSave: () => Promise<void> }) {
  if (!canManage) return <div className="rounded-card bg-secondary px-4 py-3 text-xs text-muted-foreground">للعرض فقط — تحتاج صلاحية التحكم بإعدادات الموقع للتعديل.</div>;
  return <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-background/95 p-3 shadow-card backdrop-blur"><div>{saved ? <p className="text-sm font-bold text-success">تم حفظ الإعدادات ✓</p> : <p className="text-xs text-muted-foreground">احفظ التغييرات لتطبيقها.</p>}{error ? <p className="mt-1 text-xs font-bold text-destructive">{error}</p> : null}</div><button type="button" disabled={saving} onClick={() => void onSave()} className="min-h-11 rounded-card bg-brand px-6 text-sm font-extrabold text-brand-ink disabled:opacity-50">{saving ? "جارٍ الحفظ..." : "حفظ التغييرات"}</button></div>;
}

function SettingsSkeleton() { return <div className="space-y-4"><div className="card-surface h-44 animate-pulse opacity-60" /><div className="card-surface h-64 animate-pulse opacity-60" /></div>; }
function SettingsError({ error }: { error: unknown }) { return <div className="card-surface p-8 text-center"><p className="font-extrabold">تعذّر تحميل الإعدادات</p><p className="mt-2 text-xs text-muted-foreground">{error instanceof Error ? error.message : "حاول مرة أخرى"}</p></div>; }
