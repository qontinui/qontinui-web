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
`JsConfigPathsPlugin`, which taps `described-resolve`. Webpack's own
`resolve.alias` is an `AliasPlugin` registered on `raw-resolve`, and
enhanced-resolve's pipeline runs `described-resolve` → `raw-resolve`. So the
tsconfig entry is consulted first and wins — on **pipeline ordering**, which is
architectural, not on plugin registration order, which would be incidental. A
`@cloud/*` entry in `tsconfig.json` therefore beats `config.resolve.alias` and
every composed build quietly resolves back to the OSS stubs. The build stays
green and serves the wrong thing.

One narrowing worth knowing: `JsConfigPathsPlugin` tries its candidates with
`forEachBail` and falls through when **none** exist on disk. The fatal shape is
an entry whose first *existing* candidate is the wrong one — exactly what
copying the webpack alias (`@cloud/* → ./src/cloud-absent/*`) produces. Copying
the composed-first pair from `tsconfig.typecheck.json` would accidentally
behave. Don't rely on that: `cloud-route-shims.test.ts` → *keeps @cloud out of
tsconfig.json paths* rejects any `@cloud` key outright, because every other gate
is blind to this (tsc reads the typecheck config, whose `paths` replaces the
base's wholesale; vitest declares its own alias; `next build` runs with
`typescript.ignoreBuildErrors`).

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
4. Add `shim("routes/<path>/page")` to `SHIMS` **and** the matching entry to
   `STUB_IMPORTS`, both in `src/cloud-absent/cloud-route-shims.test.ts`. The
   OSS case needs the second one — its specifiers are static so the bundler can
   see them, which rules out deriving them from `SHIMS`.

**Land cloud-control first.** `composed-cloud-build` checks out cloud-control's
default branch, so a qontinui-web PR cannot be validated against an unlanded
cloud-control change, and the two repos have a fixed landing order: the route
lands in cloud-control, then the shim lands here. The reverse turns this repo's
CI red for a change made in the other one — see *A gap worth naming* below.

Skip 2 or 4 and the composed CI job fails; skip 3 and the OSS build fails to
resolve the specifier. Both are build-time facts, which is the point — a
mis-mounted route is a red build, not a 404 discovered in production.

**A shim forwards `default` and nothing else.** Route segment config
(`metadata`, `dynamic`, `revalidate`, `generateStaticParams`, …) is read by
Next from the *page module in the server graph* — which is the shim, not the
module it re-exports. So a `export const dynamic` in cloud-control's page is
inert; if a cloud route needs one, re-export it from the shim too:

```ts
export { default, metadata } from "@cloud/routes/pricing/page";
```

Nothing depends on this today (`app/layout.tsx` sets `dynamic =
"force-dynamic"` for the whole app), which is exactly why it is worth writing
down before someone adds a `metadata` export and watches it do nothing. The
capability is real — that is the SSR/metadata advantage option D has over a
registry — but it lives on the shim.

**The inventory both sides are diffed against is cloud-control's filesystem**,
not a list: `cloud-route-shims.test.ts` walks its `routes/` tree and treats
every `page.tsx` outside a `_`-prefixed folder as a route. That is what
replaced the regex over the deleted `appRoutes` array, and it is why step 1's
filename matters — a page added as `routes/foo.tsx` is invisible to the guard.
A route that should exist but not be mounted goes in `UNMOUNTED`, with a
reason.

### A gap worth naming: the cross-repo guard fires in the wrong repo

`composed-cloud-build` is the only thing that type-checks cloud-control's
frontend or checks the route inventory — that package has no tsconfig, no
frontend build, and its own `ci.yml` runs Python gates plus an import check
under an explicit *"every gate here runs standalone — no sibling checkout"*
constraint. So the guard lives here, and it reads cloud-control's **default
branch**.

The consequence: a cloud-control PR that adds, renames or removes a
`routes/<path>/page.tsx` goes green in cloud-control, lands, and then turns
**qontinui-web's `main`** red on its next run. The repo that made the change
never sees the failure, and the repo that did nothing gets the red.

That is why *Adding a route* says to land cloud-control first — the ordering is
a workaround for this, not a preference. The real fix is a `repository_dispatch`
from cloud-control into qontinui-web, or a cloud-control job that checks out
qontinui-web and runs the same guard (the way `backend-ci.yml` already handles
the backend half of this composition; the "no sibling checkout" rule is about
the local CI-node lane, so a GitHub-hosted job can carve out). Until then, treat
a red `mirrors cloud-control's route modules exactly` on main as *someone landed
a cloud-control route change*, not as a regression here.

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

**Wired.** qontinui.io deploys through Vercel's Git integration, and
`vercel.json` sets an `installCommand` that builds the composed shape:

```json
"installCommand": "bash frontend/scripts/vercel-install.sh --config-source root"
```

`scripts/vercel-install.sh` runs `npm ci`, clones
`qontinui/qontinui-cloud-control` (public — no credential) at the commit
pinned in `frontend/cloud-control.pin` into `<repo>/.sibling/`, links it with
`npm run cloud:install -- --source <that>`, and then **verifies the overlay
landed and exits non-zero if it did not**. That last step is the design: a
clone failure that quietly fell back to the OSS shape would deploy qontinui.io
without the org switcher, the beta banner, the subscription badge, and with
`billingService` / `organizationService` as throwing stubs — and would report
success. It is the same failure shape as the `.catch(() => {})` loader this
mechanism replaced. Vercel keeps the previous deployment serving when a build
fails, so failing loud costs no availability.

The layout mirrors `frontend-ci.yml`'s `composed-cloud-build` job exactly
(sibling checked out to `.sibling/qontinui-cloud-control`, linked from there),
so the deploy path is the path CI already proves green on every PR rather than
a second arrangement nothing exercises.

**Bumping cloud-control is a qontinui-web commit.** `cloud-control.pin` holds a
full commit sha, and the script checks out that commit — it never follows a
branch. cloud-control publishes no release tags, so a sha is the pin. A
floating `main` would let a cloud-control push change what qontinui.io serves
with no qontinui-web commit at all: an untracked input to a production build.
Editing the pin puts the change through qontinui-web review and through
`composed-cloud-build`, which builds the two repos together.

### Which `vercel.json` — and why there are two

Vercel reads `vercel.json` from the project's **Root Directory**, and this repo
has both a `frontend/` and a `backend/`. Which one the qontinui-web project is
rooted at is a dashboard setting recorded nowhere in the tree, and no Vercel
credential is reachable from a dev session to read it (the Vercel CLI's
`auth.json` under `%APPDATA%/xdg.data/com.vercel.cli/` has been an empty `{}`
since 2026-07-12).

The available evidence favours the **repo root**: `39cb6f87` set
`git.deploymentEnabled: false` in the root `vercel.json` on 2026-05-02 and
`aabaaf39` set it back on 2026-05-17, and Vercel created **zero** deployments
for main commits inside that window (sampled `08db0242`, `4fb69ed1`,
`26519749`, `0b83f939`, `12de6861`, `80ae61bd` — all 0) against a
`Production/vercel[bot]` deployment for `f2b72d06` just before it and for
`096c7eb0` just after. That is the root file demonstrably steering Vercel,
twice. It is not conclusive for `installCommand` specifically, so the command
is installed in **both** candidate locations — `vercel.json` and
`frontend/vercel.json` — and whichever Vercel reads wins while the other sits
inert.

Each passes a different `--config-source`, and the script writes it into
`public/composed-build.json`, which the deployment then serves. One
unauthenticated GET answers all three questions at once:

```console
$ curl https://qontinui.io/composed-build.json
{
  "composed": true,
  "configSource": "root",
  "cloudControlSha": "d89aa6f4905145a9484cbe848643e2d20ab99359",
  "webCommitSha": "...",
  "generatedBy": "frontend/scripts/vercel-install.sh"
}
```

`middleware.ts`'s matcher excludes `*.json`, so the file is reachable without a
session. It is written **last**, only on the path where the overlay verified —
so an OSS build serves a 404 there rather than a claim it cannot back, and a
404 is the honest signal that the shape is OSS. Once a deployment has answered,
delete the `vercel.json` that did **not** win.

### The claim this section replaces

Until this landed, this document said the install and build commands *"live in
the Vercel project settings, which this repo cannot change"*, and deferred the
last mile as an operator-only change. That was wrong, and being wrong here is
what kept the whole extension surface inert in production after the loader was
fixed: `installCommand` and `buildCommand` in `vercel.json` take precedence
over the dashboard settings, so it was always a code change. A doc that
mis-scopes a code change as an operator change is how the same gap gets
deferred a second time.

## CI

Four lanes gate this composition, and a fifth is recorded because it gates
nothing. The table is the whole answer to "is X checked, and where" — read it
before adding a step, because two of the cells that look like coverage are not.

| Lane | Shape | lint | type-check | unit tests | build |
|---|---|---|---|---|---|
| **qontinui-web** Actions — `lint-and-typecheck` | OSS-only | ✅ | ✅ | ✅ | — |
| **qontinui-web** Actions — `composed-cloud-build` | composed | ⚠️ host files only | ✅ **incl. cloud-control's sources** | ✅ | ✅ |
| **qontinui-web** local-CI (`.qontinui/ci.toml`) | both, in sequence | ⚠️ host files only | ✅ **incl. cloud-control's sources** | ✅ | ✅ |
| **qontinui-cloud-control** Actions — `composed-typecheck` | composed | — | ✅ | ✅ | — |
| **qontinui-cloud-control** local-CI (`.qontinui/ci.toml`) | — | — | — | — | — |

**The composed jobs are where cloud-control's frontend is checked at all.** The
package has no tsconfig, no build step and no CI of its own, and `@cloud/*`
resolves into its raw sources only when the overlay is present. A change in
either repo that breaks the composition fails in CI rather than at deploy.

**Why cloud-control has its own composed job.** `composed-cloud-build` triggers
on `frontend/**` of *this* repo, so it never runs on a cloud-control PR. Until
`composed-typecheck` was added, that meant a cloud-control PR ran no JS/TS gate
of any kind: a type error, or an import of a host module that does not exist,
merged green and reddened the next unrelated qontinui-web frontend PR, whose
author did not cause it. `composed-typecheck` in
`qontinui-cloud-control/.github/workflows/ci.yml` builds the same composition
with the overlay pointed at *that* PR, so the failure lands on the change that
caused it. It runs `npm test` as well as `npm run type-check`, because
`cloud-absent/cloud-route-shims.test.ts` is what catches a cloud route added
with no host shim — a file-existence fact `tsc` cannot see.

The consequence is intended: **a cloud-control PR that adds a route is red until
its qontinui-web shim PR exists.** That is a declared adaptation pair, and a
route that should exist but stay unmounted goes in that test's `UNMOUNTED` list.

### Two things that look like coverage and are not

**1. Lint never reaches cloud-control's sources, in any lane.** `.eslintrc.json`
`ignorePatterns` contains `"node_modules/"`, and the overlay links the package
to exactly `frontend/node_modules/@qontinui/cloud-control`. The `@cloud/*` alias
does not change this — ESLint takes its file set from directory globs, never
from the module graph, so an alias changes *resolution* and not *which files are
linted*. Type-check is different precisely because `tsc` follows imports.

**2. `Lint (composed)` is therefore a duplicate of the OSS `Lint`** — the same
file set, the same rules, and no type-aware rules configured (`.eslintrc.json`
extends `next/core-web-vitals` + `next/typescript` and sets no
`parserOptions.project`). It cannot report anything the OSS lint did not. It is
kept for now because a symmetric job list is easier to reason about than an
asymmetric one, and it costs seconds — but it is a removal candidate, and if it
goes it must go from `.qontinui/ci.toml` in the same PR.

### The local-CI lane

`.qontinui/ci.toml` mirrors `frontend-ci.yml`'s gate commands for the
runner-as-CI-node lane, and it gets both shapes out of **one** worktree by
ordering: `frontend-lint` / `frontend-typecheck` / `frontend-test` run before
the overlay exists, then `composed-cloud-install` flips the switch and
`composed-lint` / `composed-typecheck` / `composed-test` / `composed-build`
run after it. That works because the presence of
`frontend/node_modules/@qontinui/cloud-control` is the *only* switch.

Two divergences from the Actions job, both forced and both recorded in the
manifest: that lane passes **no** `QONTINUI_CLOUD_CONTROL_PATH` (its executor
materialises the sibling exactly where `cloud-control-overlay.mjs`'s
`DEFAULT_SOURCE` already looks, and the variable is not on the runner's env
allowlist anyway), and cloud-control's own manifest **cannot** mirror
`composed-typecheck` — every step of that job needs its working directory
inside a sibling checkout, and manifest `working_dir` values may not contain a
parent component. It is disclosed there under "STILL NOT GATED, AND WHY" rather
than silently dropped.
