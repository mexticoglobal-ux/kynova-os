import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

// AGENTS.md §7.2: provider SDKs are only allowed inside lib/ai/.
const AI_SDK_PATTERNS = [
  "@anthropic-ai/sdk",
  "openai",
  "openai/*",
  "@google/genai",
  "@google/generative-ai",
  "@mistralai/*",
  "cohere-ai",
  "groq-sdk",
  "@ai-sdk/*",
];

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      ".open-next/**",
      ".vercel/**",
      ".wrangler/**",
      "node_modules/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
      "cloudflare-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript", "prettier"),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: AI_SDK_PATTERNS,
              message: "Use the provider interface in lib/ai/ (AGENTS.md §7.2).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["lib/ai/**"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    files: [".claude/hooks/**", "*.config.{js,mjs,mts,ts}"],
    rules: { "no-console": "off" },
  },
];

export default eslintConfig;
