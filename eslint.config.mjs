import nextVitals from "eslint-config-next/core-web-vitals";

// Flat config, because Next 16 removed `next lint` and eslint-config-next 16
// ships for ESLint 9 only. Same rule set as the old `.eslintrc.json`
// ("next/core-web-vitals"), with one deliberate difference below.
const config = [
  ...nextVitals,
  {
    // eslint-plugin-react-hooks 7, which came in with eslint-config-next 16,
    // adds the React Compiler rules and turns them on as errors. They are
    // good advice about render purity and effects, and they flagged about
    // twenty existing places on the day of the upgrade (13.10.2026). None of
    // those is a bug that the old rules missed; they are patterns the
    // compiler cannot optimise. Warnings for now, so the upgrade stays an
    // upgrade and the clean-up can be its own change.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/use-memo": "warn",
      "react-hooks/incompatible-library": "warn",
      "react-hooks/globals": "warn",
      "react-hooks/error-boundaries": "warn",
      "react-hooks/unsupported-syntax": "warn",
      "react-hooks/config": "warn",
      "react-hooks/gating": "warn",
    },
  },
  {
    ignores: [".next/**", "node_modules/**", "qa/reports/**", "public/**", "next-env.d.ts"],
  },
];

export default config;
