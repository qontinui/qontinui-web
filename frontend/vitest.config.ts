import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  // Vitest 4.x bundles rolldown-vite internally; its transformer is oxc, not esbuild.
  // @vitejs/plugin-react 4.x only wires JSX into esbuild, so .tsx files fail to parse
  // under vitest without this explicit oxc JSX config.
  oxc: {
    jsx: {
      runtime: "automatic",
      importSource: "react",
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "eslint-rules/**/*.{test,spec}.{js,mjs}",
      // Pure, dependency-free helpers under tests/e2e may carry vitest unit
      // tests (e.g. the style-gate snapshot normalizer). The Playwright SPECS
      // (*.spec.ts) stay excluded below — only `*.test.ts` here is collected.
      "tests/e2e/**/*.test.ts",
    ],
    // Exclude the Playwright e2e SPECS (they import @playwright/test and run
    // under `playwright test`, not vitest) but NOT the `*.test.ts` unit tests
    // included above.
    exclude: ["node_modules", "tests/e2e/**/*.spec.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "src/test/",
        "**/*.d.ts",
        "**/*.config.*",
        "**/mockData/**",
        "tests/e2e/**",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  css: {
    // Disable PostCSS processing in tests to avoid Tailwind v4 compatibility issues
    postcss: {
      plugins: [],
    },
  },
});
