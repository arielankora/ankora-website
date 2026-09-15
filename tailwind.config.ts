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
      },
      backgroundImage: {
        "gold-gradient": "linear-gradient(120deg, #B08D57 0%, #C7AC7E 50%, #B08D57 100%)",
        "radial-glow": "radial-gradient(60% 60% at 50% 40%, rgba(176,141,87,0.16) 0%, rgba(176,141,87,0) 70%)",
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
      },
      animation: {
        drift: "drift 6s ease-in-out infinite",
        glowDrift: "glowDrift 18s ease-in-out infinite",
        eyebrowPulse: "eyebrowPulse 2.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
