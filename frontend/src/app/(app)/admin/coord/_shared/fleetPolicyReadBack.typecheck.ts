/**
 * Type-level checks for `Resolvers` (plan
 * `2026-11-09-prompt-documents-cross-tab-write-guard`, review round 10).
 *
 * `tsconfig.typecheck.json` compiles this file, and tsc excludes every test
 * file here, so the check lives in a plain `.ts`. It ships no runtime code:
 * every statement is a type, and nothing imports it. If `Resolvers` were
 * widened to `string`, the bare noun below would type-check, the
 * `@ts-expect-error` would go unused, and tsc would fail on it.
 */

import type { Resolvers } from "./fleetPolicyReadBack";

/** `T`, when it is a resolver with its verb. */
type AResolver<T extends Resolvers> = T;

/** Who resolves, with its verb, as the dials' callers pass it. */
export type ResolversWithTheirVerb = [
  AResolver<"devices resolve">,
  AResolver<"agents resolve">,
  AResolver<"runners resolve">,
  AResolver<"readers resolve">,
  AResolver<"coord resolves">,
  AResolver<"the worker resolves">,
];

/** A bare noun: 'Wrote "on", but runners "off"' must not compile. */
// @ts-expect-error a resolver must carry its verb
export type ResolversRejectABareNoun = AResolver<"runners">;
