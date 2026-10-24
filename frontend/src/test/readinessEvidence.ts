/**
 * readinessEvidence — what a test run must show before a lens page counts as
 * safe to present (plan `2026-10-23-console-presentation-spaces` D3; served
 * policy `testing` `a-green-run-must-prove-it-ran` and
 * `a-test-must-be-able-to-fail`).
 *
 * A `PRESENTATION_READY_ROUTES` entry puts a page in front of an evaluator, so
 * the claim behind it — a presentation-mode render of the route's page passes
 * the page check — is read from the RUN, not from the test's source. Reading
 * source cannot settle it: whether arbitrary code skips the test, unmounts the
 * view or swaps the page out is not decidable from the text, and each review
 * round of the static reader this replaced found new shapes it accepted.
 *
 * 1. **The check records what it saw.** In a proof file, every run of the page
 *    check (`findPresentationViolations`, and so `expectPresentationSafe`)
 *    adds a {@link PresentationCheckRecord} to the running test's
 *    `meta.presentationChecks`: which ready routes had their page module's OWN
 *    default export mounted in the checked view's React root, and whether a
 *    presenting lens was above it; how many violations the check found; and
 *    how check (b) saw the UI Bridge. "Own" is identity with the module loaded
 *    unmocked before the file's tests ran (`readinessTargets.ts`), so a
 *    stand-in mocked into the page's place is not the page
 *    (`readinessRecorder.ts`).
 * 2. **The run decides.** When the run ends, `readinessReporter.ts` hands
 *    every test's records and final state to {@link readinessVerdict}. A route
 *    is proven only by a test that FINISHED `passed` — so not skipped at run
 *    time from wherever the skip came, not failed, and not concurrent (vitest
 *    cannot say which of the tests running at once made a check) — holding a
 *    record of the check over that route's page, presenting, with no
 *    violation, through the real UI Bridge provider's registry. Any ready
 *    route without one fails the run, with the reason.
 *
 * **When it applies.** Whenever a run executes the readiness test
 * ({@link READINESS_TEST_MODULE}) — `npm run test`, in CI or anywhere — every
 * ready route's proof file must run in that same run and carry the evidence;
 * a proof filtered out of it is UNKNOWN, and UNKNOWN fails the run rather
 * than counting as proven. A run that does not execute the readiness test (a
 * filtered run, `-t` excluding it) claims nothing about readiness and checks
 * nothing. `presentationReadiness.test.ts` fails when the reporter is not
 * armed in its run.
 *
 * **What stays out of reach.** A proof — or a module it loads — that writes
 * the records itself, mocks the checker's own modules (this one,
 * `readinessTargets.ts`, `readinessRecorder.ts`, `reactTree.ts`,
 * `presentation.tsx`), or edits them, the reporter, `setup.ts` or the vitest
 * config: the evidence is only as honest as the code that writes it. And the
 * state the page was checked in is the proof's choice: a fixture that never
 * loads data proves the empty page, not the loaded one.
 *
 * This module is pure and imports nothing, so the vitest config can bundle it
 * for the reporter.
 */

/** The `src/`-relative test module whose run turns the requirement on. */
export const READINESS_TEST_MODULE =
  "components/presentation/presentationReadiness.test.ts";

/** The key the reporter provides {@link ProvidedReadiness} to every test worker under. */
export const READINESS_PROVIDE_KEY = "presentationReadiness";

/** The test-meta key the page check records under: written by the check, and only by it. */
export const CHECKS_META_KEY = "presentationChecks";

/** A ready route, with the proof that must prove it and the page that must be mounted. */
export interface ReadinessTarget {
  readonly route: string;
  /** The proof test, `src/`-relative. */
  readonly provenBy: string;
  /** The route's page module, an absolute path; `null` when no page serves the route. */
  readonly pageFile: string | null;
}

/** What the reporter provides to every test worker. */
export interface ProvidedReadiness {
  /** The absolute `src/` directory the paths are relative to. */
  readonly srcDir: string;
  readonly targets: readonly ReadinessTarget[];
}

/** How check (b) saw UI Bridge registrations in one check. */
export type RegistryObservation =
  /** The real `UIBridgeProvider`'s registry, read back by the helper. */
  | "provider"
  /** A registry view the test supplied (`uiBridge: { registry }`). */
  | "caller"
  /** Not at all (`uiBridge: { unobservable }`). */
  | "unobservable";

/** One run of the page check, as the check itself records it on the running test. */
export interface PresentationCheckRecord {
  /**
   * The ready routes whose page module's own default export was mounted in
   * the checked view's React root, with a presenting lens above it.
   */
  readonly presented: readonly string[];
  /** The ready routes whose page was mounted there with the lens NOT presenting. */
  readonly operator: readonly string[];
  /** How many violations the check found. */
  readonly violations: number;
  readonly registry: RegistryObservation;
}

declare module "vitest" {
  interface TaskMeta {
    /** {@link CHECKS_META_KEY}. */
    presentationChecks?: PresentationCheckRecord[];
  }
  interface ProvidedContext {
    /** {@link READINESS_PROVIDE_KEY}. */
    presentationReadiness: ProvidedReadiness;
  }
}

/** A test's final state, as vitest reports it. */
export type RunTestState = "passed" | "failed" | "skipped" | "pending";

/** One test of a run, as the verdict reads it. */
export interface RunTest {
  /** Its full name, suites included. */
  readonly name: string;
  readonly state: RunTestState;
  readonly concurrent: boolean;
  readonly checks: readonly PresentationCheckRecord[];
}

/** One test module of a run, as the verdict reads it. */
export interface RunModule {
  /** The module, `src/`-relative. */
  readonly file: string;
  readonly tests: readonly RunTest[];
}

export interface ProvenRoute {
  readonly route: string;
  /** The test that proved it. */
  readonly test: string;
}

export interface ReadinessVerdict {
  /** Whether the run executed the readiness test, and so must prove every ready route. */
  readonly enforced: boolean;
  readonly proven: readonly ProvenRoute[];
  /** One line per ready route this run does not prove, with the reason. */
  readonly problems: readonly string[];
}

/** Whether `check` shows `route`'s page safe to present. */
export function provesRoute(
  check: PresentationCheckRecord,
  route: string
): boolean {
  return (
    check.presented.includes(route) &&
    check.violations === 0 &&
    check.registry === "provider"
  );
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function stateSummary(tests: readonly RunTest[]): string {
  if (tests.length === 0) return "it holds no test";
  const counts = new Map<RunTestState, number>();
  for (const t of tests) counts.set(t.state, (counts.get(t.state) ?? 0) + 1);
  const parts = [...counts].map(([state, n]) => `${n} ${state}`);
  return `${plural(tests.length, "test")}: ${parts.join(", ")}`;
}

function withChecks(
  tests: readonly RunTest[],
  matches: (check: PresentationCheckRecord) => boolean
): RunTest | undefined {
  return tests.find((t) => t.checks.some(matches));
}

/** Why no test of `proof` proves `route` — the evidence closest to a proof first. */
function whyNotProven(proof: RunModule, route: string): string {
  const tests = proof.tests;
  const proving = withChecks(tests, (c) => provesRoute(c, route));
  if (proving !== undefined && proving.state !== "passed") {
    return `the page check passed over the page in "${proving.name}", but that test finished ${proving.state}${
      proving.state === "skipped"
        ? " — a skip at run time, from the test, a hook or the runner, leaves nothing proven"
        : ""
    }`;
  }
  if (proving !== undefined) {
    return `the page check passed over the page in "${proving.name}", a concurrent test: which of the tests running beside it made the check cannot be told, so none counts`;
  }
  const failing = withChecks(
    tests,
    (c) => c.presented.includes(route) && c.violations > 0
  );
  if (failing !== undefined) {
    const most = Math.max(
      ...failing.checks
        .filter((c) => c.presented.includes(route))
        .map((c) => c.violations)
    );
    return `the page check found ${plural(most, "violation")} over the page in "${failing.name}"`;
  }
  const unobserved = withChecks(
    tests,
    (c) => c.presented.includes(route) && c.registry !== "provider"
  );
  if (unobserved !== undefined) {
    const how = unobserved.checks.find((c) => c.presented.includes(route));
    return `the page check ran over the page in "${unobserved.name}" seeing the UI Bridge through ${
      how?.registry === "caller"
        ? "a registry view the test supplied"
        : "nothing (unobservable)"
    }, so check (b) never read the real provider's registry`;
  }
  const operator = withChecks(tests, (c) => c.operator.includes(route));
  if (operator !== undefined) {
    return `the page was checked in "${operator.name}" with no presenting lens above it — the operator view, not a presentation-mode render`;
  }
  const checks = tests.reduce((n, t) => n + t.checks.length, 0);
  if (checks > 0) {
    return `the page check ran ${plural(checks, "time")} in it, never over a view with the page's own component mounted — an unmounted, emptied or re-rendered view, the page wrapped away, a stand-in in its place, or another component`;
  }
  return `no test in it ran the page check (${stateSummary(tests)})`;
}

/**
 * Which ready routes the run proves, and why each other one is not proven
 * (see the module doc). `modules` are the run's test modules.
 */
export function readinessVerdict(
  targets: readonly ReadinessTarget[],
  modules: readonly RunModule[]
): ReadinessVerdict {
  const readiness = modules.find((m) => m.file === READINESS_TEST_MODULE);
  const enforced =
    readiness !== undefined &&
    readiness.tests.some((t) => t.state === "passed" || t.state === "failed");
  if (!enforced) return { enforced: false, proven: [], problems: [] };
  const proven: ProvenRoute[] = [];
  const problems: string[] = [];
  for (const target of targets) {
    const label = `${target.route} (${target.provenBy})`;
    if (target.pageFile === null) {
      problems.push(
        `${label}: no page module serves this route, so no render of it can be checked`
      );
      continue;
    }
    const proof = modules.find((m) => m.file === target.provenBy);
    if (proof === undefined) {
      problems.push(
        `${label}: the proof did not run in this run, so nothing proved the page safe to present — UNKNOWN is not proven; run it with the readiness test (the whole suite does)`
      );
      continue;
    }
    const by = proof.tests.find(
      (t) =>
        t.state === "passed" &&
        !t.concurrent &&
        t.checks.some((c) => provesRoute(c, target.route))
    );
    if (by !== undefined) proven.push({ route: target.route, test: by.name });
    else problems.push(`${label}: ${whyNotProven(proof, target.route)}`);
  }
  return { enforced: true, proven, problems };
}
