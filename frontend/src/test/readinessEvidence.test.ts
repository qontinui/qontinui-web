/**
 * The readiness verdict can fail (plan `2026-10-23-console-presentation-spaces`
 * D3; served policy `testing` `a-test-must-be-able-to-fail`).
 *
 * Each row is a run, as `readinessReporter.ts` hands it to `readinessVerdict`:
 * the arming test's module and a ready route's proof module, every test with
 * its final state and the records its page checks left. For each render of
 * the page in each test, the verdict reads the LAST check over it that read
 * the page presented. A route is refused when any such last check found a
 * violation, however its test ended; otherwise it is proven only by a test
 * that FINISHED passed, not concurrent, in which such a last check found
 * nothing and read the checked render's own UI Bridge registry
 * (`readinessEvidence.ts`). Each refusal names the reason it must give, so a
 * requirement that stops holding turns its own row red; each proof keeps one
 * from over-reaching.
 */

import { describe, expect, it } from "vitest";
import {
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

/** A check over render 1 of the presented page that found nothing, through the real provider. */
const SAFE: PresentationCheckRecord = {
  render: 1,
  presented: [ROUTE],
  operator: [],
  unread: [],
  violations: 0,
  registry: "provider",
};
/** The same render's check finding a violation. */
const DIRTY: PresentationCheckRecord = { ...SAFE, violations: 1 };
const check = (
  overrides: Partial<PresentationCheckRecord>
): PresentationCheckRecord => ({ ...SAFE, ...overrides });
const test = (overrides: Partial<RunTest> = {}): RunTest => ({
  name: "dev ops > is safe to show",
  state: "passed",
  concurrent: false,
  armed: false,
  checks: [SAFE],
  ...overrides,
});
const proof = (...tests: RunTest[]): RunModule => ({ file: PROOF, tests });
/** The arming test, having run and passed, in the readiness test's module. */
const ARMING: RunTest = {
  name: "arms the end-of-run requirement in this run",
  state: "passed",
  concurrent: false,
  armed: true,
  checks: [],
};
/**
 * A test of the readiness module that is not the arming one. The real module
 * holds about a dozen tests and ONE armed, so a verdict that reads "some test
 * is armed" must not be mistaken for "every test is": fixtures that held the
 * arming test alone could not tell the two apart.
 */
const BESIDE: RunTest = test({ name: "readiness > beside", checks: [] });
const READINESS_RAN: RunModule = {
  file: "components/presentation/presentationReadiness.test.ts",
  tests: [BESIDE, ARMING, BESIDE],
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
    "a check that found violations while the page settled, then none, over the same render (waitFor)",
    run(proof(test({ checks: [check({ violations: 2 }), DIRTY, SAFE] }))),
  ],
  [
    "a check over a view holding this page and another ready page",
    run(proof(test({ checks: [check({ presented: [OTHER_ROUTE, ROUTE] })] }))),
  ],
  [
    "two renders of the page, each settling clean",
    run(proof(test({ checks: [SAFE, DIRTY, check({ render: 2 }), SAFE] }))),
  ],
  [
    "a clean last presenting check over the page, then a check of the render in the operator view",
    run(
      proof(
        test({
          checks: [
            SAFE,
            check({ presented: [], operator: [ROUTE], violations: 3 }),
          ],
        })
      )
    ),
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
      'the page check found 3 violations over the page in "dev ops > is safe to show", the last check over that render of it',
    ],
    [
      "a check over the page that found one violation",
      run(proof(test({ checks: [DIRTY] }))),
      "found 1 violation over the page",
    ],
    [
      "a clean check, then a dirty one over the same render, in one passing test — the loaded page shows what the empty one hid",
      run(proof(test({ checks: [SAFE, DIRTY] }))),
      'the page check found 1 violation over the page in "dev ops > is safe to show", the last check over that render of it (the test finished passed) — the run\'s own evidence that the page shows what presentation mode must not, which a clean check elsewhere does not outweigh',
    ],
    [
      "a clean passing test beside a passing test whose check over the page found a violation",
      run(
        proof(
          test({ name: "a > is clean", checks: [SAFE] }),
          test({ name: "b > loads the data", checks: [check({ render: 2 })] }),
          test({
            name: "c > the loaded page",
            checks: [check({ render: 3, violations: 2 })],
          })
        )
      ),
      'the page check found 2 violations over the page in "c > the loaded page", the last check over that render of it',
    ],
    [
      "a render that ended dirty, then a clean render, in one passing test — each render counts by its own last check",
      run(proof(test({ checks: [check({ render: 2, violations: 1 }), SAFE] }))),
      "found 1 violation over the page",
    ],
    [
      "a clean passing test beside a test that ended dirty and then skipped",
      run(
        proof(
          test({ name: "a > is clean" }),
          test({
            name: "b > skips once loaded",
            state: "skipped",
            checks: [check({ render: 2, violations: 4 })],
          })
        )
      ),
      'the page check found 4 violations over the page in "b > skips once loaded", the last check over that render of it (the test finished skipped)',
    ],
    [
      "a clean check, then the render's last check not reading all of the page and finding a violation",
      run(
        proof(
          test({
            checks: [
              SAFE,
              check({ presented: [], unread: [ROUTE], violations: 2 }),
            ],
          })
        )
      ),
      'the page check found 2 violations over a render of the page whose output it did not read in full in "dev ops > is safe to show", the last check over that render of it',
    ],
    [
      "a clean check, then the render's last check not reading all of the page",
      run(
        proof(
          test({ checks: [SAFE, check({ presented: [], unread: [ROUTE] })] })
        )
      ),
      'the page\'s own component was mounted in "dev ops > is safe to show", but the check did not read what it rendered',
    ],
    [
      "two renders that ended dirty",
      run(
        proof(
          test({
            checks: [DIRTY, check({ render: 2, violations: 1 })],
          })
        )
      ),
      "; 1 more render of the page ended so too",
    ],
    [
      "a check that saw the UI Bridge through a registry view the test supplied",
      run(proof(test({ checks: [check({ registry: "caller" })] }))),
      "seeing the UI Bridge through a registry view the test supplied, so check (b) never read the registry the page registers with",
    ],
    [
      "a check that did not observe the UI Bridge at all",
      run(proof(test({ checks: [check({ registry: "unobservable" })] }))),
      "seeing the UI Bridge through nothing (unobservable)",
    ],
    [
      "a check whose registry was another render's — a view assembled from two renders",
      run(proof(test({ checks: [check({ registry: "another-render" })] }))),
      "seeing the UI Bridge through another render's registry, not the checked render's",
    ],
    [
      "a check over a render that mounted a UIBridgeProvider of its own",
      run(proof(test({ checks: [check({ registry: "another-provider" })] }))),
      "seeing the UI Bridge through the helper's registry while the render mounted a UIBridgeProvider of its own",
    ],
    [
      "a check whose registry could not be tied to the checked render",
      run(proof(test({ checks: [check({ registry: "unbound" })] }))),
      "seeing the UI Bridge through a registry the check could not tie to the checked render",
    ],
    [
      "a clean check through the real provider, then the render's last check through a registry the test supplied",
      run(proof(test({ checks: [SAFE, check({ registry: "caller" })] }))),
      "seeing the UI Bridge through a registry view the test supplied",
    ],
    [
      "a check over the page mounted, but its output not read — portaled out of what the check read, or nothing",
      run(proof(test({ checks: [check({ presented: [], unread: [ROUTE] })] }))),
      'the page\'s own component was mounted in "dev ops > is safe to show", but the check did not read what it rendered',
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
    const verdict = readinessVerdict([TARGET], modules, false);
    expect(verdict.problems).toEqual([]);
    expect(verdict.proven).toEqual([
      { route: ROUTE, test: expect.any(String) },
    ]);
    expect(verdict.enforced).toBe(true);
  });

  it.each(REFUSED)("refuses %s", (_what, modules, reason) => {
    const verdict = readinessVerdict([TARGET], modules, false);
    expect(verdict.proven).toEqual([]);
    expect(verdict.problems).toHaveLength(1);
    expect(verdict.problems[0]).toContain(`${ROUTE} (${PROOF}): `);
    expect(verdict.problems[0]).toContain(reason);
  });

  it("refuses a route no page serves", () => {
    const verdict = readinessVerdict(
      [{ ...TARGET, pageFile: null }],
      run(proof(test())),
      false
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
    const verdict = readinessVerdict(
      [other, TARGET],
      run(proof(test())),
      false
    );
    expect(verdict.proven).toEqual([
      { route: ROUTE, test: "dev ops > is safe to show" },
    ]);
    expect(verdict.problems).toHaveLength(1);
    expect(verdict.problems[0]).toContain(
      `${OTHER_ROUTE} (app/(app)/admin/coord/page.test.tsx): the proof did not run in this run`
    );
  });

  it("is not vacuous: every refusal gives a reason, and the tables hold rows", () => {
    expect(PROVEN.length).toBeGreaterThanOrEqual(7);
    expect(REFUSED.length).toBeGreaterThanOrEqual(25);
    for (const [, , reason] of REFUSED) expect(reason).not.toBe("");
  });
});

describe("readinessVerdict — when a run must prove the routes", () => {
  const broken = proof(test({ state: "skipped" }));

  it("claims nothing in a run where no test armed the requirement", () => {
    expect(readinessVerdict([TARGET], [broken], false)).toEqual({
      enforced: false,
      proven: [],
      problems: [],
    });
  });

  it("is not armed by the readiness test's module running, nor by its file name, without the arming record", () => {
    const unarmed: RunModule = {
      file: READINESS_RAN.file,
      tests: [{ ...ARMING, armed: false }],
    };
    expect(readinessVerdict([TARGET], [unarmed, broken], false).enforced).toBe(
      false
    );
  });

  it("is armed by the record wherever the arming test lives, whatever its file is named", () => {
    const moved: RunModule = {
      file: "components/presentation/presentationReadiness.test.tsx",
      tests: [BESIDE, ARMING, BESIDE],
    };
    const verdict = readinessVerdict([TARGET], [moved, broken], false);
    expect(verdict.enforced).toBe(true);
    expect(verdict.problems).toHaveLength(1);
  });

  /** The readiness test's module with its arming test finished in `state`. */
  const armedAs = (state: RunTest["state"]): RunModule => ({
    file: READINESS_RAN.file,
    tests: [BESIDE, { ...ARMING, state }, BESIDE],
  });

  it("requires every route when the arming test was skipped and no name filter narrowed the run", () => {
    // it.skip, a describe.skip around it, a skipIf: the declaration made at
    // collection stands, so the skip turns nothing off.
    const verdict = readinessVerdict(
      [TARGET],
      [armedAs("skipped"), broken],
      false
    );
    expect(verdict.enforced).toBe(true);
    expect(verdict.problems).toHaveLength(1);
    expect(verdict.problems[0]).toContain(
      "but that test finished skipped — a skip at run time"
    );
  });

  it("claims nothing when the arming test was skipped and a name filter narrowed the run", () => {
    // `-t` skips every test it does not select, the arming test among them.
    expect(
      readinessVerdict([TARGET], [armedAs("skipped"), broken], true)
    ).toEqual({ enforced: false, proven: [], problems: [] });
  });

  it("requires every route when the arming test ran, filter or not", () => {
    for (const state of ["passed", "failed"] as const) {
      expect(
        readinessVerdict([TARGET], [armedAs(state), broken], true).enforced
      ).toBe(true);
    }
  });

  it("claims nothing when the arming test never finished", () => {
    for (const nameFiltered of [false, true]) {
      expect(
        readinessVerdict([TARGET], [armedAs("pending"), broken], nameFiltered)
          .enforced
      ).toBe(false);
    }
  });

  it("requires every route once the arming test ran, failed or passed", () => {
    const failed: RunModule = {
      file: READINESS_RAN.file,
      tests: [{ ...ARMING, state: "failed" }],
    };
    const verdict = readinessVerdict([TARGET], [failed, broken], false);
    expect(verdict.enforced).toBe(true);
    expect(verdict.problems).toHaveLength(1);
  });

  it("requires nothing when no route is registered", () => {
    expect(readinessVerdict([], run(), false)).toEqual({
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
    for (const registry of [
      "another-render",
      "another-provider",
      "unbound",
      "unobservable",
    ] as const) {
      expect(provesRoute(check({ registry }), ROUTE)).toBe(false);
    }
    expect(
      provesRoute(check({ presented: [], operator: [ROUTE] }), ROUTE)
    ).toBe(false);
    expect(provesRoute(check({ presented: [], unread: [ROUTE] }), ROUTE)).toBe(
      false
    );
  });
});
