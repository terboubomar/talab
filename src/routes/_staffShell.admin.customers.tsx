import { useMemo, useState } from "react";
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { fetchCustomerCrmList } from "@/lib/crm";
import { formatSAR } from "@/lib/menu";
import { usePermissions } from "@/lib/permissions";

export const Route = createFileRoute("/_staffShell/admin/customers")({
  head: () => ({ meta: [{ title: "العملاء — طلب" }] }),
  component: CustomersRouteBoundary,
});

function CustomersRouteBoundary() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (pathname !== "/admin/customers" && pathname !== "/admin/customers/") {
    return <Outlet />;
  }
  return <CustomersPage />;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("ar-SA", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function CustomersPage() {
  const { loading: permissionsLoading, can } = usePermissions();
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const canView = can("customers.view");
  const canViewGroups = can("customer_groups.view");

  const {
    data: customers = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["customer_crm_list"],
    queryFn: fetchCustomerCrmList,
    enabled: !permissionsLoading && canView,
  });

  const groups = useMemo(() => {
    const map = new Map<string, string>();
    for (const customer of customers) {
      if (customer.customer_group_id && customer.group_name) {
        map.set(customer.customer_group_id, customer.group_name);
      }
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [customers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers.filter((customer) => {
      const matchesSearch =
        !q ||
        customer.name.toLowerCase().includes(q) ||
        customer.phone.includes(q) ||
        (customer.email ?? "").toLowerCase().includes(q);
      const matchesGroup =
        groupFilter === "all" ||
        (groupFilter === "none"
          ? !customer.customer_group_id
          : customer.customer_group_id === groupFilter);
      return matchesSearch && matchesGroup;
    });
  }, [customers, search, groupFilter]);

  const kpis = useMemo(() => {
    return {
      count: customers.length,
      active: customers.filter((c) => c.status === "active" && !c.account_suspended).length,
      completed: customers.reduce((sum, c) => sum + c.completed_orders, 0),
      spend: customers.reduce((sum, c) => sum + c.total_spend, 0),
    };
  }, [customers]);

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
          CRM 360 للعملاء: الطلبات، المحفظة، النقاط، المجموعة، الحالة، والنشاط.
        </p>
      </header>

      <div className="space-y-4 px-5 py-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="إجمالي العملاء" value={kpis.count.toLocaleString("ar-SA")} />
          <Kpi label="العملاء النشطون" value={kpis.active.toLocaleString("ar-SA")} />
          <Kpi label="الطلبات المكتملة" value={kpis.completed.toLocaleString("ar-SA")} />
          <Kpi label="قيمة الطلبات المكتملة" value={formatSAR(kpis.spend)} />
        </div>

        <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="card-surface h-fit p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm font-extrabold">مجموعات العملاء</p>
              {canViewGroups ? (
                <Link
                  to="/admin/customers/groups"
                  className="text-[11px] font-bold text-brand hover:underline"
                >
                  إدارة
                </Link>
              ) : null}
            </div>
            <div className="space-y-1">
              <GroupButton
                active={groupFilter === "all"}
                label="كل العملاء"
                count={customers.length}
                onClick={() => setGroupFilter("all")}
              />
              {groups.map((group) => (
                <GroupButton
                  key={group.id}
                  active={groupFilter === group.id}
                  label={group.name}
                  count={customers.filter((c) => c.customer_group_id === group.id).length}
                  onClick={() => setGroupFilter(group.id)}
                />
              ))}
              <GroupButton
                active={groupFilter === "none"}
                label="بدون مجموعة"
                count={customers.filter((c) => !c.customer_group_id).length}
                onClick={() => setGroupFilter("none")}
              />
            </div>
          </aside>

          <section className="space-y-3">
            <div className="card-surface p-4">
              <label className="grid max-w-lg gap-1 text-xs font-bold text-muted-foreground">
                البحث عن عميل
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="الاسم، الجوال، أو البريد الإلكتروني"
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
              <div className="card-surface overflow-x-auto">
                <table className="w-full min-w-[900px] text-right text-sm">
                  <thead className="bg-secondary text-xs font-bold text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">الاسم</th>
                      <th className="px-3 py-2">الجوال</th>
                      <th className="px-3 py-2">الجنس</th>
                      <th className="px-3 py-2">المجموعة</th>
                      <th className="px-3 py-2">الحالة</th>
                      <th className="px-3 py-2">الطلبات المكتملة</th>
                      <th className="px-3 py-2">آخر طلب</th>
                      <th className="px-3 py-2">تاريخ التسجيل</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((customer) => (
                      <tr key={customer.id} className="border-t border-border hover:bg-secondary/60">
                        <td className="px-3 py-2.5">
                          <Link
                            to="/admin/customers/$customerId"
                            params={{ customerId: customer.id }}
                            className="font-extrabold hover:text-brand hover:underline"
                          >
                            {customer.name || "بدون اسم"}
                          </Link>
                          {customer.email ? (
                            <span className="block text-[11px] text-muted-foreground" dir="ltr">
                              {customer.email}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground" dir="ltr">
                          {customer.phone}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {genderLabel(customer.gender)}
                        </td>
                        <td className="px-3 py-2.5">{customer.group_name ?? "—"}</td>
                        <td className="px-3 py-2.5">
                          <CustomerStatus
                            status={customer.status}
                            suspended={customer.account_suspended}
                          />
                        </td>
                        <td className="px-3 py-2.5 font-extrabold">
                          {customer.completed_orders.toLocaleString("ar-SA")}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground">
                          {formatDate(customer.last_order_at)}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground">
                          {formatDate(customer.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
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

function GroupButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-card px-3 py-2 text-right text-xs font-bold ${
        active ? "bg-brand text-brand-ink" : "hover:bg-secondary"
      }`}
    >
      <span>{label}</span>
      <span className={active ? "opacity-80" : "text-muted-foreground"}>{count}</span>
    </button>
  );
}

function genderLabel(gender: string | null) {
  if (gender === "male") return "ذكر";
  if (gender === "female") return "أنثى";
  if (gender === "unspecified") return "غير محدد";
  return "—";
}

function CustomerStatus({ status, suspended }: { status: string; suspended: boolean }) {
  if (suspended) {
    return <span className="rounded-pill bg-danger/10 px-2 py-1 text-[11px] font-bold text-danger">معلّق</span>;
  }
  return status === "active" ? (
    <span className="rounded-pill bg-success/10 px-2 py-1 text-[11px] font-bold text-success">نشط</span>
  ) : (
    <span className="rounded-pill bg-secondary px-2 py-1 text-[11px] font-bold text-muted-foreground">غير نشط</span>
  );
}
