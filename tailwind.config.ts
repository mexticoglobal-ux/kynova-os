import type { Config } from "tailwindcss";

// Every color comes from a CSS variable defined per theme in app/globals.css, so a theme change never touches a component.
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: token("canvas"),
        surface: token("surface"),
        raised: { DEFAULT: token("raised"), strong: token("raised-strong") },
        shade: token("shade"),
        scrim: token("scrim"),
        line: { DEFAULT: token("line"), soft: token("line-soft"), strong: token("line-strong") },
        ink: { DEFAULT: token("ink"), soft: token("ink-soft"), muted: token("ink-muted") },
        primary: { DEFAULT: token("primary"), soft: token("primary-soft") },
        "on-primary": token("on-primary"),
        accent: { DEFAULT: token("accent"), soft: token("accent-soft") },
        "on-accent": token("on-accent"),
        success: token("success"),
        warning: token("warning"),
        // `soft` is the AA-compliant variant for small text on tinted backgrounds.
        danger: { DEFAULT: token("danger"), soft: token("danger-soft") },
      },
      borderRadius: { card: "20px" },
      boxShadow: { card: "var(--shadow-card)", raised: "var(--shadow-raised)" },
      fontFamily: { sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"] },
      // CSS entrance animations run before hydration, so content never waits for JavaScript to appear.
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "none" },
        },
        "page-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "none" },
        },
        "pop-in": {
          from: { opacity: "0", transform: "translateY(6px) scale(0.98)" },
          to: { opacity: "1", transform: "none" },
        },
        shimmer: { to: { transform: "translateX(100%)" } },
        float: {
          "0%, 100%": { transform: "translateY(0)", opacity: "0.2" },
          "50%": { transform: "translateY(-30px)", opacity: "0.7" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.4s ease-out both",
        "page-in": "page-in 0.28s ease-out both",
        "pop-in": "pop-in 0.18s ease-out both",
        shimmer: "shimmer 1.6s ease-in-out infinite",
        float: "float 6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
