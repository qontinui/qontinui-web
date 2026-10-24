/**
 * readinessReporter — the end-of-run step that decides whether a run proves
 * every presentation-ready route (the main-process half of
 * `readinessEvidence.ts`, which says what counts).
 *
 * {@link presentationReadiness} is a vitest plugin (`vitest.config.ts`). Its
 * `configureVitest` hook adds {@link PresentationReadinessReporter} to the
 * run's reporters after the command line's are resolved, so a `--reporter`
 * flag — which replaces the configured list — cannot drop it. At init the
 * reporter provides every ready route, with its proof and its page module, to
 * the test workers, where `readinessTargets.ts` loads the pages. When the run
 * ends it reads every test's state and records, prints the routes the run
 * proved, and fails the run (exit code 1) on any it did not, naming why.
 *
 * The vitest config bundles this module, so it imports only Node, types and
 * relative modules — no `@/` alias.
 */

import { join, relative, sep } from "node:path";
import type { Plugin } from "vite";
import type {
  Reporter,
  TestModule,
  TestRunEndReason,
  Vitest,
  VitestPluginContext,
} from "vitest/node";
import {
  PRESENTATION_READY_ROUTES,
  type PresentationReadyRoute,
} from "../components/presentation/presentationReadiness";
import { appPageModules } from "./appRoutes";
import {
  CHECKS_META_KEY,
  READINESS_PROVIDE_KEY,
  readinessVerdict,
  type ReadinessTarget,
  type ReadinessVerdict,
  type RunModule,
} from "./readinessEvidence";

/** Each ready route, with its proof and its page module's absolute path. */
export function readyRouteTargets(
  srcDir: string,
  routes: readonly PresentationReadyRoute[] = PRESENTATION_READY_ROUTES
): ReadinessTarget[] {
  const pages = appPageModules(srcDir);
  return routes.map((entry) => {
    const page = pages.get(entry.route);
    return {
      route: entry.route,
      provenBy: entry.provenBy,
      pageFile: page === undefined ? null : join(srcDir, `${page}.tsx`),
    };
  });
}

/** The run's test modules as the verdict reads them: `src/`-relative, each test's state and records. */
export function runModulesOf(
  srcDir: string,
  modules: ReadonlyArray<TestModule>
): RunModule[] {
  return modules.map((module) => ({
    file: relative(srcDir, module.moduleId).split(sep).join("/"),
    tests: [...module.children.allTests()].map((test) => ({
      name: test.fullName,
      state: test.result().state,
      concurrent: test.options.concurrent === true,
      checks: test.meta()[CHECKS_META_KEY] ?? [],
    })),
  }));
}

/** The lines the reporter prints for `verdict`; empty when the run does not enforce readiness. */
export function verdictLines(
  verdict: ReadinessVerdict,
  watching: boolean
): string[] {
  if (!verdict.enforced) return [];
  if (verdict.problems.length === 0) {
    const proven = verdict.proven.map((p) => `${p.route} by "${p.test}"`);
    return [
      `presentation readiness: this run proves ${verdict.proven.length} presentation-ready route(s)${proven.length > 0 ? ` — ${proven.join("; ")}` : ""}.`,
    ];
  }
  return [
    "presentation readiness: FAILED — this run does not prove every PRESENTATION_READY_ROUTES entry, and PresentationPage would show these pages to an evaluator on no evidence:",
    ...verdict.problems.map((p) => `  - ${p}`),
    "Fix the proof, or withhold the route (remove it from src/components/presentation/presentationReadiness.ts).",
    ...(watching
      ? [
          "(watch mode re-runs only what changed: press `a` to run every proof with the readiness test.)",
        ]
      : []),
  ];
}

/** Marks the run failed. A seam, so a test can watch it without failing its own worker. */
export type FailRun = () => void;

const failProcess: FailRun = () => {
  process.exitCode = 1;
};

export class PresentationReadinessReporter implements Reporter {
  private vitest: Vitest | undefined;
  private srcDir = "";
  private targets: ReadinessTarget[] = [];

  constructor(private readonly failRun: FailRun = failProcess) {}

  onInit(vitest: Vitest): void {
    this.vitest = vitest;
    this.srcDir = join(vitest.config.root, "src");
    this.targets = readyRouteTargets(this.srcDir);
    vitest.provide(READINESS_PROVIDE_KEY, {
      srcDir: this.srcDir,
      targets: this.targets,
    });
  }

  onTestRunEnd(
    testModules: ReadonlyArray<TestModule>,
    _unhandledErrors: ReadonlyArray<unknown>,
    reason: TestRunEndReason
  ): void {
    const vitest = this.vitest;
    if (vitest === undefined || reason === "interrupted") return;
    const verdict = readinessVerdict(
      this.targets,
      runModulesOf(this.srcDir, testModules)
    );
    const lines = verdictLines(verdict, vitest.config.watch);
    if (lines.length === 0) return;
    if (verdict.problems.length > 0) {
      vitest.logger.error(`\n${lines.join("\n")}\n`);
      this.failRun();
    } else {
      vitest.logger.log(lines.join("\n"));
    }
  }
}

/** A vite plugin with vitest's `configureVitest` hook, which `vitest/config` declares on vite's `Plugin`. */
export interface VitestPlugin extends Plugin {
  configureVitest(context: VitestPluginContext): void;
}

/** The vitest plugin that arms the readiness step in every run of this config. */
export function presentationReadiness(): VitestPlugin {
  return {
    name: "qontinui:presentation-readiness",
    configureVitest({ vitest }) {
      vitest.config.reporters.push(new PresentationReadinessReporter());
    },
  };
}
