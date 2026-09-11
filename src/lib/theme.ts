/**
 * Token-driven theming.
 *
 * Every color / radius / font is a CSS variable on :root (see src/styles.css).
 * At runtime the `theme` jsonb column of the selected brand can override any of
 * them. Unknown keys are ignored; empty theme keeps the fallback palette.
 */

const TOKEN_MAP: Record<string, string> = {
  ink: "--ink",
  surface: "--surface",
  muted: "--muted-soft",
  line: "--line",
  accent: "--accent",
  accent_ink: "--accent-ink",
  accentInk: "--accent-ink",
  success: "--success",
  danger: "--danger",
  radius: "--radius-card",
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
