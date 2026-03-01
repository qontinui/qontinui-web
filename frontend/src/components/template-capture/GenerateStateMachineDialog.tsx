/**
 * GenerateStateMachineDialog Component
 *
 * Dialog for generating a state machine from approved template candidates.
 *
 * Features:
 * - Select grouping method (state hints, user assignments, co-occurrence, etc.)
 * - Configure grouping options
 * - Preview approved templates
 * - Generate state machine via runner command
 * - Display generation results
 */

import React, { useState, useCallback, useEffect, useMemo } from "react";
import {
  Loader2,
  Wand2,
  Download,
  Check,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Layers,
  GitBranch,
  Upload,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
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

export interface GenerateStateMachineDialogProps {
  projectId?: string;
  sessionId?: string;
  videoPath?: string;
  onGenerate?: (result: GenerateStateMachineResponse) => void;
  onClose: () => void;
}

interface GroupingMethodOption {
  value: GroupingMethod;
  label: string;
  description: string;
  requiresConfig: boolean;
}

const GROUPING_METHODS: GroupingMethodOption[] = [
  {
    value: "state_hints",
    label: "State Hints",
    description:
      "Group templates by their assigned state hints (set during review)",
    requiresConfig: false,
  },
  {
    value: "co_occurrence",
    label: "Co-Occurrence Analysis",
    description:
      "Group templates that appear together in the same video frames",
    requiresConfig: true,
  },
  {
    value: "single_state",
    label: "Single State",
    description: "Put all templates into a single state",
    requiresConfig: true,
  },
  {
    value: "one_per_template",
    label: "One State per Template",
    description: "Create a separate state for each template",
    requiresConfig: false,
  },
  {
    value: "user_assignments",
    label: "Manual Assignments",
    description: "Manually assign templates to states",
    requiresConfig: true,
  },
];

export function GenerateStateMachineDialog({
  projectId,
  sessionId,
  videoPath,
  onGenerate,
  onClose,
}: GenerateStateMachineDialogProps) {
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

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5" />
            Generate State Machine
          </DialogTitle>
          <DialogDescription>
            Create a state machine configuration from approved templates
          </DialogDescription>
        </DialogHeader>

        {loadingTemplates ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : result ? (
          // Results View
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-2 text-green-600">
              <Check className="h-5 w-5" />
              <span className="font-medium">State machine generated</span>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 bg-muted rounded-lg text-center">
                <div className="text-2xl font-bold">
                  {result.grouping_result.state_count}
                </div>
                <div className="text-sm text-muted-foreground">States</div>
              </div>
              <div className="p-4 bg-muted rounded-lg text-center">
                <div className="text-2xl font-bold">
                  {result.grouping_result.total_state_images}
                </div>
                <div className="text-sm text-muted-foreground">
                  State Images
                </div>
              </div>
              <div className="p-4 bg-muted rounded-lg text-center">
                <div className="text-2xl font-bold">
                  {result.config.transitions.length}
                </div>
                <div className="text-sm text-muted-foreground">Transitions</div>
              </div>
            </div>

            {result.grouping_result.ungrouped_count > 0 && (
              <div className="flex items-center gap-2 text-yellow-600 text-sm">
                <AlertCircle className="h-4 w-4" />
                {result.grouping_result.ungrouped_count} templates were not
                assigned to any state
              </div>
            )}

            <Separator />

            {/* State Summary */}
            <div className="space-y-2">
              <Label>States</Label>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {result.config.states.map((state) => (
                  <div
                    key={state.id}
                    className="flex items-center justify-between p-2 bg-muted/50 rounded"
                  >
                    <div className="flex items-center gap-2">
                      <Layers className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{state.name}</span>
                      {state.is_initial && (
                        <Badge variant="secondary" className="text-xs">
                          Initial
                        </Badge>
                      )}
                    </div>
                    <Badge variant="outline">
                      {state.state_images.length} images
                    </Badge>
                  </div>
                ))}
              </div>
            </div>

            <div className="text-xs text-muted-foreground">
              Processing time:{" "}
              {result.grouping_result.processing_time_ms.toFixed(1)}ms
            </div>

            {/* Import Success Message */}
            {importSuccess && (
              <div className="flex items-center gap-2 p-3 bg-green-50 text-green-700 rounded-lg text-sm">
                <Check className="h-4 w-4 flex-shrink-0" />
                Configuration imported to project successfully. The states and
                transitions have been merged with your existing project
                configuration.
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {error}
              </div>
            )}
          </div>
        ) : (
          // Configuration View
          <div className="space-y-6 py-4">
            {/* Template Summary */}
            <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
              <div>
                <div className="font-medium">
                  {approvedTemplates.length} Approved Templates
                </div>
                <div className="text-sm text-muted-foreground">
                  {uniqueStateHints.length > 0
                    ? `${uniqueStateHints.length} state hints defined`
                    : "No state hints defined"}
                </div>
              </div>
              {templatesByHint.noHint > 0 && (
                <Badge variant="secondary" className="text-yellow-600">
                  {templatesByHint.noHint} without hints
                </Badge>
              )}
            </div>

            {/* State Machine Name */}
            <div className="space-y-2">
              <Label htmlFor="smName">State Machine Name</Label>
              <Input
                id="smName"
                value={stateMachineName}
                onChange={(e) => setStateMachineName(e.target.value)}
                placeholder="Enter a name for the state machine"
              />
            </div>

            {/* Grouping Method */}
            <div className="space-y-2">
              <Label>Grouping Method</Label>
              <Select
                value={groupingMethod}
                onValueChange={(v) => setGroupingMethod(v as GroupingMethod)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GROUPING_METHODS.map((method) => (
                    <SelectItem key={method.value} value={method.value}>
                      <div className="flex flex-col">
                        <span>{method.label}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {
                  GROUPING_METHODS.find((m) => m.value === groupingMethod)
                    ?.description
                }
              </p>
            </div>

            {/* Method-specific Options */}
            {groupingMethod === "state_hints" &&
              uniqueStateHints.length === 0 && (
                <div className="flex items-center gap-2 p-3 bg-yellow-50 text-yellow-700 rounded-lg text-sm">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  No state hints have been assigned. Go back to the review panel
                  and assign state hints to templates.
                </div>
              )}

            {groupingMethod === "state_hints" &&
              uniqueStateHints.length > 0 && (
                <div className="space-y-2">
                  <Label>State Hints Preview</Label>
                  <div className="flex flex-wrap gap-2">
                    {uniqueStateHints.map((hint) => (
                      <Badge key={hint} variant="outline">
                        {hint} ({templatesByHint.byHint[hint]})
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

            {groupingMethod === "co_occurrence" && (
              <div className="space-y-4 p-4 border rounded-lg">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Co-Occurrence Threshold</Label>
                    <span className="text-sm text-muted-foreground">
                      {Math.round(coOccurrenceThreshold * 100)}%
                    </span>
                  </div>
                  <Slider
                    value={[coOccurrenceThreshold]}
                    min={0.5}
                    max={1}
                    step={0.05}
                    onValueChange={([v]) =>
                      v !== undefined && setCoOccurrenceThreshold(v)
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Templates appearing together above this threshold are
                    grouped
                  </p>
                </div>

                {!videoPath && (
                  <div className="flex items-center gap-2 p-3 bg-yellow-50 text-yellow-700 rounded-lg text-sm">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    Co-occurrence analysis requires the original video file
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Sample Interval (frames)</Label>
                  <Input
                    type="number"
                    value={sampleInterval}
                    onChange={(e) =>
                      setSampleInterval(parseInt(e.target.value) || 30)
                    }
                    min={1}
                    max={120}
                  />
                  <p className="text-xs text-muted-foreground">
                    Analyze every Nth frame for template presence
                  </p>
                </div>
              </div>
            )}

            {groupingMethod === "single_state" && (
              <div className="space-y-2">
                <Label htmlFor="singleStateName">State Name</Label>
                <Input
                  id="singleStateName"
                  value={singleStateName}
                  onChange={(e) => setSingleStateName(e.target.value)}
                  placeholder="Main State"
                />
              </div>
            )}

            {/* Advanced Options */}
            <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-between"
                >
                  Advanced Options
                  {showAdvanced ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-4">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="includeTransitions"
                    checked={includeTransitions}
                    onChange={(e) => setIncludeTransitions(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <Label htmlFor="includeTransitions" className="font-normal">
                    Generate transitions between states
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Creates click-based transitions from each template&apos;s
                  source state
                </p>
              </CollapsibleContent>
            </Collapsible>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {error}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button variant="outline" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
              {projectId && (
                <Button
                  onClick={handleImportToProject}
                  disabled={importing || importSuccess}
                >
                  {importing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Importing...
                    </>
                  ) : importSuccess ? (
                    <>
                      <Check className="h-4 w-4 mr-2" />
                      Imported
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      Import to Project
                    </>
                  )}
                </Button>
              )}
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                onClick={handleGenerate}
                disabled={!canGenerate || generating}
              >
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Wand2 className="h-4 w-4 mr-2" />
                    Generate
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
