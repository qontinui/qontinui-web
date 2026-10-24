/**
 * The end-of-run readiness step (plan `2026-10-23-console-presentation-spaces`
 * D3; `readinessReporter.ts`): what it provides to the workers, how it reads a
 * run, and that it fails the run on a ready route the run does not prove.
 *
 * vitest's own entities are faked down to what the reporter reads, and the
 * run-failer is a spy: setting this worker's exit code would fail the worker,
 * not the run under test.
 */

import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { TestModule, Vitest, VitestPluginContext } from "vitest/node";
import { PRESENTATION_READY_ROUTES } from "@/components/presentation/presentationReadiness";
import {
  CHECKS_META_KEY,
  READINESS_PROVIDE_KEY,
  READINESS_TEST_MODULE,
  type PresentationCheckRecord,
  type RunTestState,
} from "./readinessEvidence";
import {
  PresentationReadinessReporter,
  presentationReadiness,
  readyRouteTargets,
  runModulesOf,
  verdictLines,
} from "./readinessReporter";

/** `src/`, resolved from this file. */
const SRC = join(__dirname, "..");
const ROOT = join(SRC, "..");

interface FakeTest {
  readonly name: string;
  readonly state: RunTestState;
  readonly concurrent?: boolean;
  readonly checks?: PresentationCheckRecord[];
}

/** A `TestModule` down to what `runModulesOf` reads. */
function fakeModule(file: string, tests: readonly FakeTest[]): TestModule {
  return {
    moduleId: join(SRC, file),
    children: {
      *allTests() {
        for (const t of tests) {
          yield {
            fullName: t.name,
            result: () => ({ state: t.state }),
            options: { concurrent: t.concurrent },
            meta: () =>
              t.checks === undefined ? {} : { [CHECKS_META_KEY]: t.checks },
          };
        }
      },
    },
  } as unknown as TestModule;
}

function fakeVitest(watch = false) {
  const vitest = {
    config: { root: ROOT, watch, reporters: [] as unknown[] },
    provide: vi.fn(),
    logger: { log: vi.fn(), error: vi.fn() },
  };
  return { vitest, asVitest: vitest as unknown as Vitest };
}

const LANDING = PRESENTATION_READY_ROUTES.find(
  (e) => e.route === "/admin/coord"
);
const SAFE: PresentationCheckRecord = {
  presented: ["/admin/coord"],
  operator: [],
  violations: 0,
  registry: "provider",
};
const READINESS = fakeModule(READINESS_TEST_MODULE, [
  { name: "readiness", state: "passed" },
]);

describe("readyRouteTargets", () => {
  it("names each ready route's proof and its page module's file", () => {
    expect(LANDING).toBeDefined();
    expect(readyRouteTargets(SRC)).toContainEqual({
      route: "/admin/coord",
      provenBy: LANDING?.provenBy,
      pageFile: join(SRC, "app/(app)/admin/coord/page.tsx"),
    });
  });

  it("names no page for a route no page serves", () => {
    expect(
      readyRouteTargets(SRC, [
        { route: "/admin/coord/nowhere", provenBy: "x.test.tsx" },
      ])
    ).toEqual([
      {
        route: "/admin/coord/nowhere",
        provenBy: "x.test.tsx",
        pageFile: null,
      },
    ]);
  });
});

describe("runModulesOf", () => {
  it("reads each module src-relative, and each test's name, state, concurrency and records", () => {
    const modules = runModulesOf(SRC, [
      fakeModule("app/(app)/admin/coord/page.test.tsx", [
        { name: "a > is safe", state: "passed", checks: [SAFE] },
        { name: "a > runs beside", state: "skipped", concurrent: true },
      ]),
    ]);
    expect(modules).toEqual([
      {
        file: "app/(app)/admin/coord/page.test.tsx",
        tests: [
          {
            name: "a > is safe",
            state: "passed",
            concurrent: false,
            checks: [SAFE],
          },
          {
            name: "a > runs beside",
            state: "skipped",
            concurrent: true,
            checks: [],
          },
        ],
      },
    ]);
  });
});

describe("verdictLines", () => {
  it("prints nothing for a run that claims nothing", () => {
    expect(
      verdictLines({ enforced: false, proven: [], problems: [] }, false)
    ).toEqual([]);
  });

  it("names every proven route and the test that proved it", () => {
    expect(
      verdictLines(
        {
          enforced: true,
          proven: [{ route: "/admin/coord", test: "x > is safe" }],
          problems: [],
        },
        false
      )
    ).toEqual([
      'presentation readiness: this run proves 1 presentation-ready route(s) — /admin/coord by "x > is safe".',
    ]);
  });

  it("names every unproven route, and in watch mode how to run every proof", () => {
    const lines = verdictLines(
      { enforced: true, proven: [], problems: ["/admin/coord (p): why"] },
      true
    );
    expect(lines[0]).toContain("presentation readiness: FAILED");
    expect(lines).toContain("  - /admin/coord (p): why");
    expect(lines.at(-1)).toContain("press `a`");
  });
});

describe("PresentationReadinessReporter", () => {
  it("provides every ready route, with its proof and page, to the test workers", () => {
    const { vitest, asVitest } = fakeVitest();
    new PresentationReadinessReporter(vi.fn()).onInit(asVitest);
    expect(vitest.provide).toHaveBeenCalledWith(READINESS_PROVIDE_KEY, {
      srcDir: SRC,
      targets: readyRouteTargets(SRC),
    });
  });

  it("passes a run that proves every ready route, and says so", () => {
    const { vitest, asVitest } = fakeVitest();
    const fail = vi.fn();
    const reporter = new PresentationReadinessReporter(fail);
    reporter.onInit(asVitest);
    reporter.onTestRunEnd(
      [
        READINESS,
        ...PRESENTATION_READY_ROUTES.map((entry) =>
          fakeModule(entry.provenBy, [
            {
              name: "is safe",
              state: "passed",
              checks: [{ ...SAFE, presented: [entry.route] }],
            },
          ])
        ),
      ],
      [],
      "passed"
    );
    expect(fail).not.toHaveBeenCalled();
    expect(vitest.logger.error).not.toHaveBeenCalled();
    expect(vitest.logger.log).toHaveBeenCalledWith(
      expect.stringContaining("this run proves")
    );
  });

  it("fails a run whose proof finished skipped, naming the route and why", () => {
    const { vitest, asVitest } = fakeVitest();
    const fail = vi.fn();
    const reporter = new PresentationReadinessReporter(fail);
    reporter.onInit(asVitest);
    reporter.onTestRunEnd(
      [
        READINESS,
        fakeModule(LANDING?.provenBy ?? "", [
          { name: "is safe", state: "skipped", checks: [SAFE] },
        ]),
      ],
      [],
      "passed"
    );
    expect(fail).toHaveBeenCalledTimes(1);
    const printed = String(vitest.logger.error.mock.calls[0]?.[0]);
    expect(printed).toContain("/admin/coord");
    expect(printed).toContain("but that test finished skipped");
  });

  it("checks nothing in a run that does not execute the readiness test", () => {
    const { vitest, asVitest } = fakeVitest();
    const fail = vi.fn();
    const reporter = new PresentationReadinessReporter(fail);
    reporter.onInit(asVitest);
    reporter.onTestRunEnd([], [], "passed");
    expect(fail).not.toHaveBeenCalled();
    expect(vitest.logger.log).not.toHaveBeenCalled();
    expect(vitest.logger.error).not.toHaveBeenCalled();
  });

  it("checks nothing in a run that was interrupted", () => {
    const { vitest, asVitest } = fakeVitest();
    const fail = vi.fn();
    const reporter = new PresentationReadinessReporter(fail);
    reporter.onInit(asVitest);
    reporter.onTestRunEnd([READINESS], [], "interrupted");
    expect(fail).not.toHaveBeenCalled();
    expect(vitest.logger.error).not.toHaveBeenCalled();
  });
});

describe("presentationReadiness — the plugin", () => {
  it("adds the reporter to the run's resolved reporters, after the command line's", () => {
    const { vitest } = fakeVitest();
    vitest.config.reporters.push(["dot", {}]);
    presentationReadiness().configureVitest({
      vitest,
    } as unknown as VitestPluginContext);
    expect(vitest.config.reporters).toHaveLength(2);
    expect(vitest.config.reporters[1]).toBeInstanceOf(
      PresentationReadinessReporter
    );
  });
});
