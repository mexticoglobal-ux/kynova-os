import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: ["app/**", "components/**", "lib/**", "config/**"],
      exclude: ["**/*.test.{ts,tsx}", "**/*.d.ts"],
      reporter: ["text", "html", "lcov"],
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["**/*.test.ts"],
          exclude: ["node_modules/**", "e2e/**", ".next/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "components",
          environment: "jsdom",
          include: ["**/*.test.tsx"],
          exclude: ["node_modules/**", "e2e/**", ".next/**"],
          setupFiles: ["./vitest.setup.ts"],
        },
      },
    ],
  },
});
