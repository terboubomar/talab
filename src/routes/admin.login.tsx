import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import { staffSignIn } from "@/lib/staff";

export const Route = createFileRoute("/admin/login")({
  head: () => ({
    meta: [{ title: "دخول الموظفين — طلب" }],
  }),
  component: StaffLoginPage,
});

function StaffLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await staffSignIn(email.trim(), password);
      navigate({ to: "/admin/orders" });
    } catch {
      setError("بيانات الدخول غير صحيحة");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-secondary px-5">
      <form onSubmit={handleSubmit} className="card-surface w-full max-w-sm p-6">
        <h1 className="text-lg font-extrabold">دخول الموظفين</h1>
        <div className="mt-5 grid gap-3">
          <div>
            <label htmlFor="staff-email" className="text-xs font-bold text-muted-foreground">
              البريد الإلكتروني
            </label>
            <input
              id="staff-email"
              type="email"
              required
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-card border border-border bg-background px-4 py-3 text-sm outline-none focus:border-brand"
            />
          </div>
          <div>
            <label htmlFor="staff-password" className="text-xs font-bold text-muted-foreground">
              كلمة المرور
            </label>
            <input
              id="staff-password"
              type="password"
              required
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-card border border-border bg-background px-4 py-3 text-sm outline-none focus:border-brand"
            />
          </div>
        </div>
        {error ? (
          <p className="mt-3 rounded-card border border-danger/30 bg-danger/10 p-2 text-center text-sm font-bold text-danger">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={submitting}
          className="mt-5 w-full rounded-pill bg-brand px-5 py-3 text-sm font-bold text-brand-ink disabled:opacity-50"
        >
          {submitting ? "جارٍ الدخول..." : "دخول"}
        </button>
        <Link
          to="/admin/signup"
          className="mt-4 block text-center text-xs font-bold text-muted-foreground hover:text-foreground"
        >
          تمت دعوتي كموظف — تفعيل الحساب
        </Link>
      </form>
    </main>
  );
}
