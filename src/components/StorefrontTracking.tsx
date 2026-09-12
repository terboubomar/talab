import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";

import { trackingIntegrationsQuery, type StorefrontTrackingIntegration } from "@/lib/storefront";

declare global {
  interface Window {
    dataLayer?: unknown[];
    fbq?: ((...args: unknown[]) => void) & { callMethod?: (...args: unknown[]) => void; queue?: unknown[]; loaded?: boolean; version?: string };
    _fbq?: Window["fbq"];
    ttq?: any;
    snaptr?: (...args: unknown[]) => void;
    gtag?: (...args: unknown[]) => void;
    TiktokAnalyticsObject?: string;
  }
}

function getSetting(integration: StorefrontTrackingIntegration, key: string) {
  const value = integration.settings[key];
  return typeof value === "string" ? value.trim() : "";
}

function appendScript(id: string, src: string) {
  if (document.getElementById(id)) return;
  const script = document.createElement("script");
  script.id = id;
  script.async = true;
  script.src = src;
  document.head.appendChild(script);
}

function initMeta(pixelId: string) {
  if (!pixelId || window.fbq) return;
  const fbq: any = function (...args: unknown[]) {
    if (fbq.callMethod) fbq.callMethod(...args);
    else fbq.queue.push(args);
  };
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = "2.0";
  fbq.queue = [];
  window.fbq = fbq;
  window._fbq = fbq;
  appendScript("talab-meta-pixel", "https://connect.facebook.net/en_US/fbevents.js");
  fbq("init", pixelId);
}

function initTikTok(pixelId: string) {
  if (!pixelId || window.ttq) return;
  const w: any = window;
  const t = "ttq";
  w.TiktokAnalyticsObject = t;
  const ttq = (w[t] = w[t] || []);
  ttq.methods = ["page", "track", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group", "enableCookie", "disableCookie"];
  ttq.setAndDefer = (obj: any, method: string) => {
    obj[method] = (...args: unknown[]) => obj.push([method, ...args]);
  };
  for (const method of ttq.methods) ttq.setAndDefer(ttq, method);
  ttq.instance = (id: string) => {
    const instance = ttq._i?.[id] || [];
    for (const method of ttq.methods) ttq.setAndDefer(instance, method);
    return instance;
  };
  ttq.load = (id: string, options?: Record<string, unknown>) => {
    const url = "https://analytics.tiktok.com/i18n/pixel/events.js";
    ttq._i = ttq._i || {};
    ttq._i[id] = [];
    ttq._i[id]._u = url;
    ttq._t = ttq._t || {};
    ttq._t[id] = Date.now();
    ttq._o = ttq._o || {};
    ttq._o[id] = options || {};
    appendScript("talab-tiktok-pixel", `${url}?sdkid=${encodeURIComponent(id)}&lib=${t}`);
  };
  ttq.load(pixelId);
}

function initSnapchat(pixelId: string) {
  if (!pixelId || window.snaptr) return;
  const snaptr: any = function (...args: unknown[]) {
    if (snaptr.handleRequest) snaptr.handleRequest(...args);
    else snaptr.queue.push(args);
  };
  snaptr.queue = [];
  window.snaptr = snaptr;
  appendScript("talab-snap-pixel", "https://sc-static.net/scevent.min.js");
  snaptr("init", pixelId, {});
}

function initGtm(containerId: string) {
  if (!containerId) return;
  window.dataLayer = window.dataLayer || [];
  if (!document.getElementById("talab-gtm")) {
    window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
    appendScript("talab-gtm", `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(containerId)}`);
  }
}

function initGoogleAnalytics(measurementId: string) {
  if (!measurementId) return;
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function (...args: unknown[]) {
    window.dataLayer?.push(args);
  };
  appendScript("talab-google-analytics", `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`);
  window.gtag("js", new Date());
  window.gtag("config", measurementId, { send_page_view: false });
}

export function StorefrontTracking() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const href = useRouterState({ select: (state) => state.location.href });
  const isStorefront = !pathname.startsWith("/admin");
  const { data = [] } = useQuery({ ...trackingIntegrationsQuery, enabled: isStorefront });
  const initialised = useRef(false);

  const config = useMemo(() => {
    const bySlug = new Map(data.map((item) => [item.provider_slug, item]));
    return {
      meta: bySlug.get("meta-pixel"),
      tiktok: bySlug.get("tiktok-pixel"),
      snapchat: bySlug.get("snapchat-pixel"),
      gtm: bySlug.get("google-tag-manager"),
      ga: bySlug.get("google-analytics"),
    };
  }, [data]);

  useEffect(() => {
    if (!isStorefront || !data.length || initialised.current) return;
    initialised.current = true;
    if (config.meta) initMeta(getSetting(config.meta, "pixel_id"));
    if (config.tiktok) initTikTok(getSetting(config.tiktok, "pixel_id"));
    if (config.snapchat) initSnapchat(getSetting(config.snapchat, "pixel_id"));
    if (config.gtm) initGtm(getSetting(config.gtm, "container_id"));
    if (config.ga) initGoogleAnalytics(getSetting(config.ga, "measurement_id"));
  }, [config, data.length, isStorefront]);

  useEffect(() => {
    if (!isStorefront || !data.length) return;
    const url = typeof window !== "undefined" ? window.location.href : href;
    window.fbq?.("track", "PageView");
    window.ttq?.page?.();
    window.snaptr?.("track", "PAGE_VIEW");
    window.dataLayer?.push({ event: "virtual_page_view", page_location: url, page_path: pathname });
    window.gtag?.("event", "page_view", { page_location: url, page_path: pathname });
  }, [data.length, href, isStorefront, pathname]);

  if (!isStorefront || !config.gtm) return null;
  const containerId = getSetting(config.gtm, "container_id");
  if (!containerId) return null;

  return (
    <noscript>
      <iframe
        src={`https://www.googletagmanager.com/ns.html?id=${encodeURIComponent(containerId)}`}
        height="0"
        width="0"
        style={{ display: "none", visibility: "hidden" }}
        title="Google Tag Manager"
      />
    </noscript>
  );
}
