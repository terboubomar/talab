import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  currentSession,
  fetchDriverOrderDetail,
  fetchDriverOrders,
  fetchDriverProfile,
  signIn,
  signOut,
  updateDriverOrderStatus,
  type DriverOrder,
  type DriverOrderDetail,
  type DriverOrderStatus,
  type DriverProfile,
} from "./src/lib/api";
import { driverAppConfigured, supabase } from "./src/lib/supabase";

const STATUS_LABEL: Record<DriverOrderStatus, string> = {
  accepted: "تم قبول الطلب",
  preparing: "جاري التجهيز",
  ready: "جاهز للاستلام",
  out_for_delivery: "جاري التوصيل",
};

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    void currentSession().then((next) => mounted && setSession(next)).catch(() => mounted && setSession(null));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  if (!driverAppConfigured) return <ConfigurationMissing />;
  if (session === undefined) return <Splash />;
  if (!session) return <LoginScreen />;
  return <DriverHome />;
}

function Splash() {
  return (
    <SafeAreaView style={styles.centeredPage}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.brandMark}><Text style={styles.brandMarkText}>ط</Text></View>
      <ActivityIndicator style={{ marginTop: 18 }} color="#111827" />
    </SafeAreaView>
  );
}

function ConfigurationMissing() {
  return (
    <SafeAreaView style={styles.centeredPage}>
      <StatusBar barStyle="dark-content" />
      <Text style={styles.title}>تطبيق سائق طلب</Text>
      <Text style={styles.centerCopy}>
        إعداد Supabase غير موجود. أنشئ ملف .env داخل apps/driver باستخدام القيم العامة الموضحة في .env.example.
      </Text>
    </SafeAreaView>
  );
}

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch {
      setError("تعذّر تسجيل الدخول. تحقق من البريد وكلمة المرور.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.page}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView style={styles.loginWrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.brandMark}><Text style={styles.brandMarkText}>ط</Text></View>
        <Text style={[styles.title, { marginTop: 18 }]}>تطبيق السائق</Text>
        <Text style={styles.subtitle}>طلبات التوصيل المسندة لك فقط</Text>

        <View style={styles.loginCard}>
          <FieldLabel>البريد الإلكتروني</FieldLabel>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            style={styles.input}
            placeholder="driver@example.com"
          />
          <FieldLabel>كلمة المرور</FieldLabel>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType="password"
            style={styles.input}
            placeholder="••••••••"
            onSubmitEditing={() => void submit()}
          />
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <PrimaryButton disabled={busy || !email.trim() || !password} onPress={() => void submit()}>
            {busy ? "جاري الدخول…" : "تسجيل الدخول"}
          </PrimaryButton>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function DriverHome() {
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [orders, setOrders] = useState<DriverOrder[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    setError(null);
    try {
      const [nextProfile, nextOrders] = await Promise.all([fetchDriverProfile(), fetchDriverOrders()]);
      setProfile(nextProfile);
      setOrders(nextOrders);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      setError(message.includes("driver_role_required") ? "هذا الحساب ليس حساب سائق في طلب." : "تعذّر تحميل طلبات التوصيل.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!supabase || !profile) return;
    const channel = supabase
      .channel(`driver-orders-${profile.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `driver_id=eq.${profile.id}` },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [profile, refresh]);

  if (selectedId) {
    return <OrderDetailScreen orderId={selectedId} onBack={() => setSelectedId(null)} onChanged={() => void refresh()} />;
  }

  if (loading) return <Splash />;

  const active = orders.filter((order) => order.status === "out_for_delivery");
  const waiting = orders.filter((order) => order.status !== "out_for_delivery");

  return (
    <SafeAreaView style={styles.page}>
      <StatusBar barStyle="dark-content" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh(true)} />}
      >
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>TALAB DRIVER</Text>
            <Text style={styles.title}>{profile ? `أهلاً ${profile.name}` : "طلباتك"}</Text>
            <Text style={styles.subtitle}>{branchSummary(profile)}</Text>
          </View>
          <Pressable style={styles.smallButton} onPress={() => void signOut()}>
            <Text style={styles.smallButtonText}>خروج</Text>
          </Pressable>
        </View>

        <View style={styles.metricsRow}>
          <Metric value={orders.length} label="المسندة لك" />
          <Metric value={active.length} label="جاري التوصيل" />
          <Metric value={orders.filter((order) => order.status === "ready").length} label="جاهزة" />
        </View>

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => void refresh()}><Text style={styles.linkText}>إعادة المحاولة</Text></Pressable>
          </View>
        ) : null}

        {active.length > 0 ? (
          <OrderSection title="جاري التوصيل" orders={active} onOpen={setSelectedId} highlighted />
        ) : null}
        <OrderSection title="الطلبات القادمة" orders={waiting} onOpen={setSelectedId} />
      </ScrollView>
    </SafeAreaView>
  );
}

function OrderSection({
  title,
  orders,
  onOpen,
  highlighted = false,
}: {
  title: string;
  orders: DriverOrder[];
  onOpen: (id: string) => void;
  highlighted?: boolean;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {orders.length === 0 ? (
        <View style={styles.emptyCard}><Text style={styles.muted}>لا توجد طلبات في هذه القائمة حالياً.</Text></View>
      ) : (
        orders.map((order) => (
          <Pressable
            key={order.id}
            onPress={() => onOpen(order.id)}
            style={({ pressed }) => [styles.orderCard, highlighted && styles.orderCardActive, pressed && { opacity: 0.82 }]}
          >
            <View style={styles.orderTopRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.orderCustomer}>{order.customer.name || "عميل"}</Text>
                <Text style={styles.orderMeta}>{order.branch_name_ar} · {order.items_count} صنف</Text>
              </View>
              <StatusPill status={order.status} />
            </View>
            <Text numberOfLines={2} style={styles.addressText}>{order.delivery_address_text || "العنوان غير مكتمل"}</Text>
            <View style={styles.orderBottomRow}>
              <Text style={styles.amount}>{formatSAR(order.total)}</Text>
              {order.payment_method === "cash" && order.payment_status !== "paid" ? (
                <Text style={styles.cashDue}>تحصيل نقدي</Text>
              ) : (
                <Text style={styles.muted}>مدفوع</Text>
              )}
            </View>
          </Pressable>
        ))
      )}
    </View>
  );
}

function OrderDetailScreen({ orderId, onBack, onChanged }: { orderId: string; onBack: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<DriverOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDetail(await fetchDriverOrderDetail(orderId));
    } catch {
      setError("تعذّر فتح تفاصيل هذا الطلب.");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeStatus(next: "out_for_delivery" | "completed") {
    setBusy(true);
    setError(null);
    try {
      await updateDriverOrderStatus(orderId, next);
      onChanged();
      if (next === "completed") {
        Alert.alert("تم التسليم", "تم تسجيل الطلب كمُسلّم بنجاح.", [{ text: "حسناً", onPress: onBack }]);
        return;
      }
      await load();
    } catch {
      setError("تعذّر تحديث حالة الطلب. تأكد أن الطلب ما زال مسنداً لك وبالحالة الصحيحة.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Splash />;

  return (
    <SafeAreaView style={styles.page}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Pressable onPress={onBack} style={styles.backButton}><Text style={styles.backButtonText}>‹ رجوع</Text></Pressable>
        {error ? <View style={styles.errorCard}><Text style={styles.errorText}>{error}</Text></View> : null}
        {!detail ? null : (
          <>
            <View style={styles.detailHero}>
              <StatusPill status={detail.status as DriverOrderStatus} />
              <Text style={styles.detailCustomer}>{detail.customer.name || "عميل"}</Text>
              <Text style={styles.detailPhone}>{detail.customer.phone}</Text>
              <Text style={styles.addressText}>{detail.delivery_address_text || "العنوان غير مكتمل"}</Text>
              <View style={styles.actionRow}>
                <SecondaryButton onPress={() => void Linking.openURL(`tel:${detail.customer.phone}`)}>اتصال بالعميل</SecondaryButton>
                <SecondaryButton onPress={() => void openDirections(detail)}>فتح الملاحة</SecondaryButton>
              </View>
            </View>

            {detail.payment_method === "cash" && detail.payment_status !== "paid" ? (
              <View style={styles.cashCard}>
                <Text style={styles.cashCardLabel}>المبلغ المطلوب تحصيله</Text>
                <Text style={styles.cashCardAmount}>{formatSAR(detail.total)}</Text>
              </View>
            ) : null}

            <View style={styles.detailCard}>
              <Text style={styles.sectionTitle}>الطلب</Text>
              {detail.items.map((item) => (
                <View key={item.id} style={styles.itemRow}>
                  <Text style={styles.itemName}>{item.qty}× {item.name_ar}</Text>
                  {item.modifiers.length ? <Text style={styles.itemMeta}>{item.modifiers.map((m) => m.name_ar).join("، ")}</Text> : null}
                  {item.notes ? <Text style={styles.itemNote}>ملاحظة: {item.notes}</Text> : null}
                </View>
              ))}
            </View>

            {detail.notes ? (
              <View style={styles.detailCard}>
                <Text style={styles.sectionTitle}>ملاحظات التوصيل</Text>
                <Text style={styles.addressText}>{detail.notes}</Text>
              </View>
            ) : null}

            {detail.status === "ready" ? (
              <PrimaryButton disabled={busy} onPress={() => void changeStatus("out_for_delivery")}>
                {busy ? "جاري التحديث…" : "بدء التوصيل"}
              </PrimaryButton>
            ) : detail.status === "out_for_delivery" ? (
              <PrimaryButton disabled={busy} onPress={() => void changeStatus("completed")}>
                {busy ? "جاري التحديث…" : "تم التوصيل"}
              </PrimaryButton>
            ) : (
              <View style={styles.waitingCard}>
                <Text style={styles.muted}>الطلب لم يصبح جاهزاً للاستلام بعد. سيتم تحديث القائمة تلقائياً عند تغير حالته.</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

async function openDirections(order: DriverOrderDetail) {
  const query = order.delivery_lat != null && order.delivery_lng != null
    ? `${order.delivery_lat},${order.delivery_lng}`
    : order.delivery_address_text ?? "";
  if (!query) {
    Alert.alert("لا يوجد موقع", "هذا الطلب لا يحتوي على إحداثيات أو عنوان قابل للملاحة.");
    return;
  }
  await Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`);
}

function StatusPill({ status }: { status: DriverOrderStatus }) {
  const active = status === "out_for_delivery";
  return (
    <View style={[styles.statusPill, active && styles.statusPillActive]}>
      <Text style={[styles.statusPillText, active && styles.statusPillTextActive]}>{STATUS_LABEL[status] ?? status}</Text>
    </View>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value.toLocaleString("ar-SA")}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function FieldLabel({ children }: { children: string }) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

function PrimaryButton({ children, onPress, disabled = false }: { children: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.primaryButton, (disabled || pressed) && { opacity: 0.65 }]}>
      <Text style={styles.primaryButtonText}>{children}</Text>
    </Pressable>
  );
}

function SecondaryButton({ children, onPress }: { children: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.secondaryButton, pressed && { opacity: 0.65 }]}>
      <Text style={styles.secondaryButtonText}>{children}</Text>
    </Pressable>
  );
}

function formatSAR(value: number) {
  return `${Number(value || 0).toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س`;
}

function branchSummary(profile: DriverProfile | null) {
  if (!profile) return "تحميل بيانات السائق…";
  if (profile.branches.length === 0) return "جميع الفروع المسموحة لحسابك";
  return profile.branches.map((branch) => branch.name_ar).join(" · ");
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F7F8FA" },
  centeredPage: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#F7F8FA", padding: 28 },
  scrollContent: { padding: 18, paddingBottom: 42 },
  loginWrap: { flex: 1, justifyContent: "center", padding: 22 },
  brandMark: { width: 58, height: 58, borderRadius: 18, backgroundColor: "#111827", alignItems: "center", justifyContent: "center", alignSelf: "center" },
  brandMarkText: { color: "#FFFFFF", fontSize: 27, fontWeight: "900" },
  eyebrow: { textAlign: "right", fontSize: 10, letterSpacing: 1.2, color: "#6B7280", fontWeight: "800" },
  title: { textAlign: "right", fontSize: 24, lineHeight: 34, color: "#111827", fontWeight: "900" },
  subtitle: { marginTop: 4, textAlign: "right", fontSize: 12, lineHeight: 20, color: "#6B7280" },
  centerCopy: { marginTop: 12, maxWidth: 320, textAlign: "center", fontSize: 13, lineHeight: 22, color: "#6B7280" },
  loginCard: { marginTop: 28, borderRadius: 22, backgroundColor: "#FFFFFF", padding: 18, borderWidth: 1, borderColor: "#E5E7EB" },
  fieldLabel: { marginBottom: 7, marginTop: 12, textAlign: "right", fontSize: 12, fontWeight: "800", color: "#374151" },
  input: { height: 48, borderRadius: 14, borderWidth: 1, borderColor: "#D1D5DB", backgroundColor: "#FFFFFF", paddingHorizontal: 14, textAlign: "left", color: "#111827" },
  errorText: { textAlign: "right", color: "#B91C1C", fontSize: 12, lineHeight: 19, fontWeight: "700" },
  errorCard: { gap: 8, marginTop: 16, borderRadius: 16, padding: 14, backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA" },
  linkText: { textAlign: "right", color: "#111827", fontSize: 12, fontWeight: "900" },
  primaryButton: { marginTop: 18, minHeight: 50, borderRadius: 16, backgroundColor: "#111827", alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  primaryButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
  secondaryButton: { flex: 1, minHeight: 44, borderRadius: 14, borderWidth: 1, borderColor: "#D1D5DB", backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  secondaryButtonText: { color: "#111827", fontSize: 12, fontWeight: "800" },
  smallButton: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: "#D1D5DB", backgroundColor: "#FFFFFF" },
  smallButtonText: { color: "#374151", fontSize: 11, fontWeight: "800" },
  headerRow: { flexDirection: "row-reverse", alignItems: "flex-start", gap: 12 },
  metricsRow: { flexDirection: "row-reverse", gap: 8, marginTop: 18 },
  metric: { flex: 1, borderRadius: 16, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E5E7EB", padding: 12 },
  metricValue: { textAlign: "right", fontSize: 18, fontWeight: "900", color: "#111827" },
  metricLabel: { marginTop: 2, textAlign: "right", fontSize: 10, color: "#6B7280" },
  section: { marginTop: 24, gap: 10 },
  sectionTitle: { textAlign: "right", fontSize: 14, fontWeight: "900", color: "#111827" },
  emptyCard: { borderRadius: 18, padding: 20, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E5E7EB" },
  muted: { textAlign: "right", color: "#6B7280", fontSize: 11, lineHeight: 18 },
  orderCard: { borderRadius: 20, padding: 16, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E5E7EB" },
  orderCardActive: { borderColor: "#86EFAC", backgroundColor: "#F0FDF4" },
  orderTopRow: { flexDirection: "row-reverse", alignItems: "flex-start", gap: 10 },
  orderCustomer: { textAlign: "right", fontSize: 15, fontWeight: "900", color: "#111827" },
  orderMeta: { marginTop: 3, textAlign: "right", fontSize: 10, color: "#6B7280" },
  statusPill: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "#F3F4F6" },
  statusPillActive: { backgroundColor: "#DCFCE7" },
  statusPillText: { color: "#4B5563", fontSize: 9, fontWeight: "900" },
  statusPillTextActive: { color: "#15803D" },
  addressText: { marginTop: 12, textAlign: "right", color: "#4B5563", fontSize: 12, lineHeight: 20 },
  orderBottomRow: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#F3F4F6", flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center" },
  amount: { color: "#111827", fontSize: 13, fontWeight: "900" },
  cashDue: { color: "#B45309", fontSize: 10, fontWeight: "900" },
  backButton: { alignSelf: "flex-end", paddingVertical: 8 },
  backButtonText: { color: "#4B5563", fontSize: 12, fontWeight: "800" },
  detailHero: { marginTop: 8, borderRadius: 22, padding: 18, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E5E7EB" },
  detailCustomer: { marginTop: 14, textAlign: "right", color: "#111827", fontSize: 22, fontWeight: "900" },
  detailPhone: { marginTop: 3, textAlign: "right", color: "#6B7280", fontSize: 12 },
  actionRow: { marginTop: 16, flexDirection: "row-reverse", gap: 8 },
  cashCard: { marginTop: 12, borderRadius: 18, padding: 16, backgroundColor: "#FFFBEB", borderWidth: 1, borderColor: "#FDE68A" },
  cashCardLabel: { textAlign: "right", color: "#92400E", fontSize: 11, fontWeight: "800" },
  cashCardAmount: { marginTop: 5, textAlign: "right", color: "#78350F", fontSize: 21, fontWeight: "900" },
  detailCard: { marginTop: 12, borderRadius: 18, padding: 16, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E5E7EB" },
  itemRow: { paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E5E7EB" },
  itemName: { textAlign: "right", color: "#111827", fontSize: 13, fontWeight: "800" },
  itemMeta: { marginTop: 4, textAlign: "right", color: "#6B7280", fontSize: 10 },
  itemNote: { marginTop: 4, textAlign: "right", color: "#92400E", fontSize: 10 },
  waitingCard: { marginTop: 14, borderRadius: 16, padding: 14, backgroundColor: "#F3F4F6" },
});
