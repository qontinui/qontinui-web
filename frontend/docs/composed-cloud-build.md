# The composed cloud build (`@qontinui/cloud-control`)

`qontinui-web/frontend` builds in two shapes:

| Shape | `@qontinui/cloud-control` | Who builds it |
|---|---|---|
| **OSS-only** (default) | absent | every `npm ci` / `npm run build`, CI, self-hosters |
| **Composed cloud** | linked into `node_modules` | the qontinui.io deployment, and anyone verifying cloud behaviour locally |

Nothing about the OSS shape changes when the composed shape exists: there is
one `package.json`, one `package-lock.json`, and `npm ci` installs exactly the
same tree it always did. The composed shape is one extra, explicit step.

## Turning it on

```bash
cd frontend
npm ci                  # unchanged; OSS-only tree
npm run cloud:install   # link the sibling checkout of qontinui-cloud-control
npm run build           # now a composed cloud build
```

`npm run cloud:status` reports which shape the tree is in, and
`npm run cloud:remove` puts it back to OSS-only. The link source defaults to
`../../qontinui-cloud-control` (a sibling checkout of this repo); override it
with `QONTINUI_CLOUD_CONTROL_PATH` or `-- --source <path>`.

`npm install` and `npm ci` prune the link as extraneous, so **re-run
`npm run cloud:install` after either.**

## How the two shapes are wired

Three pieces, all keyed off whether
`frontend/node_modules/@qontinui/cloud-control` exists:

1. **`scripts/cloud-control-overlay.mjs`** creates that path as a directory
   junction (Windows) or symlink (POSIX) pointing at a sibling
   `qontinui-cloud-control` checkout. It is the only switch.

2. **`next.config.mjs`** reads the path once at config load:
   - present → `transpilePackages: ["@qontinui/cloud-control"]`, so webpack
     compiles the package's raw `.ts`/`.tsx` **inside the host graph**. That
     is what makes the package's own `@/lib/extension-slots` and
     `@/services/service-factory` imports resolve — they are the host's
     alias, and the package deliberately has no tsconfig, no build step and
     no emitted JavaScript of its own.
   - absent → `config.resolve.alias["@qontinui/cloud-control"]` points at
     `src/cloud-absent/index.ts`, a module that exports nothing and registers
     nothing.

3. **`src/components/cloud-extensions-boot.tsx`** is a `"use client"` module
   with a plain static `import "@qontinui/cloud-control"`, rendered by the
   root layout. The `"use client"` directive is load-bearing: see below.

`src/cloud-absent/cloud-control.d.ts` declares the package ambiently so
`npm run type-check` is green in the OSS shape without a conditional tsconfig.

4. **`@cloud/*`**, the build-time route alias, resolved from the same switch:
   present → `node_modules/@qontinui/cloud-control/frontend/src`, absent →
   `src/cloud-absent`. This is what mounts cloud-control's routes; see
   *Mounting cloud routes* below.

Two more settings exist only because the overlay is a **link**, and both are
inert without one (`npm ci` creates no symlinks):

- `tsconfig.json` → `"preserveSymlinks": true`. Without it `tsc` canonicalises
  the link to a path outside this project, and every bare import inside the
  package (`react`, `lucide-react`, `next/navigation`, …) fails to resolve,
  because there is no `node_modules` above a sibling checkout. With it, the
  composed `npm run type-check` really does type-check cloud-control's sources
  under this app's `strict` settings — which is the point: the package has no
  tsconfig of its own and is otherwise never checked anywhere. (It found three
  real defects the first time it ran.)
- `vitest.config.ts` → the same `preserveSymlinks`, for the same reason, plus
  `server.deps.inline` so vitest transforms the package's raw `.ts`/`.tsx`
  instead of externalizing it to Node, and the same absent-case alias as
  `next.config.mjs`.

## Two things this replaced, and why they could never work

The loader this supersedes lived in `src/app/layout.tsx`:

```ts
const CLOUD_CONTROL_PKG = "@qontinui/cloud-control";
import(/* webpackIgnore: true */ CLOUD_CONTROL_PKG).catch(() => {});
```

- `webpackIgnore: true` takes the specifier **out of webpack's graph**, so
  Node resolved it at runtime against the package's `main`,
  `./frontend/src/index.ts` — a TypeScript file in a package that emits no
  JavaScript. `require` threw `ERR_UNKNOWN_FILE_EXTENSION`, and
  `.catch(() => {})` made that indistinguishable from "cloud-control is not
  installed". Opting out of webpack also opted out of the host's `@/*` alias,
  which the package's entry point needs, so the import could not have
  succeeded even with emitted JS. `webpackIgnore` is **mutually exclusive**
  with `transpilePackages`: the first exists to stop webpack resolving the
  specifier, and the second needs it to.

- `layout.tsx` is a **Server Component**, and it was the only import site of
  the package in the entire repo. A registration performed there fills the
  *server's* module instance of `src/lib/extension-slots.ts`. Every consumer
  is a client component — `components/navigation/sidebar/UnifiedSidebar.tsx`
  and its `_components/SidebarHeader.tsx` call `getComponent`,
  `services/service-factory.ts` calls `getService` — and reads a separate
  browser instance that stayed empty. Everything cloud-control registers is
  `"use client"` too, so a server-side Map of client components would not have
  been renderable from the client anyway.

Both failures were silent, which is why the extension surface shipped inert
and stayed that way. The regression guard against a recurrence is
`src/components/cloud-extensions-boot.registration.test.tsx`: it asserts on
slot **content** in a DOM environment, never on the absence of an error, and
covers both build shapes so it is never vacuously green.

## Mounting cloud routes (`@cloud/*`)

cloud-control used to register eleven routes into a runtime `appRoutes`
array. Every one of them was a 404 (or, for `/organizations`, a redirect away)
in every deployment, because the App Router is **file-system routed and
resolved at build time** and nothing read the registry. A route descriptor
pushed into a module-scoped array at runtime cannot shadow, replace or add a
route. That array — along with `marketingRoutes`, `navItems` and
`profilePanels` — has since been deleted outright.

So the routes are mounted the way the App Router actually works: one
`page.tsx` per path, re-exporting through a build-time alias.

```ts
// src/app/(app)/pricing/page.tsx
export { default } from "@cloud/routes/pricing/page";
```

| | Composed cloud | OSS-only |
|---|---|---|
| `@cloud` resolves to | `node_modules/@qontinui/cloud-control/frontend/src` | `src/cloud-absent` |
| `/pricing` renders | cloud-control's pricing page | `notFound()` → 404 |

No client boundary, no registry read, no loader race, and — the reason this
shape was chosen over a registry-driven catch-all or pane — SSR, per-route
`metadata` and server components all stay available to cloud routes. A
registry lookup forfeits all three by construction: the registry only ever
exists behind a client boundary.

The twelve paths, all under `(app)`:

```
/billing           /billing/success    /billing/canceled
/pricing
/admin             /admin/mobile
/organizations     /organizations/new  /organizations/[id]
/organizations/[id]/members            /organizations/[id]/settings
/invitations/accept
```

`/billing` is new: `navItems` advertised it and no route ever existed, so the
link 404'd in every deployment. It is now cloud-control's account-side billing
landing page (plan, limits, Stripe portal).

One route cloud-control ships is deliberately **not** mounted: `/privacy`.
qontinui-web serves a 92-line privacy policy at that path to every deployment,
cloud-control's is a different 326-line document about the hosted service, and
which one binds hosted users is a legal call rather than an engineering one.
It is recorded in `UNMOUNTED` in `cloud-route-shims.test.ts`, which is the
only place that choice is visible.

### The `cloud-absent/` mirror

`src/cloud-absent/` mirrors `qontinui-cloud-control/frontend/src/` path for
path — `@cloud/routes/organizations/[id]/page` is
`src/cloud-absent/routes/organizations/[id]/page.tsx`, and `@cloud/nav-items`
is `src/cloud-absent/nav-items.ts`. Each mirrored route
module default-exports a component that calls `notFound()`, with two
deliberate exceptions where OSS already served the path and 404ing it would
be a pure regression:

- **`/organizations`** redirects to `/settings/account`, which is what the
  OSS page at that path did unconditionally before it became a shim.
- **`/admin`** redirects to `/admin/architecture`. That redirect used to live
  in `next.config.mjs` `redirects()`, where it shadowed any page mounted at
  `/admin` — `redirects()` is matched ahead of the filesystem — so it had to
  move for cloud-control's admin dashboard to be reachable at all. OSS keeps
  the same destination and the same non-permanent redirect; the difference is
  that it is now conditional on the build shape. `/admin`'s OSS sub-pages
  (`architecture/`, `coord/**`, `datasets/`, `agent-claims/`,
  `agent-sessions/`, `region-analysis/`) were never affected either way: the
  redirect's `source` was the exact path `/admin`.

### Why `@cloud` is not in `tsconfig.json` `paths`

It looks like the obvious place for it, and putting it there breaks the
composed build **silently**. Next passes tsconfig `paths` to webpack as
`JsConfigPathsPlugin`, a user resolve plugin. enhanced-resolve applies user
plugins before its built-in ones, both tap `described-resolve`, and the hook
bails on the first tap that resolves — so a `@cloud/*` entry in
`tsconfig.json` wins over `config.resolve.alias` and every composed build
quietly resolves back to the OSS stubs. The build stays green and serves the
wrong thing.

`tsc` still needs a mapping, so it gets one in **`tsconfig.typecheck.json`**,
which extends `tsconfig.json` and which Next never reads.
`npm run type-check` points at it. Its two candidates are ordered
composed-first (`node_modules/@qontinui/cloud-control/frontend/src/*`, then
`src/cloud-absent/*`); TypeScript takes the first that exists on disk, which
is the same switch webpack performs. **A bare `npx tsc --noEmit` fails on
every shim** — `frontend-ci.yml` runs `npm run type-check` for that reason.

The cost, stated rather than hidden: editors read `tsconfig.json`, so an IDE
flags `@cloud/*` as unresolved in the shims. They are two-line re-exports and
CI covers them in both shapes.

### Adding a route

1. Add the page to cloud-control as **`frontend/src/routes/<path>/page.tsx`**.
   The filename is load-bearing — see below.
2. Add `src/app/(app)/<path>/page.tsx` re-exporting
   `@cloud/routes/<path>/page`.
3. Add `src/cloud-absent/routes/<path>/page.tsx`.
4. Add the entry to `SHIMS` in `src/cloud-absent/cloud-route-shims.test.ts`.

Skip 2 or 4 and the composed CI job fails; skip 3 and the OSS build fails to
resolve the specifier. Both are build-time facts, which is the point — a
mis-mounted route is a red build, not a 404 discovered in production.

**The inventory both sides are diffed against is cloud-control's filesystem**,
not a list: `cloud-route-shims.test.ts` walks its `routes/` tree and treats
every `page.tsx` outside a `_`-prefixed folder as a route. That is what
replaced the regex over the deleted `appRoutes` array, and it is why step 1's
filename matters — a page added as `routes/foo.tsx` is invisible to the guard.
A route that should exist but not be mounted goes in `UNMOUNTED`, with a
reason.

### Adding a sidebar entry

Same alias, plain data: append to `cloudNavItems` in cloud-control's
`frontend/src/nav-items.ts`. `_hooks/use-sidebar-navigation.ts` spreads
`@cloud/nav-items` into its local items, so the OSS stub's empty array means a
self-hosted build needs no runtime feature check. Entries use qontinui-web's
own `NavItem` shape, including `adminOnly` (which is what cloud-control's old
`superuserOnly` meant). Do not re-add `/admin`: qontinui-web's `devNavItems`
already has it, and a second entry renders the item twice.

### On "server-rendered"

Option D keeps SSR *available* to cloud routes, and the server graph really
does contain them: `.next/server/app/(app)/pricing/page.js` compiles
cloud-control's module, and `notFound()` / `redirect()` in the OSS stubs
execute on the server (HTTP 404 / 307, no client round-trip).

What you will **not** see is cloud page markup in view-source, and that is a
property of the host, not of this mechanism: `src/app/(app)/layout.tsx`'s
`AppAuthGate` renders `<AuthLoadingShell/>` instead of `children` whenever
`useAuth()` reports `loading || !user`, which on the server is always. Every
`(app)` route in this app, OSS or cloud, server-renders that same shell.
Compare `/dashboard` if in doubt. Changing that is an auth-architecture
question, not a route-mounting one.

## Design notes

**Why the boot import is static, not `useEffect(() => import(...))`.**
Registration has to finish before React renders anything that reads a slot.
An effect-driven import resolves after first paint, which would make
`getComponent("organizationSwitcher")` transiently `undefined` and force every
consumer to grow a loading state that can flash the wrong UI. A static import
in a client module evaluates during the initial bundle load, before hydration.

**Why a link and not a copy.** One source of truth, so editing
`qontinui-cloud-control` is picked up by the next build with no re-sync and no
stale-copy failure mode. `next.config.mjs` carries a warning that SWC cannot
follow Windows junctions, which is why `@qontinui/ui-bridge` is kept out of
`transpilePackages` — that warning does not transfer: ui-bridge ships
pre-compiled `dist/` JavaScript and needs no transpilation at all, whereas
cloud-control ships raw sources and needs it. Webpack's resolver and Next's
`transpilePackages` lookup both canonicalise through the junction to the same
real path, so the package's files land inside the SWC loader's `include`.
Verified by a composed `next build` on Windows.

**Why not a `file:` dependency.** A `file:../../qontinui-cloud-control` entry
in `package.json` is not opt-in — it lands in the committed manifest and
lockfile, and every OSS `npm ci` then fails on a directory that is not there.
A second `package.cloud.json` overlay avoids that but needs a second lockfile
to stay honest, and the two drift silently. An explicit post-install link
keeps one lockfile, leaves `npm ci` byte-identical for OSS, and matches how the
backend half of this same composition already works: `backend-ci.yml` clones
the sibling repo and `pip install -e`s it as a separate step rather than
declaring it a dependency.

**Bundle impact on OSS.** `src/cloud-absent/index.ts` is empty, so the OSS
client bundle contains no cloud-control code — check with
`ANALYZE=true npm run build`, or by grepping `.next/static` for a cloud-control
string.

## Deploying the composed shape

**Not wired yet, and deliberately named rather than papered over.** The
frontend deploys through Vercel, and the repo's `vercel.json` sets no
`installCommand` / `buildCommand` — those live in the Vercel project settings,
which this repo cannot change. Vercel also clones only this repo, so there is
no sibling checkout for the overlay to link to. Making qontinui.io serve the
composed shape needs a Vercel install command that fetches
`qontinui/qontinui-cloud-control` and then runs
`npm run cloud:install -- --source <path>` — a settings change, not a code one.
Until that lands, the production frontend runs the OSS shape, exactly as it
did before this mechanism existed. What changed is that the composed shape now
exists, builds, and is gated in CI.

## CI

`.github/workflows/frontend-ci.yml` runs both shapes: `lint-and-typecheck` is
the OSS-only tree, and `composed-cloud-build` checks out
`qontinui/qontinui-cloud-control`, installs the overlay, and runs lint,
type-check and the unit tests plus a full `next build`. A change in either
repo that breaks the composition fails there rather than at deploy.

Lint and type-check run in **both** jobs deliberately. The composed job is the
only place cloud-control's sources are type-checked anywhere — the package has
no tsconfig, no build step and no CI of its own — and `@cloud/*` only resolves
to them there.
