import { useState, useCallback, useEffect } from "react";
import { workflowFileManager } from "../../../../services/workflow-file-manager";
import { workflowSnapshots } from "../../../../services/workflow-snapshots";
import { workflowFolderManager } from "../../../../services/workflow-folder-manager";
import { workflowAnalyticsService } from "../../../../services/workflow-analytics-service";
import { workflowComplexityAnalyzer } from "../../../../services/workflow-complexity-analyzer";
import { getWorkflowTestingService } from "../../../../services/workflow-testing";
import type { WorkflowFolder } from "../../../workflow-organization/types";
import type {
  SearchFilter,
  SavedFilter,
} from "../../../workflow-organization/types";
import { isRecentlyModified, type EnhancedWorkflowItem } from "../types";
import { createLogger } from "@/lib/logger";
import { toast } from "sonner";

const logger = createLogger("WorkflowBrowser");

export function useWorkflowLoader(open: boolean) {
  const [workflows, setWorkflows] = useState<EnhancedWorkflowItem[]>([]);
  const [folders, setFolders] = useState<WorkflowFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);

  const testingService = getWorkflowTestingService();

  const loadWorkflows = useCallback(async () => {
    setLoading(true);

    try {
      const keys = workflowFileManager.listWorkflows();
      const items: EnhancedWorkflowItem[] = [];

      const folderResult = workflowFolderManager.getAllFolders();
      const folderData = folderResult.success ? folderResult.folders : [];
      setFolders(folderData as unknown as WorkflowFolder[]);

      for (const key of keys) {
        const result = await workflowFileManager.loadWorkflowFromStorage(key);
        if (result.success && result.workflow) {
          const workflow = result.workflow;

          const snapshotCount = workflowSnapshots.getSnapshotCount(workflow.id);

          const folderAssoc = workflowFolderManager.getWorkflowFolder(
            workflow.id
          );
          const folderId = folderAssoc.success ? folderAssoc.folder?.id : null;
          const folderPath = folderId
            ? workflowFolderManager.getFolderPath(folderId).map((p) => p.name)
            : undefined;

          const complexityAnalysis =
            workflowComplexityAnalyzer.analyzeComplexity(workflow);

          const testCases = testingService.getTestCasesForWorkflow(workflow.id);
          const coverage =
            testCases.length > 0
              ? testingService.calculateCoverage(workflow.id, workflow)
              : null;

          const metrics = workflowAnalyticsService.getWorkflowMetrics(
            workflow.id
          );

          const lastModified = workflow.metadata?.updated
            ? new Date(workflow.metadata.updated)
            : undefined;

          items.push({
            key,
            workflow,
            lastModified,
            snapshotCount,
            folderId,
            folderPath,
            complexity: complexityAnalysis.complexityScore,
            complexityRating: complexityAnalysis.complexityRating,
            testCoverage: coverage?.coveragePercentage,
            hasTests: testCases.length > 0,
            hasDocumentation: Boolean(
              workflow.description && workflow.description.length > 0
            ),
            lastRun: metrics?.lastExecuted,
            successRate: metrics?.successRate
              ? metrics.successRate * 100
              : undefined,
            avgDuration: metrics?.avgDuration,
            failedLastRun: metrics ? (metrics.successRate || 0) < 1 : false,
            hasDependencies: workflow.actions.some(
              (a) => a.type === "RUN_WORKFLOW"
            ),
            recentlyModified: isRecentlyModified(lastModified),
          });
        }
      }

      setWorkflows(items);
    } catch (error) {
      logger.error("Failed to load workflows:", error);
      toast.error("Failed to load workflows");
    } finally {
      setLoading(false);
    }
  }, [testingService]);

  useEffect(() => {
    if (open) {
      loadWorkflows();
      try {
        const saved = localStorage.getItem("workflow-browser-filters");
        if (saved) {
          setSavedFilters(JSON.parse(saved));
        }
      } catch (error) {
        logger.error("Failed to load saved filters:", error);
      }
    }
  }, [open, loadWorkflows]);

  const handleSaveFilter = useCallback((name: string, filter: SearchFilter) => {
    const newFilter: SavedFilter = {
      id: `filter-${Date.now()}`,
      name,
      filter,
      createdAt: new Date(),
    };
    setSavedFilters((prev) => {
      const updated = [...prev, newFilter];
      localStorage.setItem("workflow-browser-filters", JSON.stringify(updated));
      return updated;
    });
  }, []);

  return {
    workflows,
    folders,
    loading,
    savedFilters,
    handleSaveFilter,
    loadWorkflows,
  };
}
