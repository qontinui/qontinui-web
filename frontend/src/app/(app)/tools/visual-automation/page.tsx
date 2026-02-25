"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRunnerHealth, useGuiLock, runnerApi } from "@/lib/runner-api";
import { useUnifiedWorkflows } from "@/lib/api/unified-workflows";
import { RunnerPartialState } from "@/components/runner/RunnerPartialState";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Play,
  Search,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  ExternalLink,
  AlertCircle,
  Activity,
  Settings,
  Monitor,
  ChevronDown,
  ChevronRight,
  Sliders,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

export default function ExecuteVisualAutomationPage() {
  const { isOffline, isLoading: healthLoading } = useRunnerHealth();
  const {
    data: workflows,
    isLoading: workflowsLoading,
    error: workflowsError,
  } = useUnifiedWorkflows();
  const { data: guiLock } = useGuiLock();
  const isGuiLocked = guiLock?.holder_id != null;

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(
    null
  );
  const [isRunning, setIsRunning] = useState(false);
  const [runResult, setRunResult] = useState<{
    success: boolean;
    taskRunId?: string;
    error?: string;
  } | null>(null);
  const [selectedMonitor, setSelectedMonitor] = useState("primary");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [initialStates, setInitialStates] = useState("");
  const [autoMinimize, setAutoMinimize] = useState(false);
  const [showToolkit, setShowToolkit] = useState(false);
  const [toolkitTab, setToolkitTab] = useState<"actions" | "macros">("actions");
  const [clickType, setClickType] = useState("click");
  const [typeText, setTypeText] = useState("");
  const [hotkeyInput, setHotkeyInput] = useState("");

  const filteredWorkflows = useMemo(() => {
    if (!workflows) return [];
    if (!searchQuery.trim()) return workflows;
    const lower = searchQuery.toLowerCase();
    return workflows.filter(
      (w) =>
        w.name.toLowerCase().includes(lower) ||
        w.description?.toLowerCase().includes(lower)
    );
  }, [workflows, searchQuery]);

  const selectedWorkflow = useMemo(() => {
    if (!selectedWorkflowId || !workflows) return null;
    return workflows.find((w) => w.id === selectedWorkflowId) ?? null;
  }, [selectedWorkflowId, workflows]);

  const handleRun = async () => {
    if (!selectedWorkflowId) return;
    setIsRunning(true);
    setRunResult(null);
    try {
      const result = await runnerApi.runWorkflow(selectedWorkflowId);
      setRunResult({ success: true, taskRunId: result.task_run_id });
    } catch (err) {
      setRunResult({
        success: false,
        error: err instanceof Error ? err.message : "Failed to start workflow",
      });
    } finally {
      setIsRunning(false);
    }
  };

  if (healthLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
      {/* Header */}
      <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Zap className="w-6 h-6 text-brand-primary" />
            <h1 className="text-2xl font-bold bg-gradient-to-r from-brand-primary to-brand-secondary bg-clip-text text-transparent">
              Execute
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {isGuiLocked && (
              <Badge variant="warning" className="gap-1.5">
                <Activity className="w-3 h-3 animate-pulse" />
                GUI In Use
              </Badge>
            )}
            <Badge variant="success" className="gap-1.5">
              <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
              Runner Connected
            </Badge>
            <Button
              variant={showToolkit ? "default" : "outline"}
              size="sm"
              onClick={() => setShowToolkit(!showToolkit)}
              className={
                showToolkit
                  ? "bg-brand-primary text-black"
                  : "border-border-default"
              }
            >
              <Wrench className="size-4 mr-1" />
              Toolkit
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main
        className="p-6 mx-auto flex gap-6"
        style={{ maxWidth: showToolkit ? "1200px" : "896px" }}
      >
        <div className="flex-1 space-y-6">
          {isOffline && (
            <RunnerPartialState message="Runner offline — this tool requires the runner for execution" />
          )}

          {/* Config Status */}
          <Card className="bg-surface-raised/50 border-border-subtle/50">
            <CardContent className="py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Settings className="size-4 text-text-muted" />
                  <div>
                    <p className="text-sm font-medium text-text-primary">
                      {selectedWorkflow
                        ? selectedWorkflow.name
                        : "No config loaded"}
                    </p>
                    <p className="text-xs text-text-muted">
                      {selectedWorkflow
                        ? "Active configuration"
                        : "Select a workflow to begin"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {selectedWorkflow ? (
                    <>
                      <Badge variant="success" className="text-xs gap-1">
                        <div className="size-1.5 rounded-full bg-white" />
                        Active
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedWorkflowId(null)}
                        className="text-text-muted text-xs"
                      >
                        Unload
                      </Button>
                    </>
                  ) : (
                    <Badge variant="secondary" className="text-xs">
                      No Config
                    </Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Monitor Selector */}
          <Card className="bg-surface-raised/50 border-border-subtle/50">
            <CardContent className="py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Monitor className="size-4 text-text-muted" />
                  <Label className="text-sm text-text-primary">
                    Target Monitor
                  </Label>
                </div>
                <Select
                  value={selectedMonitor}
                  onValueChange={setSelectedMonitor}
                >
                  <SelectTrigger className="w-[180px] bg-surface-raised/50 border-border-default">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="primary">Primary Monitor</SelectItem>
                    <SelectItem value="left">Left Monitor</SelectItem>
                    <SelectItem value="right">Right Monitor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* GUI Lock Status Card */}
          {guiLock && (
            <Card className="bg-surface-raised/50 border-border-subtle/50">
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Activity className="w-5 h-5 text-text-muted" />
                    <div>
                      <p className="text-sm font-medium text-text-primary">
                        GUI Status
                      </p>
                      <p className="text-xs text-text-muted">
                        {isGuiLocked
                          ? "A visual automation workflow is using the GUI"
                          : "Ready to execute workflows"}
                      </p>
                    </div>
                  </div>
                  <Badge variant={isGuiLocked ? "warning" : "info"}>
                    {isGuiLocked ? "locked" : "available"}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Workflow Selection */}
          <Card className="bg-surface-raised/50 border-border-subtle/50">
            <CardHeader>
              <CardTitle className="text-lg text-white flex items-center gap-2">
                <Play className="w-5 h-5" />
                Select Workflow
              </CardTitle>
              <CardDescription className="text-text-muted">
                Choose a workflow to execute on the connected runner
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <Input
                  placeholder="Search workflows..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 bg-surface-raised/50 border-border-subtle/50 text-white placeholder:text-text-muted"
                />
              </div>

              {/* Workflow List */}
              {workflowsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-16 bg-surface-raised/30 rounded-lg animate-pulse"
                    />
                  ))}
                </div>
              ) : workflowsError ? (
                <div className="flex items-center gap-2 text-red-400 py-4">
                  <AlertCircle className="w-5 h-5" />
                  <p className="text-sm">Failed to load workflows</p>
                </div>
              ) : filteredWorkflows.length === 0 ? (
                <div className="text-center py-8">
                  <Play className="w-12 h-12 mx-auto mb-3 text-text-muted" />
                  <p className="text-sm text-text-muted">
                    {searchQuery
                      ? "No workflows match your search"
                      : "No workflows available. Create one in the automation builder."}
                  </p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {filteredWorkflows.map((workflow) => (
                    <button
                      key={workflow.id}
                      onClick={() =>
                        setSelectedWorkflowId(
                          selectedWorkflowId === workflow.id
                            ? null
                            : workflow.id
                        )
                      }
                      className={`w-full text-left p-4 rounded-lg border transition-all ${
                        selectedWorkflowId === workflow.id
                          ? "border-brand-primary bg-brand-primary/10"
                          : "border-border-subtle/50 bg-surface-canvas/50 hover:bg-surface-hover"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-text-primary truncate">
                            {workflow.name}
                          </p>
                          {workflow.description && (
                            <p className="text-sm text-text-muted mt-1 truncate">
                              {workflow.description}
                            </p>
                          )}
                        </div>
                        {selectedWorkflowId === workflow.id && (
                          <CheckCircle2 className="w-5 h-5 text-brand-primary flex-shrink-0 ml-3" />
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Advanced Settings */}
          <Card className="bg-surface-raised/50 border-border-subtle/50">
            <CardHeader
              className="cursor-pointer py-3"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  {showAdvanced ? (
                    <ChevronDown className="size-4" />
                  ) : (
                    <ChevronRight className="size-4" />
                  )}
                  <Sliders className="size-4" />
                  Advanced Settings
                </CardTitle>
              </div>
            </CardHeader>
            {showAdvanced && (
              <CardContent className="space-y-4 pt-0">
                <div className="space-y-2">
                  <Label className="text-sm">Initial States</Label>
                  <Input
                    placeholder="Comma-separated state names (optional)"
                    value={initialStates}
                    onChange={(e) => setInitialStates(e.target.value)}
                    className="bg-surface-canvas/50 border-border-subtle/50"
                  />
                  <p className="text-xs text-text-muted">
                    Override the starting states for execution
                  </p>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm">Auto-Minimize</Label>
                    <p className="text-xs text-text-muted mt-0.5">
                      Minimize the runner window during execution
                    </p>
                  </div>
                  <Switch
                    checked={autoMinimize}
                    onCheckedChange={setAutoMinimize}
                  />
                </div>
              </CardContent>
            )}
          </Card>

          {/* Run Action */}
          {selectedWorkflow && (
            <Card className="bg-surface-raised/50 border-border-subtle/50">
              <CardContent className="py-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-text-primary">
                      {selectedWorkflow.name}
                    </p>
                    <p className="text-sm text-text-muted mt-1">
                      {selectedWorkflow.description ?? "Ready to execute"}
                    </p>
                  </div>
                  <Button
                    onClick={handleRun}
                    disabled={isRunning || isGuiLocked}
                    className="bg-brand-primary hover:bg-brand-primary/90 text-black font-semibold px-6"
                  >
                    {isRunning ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        Starting...
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 mr-2" />
                        Run
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Run Result */}
          {runResult && (
            <Card
              className={`border ${
                runResult.success
                  ? "bg-green-950/30 border-green-500/50"
                  : "bg-red-950/30 border-red-500/50"
              }`}
            >
              <CardContent className="py-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {runResult.success ? (
                      <CheckCircle2 className="w-6 h-6 text-green-400" />
                    ) : (
                      <XCircle className="w-6 h-6 text-red-400" />
                    )}
                    <div>
                      <p className="font-medium text-text-primary">
                        {runResult.success
                          ? "Workflow started successfully"
                          : "Failed to start workflow"}
                      </p>
                      {runResult.success && runResult.taskRunId && (
                        <p className="text-sm text-text-muted mt-1">
                          Task Run #{runResult.taskRunId}
                        </p>
                      )}
                      {runResult.error && (
                        <p className="text-sm text-red-400 mt-1">
                          {runResult.error}
                        </p>
                      )}
                    </div>
                  </div>
                  {runResult.success && (
                    <Link href="/monitor">
                      <Button
                        variant="outline"
                        className="border-green-500/50 text-green-400 hover:bg-green-950/50"
                      >
                        <ExternalLink className="w-4 h-4 mr-2" />
                        View Dashboard
                      </Button>
                    </Link>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Info */}
          {!selectedWorkflow && !runResult && (
            <Card className="bg-surface-raised/50 border-border-subtle/50">
              <CardContent className="py-12">
                <div className="text-center">
                  <Clock className="w-12 h-12 mx-auto mb-4 text-text-muted" />
                  <h3 className="text-lg font-medium text-text-secondary mb-2">
                    Select a Workflow to Execute
                  </h3>
                  <p className="text-sm text-text-muted max-w-md mx-auto">
                    Choose a workflow from the list above, then click Run to
                    start execution on the connected runner. You can monitor
                    progress in the live dashboard.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Toolkit Panel */}
        {showToolkit && (
          <div className="w-80 shrink-0 space-y-4">
            <Card className="bg-surface-raised/50 border-border-subtle/50 sticky top-24">
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Wrench className="size-4" />
                  Automation Toolkit
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-1">
                  <Button
                    variant={toolkitTab === "actions" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setToolkitTab("actions")}
                    className={`flex-1 text-xs ${toolkitTab === "actions" ? "bg-brand-primary text-black" : ""}`}
                  >
                    Quick Actions
                  </Button>
                  <Button
                    variant={toolkitTab === "macros" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setToolkitTab("macros")}
                    className={`flex-1 text-xs ${toolkitTab === "macros" ? "bg-brand-primary text-black" : ""}`}
                  >
                    Macros
                  </Button>
                </div>

                {toolkitTab === "actions" && (
                  <div className="space-y-3">
                    {/* Click Type */}
                    <div className="space-y-1.5">
                      <Label className="text-xs">Click Type</Label>
                      <div className="grid grid-cols-3 gap-1">
                        {["click", "double", "right"].map((type) => (
                          <Button
                            key={type}
                            variant={clickType === type ? "default" : "outline"}
                            size="sm"
                            onClick={() => setClickType(type)}
                            className={`text-xs capitalize ${clickType === type ? "bg-brand-primary text-black" : ""}`}
                          >
                            {type}
                          </Button>
                        ))}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full text-xs mt-1"
                        onClick={() => {
                          if (!selectedWorkflow) {
                            toast.warning(
                              "Load a config first to use click actions"
                            );
                          } else {
                            toast.warning(
                              "Image target selection not yet available. Use click actions from a workflow."
                            );
                          }
                        }}
                      >
                        <Play className="size-3 mr-1" />
                        Execute {clickType} click
                      </Button>
                    </div>

                    {/* Type Text */}
                    <div className="space-y-1.5">
                      <Label className="text-xs">Type Text</Label>
                      <div className="flex gap-1">
                        <Input
                          placeholder="Text to type..."
                          value={typeText}
                          onChange={(e) => setTypeText(e.target.value)}
                          className="bg-surface-canvas/50 border-border-subtle/50 text-xs"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            if (!typeText.trim()) {
                              toast.error("Enter text to type");
                              return;
                            }
                            try {
                              await runnerApi.executeAction({
                                action_type: "type",
                                text_input: typeText,
                              });
                              toast.success("Text typed successfully");
                              setTypeText("");
                            } catch (err) {
                              toast.error(
                                err instanceof Error
                                  ? err.message
                                  : "Failed to type text"
                              );
                            }
                          }}
                        >
                          <Play className="size-3" />
                        </Button>
                      </div>
                    </div>

                    {/* Hotkey */}
                    <div className="space-y-1.5">
                      <Label className="text-xs">Hotkey</Label>
                      <div className="flex gap-1">
                        <Input
                          placeholder="e.g. ctrl+s"
                          value={hotkeyInput}
                          onChange={(e) => setHotkeyInput(e.target.value)}
                          className="bg-surface-canvas/50 border-border-subtle/50 text-xs font-mono"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            if (!hotkeyInput.trim()) {
                              toast.error("Enter a hotkey combination");
                              return;
                            }
                            try {
                              await runnerApi.executeAction({
                                action_type: "hotkey",
                                hotkey: hotkeyInput,
                              });
                              toast.success("Hotkey executed successfully");
                              setHotkeyInput("");
                            } catch (err) {
                              toast.error(
                                err instanceof Error
                                  ? err.message
                                  : "Failed to execute hotkey"
                              );
                            }
                          }}
                        >
                          <Play className="size-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {toolkitTab === "macros" && (
                  <div className="text-center py-6">
                    <Zap className="size-8 mx-auto mb-2 text-text-muted" />
                    <p className="text-xs text-text-muted">
                      No macros available.
                    </p>
                    <p className="text-xs text-text-muted mt-1">
                      Create macros in the Build section.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
