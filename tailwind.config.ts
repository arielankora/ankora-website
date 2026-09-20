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
        // Site redesign (design_handoff_ankora_site/README.md, "Colour"). NOTE the
        // name inversion, kept deliberately for now: this file's `ink` is the spec's
        // *Navy* (#0B1B33, the page ground) and this file's `paper` is the spec's
        // *Ink* (#F8F4EC, the text on it). Renaming ink->navy / paper->ink touches 84
        // `-ink` and 304 `-paper` occurrences across 62 files including the internal
        // app, so it lands as its own mechanical commit after the redesign, where the
        // diff is reviewable on its own (Ariel's decision, C14).
        inkDeep: "#08182D",
        // The four body/label greys from the spec's colour table. Previously
        // hardcoded as arbitrary values -- 66 occurrences of #A9B8C9 and 39 of
        // #7C8EA3 before this change.
        tone: {
          body: "#C3CEDA",
          muted: "#A9B8C9",
          dim: "#7C8EA3",
          faint: "#5C6B7E",
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
        // JetBrains Mono carries no Hebrew glyphs, so Hebrew mono labels fall through
        // to the next family. Heebo sits in the middle of the stack so that fallback
        // is the brand face rather than the platform's default monospace; Latin
        // glyphs still resolve to JetBrains Mono, since fallback is per glyph.
        jbmono: ["JetBrains Mono", "Heebo", "monospace"],
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
        // Site redesign hero graphic + diagram strokes (design_handoff_ankora_site/
        // README.md, "Motion"). `flow` animates the seven inbound threads, `hubPulse`
        // the hub node's radius, `drawLine` the single resolved line (once, on load),
        // `nodePulse` the source nodes and diagram dots.
        flow: {
          to: { strokeDashoffset: "-56" },
        },
        hubPulse: {
          "0%, 100%": { r: "9" },
          "50%": { r: "12" },
        },
        drawLine: {
          to: { strokeDashoffset: "0" },
        },
        nodePulse: {
          "0%, 100%": { opacity: "0.35" },
          "50%": { opacity: "1" },
        },
        // The home page's two-lane comparison. One 12s cycle shows the same task run
        // twice. `tokenSlow` is the task without Ankora: it stalls at each of the five
        // interruption points and never quite arrives (ends at 88%). `tokenFast` is the
        // same task with Ankora: one uninterrupted run to 100% in the first quarter of
        // the cycle, then it waits. `tickFlash` lights each interruption as the slow
        // token reaches it, `arrive` is the ring that lands on the fast lane's target.
        // All four animate inset-inline-start, so the lanes run in the reading
        // direction in both locales with no mirrored copy.
        tokenSlow: {
          "0%": { insetInlineStart: "0%" },
          "6%": { insetInlineStart: "13%" },
          "16%": { insetInlineStart: "13%" },
          "24%": { insetInlineStart: "29%" },
          "33%": { insetInlineStart: "29%" },
          "40%": { insetInlineStart: "24%" },
          "50%": { insetInlineStart: "47%" },
          "58%": { insetInlineStart: "47%" },
          "67%": { insetInlineStart: "61%" },
          "76%": { insetInlineStart: "61%" },
          "86%": { insetInlineStart: "79%" },
          "94%": { insetInlineStart: "79%" },
          "100%": { insetInlineStart: "88%" },
        },
        tokenFast: {
          "0%": { insetInlineStart: "0%" },
          "26%": { insetInlineStart: "100%" },
          "100%": { insetInlineStart: "100%" },
        },
        tickFlash: {
          "0%, 4%": { opacity: "0.18" },
          "8%": { opacity: "1" },
          "20%": { opacity: "0.18" },
          "100%": { opacity: "0.18" },
        },
        arrive: {
          "0%, 24%": { opacity: "0.2", transform: "scale(0.7)" },
          "28%": { opacity: "1", transform: "scale(1)" },
          "100%": { opacity: "1", transform: "scale(1)" },
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
        flow: "flow 3.2s linear infinite",
        hubPulse: "hubPulse 2.8s ease-in-out infinite",
        drawLine: "drawLine 1.8s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        nodePulse: "nodePulse 3.6s ease-in-out infinite",
        tokenSlow: "tokenSlow 12s linear infinite",
        tokenFast: "tokenFast 12s cubic-bezier(0.3, 0, 0.2, 1) infinite",
        tickFlash: "tickFlash 12s linear infinite",
        arrive: "arrive 12s linear infinite",
        "toast-in": "toast-in 0.22s ease-out",
        "pulse-dot": "pulse-dot 2.6s ease-in-out infinite",
        sweep: "sweep 1.4s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
