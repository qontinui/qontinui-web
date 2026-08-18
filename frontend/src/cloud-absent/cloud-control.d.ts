/**
 * Ambient declaration for the optional `@qontinui/cloud-control` package.
 *
 * The package is present only in the composed cloud build (see
 * `docs/composed-cloud-build.md`), so `tsc --noEmit` would fail on
 * `src/components/cloud-extensions-boot.tsx` in every OSS checkout without
 * this. Declaring it here keeps `npm run type-check` green in BOTH build
 * shapes with one line and no conditional tsconfig.
 *
 * The declaration is deliberately body-less (implicitly `any`). The only
 * import of this package anywhere in the host is a side-effect import — it
 * binds no value — so there is no type contract to state, and an ambient
 * module with no body correctly says "resolvable, exports nothing anyone
 * here uses". It also stops `tsc` from following `main` into the package's
 * own sources, which have no tsconfig of their own and would be checked
 * under the host's `strict` + `noUnusedLocals` settings against a
 * dependency set the host does not install.
 *
 * Typed access to cloud-control's modules is Phase 1b's problem: the
 * `@cloud/*` build-time alias resolves to real sources or to
 * `src/cloud-absent/*` stubs, and both sides are type-checked normally
 * because both are ordinary paths inside the host's `src/`.
 */
declare module "@qontinui/cloud-control";
