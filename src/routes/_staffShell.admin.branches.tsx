import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  MapPin,
  Package,
  Pencil,
  Phone,
  Plus,
  Save,
  Search,
  Store,
  TimerReset,
  Truck,
  Users,
  UtensilsCrossed,
  X,
} from "lucide-react";

import {
  createArea,
  createBranch,
  createCity,
  createDeliveryZone,
  fetchBranchFormOptions,
  fetchStaffBranchDetail,
  fetchStaffBranchOperations,
  setBranchBusyUntil,
  setBranchProductAvailability,
  updateBranch,
  updateDeliveryZone,
  type AreaOption,
  type BranchFormInput,
  type BranchOption,
  type BranchOrderType,
  type StaffBranchDetail,
  type StaffBranchFormOptions,
  type StaffBranchHour,
  type StaffBranchOperation,
  type StaffBranchProduct,
  type StaffDeliveryZone,
} from "@/lib/branch-operations";
import { usePermissions } from "@/lib/permissions";

export const Route = createFileRoute("/_staffShell/admin/branches")({
  head: () => ({ meta: [{ title: "الفروع — طلب" }] }),
  component: BranchesPage,
});

const QUICK_MINUTES = [15, 30, 60, 90] as const;
const ORDER_TYPE_LABEL: Record<BranchOrderType, string> = {
  pickup: "استلام",
  delivery: "توصيل",
  curbside: "من السيارة",
  dinein: "محلي",
};
const WEEKDAY_LABEL: Record<number, string> = {
  0: "الأحد",
  1: "الاثنين",
  2: "الثلاثاء",
  3: "الأربعاء",
  4: "الخميس",
  5: "الجمعة",
  6: "السبت",
};
const ORDER_TYPE_KINDS: BranchOrderType[] = ["pickup", "delivery", "curbside", "dinein"];

function defaultHours(): StaffBranchHour[] {
  return Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    opens_at: "00:00",
    closes_at: "23:59",
    is_24h: true,
    closed: false,
  }));
}

function emptyBranchForm(brandId?: string): BranchFormInput {
  return {
    ...(brandId ? { brand_id: brandId } : {}),
    name_ar: "",
    name_en: "",
    city_id: null,
    phone: null,
    lat: null,
    lng: null,
    code: null,
    status: "active",
    menu_id: null,
    order_types: ORDER_TYPE_KINDS.map((kind) => ({ kind, enabled: kind !== "dinein" })),
    hours: defaultHours(),
  };
}

function branchDetailToForm(detail: StaffBranchDetail): BranchFormInput {
  return {
    brand_id: detail.branch.brand_id,
    name_ar: detail.branch.name_ar,
    name_en: detail.branch.name_en ?? "",
    city_id: detail.branch.city_id,
    phone: detail.branch.phone,
    lat: detail.branch.lat,
    lng: detail.branch.lng,
    code: detail.branch.code,
    status: (detail.branch.status as "active" | "inactive") ?? "active",
    menu_id: detail.menu?.id ?? null,
    order_types: ORDER_TYPE_KINDS.map((kind) => ({
      kind,
      enabled: detail.order_types.find((item) => item.kind === kind)?.enabled ?? false,
    })),
    hours: detail.hours.length > 0 ? detail.hours : defaultHours(),
  };
}

type BranchTab = "info" | "products" | "seating" | "reservations" | "waitlist";

const DETAIL_TABS: { key: BranchTab; label: string }[] = [
  { key: "info", label: "معلومات الفرع" },
  { key: "products", label: "حالة المنتجات" },
  { key: "seating", label: "مناطق الجلوس والطاولات" },
  { key: "reservations", label: "إعدادات الحجوزات" },
  { key: "waitlist", label: "إعدادات قائمة الانتظار" },
];

function formatBusyUntil(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
    timeZone: "Asia/Riyadh",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function riyadhInputToIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00+03:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function defaultCustomTime() {
  const target = new Date(Date.now() + 30 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(target);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function BranchesPage() {
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const canCreate = can("branches.create");

  const {
    data: branches = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["staff_branch_operations"],
    queryFn: fetchStaffBranchOperations,
    refetchInterval: 30_000,
  });

  const { data: formOptions } = useQuery({
    queryKey: ["staff_branch_form_options"],
    queryFn: fetchBranchFormOptions,
    enabled: canCreate,
    staleTime: 60_000,
  });

  const createMutation = useMutation({
    mutationFn: (input: BranchFormInput) => createBranch(input),
    onSuccess: (detail) => {
      queryClient.invalidateQueries({ queryKey: ["staff_branch_operations"] });
      setShowCreate(false);
      setSelectedBranchId(detail.branch.id);
    },
  });

  const filteredBranches = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ar");
    if (!query) return branches;
    return branches.filter((branch) =>
      [branch.name_ar, branch.name_en, branch.city_ar, branch.city_en, branch.phone]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("ar").includes(query)),
    );
  }, [branches, search]);

  const busyCount = useMemo(() => branches.filter((branch) => branch.busy).length, [branches]);

  if (selectedBranchId) {
    return (
      <BranchDetailWorkspace
        branchId={selectedBranchId}
        onBack={() => setSelectedBranchId(null)}
        can={can}
      />
    );
  }

  return (
    <main className="min-h-screen pb-10" dir="rtl">
      <header className="sticky top-0 z-20 border-b border-border bg-background px-5 py-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-base font-extrabold">الفروع</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              إدارة الفروع وحالة الطلب والقائمة ومناطق التوصيل.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-pill bg-success/10 px-3 py-1.5 font-bold text-success">
              {branches.length - busyCount} متاح
            </span>
            <span className="rounded-pill bg-warning/10 px-3 py-1.5 font-bold text-warning">
              {busyCount} مشغول
            </span>
            {canCreate ? (
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-foreground px-4 text-xs font-bold text-background"
              >
                <Plus className="size-4" aria-hidden /> إضافة فرع
              </button>
            ) : null}
          </div>
        </div>
      </header>

      {showCreate && formOptions ? (
        <BranchFormModal
          mode="create"
          options={formOptions}
          initial={emptyBranchForm(formOptions.brands[0]?.id)}
          submitting={createMutation.isPending}
          error={createMutation.error instanceof Error ? createMutation.error.message : null}
          onClose={() => setShowCreate(false)}
          onSubmit={(input) => createMutation.mutate(input)}
        />
      ) : null}

      <div className="px-5 py-6">
        <label className="relative mb-5 block max-w-xl">
          <Search
            className="pointer-events-none absolute inset-inline-start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ابحث باسم الفرع أو المدينة"
            className="min-h-11 w-full rounded-card border border-border bg-background px-10 text-sm outline-none focus:border-brand"
          />
        </label>

        {isLoading ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {[0, 1].map((item) => (
              <div key={item} className="card-surface h-52 animate-pulse opacity-60" />
            ))}
          </div>
        ) : isError ? (
          <div className="card-surface p-6 text-center">
            <p className="font-bold">تعذّر تحميل الفروع</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {error instanceof Error ? error.message : "حاول مرة أخرى"}
            </p>
          </div>
        ) : filteredBranches.length === 0 ? (
          <div className="card-surface p-8 text-center text-sm text-muted-foreground">
            لا توجد فروع مطابقة.
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {filteredBranches.map((branch) => (
              <BranchCard
                key={branch.id}
                branch={branch}
                onOpen={() => setSelectedBranchId(branch.id)}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function BranchCard({ branch, onOpen }: { branch: StaffBranchOperation; onOpen: () => void }) {
  const inactive = branch.status !== "active";
  const busyUntil = branch.busy ? formatBusyUntil(branch.busy_until) : "";
  const foodicsRef = branch.pos_ref ?? branch.menu?.pos_ref ?? null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="card-surface w-full p-5 text-start transition hover:border-brand/40"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-pill bg-secondary text-brand">
            <Store className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-extrabold">{branch.name_ar}</h2>
            {branch.name_en ? (
              <p className="mt-0.5 truncate text-xs text-muted-foreground" dir="ltr">
                {branch.name_en}
              </p>
            ) : null}
            {branch.city_ar ? (
              <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="size-3.5" aria-hidden />
                {branch.city_ar}
              </p>
            ) : null}
          </div>
        </div>

        <span
          className={`shrink-0 rounded-pill px-3 py-1.5 text-xs font-bold ${inactive ? "bg-secondary text-muted-foreground" : "bg-success/10 text-success"}`}
        >
          {inactive ? "غير نشط" : "نشط"}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {(branch.order_types ?? []).map((type) => (
          <span
            key={type}
            className="rounded-pill bg-secondary px-3 py-1.5 text-xs font-bold text-foreground"
          >
            {ORDER_TYPE_LABEL[type]}
          </span>
        ))}
        {foodicsRef ? (
          <span className="rounded-pill bg-foreground px-3 py-1.5 text-xs font-bold text-background">
            Foodics
          </span>
        ) : null}
      </div>

      {branch.busy ? (
        <div className="mt-4 flex items-center gap-2 rounded-card bg-warning/10 px-4 py-3 text-sm font-bold text-warning">
          <Clock3 className="size-4" aria-hidden />
          <span>{busyUntil ? `الفرع مشغول حتى: ${busyUntil}` : "الفرع مشغول حالياً"}</span>
        </div>
      ) : null}
    </button>
  );
}

function BranchDetailWorkspace({
  branchId,
  onBack,
  can,
}: {
  branchId: string;
  onBack: () => void;
  can: (permission: string) => boolean;
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<BranchTab>("info");
  const [feedback, setFeedback] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["staff_branch_detail", branchId],
    queryFn: () => fetchStaffBranchDetail(branchId),
    refetchInterval: 30_000,
  });

  const busyMutation = useMutation({
    mutationFn: (busyUntil: string | null) => setBranchBusyUntil(branchId, busyUntil),
    onSuccess: () => {
      setFeedback("تم تحديث حالة الفرع");
      queryClient.invalidateQueries({ queryKey: ["staff_branch_detail", branchId] });
      queryClient.invalidateQueries({ queryKey: ["staff_branch_operations"] });
      window.setTimeout(() => setFeedback(null), 2200);
    },
  });

  const productMutation = useMutation({
    mutationFn: ({ productId, available }: { productId: string; available: boolean }) =>
      setBranchProductAvailability(branchId, productId, available),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff_branch_detail", branchId] });
      queryClient.invalidateQueries({ queryKey: ["staff_branch_operations"] });
    },
  });

  const zoneMutation = useMutation({
    mutationFn: updateDeliveryZone,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["staff_branch_detail", branchId] }),
  });

  const createZoneMutation = useMutation({
    mutationFn: (zone: {
      area_id: string;
      eta_minutes: number;
      fee: number;
      min_order: number;
      below_min_fee: number;
      enabled: boolean;
    }) => createDeliveryZone(branchId, zone),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["staff_branch_detail", branchId] }),
  });

  const createAreaMutation = useMutation({
    mutationFn: ({ cityId, nameAr, nameEn }: { cityId: string; nameAr: string; nameEn: string }) =>
      createArea(cityId, nameAr, nameEn),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["staff_branch_form_options"] }),
  });

  const canEditBranch = can("branches.update");
  const canManageZones = can("branches.zones.manage");
  const [showEdit, setShowEdit] = useState(false);
  const { data: formOptions } = useQuery({
    queryKey: ["staff_branch_form_options"],
    queryFn: fetchBranchFormOptions,
    enabled: canEditBranch || canManageZones,
    staleTime: 60_000,
  });

  const updateMutation = useMutation({
    mutationFn: (input: BranchFormInput) => updateBranch(branchId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff_branch_detail", branchId] });
      queryClient.invalidateQueries({ queryKey: ["staff_branch_operations"] });
      setFeedback("تم حفظ بيانات الفرع");
      setShowEdit(false);
      window.setTimeout(() => setFeedback(null), 2200);
    },
  });

  if (isLoading) {
    return (
      <main className="min-h-screen p-5" dir="rtl">
        <div className="card-surface h-80 animate-pulse opacity-60" />
      </main>
    );
  }
  if (isError || !data) {
    return (
      <main className="min-h-screen p-5" dir="rtl">
        <button
          type="button"
          onClick={onBack}
          className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm font-bold"
        >
          <ArrowRight className="size-4" /> رجوع
        </button>
        <div className="card-surface p-6 text-center">
          <p className="font-bold">تعذّر تحميل تفاصيل الفرع</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {error instanceof Error ? error.message : "حاول مرة أخرى"}
          </p>
        </div>
      </main>
    );
  }

  const branch = data.branch;
  const foodicsRef = branch.pos_ref ?? data.menu?.pos_ref ?? null;

  return (
    <main className="min-h-screen pb-10" dir="rtl">
      <header className="sticky top-0 z-20 border-b border-border bg-background px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="grid size-11 shrink-0 place-items-center rounded-pill bg-secondary"
              aria-label="العودة للفروع"
            >
              <ArrowRight className="size-4" aria-hidden />
            </button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-base font-extrabold">{branch.name_ar}</h1>
                <span
                  className={`rounded-pill px-2.5 py-1 text-[11px] font-bold ${branch.status === "active" ? "bg-success/10 text-success" : "bg-secondary text-muted-foreground"}`}
                >
                  {branch.status === "active" ? "نشط" : "غير نشط"}
                </span>
                {foodicsRef ? (
                  <span className="rounded-pill bg-foreground px-2.5 py-1 text-[11px] font-bold text-background">
                    Foodics · {foodicsRef}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{branch.city_ar ?? "—"}</p>
            </div>
          </div>
          {canEditBranch ? (
            <button
              type="button"
              onClick={() => setShowEdit(true)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-border px-4 text-xs font-bold hover:border-brand"
            >
              <Pencil className="size-3.5" aria-hidden /> تعديل بيانات الفرع
            </button>
          ) : null}
        </div>
        <div className="-mx-5 mt-4 flex gap-1 overflow-x-auto border-t border-border px-5 pt-3 no-scrollbar">
          {DETAIL_TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`min-h-11 shrink-0 rounded-card px-4 text-xs font-bold ${tab === item.key ? "bg-foreground text-background" : "text-muted-foreground hover:bg-secondary"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      {showEdit && formOptions ? (
        <BranchFormModal
          mode="edit"
          options={formOptions}
          initial={branchDetailToForm(data)}
          submitting={updateMutation.isPending}
          error={updateMutation.error instanceof Error ? updateMutation.error.message : null}
          onClose={() => setShowEdit(false)}
          onSubmit={(input) => updateMutation.mutate(input)}
        />
      ) : null}

      <div className="px-5 py-6">
        {feedback ? (
          <div className="mb-4 rounded-card bg-secondary px-4 py-3 text-sm font-bold">
            {feedback}
          </div>
        ) : null}
        {tab === "info" ? (
          <BranchInfoTab
            data={data}
            areas={formOptions?.areas ?? []}
            canToggleBusy={can("branches.busy.toggle")}
            canManageZones={can("branches.zones.manage")}
            busyMutation={busyMutation}
            zoneMutation={zoneMutation}
            createZoneMutation={createZoneMutation}
            createAreaMutation={createAreaMutation}
          />
        ) : tab === "products" ? (
          <BranchProductsTab
            products={data.products}
            canToggle={can("branches.products.toggle")}
            pendingProductId={
              productMutation.isPending ? (productMutation.variables?.productId ?? null) : null
            }
            onToggle={(productId, available) => productMutation.mutate({ productId, available })}
          />
        ) : tab === "seating" ? (
          <FutureBranchTab icon={UtensilsCrossed} title="مناطق الجلوس والطاولات" />
        ) : tab === "reservations" ? (
          <FutureBranchTab icon={CalendarDays} title="إعدادات الحجوزات" />
        ) : (
          <FutureBranchTab icon={Users} title="إعدادات قائمة الانتظار" />
        )}
      </div>
    </main>
  );
}

function BranchInfoTab({
  data,
  areas,
  canToggleBusy,
  canManageZones,
  busyMutation,
  zoneMutation,
  createZoneMutation,
  createAreaMutation,
}: {
  data: StaffBranchDetail;
  areas: AreaOption[];
  canToggleBusy: boolean;
  canManageZones: boolean;
  busyMutation: ReturnType<
    typeof useMutation<Awaited<ReturnType<typeof setBranchBusyUntil>>, Error, string | null>
  >;
  zoneMutation: ReturnType<
    typeof useMutation<Awaited<ReturnType<typeof updateDeliveryZone>>, Error, StaffDeliveryZone>
  >;
  createZoneMutation: ReturnType<
    typeof useMutation<
      Awaited<ReturnType<typeof createDeliveryZone>>,
      Error,
      {
        area_id: string;
        eta_minutes: number;
        fee: number;
        min_order: number;
        below_min_fee: number;
        enabled: boolean;
      }
    >
  >;
  createAreaMutation: ReturnType<
    typeof useMutation<
      Awaited<ReturnType<typeof createArea>>,
      Error,
      { cityId: string; nameAr: string; nameEn: string }
    >
  >;
}) {
  const branch = data.branch;
  const [customTime, setCustomTime] = useState(defaultCustomTime());
  const busyUntil = branch.busy ? formatBusyUntil(branch.busy_until) : "";

  function saveCustomBusy() {
    const iso = riyadhInputToIso(customTime);
    if (!iso || new Date(iso).getTime() <= Date.now()) return;
    busyMutation.mutate(iso);
  }

  return (
    <div className="space-y-5">
      <section className="grid gap-3 md:grid-cols-3">
        <InfoCard icon={MapPin} label="المدينة" value={branch.city_ar ?? "—"} />
        <InfoCard icon={Phone} label="هاتف الفرع" value={branch.phone ?? "—"} dir="ltr" />
        <InfoCard
          icon={Package}
          label="القائمة المعينة"
          value={data.menu?.name_ar ?? "غير معينة"}
        />
      </section>

      <section className="card-surface p-5">
        <h2 className="text-sm font-extrabold">أنواع الطلب المفعلة</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {data.order_types
            .filter((item) => item.enabled)
            .map((item) => (
              <span
                key={item.kind}
                className="rounded-pill bg-secondary px-3 py-1.5 text-xs font-bold"
              >
                {ORDER_TYPE_LABEL[item.kind]}
              </span>
            ))}
        </div>
      </section>

      <section className="card-surface p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-extrabold">ساعات العمل</h2>
          <Clock3 className="size-4 text-muted-foreground" aria-hidden />
        </div>
        <div className="mt-4 divide-y divide-border">
          {data.hours.map((hour) => (
            <div
              key={hour.weekday}
              className="flex items-center justify-between gap-4 py-3 text-sm"
            >
              <span className="font-bold">
                {WEEKDAY_LABEL[hour.weekday] ?? `اليوم ${hour.weekday}`}
              </span>
              <span className="text-muted-foreground">
                {hour.closed
                  ? "مغلق"
                  : hour.is_24h
                    ? "24 ساعة"
                    : `${hour.opens_at ?? "—"} – ${hour.closes_at ?? "—"}`}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="card-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-extrabold">حالة استقبال الطلبات</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              الفرع يعود متاحاً تلقائياً عند انتهاء الوقت المحدد.
            </p>
          </div>
          <span
            className={`rounded-pill px-3 py-1.5 text-xs font-bold ${branch.busy ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}`}
          >
            {branch.busy ? (busyUntil ? `مشغول حتى ${busyUntil}` : "مشغول حالياً") : "متاح الآن"}
          </span>
        </div>
        {canToggleBusy && branch.status === "active" ? (
          <div className="mt-4">
            <div className="grid grid-cols-4 gap-2">
              {QUICK_MINUTES.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  disabled={busyMutation.isPending}
                  onClick={() =>
                    busyMutation.mutate(new Date(Date.now() + minutes * 60_000).toISOString())
                  }
                  className="min-h-11 rounded-card border border-border px-2 text-xs font-bold hover:border-brand disabled:opacity-50"
                >
                  {minutes} د
                </button>
              ))}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
              <input
                type="datetime-local"
                value={customTime}
                onChange={(event) => setCustomTime(event.target.value)}
                className="min-h-11 rounded-card border border-border bg-background px-3 text-sm outline-none focus:border-brand"
              />
              <button
                type="button"
                disabled={busyMutation.isPending}
                onClick={saveCustomBusy}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-card bg-foreground px-4 text-xs font-bold text-background disabled:opacity-50"
              >
                <TimerReset className="size-4" aria-hidden /> وقت مخصص
              </button>
            </div>
            {branch.busy ? (
              <button
                type="button"
                disabled={busyMutation.isPending}
                onClick={() => busyMutation.mutate(null)}
                className="mt-3 min-h-11 w-full rounded-card bg-success px-4 text-sm font-extrabold text-white disabled:opacity-50"
              >
                فتح الفرع الآن
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      <ChannelLinks
        branchId={branch.id}
        enabledOrderTypes={data.order_types.filter((item) => item.enabled).map((item) => item.kind)}
      />

      <DeliveryZonesGrid
        zones={data.delivery_zones}
        cityId={branch.city_id}
        availableAreas={areas.filter((area) => area.city_id === branch.city_id)}
        canManage={canManageZones}
        mutation={zoneMutation}
        createMutation={createZoneMutation}
        createAreaMutation={createAreaMutation}
      />
    </div>
  );
}

function InfoCard({
  icon: Icon,
  label,
  value,
  dir,
}: {
  icon: typeof Store;
  label: string;
  value: string;
  dir?: "ltr" | "rtl";
}) {
  return (
    <div className="card-surface p-4">
      <Icon className="size-4 text-brand" aria-hidden />
      <p className="mt-3 text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-extrabold" dir={dir}>
        {value}
      </p>
    </div>
  );
}

function ChannelLinks({
  branchId,
  enabledOrderTypes,
}: {
  branchId: string;
  enabledOrderTypes: BranchOrderType[];
}) {
  const links: { label: string; path: string; enabled: boolean }[] = [
    {
      label: "القائمة الالكترونية",
      path: `/menu?branch=${encodeURIComponent(branchId)}`,
      enabled: true,
    },
    {
      label: "رابط توصيل",
      path: `/menu?branch=${encodeURIComponent(branchId)}&orderType=delivery`,
      enabled: enabledOrderTypes.includes("delivery"),
    },
    {
      label: "رابط استلام",
      path: `/menu?branch=${encodeURIComponent(branchId)}&orderType=pickup`,
      enabled: enabledOrderTypes.includes("pickup"),
    },
    {
      label: "رابط من السيارة",
      path: `/menu?branch=${encodeURIComponent(branchId)}&orderType=curbside`,
      enabled: enabledOrderTypes.includes("curbside"),
    },
  ];
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(path: string) {
    if (typeof window === "undefined") return;
    await navigator.clipboard.writeText(`${window.location.origin}${path}`);
    setCopied(path);
    window.setTimeout(() => setCopied(null), 1500);
  }

  return (
    <section className="card-surface p-5">
      <div className="flex items-center gap-2">
        <Link2 className="size-4 text-brand" aria-hidden />
        <h2 className="text-sm font-extrabold">روابط القنوات</h2>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {links.map((link) => (
          <div
            key={link.label}
            className={`rounded-card border border-border p-4 ${link.enabled ? "" : "opacity-50"}`}
          >
            <p className="text-xs font-bold">{link.label}</p>
            <p className="mt-1 truncate text-[11px] text-muted-foreground" dir="ltr">
              {link.path}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={!link.enabled}
                onClick={() => copy(link.path)}
                className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-card bg-secondary px-3 text-xs font-bold disabled:cursor-not-allowed"
              >
                <Copy className="size-3.5" aria-hidden />
                {copied === link.path ? "تم النسخ" : "نسخ الرابط"}
              </button>
              <a
                href={link.enabled ? link.path : undefined}
                target="_blank"
                rel="noreferrer"
                aria-disabled={!link.enabled}
                className={`grid size-10 place-items-center rounded-card border border-border ${!link.enabled ? "pointer-events-none" : ""}`}
              >
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        روابط قائمة الانتظار والحجوزات تظهر بعد تفعيل وحداتها في مرحلة Dine-in.
      </p>
    </section>
  );
}

function DeliveryZonesGrid({
  zones,
  cityId,
  availableAreas,
  canManage,
  mutation,
  createMutation,
  createAreaMutation,
}: {
  zones: StaffDeliveryZone[];
  cityId: string | null;
  availableAreas: AreaOption[];
  canManage: boolean;
  mutation: ReturnType<
    typeof useMutation<Awaited<ReturnType<typeof updateDeliveryZone>>, Error, StaffDeliveryZone>
  >;
  createMutation: ReturnType<
    typeof useMutation<
      Awaited<ReturnType<typeof createDeliveryZone>>,
      Error,
      {
        area_id: string;
        eta_minutes: number;
        fee: number;
        min_order: number;
        below_min_fee: number;
        enabled: boolean;
      }
    >
  >;
  createAreaMutation: ReturnType<
    typeof useMutation<
      Awaited<ReturnType<typeof createArea>>,
      Error,
      { cityId: string; nameAr: string; nameEn: string }
    >
  >;
}) {
  const [drafts, setDrafts] = useState<Record<string, StaffDeliveryZone>>({});
  useEffect(
    () => setDrafts(Object.fromEntries(zones.map((zone) => [zone.id, { ...zone }]))),
    [zones],
  );

  const uncoveredAreas = useMemo(
    () => availableAreas.filter((area) => !zones.some((zone) => zone.area_id === area.id)),
    [availableAreas, zones],
  );
  const [showAdd, setShowAdd] = useState(false);
  const [newZone, setNewZone] = useState({
    area_id: "",
    eta_minutes: 30,
    fee: 0,
    min_order: 0,
    below_min_fee: 0,
    enabled: true,
  });
  const [newAreaName, setNewAreaName] = useState({ ar: "", en: "" });

  useEffect(() => {
    const first = uncoveredAreas[0];
    if (first && !newZone.area_id) {
      setNewZone((current) => ({ ...current, area_id: first.id }));
    }
  }, [uncoveredAreas, newZone.area_id]);

  function patch(id: string, values: Partial<StaffDeliveryZone>) {
    setDrafts((current) => ({
      ...current,
      [id]: { ...(current[id] ?? zones.find((zone) => zone.id === id)!), ...values },
    }));
  }

  function submitNewZone() {
    if (!newZone.area_id) return;
    createMutation.mutate(newZone, {
      onSuccess: () => {
        setShowAdd(false);
        setNewZone({
          area_id: "",
          eta_minutes: 30,
          fee: 0,
          min_order: 0,
          below_min_fee: 0,
          enabled: true,
        });
      },
    });
  }

  function submitNewArea() {
    if (!cityId || !newAreaName.ar.trim() || !newAreaName.en.trim()) return;
    createAreaMutation.mutate(
      { cityId, nameAr: newAreaName.ar.trim(), nameEn: newAreaName.en.trim() },
      {
        onSuccess: (area: { id: string }) => {
          setNewAreaName({ ar: "", en: "" });
          setNewZone((current) => ({ ...current, area_id: area.id }));
        },
      },
    );
  }

  return (
    <section className="card-surface overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
        <div>
          <h2 className="text-sm font-extrabold">مناطق التوصيل</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            المنطقة · مدة التوصيل · الرسوم · الحد الأدنى · رسوم أقل من الحد الأدنى · التفعيل
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && cityId ? (
            <button
              type="button"
              onClick={() => setShowAdd((value) => !value)}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-card border border-border px-3 text-xs font-bold hover:border-brand"
            >
              <Plus className="size-3.5" aria-hidden /> إضافة منطقة
            </button>
          ) : null}
          <Truck className="size-5 text-brand" aria-hidden />
        </div>
      </div>

      {!cityId ? (
        <p className="border-b border-border bg-warning/10 px-5 py-3 text-xs font-bold text-warning">
          حدد مدينة للفرع أولاً (من تعديل بيانات الفرع) لإدارة مناطق التوصيل.
        </p>
      ) : null}

      {showAdd && cityId ? (
        <div className="border-b border-border bg-secondary/40 p-4">
          {uncoveredAreas.length > 0 ? (
            <>
              <div className="grid gap-3 sm:grid-cols-5">
                <select
                  value={newZone.area_id}
                  onChange={(event) =>
                    setNewZone((current) => ({ ...current, area_id: event.target.value }))
                  }
                  className="min-h-11 rounded-card border border-border bg-background px-3 text-sm outline-none focus:border-brand sm:col-span-1"
                >
                  {uncoveredAreas.map((area) => (
                    <option key={area.id} value={area.id}>
                      {area.name_ar}
                    </option>
                  ))}
                </select>
                <NumberInput
                  value={newZone.eta_minutes}
                  onChange={(value) =>
                    setNewZone((current) => ({ ...current, eta_minutes: value }))
                  }
                  disabled={false}
                />
                <NumberInput
                  value={newZone.fee}
                  onChange={(value) => setNewZone((current) => ({ ...current, fee: value }))}
                  disabled={false}
                />
                <NumberInput
                  value={newZone.min_order}
                  onChange={(value) => setNewZone((current) => ({ ...current, min_order: value }))}
                  disabled={false}
                />
                <NumberInput
                  value={newZone.below_min_fee}
                  onChange={(value) =>
                    setNewZone((current) => ({ ...current, below_min_fee: value }))
                  }
                  disabled={false}
                />
              </div>
              {createMutation.error instanceof Error ? (
                <p className="mt-2 text-xs font-bold text-danger">{createMutation.error.message}</p>
              ) : null}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={createMutation.isPending}
                  onClick={submitNewZone}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-card bg-foreground px-4 text-xs font-bold text-background disabled:opacity-50"
                >
                  {createMutation.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Plus className="size-3.5" aria-hidden />
                  )}{" "}
                  إضافة
                </button>
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  className="min-h-10 rounded-card border border-border px-4 text-xs font-bold"
                >
                  إلغاء
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs font-bold text-muted-foreground">
                لا توجد مناطق متبقية لهذه المدينة — أضف منطقة جديدة أولاً:
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <input
                  value={newAreaName.ar}
                  onChange={(event) =>
                    setNewAreaName((current) => ({ ...current, ar: event.target.value }))
                  }
                  placeholder="اسم المنطقة (عربي)"
                  className="min-h-11 rounded-card border border-border bg-background px-3 text-sm outline-none focus:border-brand"
                />
                <input
                  value={newAreaName.en}
                  onChange={(event) =>
                    setNewAreaName((current) => ({ ...current, en: event.target.value }))
                  }
                  placeholder="Area name (EN)"
                  dir="ltr"
                  className="min-h-11 rounded-card border border-border bg-background px-3 text-sm outline-none focus:border-brand"
                />
                <button
                  type="button"
                  disabled={createAreaMutation.isPending}
                  onClick={submitNewArea}
                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-card bg-foreground px-4 text-xs font-bold text-background disabled:opacity-50"
                >
                  {createAreaMutation.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Plus className="size-3.5" aria-hidden />
                  )}{" "}
                  إضافة منطقة
                </button>
              </div>
              {createAreaMutation.error instanceof Error ? (
                <p className="mt-2 text-xs font-bold text-danger">
                  {createAreaMutation.error.message}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="mt-3 min-h-10 rounded-card border border-border px-4 text-xs font-bold"
              >
                إلغاء
              </button>
            </>
          )}
        </div>
      ) : null}

      {zones.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          لا توجد مناطق توصيل لهذا الفرع.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-sm">
            <thead className="bg-secondary/60 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-start">المنطقة</th>
                <th className="px-3 py-3">دقيقة</th>
                <th className="px-3 py-3">رسوم التوصيل</th>
                <th className="px-3 py-3">الحد الأدنى</th>
                <th className="px-3 py-3">رسوم أقل من الحد</th>
                <th className="px-3 py-3">تفعيل</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {zones.map((zone) => {
                const draft = drafts[zone.id] ?? zone;
                const pending = mutation.isPending && mutation.variables?.id === zone.id;
                return (
                  <tr key={zone.id}>
                    <td className="px-4 py-3 font-bold">{zone.area_name_ar}</td>
                    <td className="px-3 py-3">
                      <NumberInput
                        disabled={!canManage}
                        value={draft.eta_minutes}
                        onChange={(value) => patch(zone.id, { eta_minutes: value })}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <NumberInput
                        disabled={!canManage}
                        value={draft.fee}
                        onChange={(value) => patch(zone.id, { fee: value })}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <NumberInput
                        disabled={!canManage}
                        value={draft.min_order}
                        onChange={(value) => patch(zone.id, { min_order: value })}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <NumberInput
                        disabled={!canManage}
                        value={draft.below_min_fee}
                        onChange={(value) => patch(zone.id, { below_min_fee: value })}
                      />
                    </td>
                    <td className="px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        disabled={!canManage}
                        checked={draft.enabled}
                        onChange={(event) => patch(zone.id, { enabled: event.target.checked })}
                        className="size-4 accent-[var(--primary)]"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        disabled={!canManage || pending}
                        onClick={() => mutation.mutate(draft)}
                        className="inline-flex min-h-10 items-center gap-1.5 rounded-card bg-foreground px-3 text-xs font-bold text-background disabled:opacity-40"
                      >
                        <Save className="size-3.5" aria-hidden />
                        {pending ? "..." : "حفظ"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function NumberInput({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled: boolean;
}) {
  return (
    <input
      type="number"
      min="0"
      step="0.01"
      disabled={disabled}
      value={value}
      onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))}
      className="w-24 rounded-sm border border-border bg-background px-2 py-2 text-center text-xs outline-none focus:border-brand disabled:bg-secondary"
    />
  );
}

function BranchFormModal({
  mode,
  options,
  initial,
  submitting,
  error,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  options: StaffBranchFormOptions;
  initial: BranchFormInput;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: BranchFormInput) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<BranchFormInput>(initial);
  const [extraCities, setExtraCities] = useState<BranchOption[]>([]);
  const [showAddCity, setShowAddCity] = useState(false);
  const [newCity, setNewCity] = useState({ ar: "", en: "" });

  const createCityMutation = useMutation({
    mutationFn: () => createCity(newCity.ar.trim(), newCity.en.trim()),
    onSuccess: (city) => {
      setExtraCities((current) => [...current, city]);
      setForm((current) => ({ ...current, city_id: city.id }));
      setNewCity({ ar: "", en: "" });
      setShowAddCity(false);
      queryClient.invalidateQueries({ queryKey: ["staff_branch_form_options"] });
    },
  });

  const allCities = useMemo(() => {
    const merged = [...options.cities];
    for (const city of extraCities) {
      if (!merged.some((item) => item.id === city.id)) merged.push(city);
    }
    return merged;
  }, [options.cities, extraCities]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function patchHour(weekday: number, values: Partial<StaffBranchHour>) {
    setForm((current) => ({
      ...current,
      hours: current.hours.map((hour) =>
        hour.weekday === weekday ? { ...hour, ...values } : hour,
      ),
    }));
  }

  function toggleOrderType(kind: BranchOrderType, enabled: boolean) {
    setForm((current) => ({
      ...current,
      order_types: current.order_types.map((item) =>
        item.kind === kind ? { ...item, enabled } : item,
      ),
    }));
  }

  function submit() {
    if (!form.name_ar.trim() || !form.name_en.trim()) return;
    if (mode === "create" && !form.brand_id) return;
    onSubmit(form);
  }

  const canSubmit =
    form.name_ar.trim().length > 0 &&
    form.name_en.trim().length > 0 &&
    (mode === "edit" || Boolean(form.brand_id));

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 sm:items-center"
      dir="rtl"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="branch-form-title"
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-card bg-background shadow-card sm:rounded-card"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h2 id="branch-form-title" className="text-sm font-extrabold">
            {mode === "create" ? "إضافة فرع جديد" : "تعديل بيانات الفرع"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="grid size-10 place-items-center rounded-pill bg-secondary"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="space-y-5">
            {mode === "create" ? (
              <div>
                <label className="text-xs font-bold text-muted-foreground">البراند</label>
                <select
                  value={form.brand_id ?? ""}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, brand_id: event.target.value }))
                  }
                  className="mt-1.5 min-h-11 w-full rounded-card border border-border bg-background px-3 text-sm outline-none focus:border-brand"
                >
                  <option value="" disabled>
                    اختر البراند
                  </option>
                  {options.brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name_ar}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-bold text-muted-foreground">اسم الفرع (عربي)</label>
                <input
                  value={form.name_ar}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name_ar: event.target.value }))
                  }
                  className="mt-1.5 min-h-11 w-full rounded-card border border-border bg-background px-3 text-sm outline-none focus:border-brand"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-muted-foreground">Branch name (EN)</label>
                <input
                  dir="ltr"
                  value={form.name_en}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name_en: event.target.value }))
                  }
                  className="mt-1.5 min-h-11 w-full rounded-card border border-border bg-background px-3 text-sm outline-none focus:border-brand"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-muted-foreground">المدينة</label>
              <div className="mt-1.5 flex gap-2">
                <select
                  value={form.city_id ?? ""}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, city_id: event.target.value || null }))
                  }
                  className="min-h-11 flex-1 rounded-card border border-border bg-background px-3 text-sm outline-none focus:border-brand"
                >
                  <option value="">بدون مدينة</option>
                  {allCities.map((city) => (
                    <option key={city.id} value={city.id}>
                      {city.name_ar}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setShowAddCity((value) => !value)}
                  className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-card border border-border px-3 text-xs font-bold hover:border-brand"
                >
                  <Plus className="size-3.5" aria-hidden /> مدينة جديدة
                </button>
              </div>
              {showAddCity ? (
                <div className="mt-2 grid gap-2 rounded-card bg-secondary/40 p-3 sm:grid-cols-3">
                  <input
                    value={newCity.ar}
                    onChange={(event) =>
                      setNewCity((current) => ({ ...current, ar: event.target.value }))
                    }
                    placeholder="اسم المدينة (عربي)"
                    className="min-h-10 rounded-card border border-border bg-background px-3 text-xs outline-none focus:border-brand"
                  />
                  <input
                    dir="ltr"
                    value={newCity.en}
                    onChange={(event) =>
                      setNewCity((current) => ({ ...current, en: event.target.value }))
                    }
                    placeholder="City name (EN)"
                    className="min-h-10 rounded-card border border-border bg-background px-3 text-xs outline-none focus:border-brand"
                  />
                  <button
                    type="button"
                    disabled={
                      !newCity.ar.trim() || !newCity.en.trim() || createCityMutation.isPending
                    }
                    onClick={() => createCityMutation.mutate()}
                    className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-card bg-foreground px-3 text-xs font-bold text-background disabled:opacity-50"
                  >
                    {createCityMutation.isPending ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <CheckCircle2 className="size-3.5" aria-hidden />
                    )}{" "}
                    إضافة
                  </button>
                </div>
              ) : null}
              {createCityMutation.error instanceof Error ? (
                <p className="mt-1.5 text-xs font-bold text-danger">
                  {createCityMutation.error.message}
                </p>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="text-xs font-bold text-muted-foreground">هاتف الفرع</label>
                <input
                  dir="ltr"
                  value={form.phone ?? ""}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, phone: event.target.value || null }))
                  }
                  className="mt-1.5 min-h-11 w-full rounded-card border border-border bg-background px-3 text-sm outline-none focus:border-brand"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-muted-foreground">خط العرض (lat)</label>
                <input
                  dir="ltr"
                  type="number"
                  step="0.000001"
                  value={form.lat ?? ""}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      lat: event.target.value === "" ? null : Number(event.target.value),
                    }))
                  }
                  className="mt-1.5 min-h-11 w-full rounded-card border border-border bg-background px-3 text-sm outline-none focus:border-brand"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-muted-foreground">خط الطول (lng)</label>
                <input
                  dir="ltr"
                  type="number"
                  step="0.000001"
                  value={form.lng ?? ""}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      lng: event.target.value === "" ? null : Number(event.target.value),
                    }))
                  }
                  className="mt-1.5 min-h-11 w-full rounded-card border border-border bg-background px-3 text-sm outline-none focus:border-brand"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-bold text-muted-foreground">رمز الفرع الداخلي</label>
                <input
                  dir="ltr"
                  value={form.code ?? ""}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, code: event.target.value || null }))
                  }
                  className="mt-1.5 min-h-11 w-full rounded-card border border-border bg-background px-3 text-sm outline-none focus:border-brand"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-muted-foreground">القائمة المعينة</label>
                <select
                  value={form.menu_id ?? ""}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, menu_id: event.target.value || null }))
                  }
                  className="mt-1.5 min-h-11 w-full rounded-card border border-border bg-background px-3 text-sm outline-none focus:border-brand"
                >
                  <option value="">بدون قائمة</option>
                  {options.menus.map((menu) => (
                    <option key={menu.id} value={menu.id}>
                      {menu.name_ar}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {mode === "edit" ? (
              <div>
                <label className="text-xs font-bold text-muted-foreground">حالة الفرع</label>
                <div className="mt-1.5 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setForm((current) => ({ ...current, status: "active" }))}
                    className={`min-h-10 flex-1 rounded-card border px-3 text-xs font-bold ${form.status === "active" ? "border-success bg-success/10 text-success" : "border-border"}`}
                  >
                    نشط
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm((current) => ({ ...current, status: "inactive" }))}
                    className={`min-h-10 flex-1 rounded-card border px-3 text-xs font-bold ${form.status === "inactive" ? "border-danger bg-danger/10 text-danger" : "border-border"}`}
                  >
                    غير نشط
                  </button>
                </div>
              </div>
            ) : null}

            <div>
              <p className="text-xs font-bold text-muted-foreground">أنواع الطلب المفعلة</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {form.order_types.map((item) => (
                  <label
                    key={item.kind}
                    className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-card border px-3 text-xs font-bold ${item.enabled ? "border-brand bg-brand-soft text-brand" : "border-border text-muted-foreground"}`}
                  >
                    <input
                      type="checkbox"
                      checked={item.enabled}
                      onChange={(event) => toggleOrderType(item.kind, event.target.checked)}
                      className="size-4 accent-[var(--primary)]"
                    />
                    {ORDER_TYPE_LABEL[item.kind]}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-bold text-muted-foreground">ساعات العمل</p>
              <div className="mt-2 divide-y divide-border rounded-card border border-border">
                {form.hours.map((hour) => (
                  <div
                    key={hour.weekday}
                    className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-xs"
                  >
                    <span className="w-16 shrink-0 font-bold">
                      {WEEKDAY_LABEL[hour.weekday] ?? hour.weekday}
                    </span>
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={hour.closed}
                        onChange={(event) =>
                          patchHour(hour.weekday, { closed: event.target.checked })
                        }
                        className="size-3.5 accent-[var(--primary)]"
                      />{" "}
                      مغلق
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        disabled={hour.closed}
                        checked={hour.is_24h}
                        onChange={(event) =>
                          patchHour(hour.weekday, { is_24h: event.target.checked })
                        }
                        className="size-3.5 accent-[var(--primary)]"
                      />{" "}
                      24 ساعة
                    </label>
                    {!hour.closed && !hour.is_24h ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          dir="ltr"
                          type="time"
                          value={hour.opens_at ?? ""}
                          onChange={(event) =>
                            patchHour(hour.weekday, { opens_at: event.target.value })
                          }
                          className="min-h-9 rounded-sm border border-border bg-background px-2 text-xs outline-none focus:border-brand"
                        />
                        <span>–</span>
                        <input
                          dir="ltr"
                          type="time"
                          value={hour.closes_at ?? ""}
                          onChange={(event) =>
                            patchHour(hour.weekday, { closes_at: event.target.value })
                          }
                          className="min-h-9 rounded-sm border border-border bg-background px-2 text-xs outline-none focus:border-brand"
                        />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-border px-5 py-4">
          {error ? <p className="mb-3 text-xs font-bold text-danger">{error}</p> : null}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!canSubmit || submitting}
              onClick={submit}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-card bg-brand px-5 text-sm font-bold text-brand-ink disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Save className="size-4" aria-hidden />
              )}
              {mode === "create" ? "إضافة الفرع" : "حفظ التغييرات"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 rounded-card border border-border px-5 text-sm font-bold"
            >
              إلغاء
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BranchProductsTab({
  products,
  canToggle,
  pendingProductId,
  onToggle,
}: {
  products: StaffBranchProduct[];
  canToggle: boolean;
  pendingProductId: string | null;
  onToggle: (productId: string, available: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ar");
    if (!query) return products;
    return products.filter((product) =>
      [product.name_ar, product.name_en, product.category_ar, product.pos_ref]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("ar").includes(query)),
    );
  }, [products, search]);

  return (
    <section className="card-surface overflow-hidden">
      <div className="border-b border-border p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-extrabold">حالة المنتجات</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              تحكم بتوفر المنتج في هذا الفرع فقط.
            </p>
          </div>
          <span className="rounded-pill bg-secondary px-3 py-1.5 text-xs font-bold">
            {products.length} منتج
          </span>
        </div>
        <label className="relative mt-4 block max-w-md">
          <Search
            className="pointer-events-none absolute inset-inline-start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="بحث في المنتجات"
            className="min-h-11 w-full rounded-card border border-border bg-background px-10 text-sm outline-none focus:border-brand"
          />
        </label>
      </div>
      <div className="divide-y divide-border">
        {filtered.map((product) => {
          const catalogDisabled = !product.active || !product.orderable;
          const pending = pendingProductId === product.id;
          return (
            <div key={product.id} className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-bold">{product.name_ar}</p>
                  {product.pos_ref ? (
                    <span className="rounded-pill bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
                      POS {product.pos_ref}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {product.category_ar}
                  {catalogDisabled ? " · معطل من الكتالوج" : ""}
                </p>
              </div>
              <label
                className={`flex shrink-0 items-center gap-2 text-xs font-bold ${!canToggle || catalogDisabled ? "opacity-50" : ""}`}
              >
                <span>{product.effective_available ? "متوفر" : "غير متوفر"}</span>
                <input
                  type="checkbox"
                  checked={product.branch_available && !catalogDisabled}
                  disabled={!canToggle || catalogDisabled || pending}
                  onChange={(event) => onToggle(product.id, event.target.checked)}
                  className="size-5 accent-[var(--primary)]"
                />
              </label>
            </div>
          );
        })}
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">لا توجد نتائج.</div>
        ) : null}
      </div>
    </section>
  );
}

function FutureBranchTab({ icon: Icon, title }: { icon: typeof Store; title: string }) {
  return (
    <section className="card-surface p-10 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-pill bg-secondary text-brand">
        <Icon className="size-5" aria-hidden />
      </span>
      <h2 className="mt-4 text-sm font-extrabold">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-xs leading-6 text-muted-foreground">
        هذا التبويب موجود في تصميم المشروع، لكن جداول هذه الوحدة غير مفعلة في قاعدة البيانات الحالية
        بعد. لن نعرض بيانات وهمية.
      </p>
    </section>
  );
}
