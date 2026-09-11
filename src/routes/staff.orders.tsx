import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, RefreshCw } from "lucide-react";

import {
  fetchStaffOrders,
  getStaffSession,
  staffSignOut,
  updateOrderStatus,
  ORDER_TYPE_LABEL,
  STATUS_LABEL,
  type OrderStatus,
  type StaffOrder,
} from "@/lib/staff";
import { formatSAR } from "@/lib/menu";

export const Route = createFileRoute("/staff/orders")({
  head: () => ({
    meta: [{ title: "طلبات الفرع — طلب" }],
  }),
  component: StaffOrdersPage,
});

const TABS: { key: string; label: string; statuses: OrderStatus[] }[] = [
  { key: "pending", label: "بانتظار القبول", statuses: ["pending"] },
  { key: "active", label: "قيد التجهيز", statuses: ["accepted", "preparing"] },
  { key: "ready", label: "جاهزة", statuses: ["ready", "out_for_delivery"] },
  { key: "done", label: "مكتملة", statuses: ["completed", "cancelled"] },
];
const DEFAULT_TAB = TABS[0] as (typeof TABS)[number];

function nextAction(order: StaffOrder): { label: string; next: OrderStatus } | null {
  switch (order.status) {
    case "pending":
      return { label: "قبول الطلب", next: "accepted" };
    case "accepted":
      return { label: "بدء التجهيز", next: "preparing" };
    case "preparing":
      return { label: "جاهز", next: "ready" };
    case "ready":
      return order.order_type === "delivery"
        ? { label: "بدء التوصيل", next: "out_for_delivery" }
        : { label: "إكمال الطلب", next: "completed" };
    case "out_for_delivery":
      return { label: "تم التوصيل", next: "completed" };
    default:
      return null;
  }
}

function canCancel(order: StaffOrder) {
  return order.status !== "completed" && order.status !== "cancelled";
}

function StaffOrdersPage() {
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);
  const [tab, setTab] = useState(DEFAULT_TAB.key);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    getStaffSession().then((session) => {
      if (!session) {
        navigate({ to: "/staff/login", replace: true });
        return;
      }
      setChecked(true);
    });
  }, [navigate]);

  const activeTab = TABS.find((t) => t.key === tab) ?? DEFAULT_TAB;

  const { data: orders, isLoading } = useQuery({
    queryKey: ["staff_orders", activeTab.statuses],
    queryFn: () => fetchStaffOrders(activeTab.statuses),
    enabled: checked,
    refetchInterval: 12_000,
  });

  const grouped = useMemo(() => orders ?? [], [orders]);

  async function handleAction(orderId: string, next: OrderStatus) {
    setPendingId(orderId);
    setActionError(null);
    try {
      await updateOrderStatus(orderId, next);
      await queryClient.invalidateQueries({ queryKey: ["staff_orders"] });
    } catch {
      setActionError("تعذّر تحديث حالة الطلب");
    } finally {
      setPendingId(null);
    }
  }

  async function handleSignOut() {
    await staffSignOut();
    navigate({ to: "/staff/login" });
  }

  if (!checked) {
    return (
      <main className="min-h-screen bg-secondary px-5 py-10">
        <div className="mx-auto max-w-3xl">
          <div className="card-surface h-24 animate-pulse opacity-60" />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-secondary pb-10">
      <header className="sticky top-0 z-30 border-b border-border bg-background px-5 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <h1 className="text-base font-extrabold">طلبات الفرع</h1>
          <button
            type="button"
            onClick={handleSignOut}
            className="flex items-center gap-1.5 text-sm font-bold text-muted-foreground"
          >
            <LogOut aria-hidden className="size-4" />
            خروج
          </button>
        </div>
        <nav className="mx-auto mt-3 flex max-w-3xl gap-2 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`shrink-0 rounded-pill px-4 py-2 text-sm font-bold ${
                t.key === tab
                  ? "bg-brand text-brand-ink"
                  : "border border-border text-muted-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="mx-auto max-w-3xl px-5 py-6">
        {actionError ? (
          <div className="mb-4 rounded-card border border-danger/30 bg-danger/10 p-3 text-center text-sm font-bold text-danger">
            {actionError}
          </div>
        ) : null}

        {isLoading ? (
          <div className="grid gap-3">
            {[0, 1].map((i) => (
              <div key={i} className="card-surface h-28 animate-pulse opacity-60" />
            ))}
          </div>
        ) : grouped.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            لا توجد طلبات في هذه القائمة حالياً
          </p>
        ) : (
          <div className="grid gap-3">
            {grouped.map((order) => {
              const action = nextAction(order);
              const isPending = pendingId === order.id;
              return (
                <article key={order.id} className="card-surface p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-sm font-bold">{order.customers?.name ?? "عميل"}</span>
                      <span dir="ltr" className="ms-2 text-xs text-muted-foreground">
                        {order.customers?.phone}
                      </span>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="chip">{ORDER_TYPE_LABEL[order.order_type]}</span>
                        <span className="chip">{STATUS_LABEL[order.status]}</span>
                      </div>
                    </div>
                    <span className="text-sm font-bold text-brand">{formatSAR(order.total)}</span>
                  </div>

                  <ul className="mt-3 divide-y divide-border border-t border-border pt-2 text-sm">
                    {order.order_items.map((item) => (
                      <li key={item.id} className="flex flex-col gap-0.5 py-1.5">
                        <div className="flex items-center justify-between">
                          <span>
                            {item.qty}× {item.name_ar}
                          </span>
                          <span className="text-muted-foreground">
                            {formatSAR(item.line_total)}
                          </span>
                        </div>
                        {item.order_item_modifiers.length > 0 ? (
                          <span className="text-xs text-muted-foreground">
                            {item.order_item_modifiers.map((m) => m.name_ar).join("، ")}
                          </span>
                        ) : null}
                        {item.notes ? (
                          <span className="text-xs text-muted-foreground">
                            ملاحظة: {item.notes}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {order.notes ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      ملاحظات الطلب: {order.notes}
                    </p>
                  ) : null}

                  <div className="mt-3 flex gap-2">
                    {action ? (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => handleAction(order.id, action.next)}
                        className="flex-1 rounded-pill bg-brand px-4 py-2.5 text-sm font-bold text-brand-ink disabled:opacity-50"
                      >
                        {action.label}
                      </button>
                    ) : null}
                    {canCancel(order) ? (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => handleAction(order.id, "cancelled")}
                        className="rounded-pill border border-danger/40 px-4 py-2.5 text-sm font-bold text-danger disabled:opacity-50"
                      >
                        إلغاء
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <button
          type="button"
          onClick={() => queryClient.invalidateQueries({ queryKey: ["staff_orders"] })}
          className="mx-auto mt-6 flex items-center gap-1.5 text-xs font-bold text-muted-foreground"
        >
          <RefreshCw aria-hidden className="size-3.5" />
          تحديث الآن
        </button>
      </div>
    </main>
  );
}
