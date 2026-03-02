import { useMemo } from "react";
import { useExpandableSet } from "@/hooks/useExpandableSet";
import {
  useTaskRunPlaywright,
  useTaskRunVerificationPhaseResults,
  type PlaywrightResult,
  type VerificationPhaseResult,
  type VerificationStepResult,
} from "@/lib/runner-api";
import type { ComparisonResult } from "@/lib/runner/types/exploration";
import type {
  NormalizedTestResult,
  IterationGroup,
} from "../_types/test-results-types";

export function useTestResults(runId: string) {
  const { data: playwrightData, isLoading: pwLoading } =
    useTaskRunPlaywright(runId);
  const { data: verificationData, isLoading: verLoading } =
    useTaskRunVerificationPhaseResults(runId);

  const { expanded: expandedTests, toggle: toggleTest } = useExpandableSet();
  const { expanded: expandedIterations, toggle: toggleIteration } =
    useExpandableSet<number>([0]);

  const isLoading = pwLoading && verLoading;

  const playwrightTests: NormalizedTestResult[] = useMemo(() => {
    if (!playwrightData) return [];
    const results = playwrightData as PlaywrightResult[];
    return results.map((r, i) => ({
      id: `playwright-${r.id ?? i}`,
      name: r.test_name || `Playwright Test ${i + 1}`,
      status: (r.status === "passed"
        ? "passed"
        : r.status === "skipped"
          ? "skipped"
          : "failed") as "passed" | "failed" | "skipped",
      duration_ms: r.duration_ms ?? undefined,
      assertions_passed: r.assertions_passed,
      assertions_total:
        r.assertions_passed != null && r.assertions_failed != null
          ? r.assertions_passed + r.assertions_failed
          : undefined,
      console_output: r.console_output ?? undefined,
      page_snapshot: r.page_snapshot ?? undefined,
      error_message: r.error_message ?? undefined,
      screenshot_path:
        r.failure_screenshot_path ?? r.screenshot_path ?? undefined,
      source: "playwright" as const,
      step_type: "playwright",
    }));
  }, [playwrightData]);

  const iterationResults: IterationGroup[] = useMemo(() => {
    if (!verificationData?.results) return [];
    return verificationData.results.map((phase: VerificationPhaseResult) => {
      const tests: NormalizedTestResult[] = (phase.step_results ?? []).map(
        (step: VerificationStepResult, i: number) => {
          let consoleOutput: string | undefined;
          const vd = step.verification_details;
          if (vd?.console_output) {
            consoleOutput = vd.console_output;
          } else if (vd?.stdout || vd?.stderr) {
            const parts: string[] = [];
            if (vd.stdout) parts.push(vd.stdout);
            if (vd.stderr) parts.push(`[stderr]\n${vd.stderr}`);
            consoleOutput = parts.join("\n\n");
          }

          return {
            id: `verification-${phase.iteration}-${i}`,
            name: step.step_name || `Verification Step ${i + 1}`,
            status: step.success
              ? "passed"
              : step.error?.includes("Skipped")
                ? "skipped"
                : "failed",
            duration_ms: step.duration_ms,
            error_message: step.error ?? undefined,
            console_output: consoleOutput,
            page_snapshot: vd?.page_snapshot ?? undefined,
            assertions_passed: vd?.assertions_passed ?? undefined,
            assertions_total: vd?.assertions_total ?? undefined,
            source: "verification" as const,
            step_type: step.step_type,
            test_type: step.config?.test_type ?? undefined,
            check_results: vd?.check_results ?? undefined,
            comparison_result:
              (
                step as VerificationStepResult & {
                  comparison_result?: ComparisonResult;
                }
              ).comparison_result ??
              ((
                step as VerificationStepResult & {
                  output_data?: Record<string, unknown>;
                }
              ).output_data?.comparison_result as ComparisonResult | undefined),
          };
        }
      );

      return {
        iteration: phase.iteration,
        all_passed: phase.all_passed,
        tests,
        total_duration_ms: phase.total_duration_ms,
      };
    });
  }, [verificationData]);

  const allVerificationTests = iterationResults.flatMap((ir) => ir.tests);
  const allTests = [...allVerificationTests, ...playwrightTests];
  const passedCount = allTests.filter((t) => t.status === "passed").length;
  const failedCount = allTests.filter((t) => t.status === "failed").length;
  const skippedCount = allTests.filter((t) => t.status === "skipped").length;

  return {
    isLoading,
    playwrightTests,
    iterationResults,
    expandedTests,
    expandedIterations,
    toggleTest,
    toggleIteration,
    allTests,
    passedCount,
    failedCount,
    skippedCount,
    hasVerificationResults: iterationResults.length > 0,
    hasPlaywrightResults: playwrightTests.length > 0,
    hasAnyResults: iterationResults.length > 0 || playwrightTests.length > 0,
  };
}
