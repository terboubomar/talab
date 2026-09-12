import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

import { CallCenterOrderPanel } from "@/components/admin/CallCenterOrderPanel";
import { usePermissions } from "@/lib/permissions";

export const Route = createFileRoute("/_staffShell/admin/new-order")({
  head: () => ({ meta: [{ title: "إنشاء طلب جديد — طلب" }] }),
  component: NewOrderPage,
});

function NewOrderPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { loading, can } = usePermissions();

  if (loading) return <div className="p-6"><div className="card-surface h-40 animate-pulse opacity-60" /></div>;
  if (!can("orders.create")) {
    return <main className="p-6"><div className="card-surface p-6 text-center text-sm font-bold text-danger">لا تملك صلاحية إنشاء طلب جديد</div></main>;
  }

  return (
    <CallCenterOrderPanel
      open
      onClose={() => navigate({ to: "/admin/orders" })}
      onCreated={async ({ order_id, total }) => {
        await queryClient.invalidateQueries({ queryKey: ["staff_orders"] });
        sessionStorage.setItem("talab_call_center_created", JSON.stringify({ orderId: order_id, total }));
      }}
    />
  );
}
