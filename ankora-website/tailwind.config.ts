import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#050B14",
        navy: "#07162B",
        navyLight: "#0E2138",
        paper: "#F7F5F0",
        paperDim: "#EDEAE2",
        gold: {
          DEFAULT: "#C9A24B",
          light: "#E8C77A",
          dim: "#8A733A",
        },
        line: "rgba(247,245,240,0.08)",
        lineGold: "rgba(201,162,75,0.35)",
      },
      fontFamily: {
        sans: ["Heebo", "system-ui", "sans-serif"],
      },
      maxWidth: {
        content: "1440px",
      },
      backgroundImage: {
        "gold-gradient": "linear-gradient(120deg, #C9A24B 0%, #E8C77A 50%, #C9A24B 100%)",
        "radial-glow": "radial-gradient(60% 60% at 50% 40%, rgba(201,162,75,0.16) 0%, rgba(201,162,75,0) 70%)",
      },
      keyframes: {
        drift: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-10px)" },
        },
      },
      animation: {
        drift: "drift 6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
