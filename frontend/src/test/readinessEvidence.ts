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
 *    default export mounted in the checked view's React root, rendering
 *    something and all of it inside the element the check read, and whether
 *    a presenting lens was above it; how many violations the check found; and
 *    whether check (b) read the registry of the checked render's own real
 *    provider. "Own" is identity with the module loaded unmocked before the
 *    file's tests ran (`readinessTargets.ts`), so a stand-in mocked into the
 *    page's place is not the page (`readinessRecorder.ts`). A page portaled
 *    out of what the check read is `unread`, not presented; a view assembled
 *    from two renders, or a render that mounts a `UIBridgeProvider` of its
 *    own, is a check (b) failure (`uiBridgeBinding.ts`). Each record names
 *    the render it read (one number per render's container), so the checks
 *    over one render can be told from another's.
 * 2. **The run decides.** When the run ends, `readinessReporter.ts` hands
 *    every test's records and final state to {@link readinessVerdict}, which
 *    reads, for each render of a route's page in each test, the LAST check
 *    over it that saw the page presenting (read in full, or `unread`) — the
 *    state the render settled in, so a check polled while the page loads
 *    (`waitFor`) counts by its last attempt. A route is refused when any such
 *    last check, in any test of the proof and however that test ended, found
 *    a violation: that is the run's own evidence that the page shows what
 *    presentation mode must not, and a clean check elsewhere does not
 *    outweigh it. A render whose last such check is `unread` proves nothing
 *    either way. Otherwise it is proven
 *    only by a test that FINISHED `passed` — so not skipped at run time from
 *    wherever the skip came, not failed, and not concurrent (vitest cannot
 *    say which of the tests running at once made a check) — in which such a
 *    last check found no violation and read the registry of the checked
 *    render's own UI Bridge provider. Any ready route without that fails the
 *    run, with the reason.
 *
 * **When it applies.** Whenever a test of the run carrying
 * {@link ARMED_META_KEY} — the readiness test records it on itself
 * (`presentationReadiness.test.ts`, wherever that file lives or whatever it
 * is named) — finishes passed or failed: then every ready route's proof file
 * must run in that same run and carry the evidence. `npm run test`, in CI or
 * anywhere, runs it. A proof filtered out of the run is UNKNOWN, and UNKNOWN
 * fails the run rather than counting as proven. A run in which no test armed
 * the requirement (a filtered run, `-t` excluding the arming test) claims
 * nothing about readiness and checks nothing. The arming test fails when the
 * reporter is not in its run.
 *
 * **What stays out of reach.** A proof — or a module it loads — that writes
 * the records or the arming flag itself, mocks the checker's own modules (this
 * one, `readinessTargets.ts`, `readinessRecorder.ts`, `uiBridgeBinding.ts`,
 * `reactTree.ts`, `presentation.tsx`), or edits them, the reporter, the
 * readiness test, `setup.ts` or the vitest config: the evidence is only as
 * honest as the code that writes it. A proof that mocks a module the page
 * RENDERS — a child component (a `DeviceDrainControl` stubbed to render
 * nothing), a lens primitive — so the render the check reads is not
 * production's: identity is checked for the page module only, so the page's
 * own component still mounts and presents around the stub. Mock data sources
 * only — the API client, the hooks that fetch, the router. And the state the
 * page was checked in is the proof's choice: a fixture that never loads data
 * proves the empty page, not the loaded one.
 *
 * This module is pure and imports nothing, so the vitest config can bundle it
 * for the reporter.
 */

/**
 * The test-meta key that arms the requirement: written by the readiness test
 * on itself, and only by it. A run in which a test carrying it finished
 * passed or failed must prove every ready route.
 */
export const ARMED_META_KEY = "presentationReadinessArmed";

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

/**
 * How check (b) saw UI Bridge registrations in one check (read by
 * `uiBridgeBinding.ts` as the check runs).
 */
export type RegistryObservation =
  /**
   * The registry the helper read back from the checked render's own real
   * `UIBridgeProvider` — the only UI Bridge registry in the render's tree.
   */
  | "provider"
  /** The real provider's registry, read back by a render other than the one checked. */
  | "another-render"
  /** The checked render's, but its tree also holds a provider whose registry (b) did not read. */
  | "another-provider"
  /** The real provider's registry, not tied to the checked render's tree. */
  | "unbound"
  /** A registry view the test supplied (`uiBridge: { registry }`). */
  | "caller"
  /** Not at all (`uiBridge: { unobservable }`). */
  | "unobservable";

/** One run of the page check, as the check itself records it on the running test. */
export interface PresentationCheckRecord {
  /**
   * Which render the check read: one number per render's container, the same
   * for every check over it; `null` for a view without a container.
   */
  readonly render: number | null;
  /**
   * The ready routes whose page module's own default export was mounted in
   * the checked view's React root, rendered something, and rendered all of it
   * inside the element the check read — with a presenting lens above it.
   */
  readonly presented: readonly string[];
  /** The ready routes whose page was mounted and read so, with the lens NOT presenting. */
  readonly operator: readonly string[];
  /**
   * The ready routes whose page was mounted there, but whose output the check
   * did not read: it rendered nothing, or rendered some of it outside the
   * element the check read (a portal out of it, into another document too, a
   * detached element).
   */
  readonly unread: readonly string[];
  /** How many violations the check found. */
  readonly violations: number;
  readonly registry: RegistryObservation;
}

declare module "vitest" {
  interface TaskMeta {
    /** {@link CHECKS_META_KEY}. */
    presentationChecks?: PresentationCheckRecord[];
    /** {@link ARMED_META_KEY}. */
    presentationReadinessArmed?: boolean;
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
  /** Whether it carries {@link ARMED_META_KEY}. */
  readonly armed: boolean;
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
  /**
   * Whether a test of the run armed the requirement — carries
   * {@link ARMED_META_KEY} and finished passed or failed — so the run must
   * prove every ready route.
   */
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

/** How a reason names each way check (b) can have seen the UI Bridge. */
const REGISTRY_SEEN: Readonly<Record<RegistryObservation, string>> = {
  provider: "the real provider's registry",
  "another-render": "another render's registry, not the checked render's",
  "another-provider":
    "the helper's registry while the render mounted a UIBridgeProvider of its own",
  unbound: "a registry the check could not tie to the checked render",
  caller: "a registry view the test supplied",
  unobservable: "nothing (unobservable)",
};

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

/**
 * The last check over one render of a route's page that saw the page in
 * presentation mode — presented, or mounted with its output not read in full
 * (`unread`) — and its test.
 */
interface FinalCheck {
  readonly test: RunTest;
  readonly check: PresentationCheckRecord;
}

/**
 * For each test of `proof` and each render of `route`'s page in it, the last
 * check over that render that saw the page presenting — read in full
 * (`presented`) or not (`unread`): the state the render settled in. A check
 * of the page in the operator view is not one.
 */
function finalChecks(proof: RunModule, route: string): FinalCheck[] {
  const out: FinalCheck[] = [];
  for (const test of proof.tests) {
    const last = new Map<number | null, PresentationCheckRecord>();
    for (const check of test.checks) {
      if (check.presented.includes(route) || check.unread.includes(route)) {
        last.set(check.render, check);
      }
    }
    for (const check of last.values()) out.push({ test, check });
  }
  return out;
}

/** Why `dirty` — renders whose last check found a violation — refuse `route`. */
function dirtyReason(dirty: readonly FinalCheck[], route: string): string {
  const [first] = dirty;
  if (first === undefined) return "";
  const more = dirty.length - 1;
  const over = first.check.presented.includes(route)
    ? "over the page"
    : "over a render of the page whose output it did not read in full";
  return `the page check found ${plural(first.check.violations, "violation")} ${over} in "${first.test.name}", the last check over that render of it (the test finished ${first.test.state}) — the run's own evidence that the page shows what presentation mode must not, which a clean check elsewhere does not outweigh${
    more > 0 ? `; ${plural(more, "more render")} of the page ended so too` : ""
  }`;
}

/** Why no test of `proof` proves `route` — the evidence closest to a proof first. */
function whyNotProven(
  proof: RunModule,
  route: string,
  finals: readonly FinalCheck[]
): string {
  const tests = proof.tests;
  const proving = finals.filter((f) => provesRoute(f.check, route));
  const unfinished = proving.find((f) => f.test.state !== "passed");
  if (unfinished !== undefined) {
    return `the page check passed over the page in "${unfinished.test.name}", but that test finished ${unfinished.test.state}${
      unfinished.test.state === "skipped"
        ? " — a skip at run time, from the test, a hook or the runner, leaves nothing proven"
        : ""
    }`;
  }
  const [concurrent] = proving;
  if (concurrent !== undefined) {
    return `the page check passed over the page in "${concurrent.test.name}", a concurrent test: which of the tests running beside it made the check cannot be told, so none counts`;
  }
  const unobserved = finals.find(
    (f) => f.check.presented.includes(route) && f.check.registry !== "provider"
  );
  if (unobserved !== undefined) {
    return `the page check ran over the page in "${unobserved.test.name}" seeing the UI Bridge through ${
      REGISTRY_SEEN[unobserved.check.registry]
    }, so check (b) never read the registry the page registers with`;
  }
  const unread = withChecks(tests, (c) => c.unread.includes(route));
  if (unread !== undefined) {
    return `the page's own component was mounted in "${unread.name}", but the check did not read what it rendered — it rendered nothing, or rendered some of it outside the element the check read (a portal out of it, into another document too, a detached element, a narrowed baseElement, or an element React hoists into the document's head, such as a <title>: read the whole document with \`baseElement: document.documentElement\`)`;
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

/** The test of `proof` that proves `route`, or why none does (see the module doc). */
function routeVerdict(
  proof: RunModule,
  route: string
): { readonly by: string } | { readonly problem: string } {
  const finals = finalChecks(proof, route);
  const dirty = finals.filter((f) => f.check.violations > 0);
  if (dirty.length > 0) return { problem: dirtyReason(dirty, route) };
  const by = finals.find(
    (f) =>
      f.test.state === "passed" &&
      !f.test.concurrent &&
      provesRoute(f.check, route)
  );
  return by !== undefined
    ? { by: by.test.name }
    : { problem: whyNotProven(proof, route, finals) };
}

/**
 * Which ready routes the run proves, and why each other one is not proven
 * (see the module doc). `modules` are the run's test modules.
 */
export function readinessVerdict(
  targets: readonly ReadinessTarget[],
  modules: readonly RunModule[]
): ReadinessVerdict {
  const enforced = modules.some((m) =>
    m.tests.some(
      (t) => t.armed && (t.state === "passed" || t.state === "failed")
    )
  );
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
    const verdict = routeVerdict(proof, target.route);
    if ("by" in verdict) proven.push({ route: target.route, test: verdict.by });
    else problems.push(`${label}: ${verdict.problem}`);
  }
  return { enforced: true, proven, problems };
}
