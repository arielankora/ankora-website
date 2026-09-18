import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#0B1B33",
        navy: "#1B2A3D",
        navyLight: "#1B2A3D",
        cream: "#F3EADB",
        paper: "#F8F4EC",
        paperDim: "#EDE3D2",
        gold: {
          DEFAULT: "#B08D57",
          light: "#C7AC7E",
          dim: "#8A6F45",
        },
        line: "rgba(248,244,236,0.08)",
        lineDark: "rgba(27,42,61,0.14)",
        lineGold: "rgba(176,141,87,0.4)",
        // App redesign (design_handoff_ankora_app_redesign/README.md, "Design
        // Tokens" table): semantic tones for toasts, StatusBadge, inline
        // validation and KPI overage states. Not new brand colors - these
        // are tone-mapped from the existing palette per the handoff doc
        // ("צבעים סמנטיים שנוספו... אינם ב-Tailwind כרגע - להוסיף כטוקנים").
        // Nested `soft` key is each tone's low-opacity background pair.
        success: { DEFAULT: "#1F7A4D", soft: "rgba(31,122,77,0.1)" },
        error: { DEFAULT: "#B3261E", soft: "rgba(179,38,30,0.08)", "on-dark": "#E5847E" },
        warning: { DEFAULT: "#8A6F45", soft: "rgba(176,141,87,0.16)" },
        neutral: { DEFAULT: "rgba(27,42,61,0.55)", soft: "rgba(27,42,61,0.07)" },
      },
      fontFamily: {
        sans: ["Heebo", "system-ui", "sans-serif"],
        assistant: ["Assistant", "system-ui", "sans-serif"],
        jbmono: ["JetBrains Mono", "monospace"],
      },
      maxWidth: {
        content: "1440px",
        // Wide container used only by the /he redesign (spec: 1480px content max-width).
        // Kept separate from `content` so /en's existing 1440px containers are untouched.
        wide: "1480px",
        // App redesign (handoff README, "ריווח ורדיוסים"): the internal app's
        // own content max-width, distinct from the 1440/1480px marketing
        // containers above so those are never affected by this change.
        appContent: "1180px",
      },
      backgroundImage: {
        "gold-gradient": "linear-gradient(120deg, #B08D57 0%, #C7AC7E 50%, #B08D57 100%)",
        "radial-glow": "radial-gradient(60% 60% at 50% 40%, rgba(176,141,87,0.16) 0%, rgba(176,141,87,0) 70%)",
        // App redesign skeleton shimmer (handoff README: "שלד תוכן עם
        // ank-sweep, לא ספינר"). Swept via background-position, see the
        // `sweep` keyframe/animation below.
        "sweep-gradient":
          "linear-gradient(90deg, rgba(27,42,61,0.06) 25%, rgba(27,42,61,0.12) 37%, rgba(27,42,61,0.06) 63%)",
      },
      keyframes: {
        drift: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-10px)" },
        },
        // /he redesign page-glow drift (design_handoff_ankora_redesign/README.md).
        glowDrift: {
          "0%, 100%": { transform: "translate3d(0, 0, 0) scale(1)" },
          "50%": { transform: "translate3d(0, -3%, 0) scale(1.06)" },
        },
        // /he redesign eyebrow dot pulse (design_handoff_ankora_redesign/README.md).
        eyebrowPulse: {
          "0%, 100%": { opacity: "0.25" },
          "50%": { opacity: "1" },
        },
        // App redesign (handoff README, "אנימציות"): ank-toast-in, ank-pulse,
        // ank-sweep. Renamed without the `ank-` prefix to match this file's
        // existing naming, same timings/easing as specified. All three are
        // caught by globals.css's existing prefers-reduced-motion override
        // (animation-duration forced to ~0), so no extra guard is needed here.
        "toast-in": {
          "0%": { opacity: "0", transform: "translateY(14px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-dot": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
        sweep: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        drift: "drift 6s ease-in-out infinite",
        glowDrift: "glowDrift 18s ease-in-out infinite",
        eyebrowPulse: "eyebrowPulse 2.6s ease-in-out infinite",
        "toast-in": "toast-in 0.22s ease-out",
        "pulse-dot": "pulse-dot 2.6s ease-in-out infinite",
        sweep: "sweep 1.4s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
