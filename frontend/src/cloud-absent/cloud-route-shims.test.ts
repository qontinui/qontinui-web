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
 * That matters because the guard originally proposed for this — assert the
 * registry's `appRoutes` is non-empty — would have passed on the server while
 * the browser registry stayed empty, so it never covered the actual bug.
 * That array has since been deleted outright; the inventory both sides are
 * diffed against is now each repo's filesystem. The
 * four things that CAN go wrong with option D are:
 *
 *   1. cloud-control ships a route and no host shim is added — the route
 *      404s in the cloud deployment, silently. `mirrors cloud-control's
 *      route modules exactly` fails loudly on it, in the composed CI job
 *      that has cloud-control checked out.
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

type Absent = { kind: "notFound" } | { kind: "redirect"; to: string };

type Shim = {
  /** Module specifier suffix: `@cloud/<module>`. Everything else derives. */
  module: string;
  /** The URL path this route serves. Derived. */
  route: string;
  /** Host `page.tsx`, relative to `src/app/`. Derived. */
  page: string;
  /** What the OSS `cloud-absent/` stub does. */
  absent: Absent;
};

const NOT_FOUND = { kind: "notFound" } as const;

/**
 * One module specifier decides the other two fields.
 *
 * They used to be three hand-written strings, which meant a `SHIMS` row could
 * be internally inconsistent and still go green: the composed case checks
 * `module` against cloud-control's tree and another case checks `page`
 * against the host's, but nothing compared the two to each other, and `route`
 * was never asserted on at all. A row mapping `routes/billing/page` to
 * `(app)/pricing/page.tsx` satisfied both walks, because both files exist.
 *
 * Deriving removes the class. The two rules every route obeys:
 *   module `routes/<p>/page`  ->  page `(app)/<p>/page.tsx`
 *                             ->  route `/<p>`, with `[id]` written `:id`
 */
function shim(module: string, absent: Absent = NOT_FOUND): Shim {
  const rel = module.replace(/^routes\//, "").replace(/\/page$/, "");
  return {
    module,
    page: `(app)/${rel}/page.tsx`,
    route: "/" + rel.replace(/\[([^\]]+)\]/g, ":$1"),
    absent,
  };
}

/**
 * The inventory, in cloud-control's registration order. `:id` becomes an App
 * Router `[id]` segment; everything else is a literal path. Kept as data so
 * the composed case can diff it against cloud-control's own array instead of
 * trusting it.
 */
const SHIMS: Shim[] = [
  shim("routes/billing/page"),
  shim("routes/billing/success/page"),
  shim("routes/billing/canceled/page"),
  shim("routes/pricing/page"),
  // Not a 404: OSS `/admin` redirected to `/admin/architecture` from
  // next.config.mjs `redirects()`, which shadowed any page mounted here. The
  // redirect moved into the stub so self-hosters keep the entry point to a
  // live admin section. See the stub's docstring for the two cosmetic
  // differences that move introduces.
  shim("routes/admin/page", { kind: "redirect", to: "/admin/architecture" }),
  shim("routes/admin/mobile/page"),
  // Also not a 404: this path has always redirected to /settings/account in
  // OSS, where the self-hosted org affordances live.
  shim("routes/organizations/page", {
    kind: "redirect",
    to: "/settings/account",
  }),
  shim("routes/organizations/new/page"),
  shim("routes/organizations/[id]/page"),
  shim("routes/organizations/[id]/members/page"),
  shim("routes/organizations/[id]/settings/page"),
  shim("routes/invitations/accept/page"),
];

/**
 * Static specifiers, so the bundler can see them. A variable specifier would
 * make `import()` unanalyzable and these would resolve at runtime against the
 * wrong root. Only evaluated in the OSS shape — in the composed one these
 * pull cloud-control's real pages, which is not what this case is about.
 */
const STUB_IMPORTS: Record<string, () => Promise<{ default: () => never }>> = {
  "routes/billing/page": () => import("@cloud/routes/billing/page"),
  "routes/billing/success/page": () =>
    import("@cloud/routes/billing/success/page"),
  "routes/billing/canceled/page": () =>
    import("@cloud/routes/billing/canceled/page"),
  "routes/pricing/page": () => import("@cloud/routes/pricing/page"),
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
 * Route modules cloud-control ships, taken from its `routes/` tree.
 *
 * This replaced a regex over the package's old `appRoutes` array when plan
 * phase 5 deleted that array (it never worked — Next resolves the App Router
 * from the filesystem at build time, so a runtime array of routes could not
 * become URLs). The filesystem is now the source of truth on BOTH sides,
 * which is the point: the thing being compared is the thing that decides.
 *
 * The contract, stated in cloud-control's `frontend/src/index.ts` header:
 * every route is `routes/<path>/page.tsx`, mirroring the App Router.
 * Supporting modules use any other name, or live in `_`-prefixed folders.
 * A route added as `routes/foo.tsx` is therefore invisible here — hence the
 * rename of `pricing.tsx` / `billing/{success,canceled}.tsx` into that shape
 * when this guard was written.
 */
function readCloudRouteModules(): string[] {
  return walkRouteFiles()
    .filter((f) => f.endsWith("/page"))
    .sort();
}

/**
 * Every App-Router-significant file under cloud-control's `routes/`, as module
 * specifiers with the extension stripped.
 *
 * Deliberately wider than `page.tsx`. Next treats a whole family of filenames
 * as routing conventions - `route`, `layout`, `loading`, `error`,
 * `not-found`, `template`, `default` - and a `page` in any of `.tsx` / `.ts` /
 * `.jsx` / `.mdx`. A walk that recognised only `page.tsx` would let a cloud
 * route ship a `loading.tsx` (or a `route.ts` API handler) that the host never
 * mounts and nothing anywhere reports. The inventory case takes only the
 * `page` entries; `refuses route conventions the shim cannot forward` rejects
 * the rest loudly, because a shim re-exports a module's default and has no
 * answer for a per-segment convention file.
 */
const ROUTE_CONVENTIONS = [
  "page",
  "route",
  "layout",
  "loading",
  "error",
  "not-found",
  "template",
  "default",
];
const ROUTE_FILE = new RegExp(
  `^(${ROUTE_CONVENTIONS.join("|")})[.](tsx|ts|jsx|js|mdx)$`
);

function walkRouteFiles(): string[] {
  const root = path.join(OVERLAY, "frontend/src/routes");
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      // Private FOLDERS only. The old check also skipped files, which would
      // have hidden an `_page.tsx` typo instead of surfacing it.
      if (entry.isDirectory() && entry.name.startsWith("_")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (ROUTE_FILE.test(entry.name)) {
        found.push(
          "routes/" +
            path
              .relative(root, full)
              .split(path.sep)
              .join("/")
              .replace(/\.(tsx|ts|jsx|js|mdx)$/, "")
        );
      }
    }
  };
  walk(root);
  return found.sort();
}

/**
 * Route modules that exist in cloud-control but are deliberately NOT mounted.
 *
 * Every entry needs a reason, and the reason has to be a decision rather than
 * an omission — an unmounted route is invisible in the running app, so this
 * list is the only place the choice is recorded.
 */
const UNMOUNTED: Record<string, string> = {
  // qontinui-web serves a 92-line privacy policy at /privacy to every
  // deployment. cloud-control's is a different 326-line document about the
  // hosted service's data handling, and which one binds hosted users is a
  // legal call, open in the plan's "Open questions". Mounting it by default
  // would be answering that question silently.
  "routes/privacy/page":
    "pending a legal decision on which privacy policy binds hosted users",
};

describe("cloud route shims", () => {
  // H1. The `@cloud` mapping lives in `tsconfig.typecheck.json` and MUST NOT
  // reappear in `tsconfig.json`: Next hands tsconfig `paths` to webpack as
  // `JsConfigPathsPlugin`, which resolves on the `described-resolve` hook,
  // strictly BEFORE the built-in alias plugin runs on `raw-resolve`. A
  // `@cloud/*` entry there therefore wins over `config.resolve.alias` and
  // silently resolves every composed build back to the OSS stubs.
  //
  // Every other gate is blind to it. `npm run type-check` reads
  // tsconfig.typecheck.json, whose `paths` REPLACES the base's wholesale (tsc
  // merges compilerOptions key by key), so tsc never sees the rogue entry;
  // vitest declares its own alias; and `next build` succeeds while serving
  // the wrong modules, with `typescript.ignoreBuildErrors` on besides. The
  // invariant needs an assertion of its own or it is prose only.
  it("keeps @cloud out of tsconfig.json paths", () => {
    const base = JSON.parse(
      fs.readFileSync(path.resolve(FRONTEND, "tsconfig.json"), "utf8")
    ) as { compilerOptions?: { paths?: Record<string, unknown> } };
    const offenders = Object.keys(base.compilerOptions?.paths ?? {}).filter(
      (k) => k.startsWith("@cloud")
    );
    expect(
      offenders,
      "move these to tsconfig.typecheck.json - see its header for why"
    ).toEqual([]);
  });

  // Which shape a run is in decides which cases below are skipped, and
  // nothing asserted it. The composed CI job sets QONTINUI_COMPOSED_BUILD=1,
  // so a job whose overlay silently failed to link now fails here instead of
  // going green with every composed case quietly skipped.
  it("agrees with CI about which build shape this is", () => {
    const declared = process.env.QONTINUI_COMPOSED_BUILD;
    if (declared === undefined) return; // local run, nothing declared
    expect(
      composed,
      `QONTINUI_COMPOSED_BUILD=${declared} but the overlay is ${
        composed ? "present" : "ABSENT"
      } at ${OVERLAY}`
    ).toBe(declared === "1");
  });

  it.skipIf(!composed)(
    "mirrors cloud-control's route modules exactly",
    () => {
      const shipped = readCloudRouteModules();

      // Sanity: the walk found something. An empty result — a moved
      // directory, a bad OVERLAY path — would make the comparison vacuous.
      expect(shipped.length).toBeGreaterThan(0);

      // Both directions in one assertion: a cloud route with no host shim
      // AND a host shim for a route cloud-control no longer ships. Anything
      // deliberately left unmounted has to say so in UNMOUNTED.
      const expected = [
        ...SHIMS.map((s) => s.module),
        ...Object.keys(UNMOUNTED),
      ].sort();

      // Say WHICH REPO owns the drift, and which way to fix it.
      //
      // Two sorted string arrays diffed by vitest tell a reader nothing about
      // that, and this assertion is read in two places with opposite answers:
      // in cloud-control's `composed-typecheck` (the PR that added the route)
      // and in qontinui-web's `composed-cloud-build`, where it can still fire
      // on `main` because that job reads cloud-control's default branch and a
      // route can land there while a web PR is in flight. Somebody looking at
      // a red `main` here is looking at a diff that cannot contain the cause,
      // and the correct move is a shim in THIS repo, never a revert in the
      // other one.
      const unshimmed = shipped.filter((m) => !expected.includes(m));
      const orphaned = expected.filter((m) => !shipped.includes(m));
      const drift = [
        unshimmed.length > 0 &&
          `cloud-control ships ${unshimmed.join(", ")} with no host shim in ` +
            `qontinui-web. FIX HERE, not there: add src/app/(app)/<path>/page.tsx, ` +
            `src/cloud-absent/routes/<path>/page.tsx, and the SHIMS + STUB_IMPORTS ` +
            `rows in this file — or an UNMOUNTED entry with a reason. Do NOT ` +
            `revert the cloud-control route.`,
        orphaned.length > 0 &&
          `qontinui-web still lists ${orphaned.join(", ")}, which cloud-control ` +
            `no longer ships. FIX HERE: drop the shim, the cloud-absent stub and ` +
            `the SHIMS/STUB_IMPORTS (or UNMOUNTED) rows.`,
      ]
        .filter((line): line is string => typeof line === "string")
        .join("\n");

      expect(
        shipped,
        `cloud route inventory drift — the inventory came from cloud-control's ` +
          `frontend/src/routes/ tree at ${OVERLAY}.\n${drift}`
      ).toEqual(expected);
    }
  );

  it.skipIf(!composed)("has no stale UNMOUNTED entries", () => {
    // Two properties, and the second is not implied by the inventory case
    // above (which fails on a stale key too, but only as one half of an
    // array-equality mismatch that says nothing about which half is wrong):
    // the module still exists, AND it is genuinely unmounted rather than an
    // entry someone forgot to delete when they added its shim.
    const shipped = new Set(readCloudRouteModules());
    const mounted = new Set(SHIMS.map((sh) => sh.module));
    for (const [module, reason] of Object.entries(UNMOUNTED)) {
      expect(
        shipped.has(module),
        `UNMOUNTED names ${module} (${reason}) but cloud-control no longer ships it - delete the entry`
      ).toBe(true);
      expect(
        mounted.has(module),
        `${module} is in UNMOUNTED and also has a shim, so it IS mounted - delete the UNMOUNTED entry`
      ).toBe(false);
    }
  });

  // A shim re-exports a module's `default`. That works for `page`; it has no
  // meaning for `layout` / `loading` / `error` / `route` / the rest, which
  // Next resolves per-segment from the HOST's tree. Shipping one in
  // cloud-control is silently inert, so refuse it at build time rather than
  // let someone write a `loading.tsx` that never renders.
  it.skipIf(!composed)(
    "refuses route conventions the shim cannot forward",
    () => {
      const unforwardable = walkRouteFiles().filter(
        (f) => !f.endsWith("/page")
      );
      expect(
        unforwardable,
        "the @cloud shim forwards `default` only; these files would never take effect"
      ).toEqual([]);
    }
  );

  // Route segment config (`metadata`, `dynamic`, `revalidate`, ...) is read by
  // Next off the page module IN THE SERVER GRAPH - which is the shim, not the
  // module it re-exports. An `export const dynamic` in cloud-control is inert
  // unless the shim forwards it BY NAME. Harmless today only because the root
  // layout forces dynamic app-wide; an export that looks live and is not is
  // exactly the trap docs/composed-cloud-build.md warns about.
  it.skipIf(!composed)(
    "forwards any route segment config a cloud page declares",
    () => {
      const SEGMENT_CONFIG =
        /^export\s+(?:const|async\s+function|function)\s+(dynamic|dynamicParams|revalidate|fetchCache|runtime|preferredRegion|maxDuration|generateStaticParams|metadata|generateMetadata)\b/;
      for (const sh of SHIMS) {
        const cloudFile = path.join(
          OVERLAY,
          "frontend/src",
          `${sh.module}.tsx`
        );
        if (!fs.existsSync(cloudFile)) continue;
        const declared = fs
          .readFileSync(cloudFile, "utf8")
          .split(/\r?\n/)
          .map((line) => SEGMENT_CONFIG.exec(line)?.[1])
          .filter((name): name is string => Boolean(name));
        if (declared.length === 0) continue;
        const shimSource = fs.readFileSync(
          path.resolve(FRONTEND, "src/app", sh.page),
          "utf8"
        );
        for (const name of declared) {
          expect(
            shimSource.includes(name),
            `${sh.module} exports \`${name}\` but ${sh.page} does not re-export it, so Next never sees it`
          ).toBe(true);
        }
      }
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
      // SERVER graph like any other page. A runtime registry lookup cannot —
      // the registry only exists behind a client boundary.
      //
      // So render one through the same `@cloud` specifier `src/app/`'s shim
      // uses, with react-dom's SERVER renderer, and assert on the markup.
      // `/pricing` is the route with no provider requirements; the others
      // need the app shell's contexts, and the property under test is the
      // resolution path, which they all share.
      const { renderToStaticMarkup } = await import("react-dom/server");
      const { createElement } = await import("react");
      const PricingPage = (await import("@cloud/routes/pricing/page")).default;

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
    // One dynamic import per shim through the alias, each transformed on
    // demand.
    // ~12s observed; the file-wide 20s default is too close to it.
    60_000
  );
});
