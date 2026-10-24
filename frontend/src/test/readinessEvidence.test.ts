/**
 * The readiness verdict can fail (plan `2026-10-23-console-presentation-spaces`
 * D3; served policy `testing` `a-test-must-be-able-to-fail`).
 *
 * Each row is a run, as `readinessReporter.ts` hands it to `readinessVerdict`:
 * the readiness test's module and a ready route's proof module, every test
 * with its final state and the records its page checks left. A route is
 * proven only by a test that FINISHED passed, not concurrent, holding a
 * record of the check over the route's page under a presenting lens, with no
 * violation, through the real UI Bridge provider (`readinessEvidence.ts`).
 * Each refusal names the reason it must give, so a requirement that stops
 * holding turns its own row red; each proof keeps one from over-reaching.
 */

import { describe, expect, it } from "vitest";
import {
  READINESS_TEST_MODULE,
  provesRoute,
  readinessVerdict,
  type PresentationCheckRecord,
  type ReadinessTarget,
  type RunModule,
  type RunTest,
} from "./readinessEvidence";

const ROUTE = "/admin/coord/devops";
const OTHER_ROUTE = "/admin/coord";
const PROOF = "app/(app)/admin/coord/devops/page.test.tsx";
const TARGET: ReadinessTarget = {
  route: ROUTE,
  provenBy: PROOF,
  pageFile: "/repo/src/app/(app)/admin/coord/devops/page.tsx",
};

/** A check over the presented page that found nothing, through the real provider. */
const SAFE: PresentationCheckRecord = {
  presented: [ROUTE],
  operator: [],
  violations: 0,
  registry: "provider",
};
const check = (
  overrides: Partial<PresentationCheckRecord>
): PresentationCheckRecord => ({ ...SAFE, ...overrides });
const test = (overrides: Partial<RunTest> = {}): RunTest => ({
  name: "dev ops > is safe to show",
  state: "passed",
  concurrent: false,
  checks: [SAFE],
  ...overrides,
});
const proof = (...tests: RunTest[]): RunModule => ({ file: PROOF, tests });
/** The readiness test, having run. */
const READINESS_RAN: RunModule = {
  file: READINESS_TEST_MODULE,
  tests: [
    {
      name: "every presentation-ready route is proven",
      state: "passed",
      concurrent: false,
      checks: [],
    },
  ],
};
const run = (...modules: RunModule[]) => [READINESS_RAN, ...modules];

/** Runs that prove the route: [what the proof's run shows, the run]. */
const PROVEN: ReadonlyArray<readonly [string, readonly RunModule[]]> = [
  [
    "a passed test whose check ran over the presented page, finding nothing, through the real provider",
    run(proof(test())),
  ],
  [
    "a passed test beside tests that were skipped or failed",
    run(
      proof(
        test({ name: "debugs", state: "skipped", checks: [] }),
        test(),
        test({ name: "redirects", state: "failed", checks: [] })
      )
    ),
  ],
  [
    "a check over the page beside a check over something else",
    run(proof(test({ checks: [check({ presented: [] }), SAFE] }))),
  ],
  [
    "a check that found violations while the page settled, then none",
    run(proof(test({ checks: [check({ violations: 2 }), SAFE] }))),
  ],
  [
    "a check over a view holding this page and another ready page",
    run(proof(test({ checks: [check({ presented: [OTHER_ROUTE, ROUTE] })] }))),
  ],
];

/** Runs that do not: [what the proof's run shows, the run, the reason it must give]. */
const REFUSED: ReadonlyArray<readonly [string, readonly RunModule[], string]> =
  [
    [
      "the proof filtered out of the run",
      run(),
      "the proof did not run in this run, so nothing proved the page safe to present — UNKNOWN is not proven",
    ],
    [
      "a passing check in a test skipped after it, at run time",
      run(proof(test({ state: "skipped" }))),
      'the page check passed over the page in "dev ops > is safe to show", but that test finished skipped — a skip at run time',
    ],
    [
      "a passing check in a test that then failed",
      run(proof(test({ state: "failed" }))),
      "but that test finished failed",
    ],
    [
      "a passing check in a test that never finished",
      run(proof(test({ state: "pending" }))),
      "but that test finished pending",
    ],
    [
      "a passing check in a concurrent test",
      run(proof(test({ concurrent: true }))),
      "a concurrent test: which of the tests running beside it made the check cannot be told",
    ],
    [
      "a check over the page that found violations",
      run(proof(test({ checks: [check({ violations: 3 })] }))),
      'the page check found 3 violations over the page in "dev ops > is safe to show"',
    ],
    [
      "a check over the page that found one violation",
      run(proof(test({ checks: [check({ violations: 1 })] }))),
      "found 1 violation over the page",
    ],
    [
      "a check that saw the UI Bridge through a registry view the test supplied",
      run(proof(test({ checks: [check({ registry: "caller" })] }))),
      "seeing the UI Bridge through a registry view the test supplied, so check (b) never read the real provider's registry",
    ],
    [
      "a check that did not observe the UI Bridge at all",
      run(proof(test({ checks: [check({ registry: "unobservable" })] }))),
      "seeing the UI Bridge through nothing (unobservable)",
    ],
    [
      "a check over the page in the operator view",
      run(
        proof(test({ checks: [check({ presented: [], operator: [ROUTE] })] }))
      ),
      "with no presenting lens above it — the operator view, not a presentation-mode render",
    ],
    [
      "checks over views without the page — unmounted, emptied, re-rendered, a stand-in, another component",
      run(
        proof(
          test({
            checks: [
              check({ presented: [], violations: 1 }),
              check({ presented: [] }),
            ],
          })
        )
      ),
      "the page check ran 2 times in it, never over a view with the page's own component mounted",
    ],
    [
      "a check over another ready route's page only",
      run(proof(test({ checks: [check({ presented: [OTHER_ROUTE] })] }))),
      "the page check ran 1 time in it, never over a view with the page's own component mounted",
    ],
    [
      "no test that ran the page check",
      run(
        proof(
          test({ checks: [] }),
          test({ name: "skipped", state: "skipped", checks: [] })
        )
      ),
      "no test in it ran the page check (2 tests: 1 passed, 1 skipped)",
    ],
    [
      "a proof module that collected no test",
      run(proof()),
      "no test in it ran the page check (it holds no test)",
    ],
    [
      "a passing test without the check beside a skipped one with it",
      run(
        proof(
          test({ name: "renders", checks: [] }),
          test({ name: "is safe", state: "skipped" })
        )
      ),
      'the page check passed over the page in "is safe", but that test finished skipped',
    ],
  ];

describe("readinessVerdict — what a run must show", () => {
  it.each(PROVEN)("proves the route for %s", (_what, modules) => {
    const verdict = readinessVerdict([TARGET], modules);
    expect(verdict.problems).toEqual([]);
    expect(verdict.proven).toEqual([
      { route: ROUTE, test: expect.any(String) },
    ]);
    expect(verdict.enforced).toBe(true);
  });

  it.each(REFUSED)("refuses %s", (_what, modules, reason) => {
    const verdict = readinessVerdict([TARGET], modules);
    expect(verdict.proven).toEqual([]);
    expect(verdict.problems).toHaveLength(1);
    expect(verdict.problems[0]).toContain(`${ROUTE} (${PROOF}): `);
    expect(verdict.problems[0]).toContain(reason);
  });

  it("refuses a route no page serves", () => {
    const verdict = readinessVerdict(
      [{ ...TARGET, pageFile: null }],
      run(proof(test()))
    );
    expect(verdict.problems).toEqual([
      `${ROUTE} (${PROOF}): no page module serves this route, so no render of it can be checked`,
    ]);
  });

  it("names every route it does not prove, and every one it does", () => {
    const other: ReadinessTarget = {
      route: OTHER_ROUTE,
      provenBy: "app/(app)/admin/coord/page.test.tsx",
      pageFile: "/repo/src/app/(app)/admin/coord/page.tsx",
    };
    const verdict = readinessVerdict([other, TARGET], run(proof(test())));
    expect(verdict.proven).toEqual([
      { route: ROUTE, test: "dev ops > is safe to show" },
    ]);
    expect(verdict.problems).toHaveLength(1);
    expect(verdict.problems[0]).toContain(
      `${OTHER_ROUTE} (app/(app)/admin/coord/page.test.tsx): the proof did not run in this run`
    );
  });

  it("is not vacuous: every refusal gives a reason, and the tables hold rows", () => {
    expect(PROVEN.length).toBeGreaterThanOrEqual(5);
    expect(REFUSED.length).toBeGreaterThanOrEqual(15);
    for (const [, , reason] of REFUSED) expect(reason).not.toBe("");
  });
});

describe("readinessVerdict — when a run must prove the routes", () => {
  const broken = proof(test({ state: "skipped" }));

  it("claims nothing in a run that does not execute the readiness test", () => {
    expect(readinessVerdict([TARGET], [broken])).toEqual({
      enforced: false,
      proven: [],
      problems: [],
    });
  });

  it("claims nothing when the readiness test's module ran with every test filtered out", () => {
    const filtered: RunModule = {
      file: READINESS_TEST_MODULE,
      tests: [{ ...READINESS_RAN.tests[0]!, state: "skipped" }],
    };
    expect(readinessVerdict([TARGET], [filtered, broken]).enforced).toBe(false);
  });

  it("requires every route once the readiness test ran, failed or passed", () => {
    const failed: RunModule = {
      file: READINESS_TEST_MODULE,
      tests: [{ ...READINESS_RAN.tests[0]!, state: "failed" }],
    };
    const verdict = readinessVerdict([TARGET], [failed, broken]);
    expect(verdict.enforced).toBe(true);
    expect(verdict.problems).toHaveLength(1);
  });

  it("requires nothing when no route is registered", () => {
    expect(readinessVerdict([], run())).toEqual({
      enforced: true,
      proven: [],
      problems: [],
    });
  });
});

describe("provesRoute", () => {
  it("is a check over the presented page, with no violation, through the real provider", () => {
    expect(provesRoute(SAFE, ROUTE)).toBe(true);
    expect(provesRoute(SAFE, OTHER_ROUTE)).toBe(false);
    expect(provesRoute(check({ violations: 1 }), ROUTE)).toBe(false);
    expect(provesRoute(check({ registry: "caller" }), ROUTE)).toBe(false);
    expect(
      provesRoute(check({ presented: [], operator: [ROUTE] }), ROUTE)
    ).toBe(false);
  });
});
