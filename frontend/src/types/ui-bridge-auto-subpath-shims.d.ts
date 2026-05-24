/**
 * Ambient declarations for `@qontinui/ui-bridge-auto` subpath exports
 * whose `.d.ts`/`.d.mts` files are missing from the published 0.1.5
 * tarball. The package.json declares `./drift` and `./runtime` as
 * subpath exports with a `types` field pointing at
 * `dist/{drift,runtime}/index.d.mts`, but only the runtime `.mjs` is
 * actually shipped — the type declarations are absent, so consumer-side
 * tsc fails with TS7016 "implicitly has an 'any' type".
 *
 * This file is intentionally NOT a module (no top-level
 * `import`/`export` statement) so that the `declare module` blocks
 * below register as ambient module declarations — TypeScript only
 * resolves ambient `declare module "pkg/subpath"` from non-module .d.ts
 * files (a top-level export turns the file into a module and the
 * declarations would only augment, not provide-from-scratch).
 *
 * TODO(@qontinui/ui-bridge-auto): include all subpath .d.ts/.d.mts
 * files in the published artifact (verify
 * `scripts/check-dts-completeness.js` actually fails the build when
 * subpath types are missing) and delete this shim.
 */

declare module "@qontinui/ui-bridge-auto/drift" {
  /**
   * Discriminator-only mirror of the upstream `DriftEntry` union. The
   * `kind` discriminator is the only field qontinui-web reads from
   * this import (via `DriftEntry["kind"]` in
   * `drift-api.ts::asUiBridgeKind`); the rest of the upstream type
   * isn't load-bearing here.
   */
  export type DriftEntry =
    | { kind: "visual-drift" }
    | { kind: "missing-in-runtime" }
    | { kind: "missing-in-ir" }
    | { kind: "shape-mismatch" };

  // Permissive re-exports for the runtime functions imported elsewhere
  // (currently none in qontinui-web/frontend). Listed so a future
  // consumer that imports them doesn't immediately re-introduce TS7016.
  export const compareSpecToRuntime: unknown;
  export const fetchGitLog: unknown;
  export const parseGitLog: unknown;
  export const buildDriftHypotheses: unknown;
}

declare module "@qontinui/ui-bridge-auto/runtime" {
  // The qontinui-web consumer (spec-ci-init.tsx) uses these names; the
  // call sites already cast args with `as any` and pass the values
  // straight through to a global ambient registration, so permissive
  // signatures are sufficient. Specific shapes ship in upstream when
  // the .d.mts packaging gap is closed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const findFirst: (...args: any[]) => { match: { id: string } | null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const matchesQuery: (...args: any[]) => { matches: boolean };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const StateMachine: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const StateDetector: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const executeTransition: any;
}
