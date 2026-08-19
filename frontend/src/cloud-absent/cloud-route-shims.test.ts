/**
 * The route-mounting guard for the `@cloud` build-time alias.
 *
 * Under option D of the route-mounting plan, "is this cloud route reachable"
 * is a BUILD-TIME fact: each registered path is a `page.tsx` under
 * `src/app/` re-exporting through `@cloud`, which webpack resolves to
 * cloud-control's sources when the composed-build overlay is installed and to
 * `src/cloud-absent/` when it is not. So the assertions here are build-time
 * facts too — file existence and specifier text — rather than a runtime
 * registry read.
 *
 * That matters because the guard originally proposed for this — assert
 * `getSlots().appRoutes` is non-empty — would have passed on the server while
 * the browser registry stayed empty, so it never covered the actual bug. The
 * four things that CAN go wrong with option D are:
 *
 *   1. cloud-control registers a route and no host shim is added — the route
 *      404s in the cloud deployment, silently. `mirrors cloud-control's
 *      appRoutes inventory exactly` fails loudly on it, in the composed CI
 *      job that has cloud-control checked out.
 *   2. a shim exists but the `cloud-absent/` mirror does not — the OSS build
 *      fails to resolve `@cloud/...`. Caught in both shapes.
 *   3. the stubs stop being stubs — an OSS build serving something other
 *      than a 404 (or, for the two paths OSS already served, their redirect).
 *      Caught by actually invoking them through the alias, OSS-only.
 *   4. a cloud route stops being server-renderable — the one property option
 *      D was chosen for, and the one a registry-based mount could never have
 *      had. Caught by rendering one through `react-dom/server`, composed-only.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// Only the two throw-to-unwind functions are replaced; everything else
// (`useRouter`, `useParams`, `useSearchParams`, …) stays real, because the
// composed server-render case below pulls a cloud route whose dependency
// graph uses them.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

const FRONTEND = process.cwd();
const OVERLAY = path.resolve(FRONTEND, "node_modules/@qontinui/cloud-control");
const composed = fs.existsSync(path.join(OVERLAY, "package.json"));

type Shim = {
  /** The path cloud-control registers in `appRoutes`. */
  route: string;
  /** Module specifier suffix: `@cloud/<module>`. */
  module: string;
  /** Host `page.tsx`, relative to `src/app/`. */
  page: string;
  /** What the OSS `cloud-absent/` stub does. */
  absent: { kind: "notFound" } | { kind: "redirect"; to: string };
};

const NOT_FOUND = { kind: "notFound" } as const;

/**
 * The inventory, in cloud-control's registration order. `:id` becomes an App
 * Router `[id]` segment; everything else is a literal path. Kept as data so
 * the composed case can diff it against cloud-control's own array instead of
 * trusting it.
 */
const SHIMS: Shim[] = [
  {
    route: "/billing/success",
    module: "routes/billing/success",
    page: "(app)/billing/success/page.tsx",
    absent: NOT_FOUND,
  },
  {
    route: "/billing/canceled",
    module: "routes/billing/canceled",
    page: "(app)/billing/canceled/page.tsx",
    absent: NOT_FOUND,
  },
  {
    route: "/pricing",
    module: "routes/pricing",
    page: "(app)/pricing/page.tsx",
    absent: NOT_FOUND,
  },
  {
    route: "/admin",
    module: "routes/admin/page",
    page: "(app)/admin/page.tsx",
    // Not a 404: OSS `/admin` redirected to `/admin/architecture` from
    // next.config.mjs `redirects()`, which shadowed any page mounted here.
    // The redirect moved into the stub so self-hosters keep the entry point
    // to a live admin section. See the stub's own docstring.
    absent: { kind: "redirect", to: "/admin/architecture" },
  },
  {
    route: "/admin/mobile",
    module: "routes/admin/mobile/page",
    page: "(app)/admin/mobile/page.tsx",
    absent: NOT_FOUND,
  },
  {
    route: "/organizations",
    module: "routes/organizations/page",
    page: "(app)/organizations/page.tsx",
    // Also not a 404: this path has always redirected to /settings/account
    // in OSS, where the self-hosted org affordances live.
    absent: { kind: "redirect", to: "/settings/account" },
  },
  {
    route: "/organizations/new",
    module: "routes/organizations/new/page",
    page: "(app)/organizations/new/page.tsx",
    absent: NOT_FOUND,
  },
  {
    route: "/organizations/:id",
    module: "routes/organizations/[id]/page",
    page: "(app)/organizations/[id]/page.tsx",
    absent: NOT_FOUND,
  },
  {
    route: "/organizations/:id/members",
    module: "routes/organizations/[id]/members/page",
    page: "(app)/organizations/[id]/members/page.tsx",
    absent: NOT_FOUND,
  },
  {
    route: "/organizations/:id/settings",
    module: "routes/organizations/[id]/settings/page",
    page: "(app)/organizations/[id]/settings/page.tsx",
    absent: NOT_FOUND,
  },
  {
    route: "/invitations/accept",
    module: "routes/invitations/accept/page",
    page: "(app)/invitations/accept/page.tsx",
    absent: NOT_FOUND,
  },
];

/**
 * Static specifiers, so the bundler can see them. A variable specifier would
 * make `import()` unanalyzable and these would resolve at runtime against the
 * wrong root. Only evaluated in the OSS shape — in the composed one these
 * pull cloud-control's real pages, which is not what this case is about.
 */
const STUB_IMPORTS: Record<string, () => Promise<{ default: () => never }>> = {
  "routes/billing/success": () => import("@cloud/routes/billing/success"),
  "routes/billing/canceled": () => import("@cloud/routes/billing/canceled"),
  "routes/pricing": () => import("@cloud/routes/pricing"),
  "routes/admin/page": () => import("@cloud/routes/admin/page"),
  "routes/admin/mobile/page": () => import("@cloud/routes/admin/mobile/page"),
  "routes/organizations/page": () => import("@cloud/routes/organizations/page"),
  "routes/organizations/new/page": () =>
    import("@cloud/routes/organizations/new/page"),
  "routes/organizations/[id]/page": () =>
    import("@cloud/routes/organizations/[id]/page"),
  "routes/organizations/[id]/members/page": () =>
    import("@cloud/routes/organizations/[id]/members/page"),
  "routes/organizations/[id]/settings/page": () =>
    import("@cloud/routes/organizations/[id]/settings/page"),
  "routes/invitations/accept/page": () =>
    import("@cloud/routes/invitations/accept/page"),
};

/**
 * cloud-control's `appRoutes` array, read from source rather than imported.
 *
 * NOTE for whoever deletes `appRoutes` (plan phase 5, "retire the dead half of
 * ExtensionSlots"): this throws when the array is gone, which is the correct
 * loud failure — it means the inventory this table is diffed against no longer
 * exists and the guard needs a new source of truth (the `routes/` directory
 * listing is the obvious one). Do not delete the test with the array.
 *
 * Read from source rather than imported because:
 * the array is a `lazy(() => import(...))` table whose evaluation would drag
 * the package's whole module graph into this test, and the only facts wanted
 * here are the registered path and the module it points at.
 */
function readRegisteredAppRoutes(): Array<{ route: string; module: string }> {
  const source = fs.readFileSync(
    path.join(OVERLAY, "frontend/src/index.ts"),
    "utf8"
  );
  const block = /appRoutes:\s*\[([\s\S]*?)\n {2}\],/.exec(source);
  if (!block?.[1]) {
    throw new Error(
      "could not locate the appRoutes array in cloud-control's frontend/src/index.ts"
    );
  }
  const entries = [
    ...block[1].matchAll(/path:\s*"([^"]+)",[\s\S]*?import\("\.\/([^"]+)"\)/g),
  ];
  return entries.map((m) => ({ route: m[1]!, module: m[2]! }));
}

describe("cloud route shims", () => {
  it.skipIf(!composed)(
    "mirrors cloud-control's appRoutes inventory exactly",
    () => {
      const registered = readRegisteredAppRoutes();

      // Sanity: the parse found something. A regex that silently matched
      // nothing would make the comparison below vacuous.
      expect(registered.length).toBeGreaterThan(0);

      // Both directions in one assertion: a cloud route with no host shim
      // AND a host shim for a route cloud-control no longer registers.
      expect(registered).toEqual(
        SHIMS.map(({ route, module }) => ({ route, module }))
      );
    }
  );

  it("has a host page.tsx re-exporting each route through @cloud", () => {
    for (const shim of SHIMS) {
      const file = path.resolve(FRONTEND, "src/app", shim.page);
      expect(fs.existsSync(file), `missing host page: ${shim.page}`).toBe(true);
      expect(fs.readFileSync(file, "utf8")).toContain(
        `export { default } from "@cloud/${shim.module}";`
      );
    }
  });

  it("has a cloud-absent stub for each route", () => {
    for (const shim of SHIMS) {
      const file = path.resolve(
        FRONTEND,
        "src/cloud-absent",
        `${shim.module}.tsx`
      );
      expect(
        fs.existsSync(file),
        `missing OSS stub: src/cloud-absent/${shim.module}.tsx`
      ).toBe(true);
    }
  });

  // 263 `page.tsx` files get read here. That is ~1.5s of I/O standalone, but
  // it runs inside a worker that has just pulled cloud-control's module graph
  // through vite, and it tripped the file-wide 20s default under that
  // contention. Its own ceiling rather than a raise for all 2500 tests.
  it("mounts every host page that imports @cloud", () => {
    // The reverse of the two cases above: a `page.tsx` that re-exports
    // through @cloud but is missing from SHIMS would escape all of them.
    const app = path.resolve(FRONTEND, "src/app");
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (
          entry.name === "page.tsx" &&
          fs.readFileSync(full, "utf8").includes('from "@cloud/')
        ) {
          found.push(path.relative(app, full).split(path.sep).join("/"));
        }
      }
    };
    walk(app);

    expect(found.sort()).toEqual(SHIMS.map((s) => s.page).sort());
  }, 60_000);

  it.skipIf(!composed)(
    "server-renders a mounted cloud route (composed build)",
    async () => {
      // The reason option D was chosen over every registry-based option is
      // that it keeps cloud routes server-renderable: the module a cloud
      // path resolves to is decided by the bundler, so it lands in the
      // SERVER graph like any other page. A `getSlots()` lookup cannot —
      // the registry only exists behind a client boundary.
      //
      // So render one through the same `@cloud` specifier `src/app/`'s shim
      // uses, with react-dom's SERVER renderer, and assert on the markup.
      // `/pricing` is the route with no provider requirements; the others
      // need the app shell's contexts, and the property under test is the
      // resolution path, which they all share.
      const { renderToStaticMarkup } = await import("react-dom/server");
      const { createElement } = await import("react");
      const PricingPage = (await import("@cloud/routes/pricing")).default;

      const html = renderToStaticMarkup(createElement(PricingPage));

      // First-paint markup only: the tier CTAs read "Loading…" until the
      // `getSubscription()` effect resolves, so asserting on them would be
      // asserting on client behaviour. These are what the SERVER emits.
      expect(html).toContain("Choose Your Plan");
      expect(html).toContain('data-testid="pricing-tier-hobby"');
      expect(html).toContain('data-testid="pricing-tier-pro"');
      expect(html).toContain(
        "All plans include core automation features and JSON export."
      );
    },
    120_000
  );

  it.skipIf(composed)(
    "resolves @cloud to the cloud-absent stubs in the OSS build",
    async () => {
      for (const shim of SHIMS) {
        const load = STUB_IMPORTS[shim.module];
        expect(load, `no stub import registered for ${shim.module}`).toBeTypeOf(
          "function"
        );
        const stub = await load!();
        expect(() => stub.default()).toThrowError(
          shim.absent.kind === "notFound"
            ? "NEXT_NOT_FOUND"
            : `NEXT_REDIRECT:${shim.absent.to}`
        );
      }
    },
    // Eleven dynamic imports through the alias, each transformed on demand.
    // ~12s observed; the file-wide 20s default is too close to it.
    60_000
  );
});
