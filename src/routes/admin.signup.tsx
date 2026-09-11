import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/admin/signup")({
  head: () => ({ meta: [{ title: "تفعيل حساب الموظف — طلب" }] }),
  component: StaffSignupPage,
});

function StaffSignupPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needsEmailConfirmation, setNeedsEmailConfirmation] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) {
      setError("قاعدة البيانات غير متصلة");
      return;
    }
    if (password.length < 8) {
      setError("كلمة المرور يجب أن تكون 8 أحرف على الأقل.");
      return;
    }
    if (password !== confirmPassword) {
      setError("كلمتا المرور غير متطابقتين.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setNeedsEmailConfirmation(false);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      const { data, error: signupError } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
      });
      if (signupError) throw signupError;

      if (!data.session) {
        setNeedsEmailConfirmation(true);
        return;
      }

      const { error: claimError } = await supabase.rpc("staff_claim_invite");
      if (claimError) throw claimError;
      navigate({ to: "/admin/orders", replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("no_pending_invite")) {
        setError("لا توجد دعوة موظف صالحة لهذا البريد. استخدم نفس البريد الذي أضافه المدير.");
      } else {
        setError("تعذّر إنشاء الحساب. تحقق من البريد والبيانات ثم حاول مرة أخرى.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-secondary px-5 py-10">
      <form onSubmit={handleSubmit} className="card-surface w-full max-w-sm p-6">
        <h1 className="text-lg font-extrabold">تفعيل حساب الموظف</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          استخدم نفس البريد الإلكتروني الذي أضافه مدير المطعم.
        </p>

        <div className="mt-5 grid gap-3">
          <div>
            <label htmlFor="signup-email" className="text-xs font-bold text-muted-foreground">
              البريد الإلكتروني
            </label>
            <input
              id="signup-email"
              required
              type="email"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-card border border-border bg-background px-4 py-3 text-sm outline-none focus:border-brand"
            />
          </div>
          <div>
            <label htmlFor="signup-password" className="text-xs font-bold text-muted-foreground">
              كلمة المرور
            </label>
            <input
              id="signup-password"
              required
              minLength={8}
              type="password"
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-card border border-border bg-background px-4 py-3 text-sm outline-none focus:border-brand"
            />
          </div>
          <div>
            <label htmlFor="signup-confirm" className="text-xs font-bold text-muted-foreground">
              تأكيد كلمة المرور
            </label>
            <input
              id="signup-confirm"
              required
              minLength={8}
              type="password"
              dir="ltr"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="mt-1 w-full rounded-card border border-border bg-background px-4 py-3 text-sm outline-none focus:border-brand"
            />
          </div>
        </div>

        {needsEmailConfirmation ? (
          <div className="mt-4 rounded-card border border-brand/30 bg-brand/10 p-3 text-sm">
            <p className="font-bold">تحقق من بريدك الإلكتروني لإكمال التسجيل.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              بعد تأكيد البريد، ارجع إلى صفحة الدخول وسجّل بنفس الحساب ليتم ربط دعوتك تلقائياً.
            </p>
          </div>
        ) : null}

        {error ? (
          <p className="mt-3 rounded-card border border-danger/30 bg-danger/10 p-2 text-center text-sm font-bold text-danger">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting || needsEmailConfirmation}
          className="mt-5 w-full rounded-pill bg-brand px-5 py-3 text-sm font-bold text-brand-ink disabled:opacity-50"
        >
          {submitting ? "جارٍ إنشاء الحساب..." : "إنشاء الحساب وتفعيل الدعوة"}
        </button>

        <Link
          to="/admin/login"
          className="mt-4 block text-center text-xs font-bold text-muted-foreground hover:text-foreground"
        >
          لدي حساب بالفعل — دخول
        </Link>
      </form>
    </main>
  );
}
