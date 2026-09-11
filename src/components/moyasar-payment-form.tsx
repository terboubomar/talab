import { useEffect, useRef, useState } from "react";

import type { StorefrontPaymentOption } from "@/lib/storefront";
import { formatSAR } from "@/lib/menu";

declare global {
  interface Window {
    Moyasar?: {
      init: (config: Record<string, unknown>) => void;
    };
  }
}

const MOYASAR_VERSION = "1.15.0";
const MOYASAR_SCRIPT = `https://cdn.moyasar.com/mpf/${MOYASAR_VERSION}/moyasar.js`;
const MOYASAR_STYLE = `https://cdn.moyasar.com/mpf/${MOYASAR_VERSION}/moyasar.css`;

function ensureStyle() {
  if (document.querySelector('link[data-talab-moyasar="true"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = MOYASAR_STYLE;
  link.dataset.talabMoyasar = "true";
  document.head.appendChild(link);
}

function ensureScript(): Promise<void> {
  if (window.Moyasar) return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>('script[data-talab-moyasar="true"]');
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("moyasar_script_failed")), { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = MOYASAR_SCRIPT;
    script.async = true;
    script.dataset.talabMoyasar = "true";
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("moyasar_script_failed")), { once: true });
    document.head.appendChild(script);
  });
}

export function MoyasarPaymentForm({
  orderId,
  total,
  branchName,
  option,
}: {
  orderId: string;
  total: number;
  branchName: string;
  option: StorefrontPaymentOption;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const initializedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !containerRef.current || initializedRef.current) return;
    let active = true;

    async function initialize() {
      try {
        ensureStyle();
        await ensureScript();
        if (!active || !containerRef.current || !window.Moyasar) return;

        containerRef.current.innerHTML = "";
        initializedRef.current = true;

        const callbackUrl = new URL("/payment-result", window.location.origin);
        callbackUrl.searchParams.set("order", orderId);
        callbackUrl.searchParams.set("account", option.account_id);

        const methods = option.methods.length ? option.methods : ["creditcard"];
        const config: Record<string, unknown> = {
          element: containerRef.current,
          amount: Math.round(total * 100),
          currency: "SAR",
          description: `Talab order ${orderId.slice(0, 8)}`,
          publishable_api_key: option.publishable_api_key,
          callback_url: callbackUrl.toString(),
          supported_networks: option.supported_networks.length
            ? option.supported_networks
            : ["mada", "visa", "mastercard"],
          methods,
          language: "ar",
          on_initiating: () => ({
            amount: Math.round(total * 100),
            callback_url: callbackUrl.toString(),
            metadata: {
              order_id: orderId,
              payment_account_id: option.account_id,
            },
          }),
          on_completed: (payment: { id?: string }) => {
            try {
              sessionStorage.setItem(
                "talab.pendingPayment",
                JSON.stringify({
                  orderId,
                  accountId: option.account_id,
                  paymentId: payment?.id ?? null,
                }),
              );
            } catch {
              /* recovery hint only */
            }
          },
          on_failure: () => {
            if (active) setError("تعذّر بدء عملية الدفع. جرّب مرة أخرى.");
          },
        };

        if (methods.includes("applepay")) {
          config.apple_pay = {
            country: "SA",
            label: branchName || "Talab",
            validate_merchant_url: "https://api.moyasar.com/v1/applepay/initiate",
          };
        }

        window.Moyasar.init(config);
      } catch {
        if (active) setError("تعذّر تحميل بوابة الدفع حالياً. يمكنك الرجوع واختيار الدفع عند الاستلام.");
      }
    }

    void initialize();
    return () => {
      active = false;
    };
  }, [branchName, option, orderId, total]);

  return (
    <div className="w-full max-w-lg">
      <div className="mb-4 text-center">
        <p className="text-sm font-extrabold">إتمام الدفع عبر ميسر</p>
        <p className="mt-1 text-2xl font-extrabold text-brand">{formatSAR(total)}</p>
        {option.environment === "test" ? (
          <span className="mt-2 inline-flex rounded-pill bg-warning/10 px-3 py-1 text-xs font-bold text-warning">
            وضع الاختبار
          </span>
        ) : null}
      </div>
      {error ? (
        <div className="mb-3 rounded-card border border-danger/30 bg-danger/10 p-3 text-center text-sm font-bold text-danger">
          {error}
        </div>
      ) : null}
      <div ref={containerRef} className="mysr-form min-h-24" dir="ltr" />
      <p className="mt-4 text-center text-xs leading-6 text-muted-foreground">
        لن يعتبر طلبك مدفوعاً ولن يظهر للمطبخ كطلب إلكتروني مؤكد إلا بعد التحقق من ميسر على الخادم.
      </p>
    </div>
  );
}
