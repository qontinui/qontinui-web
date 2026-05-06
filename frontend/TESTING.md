# Testing notes

## Vitest + oxc JSX transform

Vitest 4.x bundles a rolldown-based vite internally. Its transformer is **oxc**, not esbuild. `@vitejs/plugin-react@4.x` only wires JSX into esbuild (`esbuild.jsx = "automatic"`), so under vitest the oxc transformer receives no JSX config and fails to parse `.tsx` files with:

```
Parse failed with 1 error:
Unexpected JSX expression
```

`vitest.config.ts` sets `oxc.jsx` explicitly to give oxc the correct automatic-runtime config. Do **not** delete that block unless you have upgraded to `@vitejs/plugin-react@6.x` (which configures oxc itself) or to a runner that no longer routes JSX through oxc.

You can safely ignore the vite warning that still fires on each run:

```
warning: `esbuild` option was specified by "vite:react-babel" plugin. This option is deprecated, please use `oxc` instead.
Both esbuild and oxc options were set. oxc options will be used and esbuild options will be ignored.
```

That warning is plugin-react still setting the (now-ignored) esbuild option. The oxc config we set wins.

## Running tests

```
npm test           # single run
npm run test:watch # watch mode
```

New test files must use `vi.*` from vitest (globals are enabled), **not** `jest.*`. There is no jest shim.

## Playwright (e2e)

### Do not use `waitForLoadState("networkidle")`

`networkidle` waits for 500 ms of zero network activity, which never settles in this app: same-origin polling on `/api/ui-bridge/commands`, the runner-discovery hook, and React Query background refetches keep the network warm continuously. Every call burns its full 60 s timeout before throwing, which is why the post-cascade-fix nightly was 11 ✓ / 697 ✘ over 3 h before PR #66.

Use `waitForLoadState("domcontentloaded")` instead, then assert on a specific selector with `await expect(locator).toBeVisible({ timeout: ... })`. The same approach has been documented in `tests/e2e/auth.setup.ts:39-41` since the auth fixture was first written.

PR #66 (commit `288f02e8`) replaced 706 occurrences across 50 spec files. The post-merge sharded run (`25456443767`) immediately moved the suite from 11 ✓ / 697 ✘ over 3 h to 411 ✓ / 313 ✘ over ~30 min. New tests must follow the same pattern.
