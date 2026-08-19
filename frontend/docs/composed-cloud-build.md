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

Wired, in `vercel.json`'s `installCommand`:

```
npm ci
rm -rf /tmp/qontinui-cloud-control
git clone --depth 1 https://github.com/qontinui/qontinui-cloud-control /tmp/qontinui-cloud-control
npm run cloud:install -- --source /tmp/qontinui-cloud-control
```

(one `&&` chain in the JSON; split here for readability. The `rm -rf` keeps it
idempotent if the step is ever re-run in a warm container.)

Vercel clones only this repo, so the sibling has to be fetched during install.
cloud-control is public, so no credential is involved — the same bare clone
`frontend-ci.yml` already does.

**An earlier revision of this section said the install command "lives in the
Vercel project settings, which this repo cannot change." That was wrong, and it
is the reason the last mile sat undone while everything upstream of it shipped.**
`installCommand` and `buildCommand` in `vercel.json` take precedence over the
dashboard's project settings, so this is a code change and always was.

Only the **Root Directory** is dashboard-only, and Vercel reads `vercel.json`
from it — so which of this repo's two `vercel.json` files governs the build is
not knowable from the tree. The evidence says `frontend/`: the repo root holds no
buildable app (its `package.json` has a `type-check` script and nothing else), so
a root-directory-is-the-repo-root project could not build the Next.js app at all.
The command is therefore landed in **both** files, identical apart from the
leading `cd frontend`. Exactly one is read; the other is inert.

**Which one is decided by measuring production, not the preview.** Preview
deployments here are behind Vercel Deployment Protection, and the failure is
disguised: a protected preview answers **HTTP 200** and serves a complete
Next.js app — Vercel's _own login page_, 65 chunks of it. Status code, chunk
count and a green `Vercel` check all read healthy while the probe examines a
build it never saw. The only reliable tell is `<title>Login - Vercel</title>`.

qontinui.io is public, so probe there, with a **control marker** alongside the
one under test so a negative is provably a real absence:

| Marker  | String                                              | Meaning                                                                                                                  |
| ------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Control | `is only available in the cloud-control deployment` | this app's own `cloudOnlySlot` message, present in **both** shapes — finding it proves the scan reached the right chunks |
| Cloud   | `beta-banner-dismissed`                             | a localStorage key only cloud-control's `beta-banner.tsx` has                                                            |

Fetch `https://qontinui.io`, collect its `/_next/static/**.js` chunks, and grep
them. In a composed build the cloud marker lands in `chunks/app/layout-*.js` —
the root-layout chunk every page references, so scanning the homepage's chunk
list is sufficient. On 2026-08-19, before this wiring: control **found**, cloud
**absent** — production was the OSS shape.

If a future reader finds only one `vercel.json` here, that is the answer, and it
was measured that way.

**A failed clone fails the build, on purpose.** There is no fallback to the OSS
shape. A fallback would deploy a site silently missing billing and organisation
UI and report success — the same class of defect as the `.catch(() => {})` this
whole mechanism replaced, and the one with no detector. A failed build leaves the
previous deployment serving, so failing loud costs no availability.

**The sibling is not pinned; `main` floats.** That means a cloud-control merge
changes the next qontinui.io build with no qontinui-web commit. It is deliberate,
and it matches how every other first-party sibling here is consumed — `ui-bridge`
and `schemas` are live links, not pins. The mitigation is that the pair is
validated together on every qontinui-web PR by `composed-cloud-build`, which
floats `main` the same way; pinning production while CI floats would mean CI stops
gating what actually ships. If cloud-control ever needs to move independently of
qontinui.io, pin the clone to a tag here and check out the same ref in
`frontend-ci.yml` — change both or neither.

## CI

`.github/workflows/frontend-ci.yml` runs both shapes: `lint-and-typecheck` is
the OSS-only tree, and `composed-cloud-build` checks out
`qontinui/qontinui-cloud-control`, installs the overlay, and runs the unit
tests plus a full `next build`. A change in either repo that breaks the
composition fails there rather than at deploy.
