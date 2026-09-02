import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bundleAnalyzer from '@next/bundle-analyzer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

// Backend URL: Use environment variable in production, localhost in development
const BACKEND_URL = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// qontinui-coord URL — separate axum service (default port 9870). The
// browser proxies REST through Next.js to avoid CORS; WebSocket
// connections still go direct via NEXT_PUBLIC_COORD_WS_URL since
// rewrites don't proxy ws:// upgrades.
const COORD_URL = process.env.COORD_URL || 'http://localhost:9870';

// Composed cloud build. `@qontinui/cloud-control` is an OPTIONAL sibling
// package that side-effect-registers the cloud services/components into
// `src/lib/extension-slots.ts`. It is linked into node_modules by
// `npm run cloud:install` (scripts/cloud-control-overlay.mjs), and the
// presence of that one path is the single switch between the OSS-only build
// shape and the composed cloud one. Full contract:
// docs/composed-cloud-build.md.
const CLOUD_CONTROL_PKG = '@qontinui/cloud-control';
const cloudControlPresent = fs.existsSync(
  path.resolve(__dirname, 'node_modules/@qontinui/cloud-control/package.json')
);

// `@cloud/*` — the build-time route alias. Every mounted cloud route is a
// two-line `page.tsx` under `src/app/` that re-exports through this prefix,
// so which module a cloud path renders is decided by webpack resolution at
// build time rather than by a runtime registry lookup. That is what keeps
// SSR, per-route `metadata` and server components available to cloud routes;
// a registry read forfeits all three because the registry only ever exists
// behind a client boundary. See docs/composed-cloud-build.md.
//
// Deliberately NOT in tsconfig.json `paths`. Next feeds those into webpack as
// `JsConfigPathsPlugin`, which taps `described-resolve`; webpack's own
// `resolve.alias` is an `AliasPlugin` on `raw-resolve`, and enhanced-resolve
// runs `described-resolve` strictly BEFORE `raw-resolve`. So a `@cloud/*`
// entry in tsconfig.json wins over the mapping below on pipeline ordering —
// not on plugin registration order — and silently resolves every composed
// build back to the OSS stubs. `tsc` gets its own mapping from
// `tsconfig.typecheck.json`, which Next never reads, and
// `cloud-route-shims.test.ts` asserts the entry never reappears.
const CLOUD_ALIAS_TARGET = path.resolve(
  __dirname,
  cloudControlPresent
    ? 'node_modules/@qontinui/cloud-control/frontend/src'
    : 'src/cloud-absent'
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // `ioredis` powers the UI Bridge cross-instance relay bus
  // (`@qontinui/ui-bridge` RedisRelayBus, used by lib/ui-bridge/relay.ts).
  // It's loaded via a variable-specifier dynamic import so the SDK stays
  // optional-dep-clean, but that defeats @vercel/nft tracing — so without
  // this the package is absent from the serverless bundle and the bus dies
  // with `Cannot find module 'ioredis'`, silently degrading to per-lambda
  // in-memory state (the relay instance-skew). Externalizing it forces
  // ioredis (+ its transitive deps) into the standalone output.
  serverExternalPackages: ['ioredis'],
  // Belt-and-suspenders to the static `import "ioredis"` trace-anchor in
  // lib/ui-bridge/relay.ts: force ioredis + its transitive deps into the
  // serverless function trace for the relay route, in case nft still can't
  // follow the reference. `serverExternalPackages` alone was insufficient —
  // it keeps the package external but still relies on nft tracing to COPY it,
  // and the SDK's variable-specifier dynamic require leaves no literal for nft
  // to follow. Without ioredis present at runtime the cross-instance relay bus
  // dies (`Cannot find module 'ioredis'`) and the co-pilot navigate is accepted
  // but never delivered to the tab (verified on prod via Vercel logs 2026-06-07).
  outputFileTracingIncludes: {
    '/api/ui-bridge/[...path]': [
      './node_modules/ioredis/**/*',
      './node_modules/@ioredis/**/*',
      './node_modules/cluster-key-slot/**/*',
      './node_modules/denque/**/*',
      './node_modules/redis-errors/**/*',
      './node_modules/redis-parser/**/*',
      './node_modules/standard-as-callback/**/*',
      './node_modules/debug/**/*',
    ],
  },
  // Note: @qontinui/ui-bridge uses file: reference (junction on Windows).
  // Do NOT add to transpilePackages — SWC cannot follow Windows junctions.
  // The package dist is pre-compiled so transpilation is unnecessary.
  //
  // @qontinui/cloud-control is the opposite case and DOES belong here: it
  // ships raw .ts/.tsx with no build step, no emitted JavaScript and no
  // tsconfig of its own, because it is designed to compile INSIDE this app.
  // Compiling it in the host graph is also what makes its own `@/...`
  // imports (`@/lib/extension-slots`, `@/services/service-factory`) resolve —
  // that alias belongs to this app, not to the package. node_modules is
  // excluded from the SWC loader by default, so without this its sources
  // reach webpack untranspiled and the build dies on the first type
  // annotation. The junction caveat above does not bite: webpack's resolver
  // and Next's transpilePackages lookup both canonicalise the link to the
  // same real path, so the package's files land inside the loader's
  // `include` (verified by a composed `next build` on Windows).
  //
  // Empty in OSS-only builds, where the alias in `webpack()` below stands the
  // package down to a no-op instead.
  transpilePackages: cloudControlPresent ? [CLOUD_CONTROL_PKG] : [],
  webpack: (config, { dev }) => {
    // OSS-only build: no cloud-control overlay installed, so resolve the
    // package specifier to a local module that registers nothing. This is
    // what lets `src/components/cloud-extensions-boot.tsx` carry a plain
    // static `import "@qontinui/cloud-control"` in BOTH build shapes. The
    // loader it replaced used `import(/* webpackIgnore: true */ …)` to dodge
    // exactly this resolution — which is why it could never load the package
    // at all, and why its `.catch(() => {})` kept that silent.
    if (!cloudControlPresent) {
      config.resolve.alias[CLOUD_CONTROL_PKG] = path.resolve(
        __dirname,
        'src/cloud-absent/index.ts'
      );
    }

    // The route alias, on BOTH arms — present, it points into the linked
    // package's sources; absent, at the `cloud-absent/` mirror whose modules
    // call `notFound()` (or, for the two paths OSS already served, keep the
    // redirect they had). One entry, no runtime branch, and a cloud route
    // that gains no host `page.tsx` is caught by
    // `src/cloud-absent/cloud-route-shims.test.ts` rather than 404ing in
    // production.
    config.resolve.alias['@cloud'] = CLOUD_ALIAS_TARGET;

    // Only alias @qontinui/schemas when the local package exists (dev environment).
    // In CI/Vercel builds, the parent directory is not available. All schemas
    // imports are type-only (erased by SWC) so the alias is not needed in production.
    const schemasPath = path.resolve(__dirname, '../../qontinui-schemas/generated/typescript');
    if (fs.existsSync(schemasPath)) {
      config.resolve.alias['@qontinui/schemas'] = schemasPath;
    }

    // Ensure imports from linked packages outside the project tree (e.g.
    // ../../qontinui-workflow-ui/dist) can resolve their peer dependencies
    // from the frontend's own node_modules.
    config.resolve.modules = [
      path.resolve(__dirname, 'node_modules'),
      ...(config.resolve.modules || ['node_modules']),
    ];

    // Prevent duplicate library instances from symlinked packages
    // Note: React/react-dom aliases removed — they conflict with Next.js SSR runtime
    // which uses its own bundled React. Instead, delete react from symlinked packages'
    // node_modules so they resolve to the host app's copy naturally.
    config.resolve.alias['@xyflow/react'] = path.resolve(__dirname, 'node_modules/@xyflow/react');
    config.resolve.alias['@xyflow/system'] = path.resolve(__dirname, 'node_modules/@xyflow/system');

    // In dev mode, ignore noisy directories to prevent spurious HMR recompilations
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          '**/node_modules',
          '**/.git',
          '**/test-results',
          '**/playwright-report',
          path.resolve(__dirname, '../../.dev-logs'),
        ],
        // Increase poll interval to reduce file system load on Windows
        poll: false,
        aggregateTimeout: 500,
      };
    }

    return config;
  },
  // Prevent Next.js from stripping trailing slashes on API routes
  // FastAPI requires trailing slashes on some endpoints
  skipTrailingSlashRedirect: true,
  async redirects() {
    return [
      // app.qontinui.io is NOT a separate app surface — qontinui.io is
      // canonical. 308-redirect the whole host to it. Keeping app.* as a
      // live login surface would require a parallel Cognito callback /
      // backend TrustedHost / CORS allow-list that silently drifts out of
      // sync (it already did: redirect_mismatch + a blank /operations). A
      // single canonical surface + a redirect is the drift-proof end state.
      // `has: host` scopes this to app.qontinui.io only; qontinui.io is
      // untouched (same deployment serves both domains).
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'app.qontinui.io' }],
        destination: 'https://qontinui.io/:path*',
        permanent: true,
      },
      // Phase 4B: /runners/fleet was folded into /runners (single page,
      // tabbed Online + Sessions + Auth Tokens).
      {
        source: '/runners/fleet',
        destination: '/runners',
        permanent: true,
      },
      // Phase 4B: /dev-dashboard was renamed to /operations (first-class
      // user-facing fleet view).
      {
        source: '/dev-dashboard',
        destination: '/operations',
        permanent: true,
      },
      // Plan `2026-08-20-fleet-served-agent-skills.md` Phase 3:
      // `/settings/agent-commands` was an ACCOUNT-only editor over a corpus
      // that now has a fleet layer as well, and the operator console owns both.
      // Retired in the same change that added `/admin/coord/agent-commands` —
      // two editors over one corpus is how the two diverge. The old feature dir
      // is deleted, so this is the only thing mounted at the old path.
      {
        source: '/settings/agent-commands',
        destination: '/admin/coord/agent-commands',
        permanent: true,
      },
      // Plan 2026-08-25-coord-console-intent-and-devops-sections Phase 4:
      // /admin/coord/fleet became /admin/coord/pipeline. The tab has been
      // labelled "Pipeline" since the 2026-07-14 redesign, and after that
      // phase "fleet" means Dev Ops — two meanings for one word in one
      // console is the predictability cost the console style guide exists to
      // prevent. Bookmarks and older Spec-CI targets land on the new path.
      {
        source: '/admin/coord/fleet',
        destination: '/admin/coord/pipeline',
        permanent: true,
      },
      // NOTE: `/admin` -> `/admin/architecture` used to live here. A
      // `redirects()` entry is matched before the filesystem, so it shadowed
      // any page mounted at `/admin` — including cloud-control's admin
      // dashboard, which the extension surface had been registering (into a
      // registry nothing read) since it existed. The redirect moved into
      // `src/cloud-absent/routes/admin/page.tsx`, so OSS-only builds still
      // land on `/admin/architecture` (same destination, same 307) while the
      // composed build renders the cloud page. See
      // docs/composed-cloud-build.md.
    ]
  },
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Warning: This allows production builds to successfully complete even if
    // your project has type errors.
    ignoreBuildErrors: true,
  },
  async headers() {
    return [
      {
        // API routes proxy to the backend which has its own CORS middleware.
        // These headers cover preflight for the Next.js proxy layer itself.
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,OPTIONS,PATCH,DELETE,POST,PUT' },
          { key: 'Access-Control-Allow-Headers', value: 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization' },
        ],
      },
      {
        // UI Bridge SDK endpoints - allow external client access (runner, dev tools).
        // No credentials needed - these are tool-to-tool calls, not browser sessions.
        source: '/__ui-bridge__/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,OPTIONS,PATCH,DELETE,POST,PUT' },
          { key: 'Access-Control-Allow-Headers', value: 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization' },
        ],
      },
      {
        // Service worker must never be cached by the browser or any
        // intermediate proxy — otherwise users get stuck on an old SW for
        // up to 24h after a deploy. The SW itself controls cache lifetime
        // for all other static assets via the build-id token in CACHE_NAME.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
          { key: 'Expires', value: '0' },
        ],
      },
    ]
  },
  async rewrites() {
    return {
      // beforeFiles rewrites are checked before pages/public files
      // allowing them to override page routes
      beforeFiles: [
        // UI Bridge SDK endpoint rewrite - allows external clients to access at /__ui-bridge__
        {
          source: '/__ui-bridge__/:path*',
          destination: '/api/ui-bridge/:path*',
        },
        // VGA canonical JSON export — UI and external tools fetch
        // `/api/vga/state/<uuid>.json` and round-trip via the import
        // endpoint. Next.js App Router doesn't support `.json` as part
        // of a dynamic segment, so we rewrite to a plain subroute.
        {
          source: '/api/vga/state/:id.json',
          destination: '/api/vga/state/:id/export',
        },
        // UI Bridge control endpoint rewrite for build pages.
        // The runner constructs health-check/snapshot URLs by appending /control/:path
        // to the page URL (e.g., /build/page-sweep/control/snapshot). Rewrite these
        // to the actual UI Bridge API routes.
        {
          source: '/build/:page/control/:path*',
          destination: '/api/ui-bridge/control/:path*',
        },
      ],
      // afterFiles rewrites are checked after pages/public files
      // but before dynamic routes - this is the default behavior
      afterFiles: [
        // qontinui-coord proxy. Browser hits /coord-api/<path>, Next.js
        // forwards server-side to ${COORD_URL}/coord/<path>. Avoids
        // browser CORS without requiring CORS headers on the coord
        // service.
        {
          source: '/coord-api/:path*',
          destination: `${COORD_URL}/coord/:path*`,
        },
        // Exclude paths that have custom API route handlers
        // These routes read cookies and forward to backend with Bearer token
        {
          source: '/api/v1/users/me/automation-streaming/:path*',
          destination: '/api/v1/users/me/automation-streaming/:path*',
          has: [{ type: 'header', key: 'x-skip-rewrite' }], // Never matches, effectively skips
        },
      ],
      // fallback rewrites are checked after both pages/public files
      // and dynamic routes
      fallback: [
        // Exclude paths that have custom API route handlers requiring cookie auth
        // These routes read HttpOnly cookies and forward to backend with Bearer token
        // Without exclusion, the fallback rewrite would proxy without auth headers
        {
          source: '/api/v1/ai-tasks',
          destination: '/api/v1/ai-tasks', // No rewrite - use API route handler
        },
        {
          source: '/api/v1/ai-tasks/:path*',
          destination: '/api/v1/ai-tasks/:path*', // No rewrite - use API route handlers
        },
        {
          source: '/api/:path*',
          destination: `${BACKEND_URL}/api/:path*`, // Proxy to Backend (uses env var in production)
        },
      ],
    }
  },
}

export default withBundleAnalyzer(nextConfig);
