import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Percent } from "lucide-react";

import {
  fetchTaxSettings,
  updateTaxSettings,
  fetchBusinessInfo,
  updateBusinessInfo,
  type TaxSettings,
  type BusinessInfo,
} from "@/lib/settings";
import { usePermissions } from "@/lib/permissions";

export const Route = createFileRoute("/_staffShell/admin/settings")({
  head: () => ({
    meta: [{ title: "الإعدادات — طلب" }],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { tenantId, can, loading } = usePermissions();
  const canManage = can("settings.manage");

  if (loading || !tenantId) {
    return (
      <main className="min-h-screen px-5 py-6">
        <div className="card-surface h-32 animate-pulse opacity-60" />
      </main>
    );
  }

  return (
    <main className="min-h-screen pb-10">
      <header className="sticky top-0 z-20 border-b border-border bg-background px-5 py-4">
        <h1 className="text-base font-extrabold">الإعدادات</h1>
      </header>
      <div className="grid gap-6 px-5 py-6">
        <TaxSettingsSection tenantId={tenantId} canManage={canManage} />
        <BusinessInfoSection tenantId={tenantId} canManage={canManage} />
      </div>
    </main>
  );
}

function TaxSettingsSection({ tenantId, canManage }: { tenantId: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["tax_settings", tenantId],
    queryFn: () => fetchTaxSettings(tenantId),
  });
  const [form, setForm] = useState<TaxSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data && !form) setForm(data);
  }, [data, form]);

  if (isLoading || !form) {
    return <div className="card-surface h-32 animate-pulse opacity-60" />;
  }

  async function handleSave() {
    if (!form) return;
    setSaving(true);
    try {
      await updateTaxSettings(tenantId, form);
      queryClient.invalidateQueries({ queryKey: ["tax_settings", tenantId] });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card-surface p-5">
      <h2 className="flex items-center gap-2 text-sm font-extrabold">
        <Percent className="size-4 text-brand" aria-hidden />
        الضريبة
      </h2>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-bold text-muted-foreground">نسبة الضريبة (%)</label>
          <input
            type="number"
            step="0.01"
            min={0}
            max={100}
            disabled={!canManage}
            value={(form.vat_rate * 100).toFixed(2)}
            onChange={(e) =>
              setForm((prev) => (prev ? { ...prev, vat_rate: Number(e.target.value) / 100 } : prev))
            }
            className="mt-1 w-full rounded-card border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand disabled:opacity-60"
          />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={!canManage}
              checked={form.tax_inclusive}
              onChange={(e) =>
                setForm((prev) => (prev ? { ...prev, tax_inclusive: e.target.checked } : prev))
              }
              className="size-4 accent-[var(--accent)]"
            />
            الأسعار المعروضة شاملة للضريبة
          </label>
        </div>
      </div>
      {canManage ? (
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="mt-4 rounded-pill bg-brand px-5 py-2.5 text-sm font-bold text-brand-ink disabled:opacity-50"
        >
          {saving ? "جارٍ الحفظ..." : saved ? "تم الحفظ ✓" : "حفظ"}
        </button>
      ) : null}
    </section>
  );
}

function BusinessInfoSection({ tenantId, canManage }: { tenantId: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["business_info", tenantId],
    queryFn: () => fetchBusinessInfo(tenantId),
  });
  const [form, setForm] = useState<BusinessInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data && !form) setForm(data);
  }, [data, form]);

  if (isLoading || !form) {
    return <div className="card-surface h-32 animate-pulse opacity-60" />;
  }

  async function handleSave() {
    if (!form) return;
    setSaving(true);
    try {
      await updateBusinessInfo(tenantId, form);
      queryClient.invalidateQueries({ queryKey: ["business_info", tenantId] });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card-surface p-5">
      <h2 className="flex items-center gap-2 text-sm font-extrabold">
        <Building2 className="size-4 text-brand" aria-hidden />
        معلومات النشاط التجاري
      </h2>
      <div className="mt-4 grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-bold text-muted-foreground">جوال الدعم</label>
            <input
              dir="ltr"
              disabled={!canManage}
              value={form.support_phone}
              onChange={(e) =>
                setForm((prev) => (prev ? { ...prev, support_phone: e.target.value } : prev))
              }
              className="mt-1 w-full rounded-card border border-border bg-background px-3 py-2 text-end text-sm outline-none focus:border-brand disabled:opacity-60"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-muted-foreground">بريد الدعم</label>
            <input
              dir="ltr"
              disabled={!canManage}
              value={form.support_email}
              onChange={(e) =>
                setForm((prev) => (prev ? { ...prev, support_email: e.target.value } : prev))
              }
              className="mt-1 w-full rounded-card border border-border bg-background px-3 py-2 text-end text-sm outline-none focus:border-brand disabled:opacity-60"
            />
          </div>
        </div>
        <div>
          <label className="text-xs font-bold text-muted-foreground">العنوان</label>
          <input
            disabled={!canManage}
            value={form.address_ar}
            onChange={(e) =>
              setForm((prev) => (prev ? { ...prev, address_ar: e.target.value } : prev))
            }
            className="mt-1 w-full rounded-card border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand disabled:opacity-60"
          />
        </div>
        <div>
          <label className="text-xs font-bold text-muted-foreground">نبذة عن النشاط</label>
          <textarea
            rows={3}
            disabled={!canManage}
            value={form.about_ar}
            onChange={(e) =>
              setForm((prev) => (prev ? { ...prev, about_ar: e.target.value } : prev))
            }
            className="mt-1 w-full rounded-card border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand disabled:opacity-60"
          />
        </div>
      </div>
      {canManage ? (
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="mt-4 rounded-pill bg-brand px-5 py-2.5 text-sm font-bold text-brand-ink disabled:opacity-50"
        >
          {saving ? "جارٍ الحفظ..." : saved ? "تم الحفظ ✓" : "حفظ"}
        </button>
      ) : null}
    </section>
  );
}
