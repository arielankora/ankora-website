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
      },
      maxWidth: {
        content: "1440px",
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
      },
      animation: {
        drift: "drift 6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
