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

**Ask production, not a preview.** Vercel Deployment Protection is on for
preview deployments — a `*.vercel.app` deployment URL answers `302` to
`vercel.com/sso-api`, for `/composed-build.json` as for everything else, so
that read needs a Vercel session an agent does not have. The production alias
is not protected (`verify-frontend-deploy.yml` crawls `https://qontinui.io`
unauthenticated for exactly this reason), so `curl
https://qontinui.io/composed-build.json` is the read that resolves it. Until
then both files stand, which costs nothing: each is either the live one or an
ignored file.

### What gates the install script

`frontend-ci.yml`'s `vercel-install-script` job runs `vercel-install.sh`
end-to-end on Linux and asserts three things: the overlay resolves, the marker
is valid JSON naming the same sha as `cloud-control.pin`, and — with the pin
pointed at a sha that resolves to nothing — the script exits **non-zero and
writes no marker**. That last case is the one the design is about, so testing
only the success path would leave it uncovered.

It is a separate job from `composed-cloud-build` on purpose.
`composed-cloud-build` checks cloud-control out at its floating `main`, which
is what makes it a cross-repo drift detector; pointing it at the pin instead
would trade that away. So one job proves the two repos still compose, and the
other proves the script that ships them does what it says.

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

`.github/workflows/frontend-ci.yml` runs both shapes: `lint-and-typecheck` is
the OSS-only tree, and `composed-cloud-build` checks out
`qontinui/qontinui-cloud-control`, installs the overlay, and runs the unit
tests plus a full `next build`. A change in either repo that breaks the
composition fails there rather than at deploy.
