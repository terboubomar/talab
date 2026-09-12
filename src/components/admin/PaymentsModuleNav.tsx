import { Link } from "@tanstack/react-router";
import { usePermissions } from "@/lib/permissions";

interface PaymentsModuleNavProps {
  active: "payments" | "refunds";
}

const TABS = [
  { id: "payments" as const, label: "آخر العمليات", to: "/admin/payments", perm: "payments.view" },
  { id: "refunds" as const, label: "آخر عمليات الاسترجاع", to: "/admin/refunds", perm: "orders.refund" },
];

export function PaymentsModuleNav({ active }: PaymentsModuleNavProps) {
  const { can } = usePermissions();

  return (
    <nav className="flex flex-wrap gap-2 border-b border-border bg-background px-5 pb-3 pt-2">
      {TABS.map((tab) => {
        const enabled = can(tab.perm);
        const isActive = active === tab.id;
        if (!enabled) {
          return (
            <span
              key={tab.id}
              className="inline-flex cursor-not-allowed items-center gap-2 rounded-pill border border-border bg-secondary px-3 py-1.5 text-xs font-bold text-muted-foreground opacity-60"
            >
              {tab.label}
            </span>
          );
        }
        return (
          <Link
            key={tab.id}
            to={tab.to}
            className={`inline-flex items-center gap-2 rounded-pill px-3 py-1.5 text-xs font-bold transition-colors ${
              isActive
                ? "bg-brand text-brand-ink"
                : "border border-border bg-background text-foreground hover:bg-secondary"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
      <span className="inline-flex cursor-not-allowed items-center gap-2 rounded-pill border border-border bg-secondary px-3 py-1.5 text-xs font-bold text-muted-foreground opacity-60">
        كشف الحساب و الإيداعات
        <span className="rounded-pill bg-muted px-1.5 py-0.5 text-[10px]">قريباً</span>
      </span>
    </nav>
  );
}
