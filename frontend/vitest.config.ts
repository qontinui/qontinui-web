import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";

// Mirror of the switch in `next.config.mjs`: the optional
// `@qontinui/cloud-control` overlay is present (composed cloud build) or it is
// not (OSS-only), and the absent case resolves the specifier to a local no-op
// so the boot module's static import works in both shapes. Vitest has its own
// resolver, so the fallback has to be declared here too or every OSS run dies
// on an unresolved import. See docs/composed-cloud-build.md.
const cloudControlPresent = fs.existsSync(
  path.resolve(__dirname, "node_modules/@qontinui/cloud-control/package.json")
);

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
    // Heavy component test files (e.g. workflow-canvas/auto-layout, nodes) do the
    // same work but wall-clock-slower under parallel CPU contention, so vitest's
    // 5s DEFAULT testTimeout flakes them on full-suite runs while they pass in
    // isolation. 20s absorbs the contention slowdown; a real hang still fails.
    testTimeout: 20_000,
    hookTimeout: 20_000,
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
    server: {
      deps: {
        // `@qontinui/cloud-control` is the optional composed-cloud-build
        // overlay (docs/composed-cloud-build.md). It lives under
        // node_modules, so vitest would externalize it and hand its raw
        // `.ts` entry point to Node, which cannot load TypeScript. Inlining
        // routes it through vite's transform instead — the same "compile the
        // package inside the host graph" treatment `transpilePackages` gives
        // it under webpack. No effect on OSS-only runs, where the package is
        // absent and the tests that touch it skip themselves.
        inline: [/@qontinui[\\/]cloud-control/],
      },
    },
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
    // The cloud-control overlay is a link into node_modules pointing at a
    // sibling checkout. Without this, vite canonicalises it to a real path
    // OUTSIDE this project and every bare import inside the package
    // ("lucide-react", "react-hook-form", …) fails to resolve, because there
    // is no node_modules above the sibling repo. Keeping the linked path
    // makes the normal upward node_modules lookup land in this app's tree —
    // the same thing `config.resolve.modules` does for webpack in
    // next.config.mjs. Harmless when no overlay is installed: `npm ci`
    // creates no symlinks, so nothing else here is affected.
    preserveSymlinks: true,
    alias: {
      "@": path.resolve(__dirname, "./src"),
      ...(cloudControlPresent
        ? {}
        : {
            "@qontinui/cloud-control": path.resolve(
              __dirname,
              "./src/cloud-absent/index.ts"
            ),
          }),
    },
  },
  css: {
    // Disable PostCSS processing in tests to avoid Tailwind v4 compatibility issues
    postcss: {
      plugins: [],
    },
  },
});
