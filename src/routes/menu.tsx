import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";

import { ORDER_TYPE_LABEL, readSelection, type Selection } from "@/lib/storefront";

export const Route = createFileRoute("/menu")({
  head: () => ({
    meta: [
      { title: "القائمة — طلب" },
      {
        name: "description",
        content: "قائمة الأصناف والمنتجات للفرع المختار، الأسعار بالريال السعودي شاملة الضريبة.",
      },
      { property: "og:title", content: "القائمة — طلب" },
      { property: "og:description", content: "تصفّح أصناف الفرع المختار وأضف طلبك." },
    ],
  }),
  component: MenuPage,
});

function MenuPage() {
  const [selection, setSelection] = useState<Selection | null>(null);

  useEffect(() => {
    setSelection(readSelection());
  }, []);

  return (
    <main className="min-h-screen bg-secondary px-5 py-10">
      <div className="mx-auto max-w-3xl">
        <div className="card-surface p-6 text-center">
          <h1 className="text-xl font-extrabold">القائمة</h1>
          {selection ? (
            <p className="mt-2 text-sm text-muted-foreground">
              الفرع: {selection.branchNameAr} — طريقة الطلب:{" "}
              {ORDER_TYPE_LABEL[selection.orderType] ?? selection.orderType}
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">لم يتم اختيار فرع بعد.</p>
          )}
          <Link
            to="/"
            className="mt-5 inline-flex rounded-pill bg-brand px-5 py-2.5 text-sm font-bold text-brand-ink"
          >
            تغيير الفرع
          </Link>
        </div>
      </div>
    </main>
  );
}
