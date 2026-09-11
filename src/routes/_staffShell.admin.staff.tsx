import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Copy, UserPlus } from "lucide-react";

import { supabase } from "@/lib/supabase";
import { usePermissions } from "@/lib/permissions";

export const Route = createFileRoute("/_staffShell/admin/staff")({
  head: () => ({ meta: [{ title: "الموظفين — طلب" }] }),
  component: StaffAdminPage,
});

type RoleRow = {
  id: string;
  name_ar: string;
  slug: string;
  branch_scoped: boolean;
};

type BranchRow = {
  id: string;
  name_ar: string;
};

type StaffRow = {
  id: string;
  name: string;
  email: string | null;
  status: string;
  user_id: string | null;
  created_at: string;
};

type StaffRoleRow = { staff_id: string; role_id: string };
type StaffBranchRow = { staff_id: string; branch_id: string };

async function fetchStaffAdminData() {
  if (!supabase) throw new Error("قاعدة البيانات غير متصلة");

  const [staffResult, rolesResult, staffRolesResult, staffBranchesResult, branchesResult] =
    await Promise.all([
      supabase
        .from("staff")
        .select("id, name, email, status, user_id, created_at")
        .order("created_at", { ascending: true }),
      supabase.from("roles").select("id, name_ar, slug, branch_scoped").order("name_ar"),
      supabase.from("staff_roles").select("staff_id, role_id"),
      supabase.from("staff_branches").select("staff_id, branch_id"),
      supabase.from("branches").select("id, name_ar").order("name_ar"),
    ]);

  const firstError = [
    staffResult.error,
    rolesResult.error,
    staffRolesResult.error,
    staffBranchesResult.error,
  ].find(Boolean);
  if (firstError) throw firstError;

  return {
    staff: (staffResult.data ?? []) as StaffRow[],
    roles: (rolesResult.data ?? []) as RoleRow[],
    staffRoles: (staffRolesResult.data ?? []) as StaffRoleRow[],
    staffBranches: (staffBranchesResult.data ?? []) as StaffBranchRow[],
    branches: (branchesResult.data ?? []) as BranchRow[],
  };
}

function StaffAdminPage() {
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("");
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successEmail, setSuccessEmail] = useState<string | null>(null);

  const { data, isLoading, error: queryError } = useQuery({
    queryKey: ["staff_admin"],
    queryFn: fetchStaffAdminData,
    enabled: can("staff.view"),
  });

  const selectedRole = useMemo(
    () => data?.roles.find((role) => role.id === roleId) ?? null,
    [data?.roles, roleId],
  );

  if (!can("staff.view")) {
    return <p className="p-6 text-sm text-muted-foreground">ليس لديك صلاحية عرض الموظفين.</p>;
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || !selectedRole) return;

    setSubmitting(true);
    setError(null);
    setSuccessEmail(null);
    try {
      const { error: inviteError } = await supabase.rpc("admin_invite_staff_v2", {
        p_name: name.trim(),
        p_email: email.trim().toLowerCase(),
        p_role_id: selectedRole.id,
        p_branch_ids: selectedRole.branch_scoped ? branchIds : [],
      });
      if (inviteError) throw inviteError;

      setSuccessEmail(email.trim().toLowerCase());
      setName("");
      setEmail("");
      setRoleId("");
      setBranchIds([]);
      await queryClient.invalidateQueries({ queryKey: ["staff_admin"] });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("email_already_invited")) {
        setError("هذا البريد مضاف مسبقاً.");
      } else if (message.includes("branch_required")) {
        setError("اختر فرعاً واحداً على الأقل لهذا الدور.");
      } else {
        setError("تعذّر إضافة الموظف. تأكد من الصلاحيات والبيانات.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function toggleBranch(branchId: string) {
    setBranchIds((current) =>
      current.includes(branchId)
        ? current.filter((id) => id !== branchId)
        : [...current, branchId],
    );
  }

  const signupUrl = typeof window !== "undefined" ? `${window.location.origin}/admin/signup` : "/admin/signup";

  return (
    <main className="min-h-screen px-5 py-6">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-extrabold">الموظفين</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              إدارة الوصول والأدوار وربط الأدوار المحددة بالفروع.
            </p>
          </div>
          {can("staff.create") ? (
            <button
              type="button"
              onClick={() => setShowInvite((value) => !value)}
              className="inline-flex items-center gap-2 rounded-pill bg-brand px-4 py-2.5 text-sm font-bold text-brand-ink"
            >
              <UserPlus aria-hidden className="size-4" />
              إضافة موظف
            </button>
          ) : null}
        </div>

        {showInvite && can("staff.create") ? (
          <form onSubmit={handleInvite} className="card-surface mt-5 p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs font-bold text-muted-foreground">الاسم</label>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-card border border-border bg-background px-4 py-3 text-sm outline-none focus:border-brand"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-muted-foreground">البريد الإلكتروني</label>
                <input
                  required
                  type="email"
                  dir="ltr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-card border border-border bg-background px-4 py-3 text-sm outline-none focus:border-brand"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs font-bold text-muted-foreground">الدور</label>
                <select
                  required
                  value={roleId}
                  onChange={(e) => {
                    setRoleId(e.target.value);
                    setBranchIds([]);
                  }}
                  className="mt-1 w-full rounded-card border border-border bg-background px-4 py-3 text-sm outline-none focus:border-brand"
                >
                  <option value="">اختر الدور</option>
                  {(data?.roles ?? []).map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name_ar}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {selectedRole?.branch_scoped ? (
              <div className="mt-4">
                <p className="text-xs font-bold text-muted-foreground">الفروع المسموحة</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(data?.branches ?? []).map((branch) => {
                    const selected = branchIds.includes(branch.id);
                    return (
                      <button
                        key={branch.id}
                        type="button"
                        onClick={() => toggleBranch(branch.id)}
                        className={`rounded-pill border px-3 py-2 text-xs font-bold ${
                          selected
                            ? "border-brand bg-brand/10 text-brand"
                            : "border-border text-muted-foreground"
                        }`}
                      >
                        {branch.name_ar}
                      </button>
                    );
                  })}
                </div>
                {(data?.branches ?? []).length === 0 ? (
                  <p className="mt-2 text-xs text-danger">
                    لا يمكن تعيين دور مرتبط بفرع قبل توفر صلاحية عرض الفروع.
                  </p>
                ) : null}
              </div>
            ) : null}

            {error ? (
              <p className="mt-4 rounded-card border border-danger/30 bg-danger/10 p-3 text-sm font-bold text-danger">
                {error}
              </p>
            ) : null}

            {successEmail ? (
              <div className="mt-4 rounded-card border border-success/30 bg-success/10 p-3 text-sm">
                <p className="flex items-center gap-2 font-bold text-success">
                  <CheckCircle2 aria-hidden className="size-4" />
                  تمت إضافة {successEmail}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  أرسل للموظف رابط التسجيل التالي. يجب أن يسجل بنفس البريد المضاف هنا.
                </p>
                <div dir="ltr" className="mt-2 flex items-center gap-2 rounded-card bg-background p-2 text-xs">
                  <span className="min-w-0 flex-1 truncate">{signupUrl}</span>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(signupUrl)}
                    className="rounded-card border border-border p-2"
                    aria-label="نسخ رابط التسجيل"
                  >
                    <Copy aria-hidden className="size-3.5" />
                  </button>
                </div>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={submitting || !selectedRole || (selectedRole.branch_scoped && branchIds.length === 0)}
              className="mt-4 rounded-pill bg-brand px-5 py-2.5 text-sm font-bold text-brand-ink disabled:opacity-50"
            >
              {submitting ? "جارٍ الإضافة..." : "إضافة الموظف"}
            </button>
          </form>
        ) : null}

        <section className="mt-6">
          {isLoading ? (
            <div className="grid gap-3">
              {[0, 1, 2].map((item) => (
                <div key={item} className="card-surface h-24 animate-pulse opacity-60" />
              ))}
            </div>
          ) : queryError ? (
            <p className="rounded-card border border-danger/30 bg-danger/10 p-3 text-sm font-bold text-danger">
              تعذّر تحميل الموظفين.
            </p>
          ) : (
            <div className="grid gap-3">
              {(data?.staff ?? []).map((staff) => {
                const roleNames = data?.staffRoles
                  .filter((item) => item.staff_id === staff.id)
                  .map((item) => data.roles.find((role) => role.id === item.role_id)?.name_ar)
                  .filter(Boolean) as string[];
                const branchNames = data?.staffBranches
                  .filter((item) => item.staff_id === staff.id)
                  .map((item) => data.branches.find((branch) => branch.id === item.branch_id)?.name_ar)
                  .filter(Boolean) as string[];

                return (
                  <article key={staff.id} className="card-surface p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-extrabold">{staff.name}</p>
                        <p dir="ltr" className="mt-0.5 text-xs text-muted-foreground">
                          {staff.email ?? "—"}
                        </p>
                      </div>
                      <span
                        className={`rounded-pill px-2.5 py-1 text-[11px] font-bold ${
                          staff.user_id
                            ? "bg-success/10 text-success"
                            : "bg-secondary text-muted-foreground"
                        }`}
                      >
                        {staff.user_id ? "مفعّل" : "بانتظار التسجيل"}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {roleNames.map((role) => (
                        <span key={role} className="chip">{role}</span>
                      ))}
                      {branchNames.map((branch) => (
                        <span key={branch} className="chip">{branch}</span>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
