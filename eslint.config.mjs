import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  { ignores: [".next/**", "node_modules/**", "supabase/**", "next-env.d.ts", "tests/e2e/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Server actions return ActionResult; unused catch bindings are fine.
      // Apostrophes in plain UI text are fine; only the characters that can break JSX are forbidden.
      "react/no-unescaped-entities": ["error", { forbid: [">", "}"] }],
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
];

export default config;
