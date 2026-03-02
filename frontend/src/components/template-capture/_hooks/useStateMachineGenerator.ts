import { useState, useCallback, useEffect, useMemo } from "react";
import {
  TemplateCaptureService,
  type ApprovedTemplateData,
  type GenerateStateMachineResponse,
  type GroupingMethod,
} from "@/services/template-capture-service";
import { httpClient } from "@/services/service-factory";
import { runnerClient } from "@/lib/runner-client";
import { ProjectService } from "@/services/project-service";
import {
  convertToQontinuiConfig,
  validateGeneratedConfig,
} from "@/lib/state-machine-converter";

interface UseStateMachineGeneratorParams {
  projectId?: string;
  sessionId?: string;
  videoPath?: string;
  onGenerate?: (result: GenerateStateMachineResponse) => void;
}

export function useStateMachineGenerator({
  projectId,
  sessionId,
  videoPath,
  onGenerate,
}: UseStateMachineGeneratorParams) {
  const [service] = useState(() => new TemplateCaptureService(httpClient));
  const [projectService] = useState(() => new ProjectService(httpClient));

  // Loading and state
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importSuccess, setImportSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvedTemplates, setApprovedTemplates] = useState<
    ApprovedTemplateData[]
  >([]);
  const [result, setResult] = useState<GenerateStateMachineResponse | null>(
    null
  );

  // Configuration
  const [groupingMethod, setGroupingMethod] =
    useState<GroupingMethod>("state_hints");
  const [stateMachineName, setStateMachineName] = useState("Generated Config");
  const [includeTransitions, setIncludeTransitions] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Co-occurrence options
  const [coOccurrenceThreshold, setCoOccurrenceThreshold] = useState(0.8);
  const [sampleInterval, setSampleInterval] = useState(30);

  // Single state options
  const [singleStateName, setSingleStateName] = useState("Main State");

  // Fetch approved templates
  useEffect(() => {
    const fetchApproved = async () => {
      setLoadingTemplates(true);
      setError(null);
      try {
        const response = await service.exportApproved({
          session_id: sessionId,
          project_id: projectId,
        });
        setApprovedTemplates(response.items);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load approved templates"
        );
        console.error("[GenerateStateMachineDialog] Error:", err);
      } finally {
        setLoadingTemplates(false);
      }
    };

    fetchApproved();
  }, [service, projectId, sessionId]);

  // Get unique state hints from templates
  const uniqueStateHints = useMemo(() => {
    const hints = new Set<string>();
    for (const template of approvedTemplates) {
      if (template.state_hint) {
        hints.add(template.state_hint);
      }
    }
    return Array.from(hints).sort();
  }, [approvedTemplates]);

  // Count templates per state hint
  const templatesByHint = useMemo(() => {
    const byHint: Record<string, number> = {};
    let noHint = 0;
    for (const template of approvedTemplates) {
      if (template.state_hint) {
        byHint[template.state_hint] = (byHint[template.state_hint] || 0) + 1;
      } else {
        noHint++;
      }
    }
    return { byHint, noHint };
  }, [approvedTemplates]);

  // Validate configuration
  const canGenerate = useMemo(() => {
    if (approvedTemplates.length === 0) return false;
    if (!stateMachineName.trim()) return false;

    if (groupingMethod === "state_hints" && uniqueStateHints.length === 0) {
      return false;
    }

    if (groupingMethod === "co_occurrence" && !videoPath) {
      return false;
    }

    return true;
  }, [
    approvedTemplates.length,
    stateMachineName,
    groupingMethod,
    uniqueStateHints.length,
    videoPath,
  ]);

  // Generate state machine
  const handleGenerate = useCallback(async () => {
    if (!canGenerate) return;

    setGenerating(true);
    setError(null);
    setResult(null);

    try {
      // Build grouping config based on method
      const groupingConfig: Record<string, unknown> = {};

      if (groupingMethod === "co_occurrence") {
        groupingConfig.co_occurrence_threshold = coOccurrenceThreshold;
        groupingConfig.video_path = videoPath;
        groupingConfig.sample_interval = sampleInterval;
      } else if (groupingMethod === "single_state") {
        groupingConfig.single_state_name = singleStateName;
      }

      // Call the runner to generate state machine
      const response =
        await runnerClient.sendCommand<GenerateStateMachineResponse>(
          "generate_state_machine",
          {
            templates: approvedTemplates,
            grouping_method: groupingMethod,
            grouping_config:
              Object.keys(groupingConfig).length > 0
                ? groupingConfig
                : undefined,
            state_machine_name: stateMachineName,
            include_transitions: includeTransitions,
          }
        );

      if (!response.success || response.error || !response.result) {
        throw new Error(
          response.error || "Generation failed - no result returned"
        );
      }

      setResult(response.result);
      onGenerate?.(response.result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to generate state machine"
      );
      console.error("[GenerateStateMachineDialog] Error:", err);
    } finally {
      setGenerating(false);
    }
  }, [
    canGenerate,
    approvedTemplates,
    groupingMethod,
    coOccurrenceThreshold,
    videoPath,
    sampleInterval,
    singleStateName,
    stateMachineName,
    includeTransitions,
    onGenerate,
  ]);

  // Download result as JSON
  const handleDownload = useCallback(() => {
    if (!result) return;

    const blob = new Blob([JSON.stringify(result.config, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${stateMachineName.toLowerCase().replace(/\s+/g, "_")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [result, stateMachineName]);

  // Import result to project
  const handleImportToProject = useCallback(async () => {
    if (!result || !projectId) return;

    setImporting(true);
    setError(null);

    try {
      // Convert the generated state machine response to QontinuiConfig format
      const qontinuiConfig = convertToQontinuiConfig(result, {
        projectId,
        targetApplication: stateMachineName,
      });

      // Validate the generated config
      const validation = validateGeneratedConfig(qontinuiConfig);

      if (!validation.valid) {
        throw new Error(`Validation failed: ${validation.errors.join(", ")}`);
      }

      if (validation.warnings.length > 0) {
        console.warn(
          "[GenerateStateMachineDialog] Config warnings:",
          validation.warnings
        );
      }

      // Import to project with merge=true to add to existing config
      await projectService.importConfiguration(
        projectId,
        qontinuiConfig as unknown as Record<string, unknown>,
        true
      );

      setImportSuccess(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to import to project"
      );
      console.error("[GenerateStateMachineDialog] Import error:", err);
    } finally {
      setImporting(false);
    }
  }, [result, projectId, projectService, stateMachineName]);

  return {
    // Data
    approvedTemplates,
    result,
    uniqueStateHints,
    templatesByHint,
    error,

    // Loading states
    loadingTemplates,
    generating,
    importing,
    importSuccess,

    // Configuration state + setters
    groupingMethod,
    setGroupingMethod,
    stateMachineName,
    setStateMachineName,
    includeTransitions,
    setIncludeTransitions,
    showAdvanced,
    setShowAdvanced,
    coOccurrenceThreshold,
    setCoOccurrenceThreshold,
    sampleInterval,
    setSampleInterval,
    singleStateName,
    setSingleStateName,

    // Derived
    canGenerate,

    // Actions
    handleGenerate,
    handleDownload,
    handleImportToProject,
  };
}
