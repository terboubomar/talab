/**
 * Token-driven theming.
 *
 * Every storefront color / radius / font is a CSS variable on :root
 * (see src/styles.css). At runtime the `theme` jsonb column of the selected
 * brand can override the supported tokens below. Unknown keys are ignored;
 * an empty theme keeps the audited Talab defaults.
 */

const TOKEN_MAP: Record<string, string> = {
  ink: "--ink",
  ink_2: "--ink-2",
  ink2: "--ink-2",
  ink_3: "--ink-3",
  ink3: "--ink-3",
  surface: "--surface",
  surface_sunk: "--surface-sunk",
  surfaceSunk: "--surface-sunk",
  surface_raised: "--surface-raised",
  surfaceRaised: "--surface-raised",
  muted: "--muted-soft",
  line: "--line",
  line_soft: "--line-soft",
  lineSoft: "--line-soft",
  accent: "--accent",
  accent_ink: "--accent-ink",
  accentInk: "--accent-ink",
  accent_soft: "--accent-soft",
  accentSoft: "--accent-soft",
  success: "--ok",
  ok: "--ok",
  warn: "--warn",
  warning: "--warn",
  danger: "--danger",
  radius: "--radius-card",
  radius_sm: "--radius-sm",
  radiusSm: "--radius-sm",
  radius_card: "--radius-card",
  radiusCard: "--radius-card",
  radius_pill: "--radius-pill",
  radiusPill: "--radius-pill",
  shadow_1: "--shadow-1",
  shadow1: "--shadow-1",
  shadow_2: "--shadow-2",
  shadow2: "--shadow-2",
  font_heading: "--font-heading",
  font_body: "--font-body",
};

export type BrandTheme = Record<string, unknown> | null | undefined;

export function applyBrandTheme(theme: BrandTheme) {
  if (typeof document === "undefined" || !theme) return;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme)) {
    const cssVar = TOKEN_MAP[key];
    if (!cssVar) continue;
    if (typeof value === "string" && value.trim()) {
      root.style.setProperty(cssVar, value.trim());
    } else if (typeof value === "number") {
      root.style.setProperty(cssVar, `${value}px`);
    }
  }
}
