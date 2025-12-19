/**
 * Coverage Analyzer Module
 *
 * Responsible for analyzing test and documentation coverage:
 * - Test coverage calculation
 * - Documentation coverage calculation
 * - Uncovered resource detection
 */

import type { Workflow } from "@/lib/action-schema/action-types";
import { WorkflowDocumentationService } from "../workflow-documentation-service";
import { getWorkflowTestingService } from "../workflow-testing-service";
import type { CoverageReport } from "./types";

/**
 * Calculate test coverage
 */
export function calculateTestCoverage(
  workflows: Workflow[]
): CoverageReport["testCoverage"] {
  const tested = new Set<string>();
  const workflowTestingService = getWorkflowTestingService();
  const allTests = workflowTestingService.getAllTestCases();

  allTests.forEach((test: unknown) => {
    const typedTest = test as { enabled?: boolean; workflowId: string };
    if (typedTest.enabled !== false) {
      tested.add(typedTest.workflowId);
    }
  });

  const overall =
    workflows.length > 0 ? (tested.size / workflows.length) * 100 : 0;

  const byFolder: Record<string, number> = {};
  const folderCounts: Record<string, { total: number; tested: number }> = {};

  workflows.forEach((workflow) => {
    const folder = workflow.category || "Uncategorized";
    if (!folderCounts[folder]) {
      folderCounts[folder] = { total: 0, tested: 0 };
    }
    folderCounts[folder].total++;
    if (tested.has(workflow.id)) {
      folderCounts[folder].tested++;
    }
  });

  Object.entries(folderCounts).forEach(([folder, counts]) => {
    byFolder[folder] = (counts.tested / counts.total) * 100;
  });

  const untested = workflows.filter((w) => !tested.has(w.id)).map((w) => w.id);

  return {
    overall,
    byFolder,
    untested,
  };
}

/**
 * Calculate documentation coverage
 */
export function calculateDocumentationCoverage(
  workflows: Workflow[]
): CoverageReport["documentationCoverage"] {
  const documentationService = WorkflowDocumentationService.getInstance();
  const documented = new Set<string>();

  workflows.forEach((workflow) => {
    if (documentationService.hasDocumentation(workflow.id)) {
      documented.add(workflow.id);
    }
  });

  const overall =
    workflows.length > 0 ? (documented.size / workflows.length) * 100 : 0;

  const byFolder: Record<string, number> = {};
  const folderCounts: Record<string, { total: number; documented: number }> =
    {};

  workflows.forEach((workflow) => {
    const folder = workflow.category || "Uncategorized";
    if (!folderCounts[folder]) {
      folderCounts[folder] = { total: 0, documented: 0 };
    }
    folderCounts[folder].total++;
    if (documented.has(workflow.id)) {
      folderCounts[folder].documented++;
    }
  });

  Object.entries(folderCounts).forEach(([folder, counts]) => {
    byFolder[folder] = (counts.documented / counts.total) * 100;
  });

  const undocumented = workflows
    .filter((w) => !documented.has(w.id))
    .map((w) => w.id);

  return {
    overall,
    byFolder,
    undocumented,
  };
}

/**
 * Get undocumented resources
 */
export function getUndocumentedResources(workflows: Workflow[]): string[] {
  const documentationService = WorkflowDocumentationService.getInstance();
  return workflows
    .filter((w) => !documentationService.hasDocumentation(w.id))
    .map((w) => w.id);
}

/**
 * Get untested resources
 */
export function getUntestedResources(workflows: Workflow[]): string[] {
  const coverage = calculateTestCoverage(workflows);
  return coverage.untested;
}
