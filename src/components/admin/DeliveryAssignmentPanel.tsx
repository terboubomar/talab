import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bike, Building2, CheckCircle2, ExternalLink, UserRound } from "lucide-react";

import {
  assignOrderDriver,
  assignOrderProvider,
  fetchDeliveryOptions,
  unassignOrderDriver,
  unassignOrderProvider,
} from "@/lib/delivery";
import { usePermissions } from "@/lib/permissions";
import type { OrderStatus } from "@/lib/staff";

export function DeliveryAssignmentPanel({ orderId, status }: { orderId: string; status: OrderStatus }) {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [driverId, setDriverId] = useState("");
  const [providerId, setProviderId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const editable = ["accepted", "preparing", "ready", "out_for_delivery"].includes(status);
  const { data, isLoading, error } = useQuery({
    queryKey: ["delivery-options", orderId],
    queryFn: () => fetchDeliveryOptions(orderId),
    enabled: editable,
  });

  if (!editable) return null;
  if (isLoading) return <div className="mt-3 h-20 animate-pulse rounded-card bg-secondary/60" />;
  if (error || !data) {
    return <div className="mt-3 rounded-card border border-danger/20 bg-danger/5 p-3 text-xs font-bold text-danger">تعذّر تحميل خيارات التوصيل</div>;
  }

  const assignedDriver = data.drivers.find((driver) => driver.id === data.driver_id) ?? null;
  const assignedProvider = data.providers.find((provider) => provider.integration_id === data.delivery_provider_id) ?? null;
  const canAssignDriver = can("orders.driver.assign");
  const canUnassignDriver = can("orders.driver.unassign");
  const canAssignProvider = can("orders.provider.assign");
  const canUnassignProvider = can("orders.provider.unassign");

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["delivery-options", orderId] }),
      queryClient.invalidateQueries({ queryKey: ["staff_orders"] }),
    ]);
  }

  async function run(key: string, action: () => Promise<void>, success: string) {
    setBusy(key);
    setMessage(null);
    try {
      await action();
      await refresh();
      setDriverId("");
      setProviderId("");
      setMessage(success);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : "";
      setMessage(text.includes("not_authorized") ? "لا تملك صلاحية تنفيذ هذا الإجراء" : "تعذّر تحديث إسناد التوصيل");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mt-3 rounded-card border border-border bg-secondary/25 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-card bg-background text-brand"><Bike aria-hidden className="size-4" /></span>
          <div>
            <p className="text-xs font-extrabold">إسناد التوصيل</p>
            <p className="text-[10px] text-muted-foreground">اختر سائق المطعم أو شركة توصيل خارجية قبل بدء التوصيل.</p>
          </div>
        </div>
        {data.delivery_assignment_type ? (
          <span className="inline-flex items-center gap-1 rounded-pill bg-success/10 px-2.5 py-1 text-[10px] font-bold text-success">
            <CheckCircle2 aria-hidden className="size-3" /> تم الإسناد
          </span>
        ) : (
          <span className="rounded-pill bg-warning/10 px-2.5 py-1 text-[10px] font-bold text-warning">بانتظار الإسناد</span>
        )}
      </div>

      {assignedDriver ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-card border border-border bg-background p-3">
          <div className="flex items-center gap-2">
            <UserRound aria-hidden className="size-4 text-brand" />
            <div><p className="text-xs font-bold">{assignedDriver.name}</p><p className="text-[10px] text-muted-foreground">سائق المطعم{assignedDriver.phone ? ` · ${assignedDriver.phone}` : ""}</p></div>
          </div>
          {canUnassignDriver ? <button type="button" disabled={busy !== null} onClick={() => run("unassign-driver", () => unassignOrderDriver(orderId), "تم إلغاء إسناد السائق")} className="text-[11px] font-bold text-danger disabled:opacity-50">إلغاء الإسناد</button> : null}
        </div>
      ) : assignedProvider ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-card border border-border bg-background p-3">
          <div className="flex items-center gap-2">
            <img src={assignedProvider.logo} alt="" className="size-8 rounded-lg object-contain" />
            <div><p className="text-xs font-bold">{assignedProvider.name_ar}</p><p className="text-[10px] text-muted-foreground">شركة توصيل خارجية</p></div>
          </div>
          {canUnassignProvider ? <button type="button" disabled={busy !== null} onClick={() => run("unassign-provider", () => unassignOrderProvider(orderId), "تم إلغاء إسناد شركة التوصيل")} className="text-[11px] font-bold text-danger disabled:opacity-50">إلغاء الإسناد</button> : null}
        </div>
      ) : (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded-card border border-border bg-background p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-bold"><UserRound aria-hidden className="size-3.5" /> سائق المطعم</div>
            {data.drivers.length ? (
              <div className="flex gap-2">
                <select value={driverId} onChange={(event) => setDriverId(event.target.value)} disabled={!canAssignDriver || busy !== null} className="min-w-0 flex-1 rounded-card border border-border bg-background px-2.5 py-2 text-xs disabled:opacity-50">
                  <option value="">اختر السائق</option>
                  {data.drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}{driver.phone ? ` — ${driver.phone}` : ""}</option>)}
                </select>
                <button type="button" disabled={!driverId || !canAssignDriver || busy !== null} onClick={() => run("driver", () => assignOrderDriver(orderId, driverId), "تم إسناد الطلب للسائق")} className="rounded-card bg-brand px-3 py-2 text-xs font-bold text-brand-ink disabled:opacity-50">إسناد</button>
              </div>
            ) : (
              <p className="text-[11px] leading-5 text-muted-foreground">لا يوجد سائق نشط ومربوط بهذا الفرع. أضف موظفاً بدور <strong>driver</strong> وحدد فرعه.</p>
            )}
          </div>

          <div className="rounded-card border border-border bg-background p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-bold"><Building2 aria-hidden className="size-3.5" /> شركة توصيل</div>
            {data.providers.length ? (
              <div className="flex gap-2">
                <select value={providerId} onChange={(event) => setProviderId(event.target.value)} disabled={!canAssignProvider || busy !== null} className="min-w-0 flex-1 rounded-card border border-border bg-background px-2.5 py-2 text-xs disabled:opacity-50">
                  <option value="">اختر الشركة</option>
                  {data.providers.map((provider) => <option key={provider.integration_id} value={provider.integration_id}>{provider.name_ar}</option>)}
                </select>
                <button type="button" disabled={!providerId || !canAssignProvider || busy !== null} onClick={() => run("provider", () => assignOrderProvider(orderId, providerId), "تم إسناد الطلب لشركة التوصيل")} className="rounded-card bg-brand px-3 py-2 text-xs font-bold text-brand-ink disabled:opacity-50">إسناد</button>
              </div>
            ) : (
              <p className="text-[11px] leading-5 text-muted-foreground">لا توجد شركة توصيل مهيأة بعد. <Link to="/admin/apps" className="inline-flex items-center gap-1 font-bold text-brand">متجر التطبيقات <ExternalLink aria-hidden className="size-3" /></Link></p>
            )}
          </div>
        </div>
      )}

      {message ? <p className="mt-2 text-[11px] font-bold text-muted-foreground">{message}</p> : null}
    </section>
  );
}
