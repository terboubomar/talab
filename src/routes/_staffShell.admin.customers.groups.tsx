import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  deleteCustomerGroup,
  fetchCustomerGroups,
  saveCustomerGroup,
  type CustomerGroup,
} from "@/lib/customer-groups";
import { usePermissions } from "@/lib/permissions";

export const Route = createFileRoute("/_staffShell/admin/customers/groups")({
  head: () => ({ meta: [{ title: "مجموعات العملاء — طلب" }] }),
  component: CustomerGroupsPage,
});

type FormState = {
  id: string | null;
  nameAr: string;
  nameEn: string;
  isDefault: boolean;
};

const EMPTY_FORM: FormState = {
  id: null,
  nameAr: "",
  nameEn: "",
  isDefault: false,
};

function CustomerGroupsPage() {
  const { loading: permissionsLoading, can } = usePermissions();
  const queryClient = useQueryClient();
  const canView = can("customer_groups.view");
  const canCreate = can("customer_groups.create");
  const canUpdate = can("customer_groups.update");
  const canDelete = can("customer_groups.delete");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const {
    data: groups = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["customer_groups"],
    queryFn: fetchCustomerGroups,
    enabled: !permissionsLoading && canView,
  });

  if (permissionsLoading) {
    return (
      <div className="p-6">
        <div className="card-surface h-32 animate-pulse opacity-60" />
      </div>
    );
  }

  if (!canView) {
    return (
      <main className="p-6">
        <div className="card-surface p-6 text-center text-sm font-bold text-danger">
          لا تملك صلاحية عرض مجموعات العملاء
        </div>
      </main>
    );
  }

  const editing = Boolean(form.id);
  const canSave = editing ? canUpdate : canCreate;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    if (!canSave) return;
    if (!form.nameAr.trim() || !form.nameEn.trim()) {
      setMessage("الاسم بالعربية والإنجليزية مطلوبان");
      return;
    }

    setSaving(true);
    try {
      await saveCustomerGroup({
        groupId: form.id,
        nameAr: form.nameAr.trim(),
        nameEn: form.nameEn.trim(),
        isDefault: form.isDefault,
      });
      setForm(EMPTY_FORM);
      setMessage(editing ? "تم تحديث المجموعة" : "تم إنشاء المجموعة");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["customer_groups"] }),
        queryClient.invalidateQueries({ queryKey: ["customer_group_options"] }),
        queryClient.invalidateQueries({ queryKey: ["customer_crm_list"] }),
      ]);
    } catch (e) {
      const raw = e instanceof Error ? e.message : "تعذّر حفظ المجموعة";
      setMessage(raw.includes("customer_group_name_exists") ? "يوجد اسم مجموعة مطابق بالفعل" : raw);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(group: CustomerGroup) {
    if (!canDelete || group.is_default) return;
    if (!window.confirm(`حذف مجموعة «${group.name_ar}»؟ سيتم نقل عملائها إلى «بدون مجموعة».`)) return;
    setDeletingId(group.id);
    setMessage(null);
    try {
      await deleteCustomerGroup(group.id);
      if (form.id === group.id) setForm(EMPTY_FORM);
      setMessage("تم حذف المجموعة وإلغاء ربط العملاء بها");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["customer_groups"] }),
        queryClient.invalidateQueries({ queryKey: ["customer_group_options"] }),
        queryClient.invalidateQueries({ queryKey: ["customer_crm_list"] }),
      ]);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "تعذّر حذف المجموعة");
    } finally {
      setDeletingId(null);
    }
  }

  function startEdit(group: CustomerGroup) {
    if (!canUpdate) return;
    setMessage(null);
    setForm({
      id: group.id,
      nameAr: group.name_ar,
      nameEn: group.name_en,
      isDefault: group.is_default,
    });
  }

  const totalMembers = groups.reduce((sum, group) => sum + group.member_count, 0);

  return (
    <main className="min-h-screen pb-12">
      <header className="border-b border-border bg-background px-5 py-5">
        <div className="mb-2 text-xs text-muted-foreground">
          <Link to="/admin/customers" className="hover:text-foreground hover:underline">
            العملاء
          </Link>
          <span className="mx-1">›</span>
          <span className="font-bold text-foreground">مجموعات العملاء</span>
        </div>
        <h1 className="text-lg font-extrabold">مجموعات العملاء</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          نظّم العملاء في شرائح تستخدم داخل CRM ونطاقات الكوبونات.
        </p>
      </header>

      <div className="space-y-4 px-5 py-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <Kpi label="عدد المجموعات" value={groups.length.toLocaleString("ar-SA")} />
          <Kpi label="العملاء داخل مجموعات" value={totalMembers.toLocaleString("ar-SA")} />
          <Kpi label="المجموعة الافتراضية" value={groups.find((g) => g.is_default)?.name_ar ?? "—"} />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.35fr_0.8fr]">
          <section className="card-surface overflow-hidden">
            {error ? (
              <div className="p-6 text-center text-sm font-bold text-danger">تعذّر تحميل المجموعات</div>
            ) : isLoading ? (
              <div className="h-48 animate-pulse bg-secondary opacity-60" />
            ) : groups.length === 0 ? (
              <div className="p-6 text-center text-sm font-bold text-muted-foreground">لا توجد مجموعات بعد</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[650px] text-right text-sm">
                  <thead className="bg-secondary text-xs font-bold text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">المجموعة</th>
                      <th className="px-3 py-2">الاسم الإنجليزي</th>
                      <th className="px-3 py-2">العملاء</th>
                      <th className="px-3 py-2">الحالة</th>
                      <th className="px-3 py-2">الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((group) => (
                      <tr key={group.id} className="border-t border-border">
                        <td className="px-3 py-2.5 font-extrabold">{group.name_ar}</td>
                        <td className="px-3 py-2.5 text-muted-foreground" dir="ltr">{group.name_en}</td>
                        <td className="px-3 py-2.5 font-bold">{group.member_count.toLocaleString("ar-SA")}</td>
                        <td className="px-3 py-2.5">
                          {group.is_default ? (
                            <span className="rounded-pill bg-brand/10 px-2 py-1 text-[11px] font-bold text-brand">افتراضية</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">عادية</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-2">
                            {canUpdate ? (
                              <button type="button" onClick={() => startEdit(group)} className="rounded-card border border-border px-2.5 py-1.5 text-xs font-bold hover:bg-secondary">
                                تعديل
                              </button>
                            ) : null}
                            {canDelete && !group.is_default ? (
                              <button
                                type="button"
                                disabled={deletingId === group.id}
                                onClick={() => void handleDelete(group)}
                                className="rounded-card border border-danger/30 px-2.5 py-1.5 text-xs font-bold text-danger hover:bg-danger/5 disabled:opacity-50"
                              >
                                {deletingId === group.id ? "جاري الحذف…" : "حذف"}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <form onSubmit={handleSubmit} className="card-surface h-fit space-y-4 p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-extrabold">{editing ? "تعديل المجموعة" : "مجموعة جديدة"}</h2>
              {editing ? (
                <button type="button" onClick={() => setForm(EMPTY_FORM)} className="text-xs font-bold text-muted-foreground hover:text-foreground">
                  إلغاء
                </button>
              ) : null}
            </div>

            <label className="grid gap-1 text-xs font-bold text-muted-foreground">
              الاسم بالعربية
              <input
                value={form.nameAr}
                disabled={!canSave}
                onChange={(e) => setForm((f) => ({ ...f, nameAr: e.target.value }))}
                className="crm-input"
                placeholder="مثال: عملاء VIP"
              />
            </label>

            <label className="grid gap-1 text-xs font-bold text-muted-foreground">
              الاسم بالإنجليزية
              <input
                value={form.nameEn}
                disabled={!canSave}
                onChange={(e) => setForm((f) => ({ ...f, nameEn: e.target.value }))}
                className="crm-input"
                dir="ltr"
                placeholder="VIP Customers"
              />
            </label>

            <label className="flex items-start gap-2 rounded-card bg-secondary p-3 text-xs font-bold">
              <input
                type="checkbox"
                checked={form.isDefault}
                disabled={!canSave}
                onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))}
                className="mt-1 size-4"
              />
              <span>
                تعيين كمجموعة افتراضية
                <span className="mt-0.5 block font-normal text-muted-foreground">يمكن أن توجد مجموعة افتراضية واحدة فقط.</span>
              </span>
            </label>

            {message ? <p className="text-xs font-bold text-muted-foreground">{message}</p> : null}

            {canSave ? (
              <button type="submit" disabled={saving} className="w-full rounded-card bg-brand px-4 py-2.5 text-sm font-extrabold text-brand-ink disabled:opacity-60">
                {saving ? "جاري الحفظ…" : editing ? "حفظ التعديلات" : "إنشاء المجموعة"}
              </button>
            ) : (
              <p className="text-xs text-muted-foreground">لديك صلاحية العرض فقط.</p>
            )}
          </form>
        </div>

        <div className="card-surface p-4 text-xs text-muted-foreground">
          تعيين العميل إلى مجموعة يتم من صفحة Customer 360 الخاصة به. حذف مجموعة غير افتراضية يلغي ربط العملاء بها ويحذف نطاقات الكوبونات المرتبطة بهذه المجموعة.
        </div>
      </div>
    </main>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-surface p-4">
      <p className="text-xs font-bold text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-extrabold">{value}</p>
    </div>
  );
}
