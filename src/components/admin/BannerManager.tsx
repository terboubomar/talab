import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, ImagePlus, Pencil, Plus, Save, Trash2, X } from "lucide-react";

import {
  createBanner,
  deleteBanner,
  fetchAdminBanners,
  removeStorefrontMediaByUrl,
  updateBanner,
  uploadBannerImage,
  type AdminBanner,
} from "@/lib/banners";
import { usePermissions } from "@/lib/permissions";

type FormState = {
  id: string | null;
  titleAr: string;
  titleEn: string;
  linkUrl: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  imageUrl: string;
  mobileImageUrl: string;
};

const WEB_BANNER_WIDTH = 1110;
const WEB_BANNER_HEIGHT = 410;

const EMPTY_FORM: FormState = {
  id: null,
  titleAr: "",
  titleEn: "",
  linkUrl: "",
  startsAt: "",
  endsAt: "",
  isActive: true,
  imageUrl: "",
  mobileImageUrl: "",
};

function toLocalInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function toIso(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function statusLabel(banner: AdminBanner) {
  if (!banner.is_active) return { label: "متوقف", className: "bg-secondary text-muted-foreground" };
  const now = Date.now();
  if (banner.starts_at && new Date(banner.starts_at).getTime() > now) return { label: "مجدول", className: "bg-brand/10 text-brand" };
  if (banner.ends_at && new Date(banner.ends_at).getTime() <= now) return { label: "منتهي", className: "bg-danger/10 text-danger" };
  return { label: "ظاهر في المتجر", className: "bg-success/10 text-success" };
}

function readImageSize(file: File) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("image_validation_unavailable"));
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => {
      const result = { width: image.naturalWidth, height: image.naturalHeight };
      URL.revokeObjectURL(objectUrl);
      resolve(result);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("invalid_image"));
    };
    image.src = objectUrl;
  });
}

export function BannerManager({ onBack }: { onBack: () => void }) {
  const queryClient = useQueryClient();
  const { tenantId, can, loading } = usePermissions();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [desktopFile, setDesktopFile] = useState<File | null>(null);
  const [mobileFile, setMobileFile] = useState<File | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const { data: banners = [], isLoading } = useQuery({
    queryKey: ["admin_banners"],
    queryFn: fetchAdminBanners,
    enabled: !loading && can("marketing.banners"),
  });

  const nextSort = useMemo(() => {
    if (!banners.length) return 10;
    return Math.max(...banners.map((item) => item.sort_order)) + 10;
  }, [banners]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("tenant_missing");
      if (!form.id && !desktopFile && !form.imageUrl) throw new Error("desktop_image_required");
      if (form.startsAt && form.endsAt && new Date(form.endsAt) <= new Date(form.startsAt)) throw new Error("invalid_schedule");

      if (desktopFile) {
        const size = await readImageSize(desktopFile);
        if (size.width !== WEB_BANNER_WIDTH || size.height !== WEB_BANNER_HEIGHT) {
          throw new Error(`desktop_dimensions_invalid:${size.width}x${size.height}`);
        }
      }

      let imageUrl = form.imageUrl;
      let mobileImageUrl = form.mobileImageUrl;
      const oldImageUrl = form.imageUrl;
      const oldMobileImageUrl = form.mobileImageUrl;

      if (desktopFile) {
        const uploaded = await uploadBannerImage(desktopFile, tenantId, "desktop");
        imageUrl = uploaded.publicUrl;
      }
      if (mobileFile) {
        const uploaded = await uploadBannerImage(mobileFile, tenantId, "mobile");
        mobileImageUrl = uploaded.publicUrl;
      }

      const payload = {
        title_ar: form.titleAr.trim() || null,
        title_en: form.titleEn.trim() || null,
        image_url: imageUrl,
        mobile_image_url: mobileImageUrl || null,
        link_url: form.linkUrl.trim() || null,
        is_active: form.isActive,
        starts_at: toIso(form.startsAt),
        ends_at: toIso(form.endsAt),
      };

      if (form.id) {
        await updateBanner(form.id, payload);
      } else {
        await createBanner(tenantId, { ...payload, sort_order: nextSort });
      }

      if (desktopFile && oldImageUrl && oldImageUrl !== imageUrl) await removeStorefrontMediaByUrl(oldImageUrl);
      if (mobileFile && oldMobileImageUrl && oldMobileImageUrl !== mobileImageUrl) await removeStorefrontMediaByUrl(oldMobileImageUrl);
    },
    onSuccess: async () => {
      setMessage("تم حفظ البنر بنجاح");
      closeForm();
      await queryClient.invalidateQueries({ queryKey: ["admin_banners"] });
      await queryClient.invalidateQueries({ queryKey: ["storefront_banners"] });
    },
    onError: (error) => {
      const text = error instanceof Error ? error.message : "";
      if (text.includes("desktop_image_required")) setMessage("صورة البنر للويب مطلوبة");
      else if (text.includes("desktop_dimensions_invalid")) {
        const actual = text.split(":")[1]?.replace("x", " × ");
        setMessage(`مقاس Web - Menu Page يجب أن يكون 1110 × 410 px${actual ? ` — الصورة الحالية ${actual} px` : ""}`);
      }
      else if (text.includes("invalid_schedule")) setMessage("تاريخ الانتهاء يجب أن يكون بعد تاريخ البداية");
      else if (text.includes("image_too_large")) setMessage("حجم الصورة يجب ألا يتجاوز 8 MB");
      else if (text.includes("invalid_image")) setMessage("تعذّر قراءة أبعاد الصورة. جرّب ملف صورة آخر.");
      else setMessage("تعذّر حفظ البنر. تأكد من الصورة والصلاحيات وحاول مرة أخرى.");
    },
  });

  function closeForm() {
    setForm(EMPTY_FORM);
    setDesktopFile(null);
    setMobileFile(null);
    setFormOpen(false);
  }

  function newBanner() {
    setMessage(null);
    setForm(EMPTY_FORM);
    setDesktopFile(null);
    setMobileFile(null);
    setFormOpen(true);
  }

  function editBanner(banner: AdminBanner) {
    setMessage(null);
    setForm({
      id: banner.id,
      titleAr: banner.title_ar ?? "",
      titleEn: banner.title_en ?? "",
      linkUrl: banner.link_url ?? "",
      startsAt: toLocalInput(banner.starts_at),
      endsAt: toLocalInput(banner.ends_at),
      isActive: banner.is_active,
      imageUrl: banner.image_url,
      mobileImageUrl: banner.mobile_image_url ?? "",
    });
    setDesktopFile(null);
    setMobileFile(null);
    setFormOpen(true);
  }

  async function handleDelete(banner: AdminBanner) {
    if (!window.confirm("حذف هذا البنر؟")) return;
    setMessage(null);
    try {
      await deleteBanner(banner.id);
      await Promise.all([
        removeStorefrontMediaByUrl(banner.image_url),
        removeStorefrontMediaByUrl(banner.mobile_image_url),
      ]);
      await queryClient.invalidateQueries({ queryKey: ["admin_banners"] });
      await queryClient.invalidateQueries({ queryKey: ["storefront_banners"] });
      setMessage("تم حذف البنر");
    } catch {
      setMessage("تعذّر حذف البنر");
    }
  }

  async function toggleBanner(banner: AdminBanner) {
    setMessage(null);
    try {
      await updateBanner(banner.id, { is_active: !banner.is_active });
      await queryClient.invalidateQueries({ queryKey: ["admin_banners"] });
      await queryClient.invalidateQueries({ queryKey: ["storefront_banners"] });
    } catch {
      setMessage("تعذّر تحديث حالة البنر");
    }
  }

  async function moveBanner(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= banners.length) return;
    const current = banners[index];
    const target = banners[targetIndex];
    try {
      await Promise.all([
        updateBanner(current.id, { sort_order: target.sort_order }),
        updateBanner(target.id, { sort_order: current.sort_order }),
      ]);
      await queryClient.invalidateQueries({ queryKey: ["admin_banners"] });
      await queryClient.invalidateQueries({ queryKey: ["storefront_banners"] });
    } catch {
      setMessage("تعذّر تغيير ترتيب البنرات");
    }
  }

  if (loading || isLoading) {
    return <div className="p-5"><div className="card-surface h-40 animate-pulse opacity-60" /></div>;
  }

  if (!can("marketing.banners")) {
    return <main className="p-6"><div className="card-surface p-6 text-center text-sm font-bold text-danger">لا تملك صلاحية إدارة البنرات</div></main>;
  }

  return (
    <main className="min-h-screen pb-12">
      <header className="border-b border-border bg-background px-5 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <button type="button" onClick={onBack} className="mb-2 text-xs font-bold text-brand">العودة إلى أدوات التسويق</button>
            <h1 className="text-lg font-extrabold">البنرات الإعلانية</h1>
            <p className="mt-1 text-xs text-muted-foreground">Web - Menu Page · المقاس المطلوب 1110 × 410 px.</p>
          </div>
          <button type="button" onClick={newBanner} className="inline-flex items-center gap-2 rounded-card bg-brand px-4 py-2.5 text-sm font-extrabold text-brand-ink">
            <Plus className="size-4" /> إضافة بنر
          </button>
        </div>
      </header>

      <div className="space-y-4 px-5 py-6">
        {message ? <div className="rounded-card border border-border bg-background p-3 text-center text-sm font-bold">{message}</div> : null}

        {formOpen ? (
          <section className="card-surface p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-extrabold">{form.id ? "تعديل البنر" : "إضافة بنر جديد"}</h2>
                <p className="text-xs text-muted-foreground">صورة Web - Menu Page مطلوبة بمقاس 1110 × 410 px. صورة الجوال اختيارية.</p>
              </div>
              <button type="button" onClick={closeForm} className="grid size-9 place-items-center rounded-card border border-border"><X className="size-4" /></button>
            </div>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="العنوان بالعربي"><input value={form.titleAr} onChange={(e) => setForm((v) => ({ ...v, titleAr: e.target.value }))} className="field" placeholder="اختياري" /></Field>
                <Field label="العنوان بالإنجليزي"><input value={form.titleEn} onChange={(e) => setForm((v) => ({ ...v, titleEn: e.target.value }))} className="field" placeholder="Optional" /></Field>
                <Field label="الرابط عند الضغط"><input value={form.linkUrl} onChange={(e) => setForm((v) => ({ ...v, linkUrl: e.target.value }))} className="field" dir="ltr" placeholder="https://... أو /menu" /></Field>
                <label className="flex items-center gap-2 rounded-card border border-border px-3 py-3 text-sm font-bold"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm((v) => ({ ...v, isActive: e.target.checked }))} /> مفعّل ويظهر في المتجر</label>
                <Field label="يبدأ في"><input type="datetime-local" value={form.startsAt} onChange={(e) => setForm((v) => ({ ...v, startsAt: e.target.value }))} className="field" /></Field>
                <Field label="ينتهي في"><input type="datetime-local" value={form.endsAt} onChange={(e) => setForm((v) => ({ ...v, endsAt: e.target.value }))} className="field" /></Field>

                <div className="sm:col-span-2 grid gap-3 sm:grid-cols-2">
                  <UploadBox
                    label="Web - Menu Page"
                    hint="1110 × 410 px — إلزامي"
                    file={desktopFile}
                    currentUrl={form.imageUrl}
                    onChange={setDesktopFile}
                    required={!form.id}
                  />
                  <UploadBox
                    label="صورة الجوال (اختياري)"
                    hint="يمكن استخدام نسخة مخصصة للجوال"
                    file={mobileFile}
                    currentUrl={form.mobileImageUrl}
                    onChange={setMobileFile}
                  />
                </div>
              </div>

              <div className="rounded-card border border-border bg-secondary p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-muted-foreground">معاينة Web - Menu Page</p>
                  <span className="rounded-pill bg-background px-2 py-1 text-[10px] font-bold text-muted-foreground">1110 × 410</span>
                </div>
                {desktopFile || form.imageUrl ? (
                  <img
                    src={desktopFile ? URL.createObjectURL(desktopFile) : form.imageUrl}
                    alt="معاينة البنر"
                    className="w-full rounded-card object-cover"
                    style={{ aspectRatio: "1110 / 410" }}
                  />
                ) : (
                  <div className="grid w-full place-items-center rounded-card bg-background text-xs text-muted-foreground" style={{ aspectRatio: "1110 / 410" }}>
                    اختر صورة 1110 × 410 px لعرض المعاينة
                  </div>
                )}
                <p className="mt-3 text-xs leading-5 text-muted-foreground">يتم التحقق من أبعاد صورة الويب قبل الحفظ. الحد الأقصى لحجم الملف 8 MB.</p>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4">
              <button type="button" onClick={closeForm} className="rounded-card border border-border px-4 py-2.5 text-sm font-bold">إلغاء</button>
              <button type="button" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()} className="inline-flex items-center gap-2 rounded-card bg-brand px-5 py-2.5 text-sm font-extrabold text-brand-ink disabled:opacity-50"><Save className="size-4" />{saveMutation.isPending ? "جاري الحفظ..." : "حفظ البنر"}</button>
            </div>
          </section>
        ) : null}

        {banners.length === 0 ? (
          <section className="card-surface p-10 text-center"><ImagePlus className="mx-auto size-10 text-muted-foreground" /><h2 className="mt-3 font-extrabold">لا توجد بنرات</h2><p className="mt-1 text-sm text-muted-foreground">أضف أول بنر بمقاس 1110 × 410 px ليظهر أعلى صفحة القائمة.</p><button type="button" onClick={newBanner} className="mt-4 rounded-card bg-brand px-5 py-2.5 text-sm font-bold text-brand-ink">إضافة بنر</button></section>
        ) : (
          <section className="grid gap-3">
            {banners.map((banner, index) => {
              const status = statusLabel(banner);
              return (
                <article key={banner.id} className="card-surface grid gap-4 p-3 md:grid-cols-[220px_minmax(0,1fr)_auto] md:items-center">
                  <img src={banner.image_url} alt={banner.title_ar ?? "بنر"} className="w-full rounded-card object-cover" style={{ aspectRatio: "1110 / 410" }} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><h3 className="font-extrabold">{banner.title_ar || banner.title_en || `بنر ${index + 1}`}</h3><span className={`rounded-pill px-2 py-0.5 text-[10px] font-bold ${status.className}`}>{status.label}</span></div>
                    {banner.link_url ? <p dir="ltr" className="mt-1 truncate text-xs text-muted-foreground">{banner.link_url}</p> : <p className="mt-1 text-xs text-muted-foreground">بدون رابط</p>}
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground"><span>Web: 1110 × 410</span><span>الترتيب: {banner.sort_order}</span>{banner.mobile_image_url ? <span>صورة جوال ✓</span> : null}{banner.starts_at ? <span>من {new Date(banner.starts_at).toLocaleString("ar-SA")}</span> : null}{banner.ends_at ? <span>حتى {new Date(banner.ends_at).toLocaleString("ar-SA")}</span> : null}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1 md:flex-col">
                    <button type="button" onClick={() => moveBanner(index, -1)} disabled={index === 0} className="grid size-9 place-items-center rounded-card border border-border disabled:opacity-30" title="تحريك للأعلى"><ArrowUp className="size-4" /></button>
                    <button type="button" onClick={() => moveBanner(index, 1)} disabled={index === banners.length - 1} className="grid size-9 place-items-center rounded-card border border-border disabled:opacity-30" title="تحريك للأسفل"><ArrowDown className="size-4" /></button>
                    <button type="button" onClick={() => editBanner(banner)} className="grid size-9 place-items-center rounded-card border border-border" title="تعديل"><Pencil className="size-4" /></button>
                    <button type="button" onClick={() => toggleBanner(banner)} className={`grid size-9 place-items-center rounded-card border ${banner.is_active ? "border-success/30 text-success" : "border-border text-muted-foreground"}`} title={banner.is_active ? "إيقاف" : "تفعيل"}>{banner.is_active ? <Check className="size-4" /> : <X className="size-4" />}</button>
                    <button type="button" onClick={() => handleDelete(banner)} className="grid size-9 place-items-center rounded-card border border-danger/30 text-danger" title="حذف"><Trash2 className="size-4" /></button>
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1.5 text-xs font-bold text-muted-foreground"><span>{label}</span>{children}</label>;
}

function UploadBox({
  label,
  hint,
  file,
  currentUrl,
  onChange,
  required = false,
}: {
  label: string;
  hint?: string;
  file: File | null;
  currentUrl: string;
  onChange: (file: File | null) => void;
  required?: boolean;
}) {
  return (
    <label className="grid cursor-pointer gap-2 rounded-card border border-dashed border-border bg-secondary/50 p-4 text-center">
      <ImagePlus className="mx-auto size-6 text-muted-foreground" />
      <span className="text-sm font-bold">{label}{required ? " *" : ""}</span>
      {hint ? <span className="text-[11px] font-bold text-brand">{hint}</span> : null}
      <span className="text-xs text-muted-foreground">{file ? file.name : currentUrl ? "تم رفع صورة — اختر ملفاً لاستبدالها" : "PNG / JPG / WebP / GIF"}</span>
      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={(event) => onChange(event.target.files?.[0] ?? null)} />
    </label>
  );
}
