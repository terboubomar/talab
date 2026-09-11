import { useEffect, useState } from "react";
import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { LogOut } from "lucide-react";

import { usePermissions } from "@/lib/permissions";
import { staffSignOut } from "@/lib/staff";

export const Route = createFileRoute("/_staffShell")({
  component: StaffShell,
});

const NAV_ITEMS: { label: string; to: string; perm: string; enabled: boolean }[] = [
  { label: "لوحة التحكم", to: "/admin", perm: "dashboard.stats", enabled: false },
  { label: "الطلبات", to: "/admin/orders", perm: "orders.page.view", enabled: true },
  { label: "المنتجات", to: "/admin/products", perm: "menus.view", enabled: true },
  { label: "الفروع", to: "/admin/branches", perm: "branches.view", enabled: false },
  { label: "أدوات التسويق", to: "/admin/marketing", perm: "marketing.tools", enabled: false },
  { label: "العملاء", to: "/admin/customers", perm: "customers.view", enabled: false },
  { label: "الموظفين", to: "/admin/staff", perm: "staff.view", enabled: true },
  { label: "المدفوعات", to: "/admin/payments", perm: "payments.view", enabled: false },
  { label: "الإعدادات", to: "/admin/settings", perm: "settings.manage", enabled: false },
];

function StaffShell() {
  const navigate = useNavigate();
  const { loading, signedIn, staffName, can } = usePermissions();
  const [checkedRedirect, setCheckedRedirect] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (loading) return;
    if (!signedIn) {
      navigate({ to: "/admin/login", replace: true });
      return;
    }
    setCheckedRedirect(true);
  }, [loading, signedIn, navigate]);

  async function handleSignOut() {
    await staffSignOut();
    navigate({ to: "/admin/login" });
  }

  if (loading || !checkedRedirect) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-secondary">
        <div className="card-surface h-24 w-64 animate-pulse opacity-60" />
      </div>
    );
  }

  const visibleItems = NAV_ITEMS.filter((item) => can(item.perm));

  return (
    <div dir="rtl" className="flex min-h-screen bg-secondary">
      <aside className="flex w-60 shrink-0 flex-col border-s border-border bg-background">
        <div className="border-b border-border px-4 py-4">
          <span className="text-sm font-extrabold">لوحة تحكم طلب</span>
          {staffName ? <p className="mt-1 text-xs text-muted-foreground">{staffName}</p> : null}
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {visibleItems.map((item) => {
            const active = pathname === item.to;
            if (!item.enabled) {
              return (
                <div
                  key={item.to}
                  className="flex cursor-not-allowed items-center justify-between rounded-card px-3 py-2.5 text-sm font-bold text-muted-foreground opacity-50"
                >
                  <span>{item.label}</span>
                  <span className="text-[10px]">قريباً</span>
                </div>
              );
            }
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center rounded-card px-3 py-2.5 text-sm font-bold ${
                  active ? "bg-brand text-brand-ink" : "text-foreground hover:bg-secondary"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border p-3">
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center gap-1.5 rounded-card px-3 py-2.5 text-sm font-bold text-muted-foreground hover:bg-secondary"
          >
            <LogOut aria-hidden className="size-4" />
            خروج
          </button>
        </div>
      </aside>
      <div className="flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
