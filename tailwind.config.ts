import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#09090B",
        primary: { DEFAULT: "#2563EB", soft: "#93C5FD" },
        accent: "#7C3AED",
        success: "#22C55E",
        warning: "#F59E0B",
        // `soft` is the AA-compliant variant for small text on tinted backgrounds.
        danger: { DEFAULT: "#EF4444", soft: "#F87171" },
      },
      borderRadius: { card: "20px" },
      fontFamily: { sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"] },
      // CSS entrance animations run before hydration, so content never waits for JavaScript to appear.
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "none" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)", opacity: "0.2" },
          "50%": { transform: "translateY(-30px)", opacity: "0.7" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.4s ease-out both",
        float: "float 6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
