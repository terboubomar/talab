import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { RefundPanel } from "@/components/admin/RefundPanel";
import { formatSAR } from "@/lib/menu";
import { usePermissions } from "@/lib/permissions";
import { fetchStaffOrders, ORDER_TYPE_LABEL, STATUS_LABEL } from "@/lib/staff";

export const Route = createFileRoute("/_staffShell/admin/refunds")({
  head: () => ({ meta: [{ title: "الاستردادات — طلب" }] }),
  component: RefundsPage,
});

function RefundsPage() {
  const { loading: permissionsLoading, can } = usePermissions();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const canRefund = can("orders.refund");
  const canRefundDeposit = can("orders.deposit.refund");

  const { data: orders = [], isLoading, error } = useQuery({
    queryKey: ["refund_orders"],
    queryFn: () => fetchStaffOrders(["completed", "cancelled"]),
    enabled: !permissionsLoading && canRefund,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((order) => {
      const name = order.customers?.name?.toLowerCase() ?? "";
      const phone = order.customers?.phone ?? "";
      return name.includes(q) || phone.includes(q) || order.id.toLowerCase().includes(q);
    });
  }, [orders, search]);

  if (permissionsLoading) {
    return <div className="p-6"><div className="card-surface h-28 animate-pulse opacity-60" /></div>;
  }

  if (!canRefund) {
    return (
      <main className="p-6">
        <div className="card-surface p-6 text-center text-sm font-bold text-danger">
          لا تملك صلاحية إدارة الاستردادات
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen pb-12">
      <header className="border-b border-border bg-background px-5 py-5">
        <h1 className="text-lg font-extrabold">الاستردادات</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          تسجيل ومراجعة الاستردادات اليدوية للطلبات المكتملة أو الملغاة.
        </p>
      </header>

      <div className="space-y-4 px-5 py-6">
        <div className="card-surface p-4">
          <label className="grid max-w-md gap-1 text-xs font-bold text-muted-foreground">
            البحث عن طلب
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="اسم العميل، رقم الجوال، أو رقم الطلب"
              className="rounded-card border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand"
            />
          </label>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            ملاحظة: التسجيل اليدوي لا ينفذ تحويلاً مالياً. استخدمه فقط بعد إعادة المبلغ للعميل خارج النظام. عند ربط بوابة الدفع لاحقاً سيضاف التنفيذ الإلكتروني بنفس سجل الاسترداد.
          </p>
        </div>

        {error ? (
          <div className="rounded-card border border-danger/30 bg-danger/10 p-4 text-sm font-bold text-danger">
            تعذّر تحميل الطلبات المتاحة للاسترداد
          </div>
        ) : null}

        {isLoading ? (
          <div className="grid gap-3">
            {[0, 1, 2].map((i) => <div key={i} className="card-surface h-32 animate-pulse opacity-60" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="card-surface p-8 text-center text-sm text-muted-foreground">
            لا توجد طلبات مطابقة
          </div>
        ) : (
          <div className="grid gap-3">
            {filtered.map((order) => (
              <article key={order.id} className="card-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-extrabold">{order.customers?.name ?? "عميل"}</span>
                      <span dir="ltr" className="text-xs text-muted-foreground">{order.customers?.phone}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span className="chip">{ORDER_TYPE_LABEL[order.order_type]}</span>
                      <span className="chip">{STATUS_LABEL[order.status]}</span>
                      <span dir="ltr" className="chip">{order.id.slice(0, 8)}</span>
                    </div>
                  </div>
                  <div className="text-left">
                    <p className="text-lg font-extrabold text-brand">{formatSAR(Number(order.total))}</p>
                    {Number(order.deposit_total) > 0 ? (
                      <p className="mt-1 text-xs text-muted-foreground">تأمين: {formatSAR(Number(order.deposit_total))}</p>
                    ) : null}
                  </div>
                </div>

                <RefundPanel
                  order={order}
                  canRefundDeposit={canRefundDeposit}
                  onDone={() => queryClient.invalidateQueries({ queryKey: ["order_report"] })}
                />
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
