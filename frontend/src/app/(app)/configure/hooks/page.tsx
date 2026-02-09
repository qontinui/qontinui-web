"use client";

import { useState, useCallback } from "react";
import {
  useRunnerHealth,
  useHooks,
  runnerApi,
  type Hook,
  type HookTrigger,
  type HookActionType,
  type HookCondition,
  type CreateHookRequest,
  type UpdateHookRequest,
  type TestHookResponse,
} from "@/lib/runner-api";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2,
  Webhook,
  Plus,
  Trash2,
  Save,
  AlertCircle,
  X,
  RefreshCw,
  Search,
  Zap,
  Bell,
  Terminal,
  Globe,
  GripVertical,
  Pencil,
  Play,
  Pause,
  PlayCircle,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ============================================================================
// Constants
// ============================================================================

const TRIGGERS: {
  value: HookTrigger;
  label: string;
  description: string;
  color: string;
}[] = [
  {
    value: "pre_execution",
    label: "Pre-Execution",
    description: "Before task execution starts",
    color: "text-blue-400 border-blue-500/30 bg-blue-500/5",
  },
  {
    value: "post_execution",
    label: "Post-Execution",
    description: "After task execution completes",
    color: "text-green-400 border-green-500/30 bg-green-500/5",
  },
  {
    value: "on_error",
    label: "On Error",
    description: "When an error occurs",
    color: "text-red-400 border-red-500/30 bg-red-500/5",
  },
  {
    value: "on_verification_fail",
    label: "On Verification Fail",
    description: "When verification fails",
    color: "text-orange-400 border-orange-500/30 bg-orange-500/5",
  },
  {
    value: "on_complete",
    label: "On Complete",
    description: "When task completes successfully",
    color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/5",
  },
  {
    value: "pre_iteration",
    label: "Pre-Iteration",
    description: "Before each iteration",
    color: "text-cyan-400 border-cyan-500/30 bg-cyan-500/5",
  },
  {
    value: "post_iteration",
    label: "Post-Iteration",
    description: "After each iteration",
    color: "text-purple-400 border-purple-500/30 bg-purple-500/5",
  },
];

const ACTION_TYPES: {
  value: HookActionType;
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
}[] = [
  {
    value: "command",
    label: "Shell Command",
    description: "Execute a shell command on the local system",
    icon: Terminal,
    color: "text-green-400",
  },
  {
    value: "webhook",
    label: "Webhook",
    description: "Send an HTTP request to a URL",
    icon: Globe,
    color: "text-blue-400",
  },
  {
    value: "log",
    label: "Log Message",
    description: "Log a message to the application logs",
    icon: MessageSquare,
    color: "text-amber-400",
  },
  {
    value: "notification",
    label: "System Notification",
    description: "Send a system notification",
    icon: Bell,
    color: "text-purple-400",
  },
];

const CONDITION_VARIABLES = [
  { value: "task_run_id", label: "Task Run ID" },
  { value: "task_name", label: "Task Name" },
  { value: "iteration", label: "Iteration" },
  { value: "status", label: "Status" },
  { value: "error", label: "Error" },
];

const CONDITION_OPERATORS = [
  { value: "eq", label: "equals" },
  { value: "ne", label: "not equals" },
  { value: "gt", label: "greater than" },
  { value: "lt", label: "less than" },
  { value: "gte", label: "greater or equal" },
  { value: "lte", label: "less or equal" },
  { value: "contains", label: "contains" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
  { value: "matches", label: "matches regex" },
];

// ============================================================================
// Helper Functions
// ============================================================================

function getTriggerInfo(trigger: HookTrigger) {
  return TRIGGERS.find((t) => t.value === trigger) ?? TRIGGERS[0]!;
}

function getActionTypeInfo(actionType: HookActionType) {
  return ACTION_TYPES.find((a) => a.value === actionType) ?? ACTION_TYPES[0]!;
}

function getTriggerBadgeVariant(trigger: HookTrigger) {
  switch (trigger) {
    case "pre_execution":
      return "info" as const;
    case "post_execution":
      return "success" as const;
    case "on_error":
      return "destructive" as const;
    case "on_verification_fail":
      return "warning" as const;
    case "on_complete":
      return "success" as const;
    case "pre_iteration":
      return "secondary" as const;
    case "post_iteration":
      return "secondary" as const;
    default:
      return "outline" as const;
  }
}

function getActionSummary(
  actionType: HookActionType,
  config: Record<string, unknown>
): string {
  switch (actionType) {
    case "command":
      return String(config.command ?? "").slice(0, 60);
    case "webhook":
      return `${config.method ?? "POST"} ${String(config.url ?? "").slice(0, 50)}`;
    case "log":
      return `[${config.level ?? "info"}] ${String(config.message ?? "").slice(0, 50)}`;
    case "notification":
      return String(config.title ?? "").slice(0, 60);
    default:
      return "";
  }
}

// ============================================================================
// Hook Editor Modal
// ============================================================================

interface HookEditorProps {
  hook?: Hook;
  onSave: (hook: CreateHookRequest | UpdateHookRequest) => Promise<void>;
  onClose: () => void;
}

function HookEditor({ hook, onSave, onClose }: HookEditorProps) {
  const isEditing = !!hook;

  const [name, setName] = useState(hook?.name ?? "");
  const [description, setDescription] = useState(hook?.description ?? "");
  const [trigger, setTrigger] = useState<HookTrigger>(
    hook?.trigger ?? "post_execution"
  );
  const [actionType, setActionType] = useState<HookActionType>(
    hook?.action_type ?? "command"
  );
  const [enabled, setEnabled] = useState(hook?.enabled ?? true);
  const [executionOrder, setExecutionOrder] = useState(
    hook?.execution_order ?? 0
  );
  const [continueOnFailure, setContinueOnFailure] = useState(
    hook?.continue_on_failure ?? true
  );
  const [conditions, setConditions] = useState<HookCondition[]>(
    hook?.conditions ?? []
  );

  // Command action fields
  const [cmdCommand, setCmdCommand] = useState(
    String(hook?.action_config?.command ?? "")
  );
  const [cmdWorkingDir, setCmdWorkingDir] = useState(
    String(hook?.action_config?.working_dir ?? "")
  );
  const [cmdTimeout, setCmdTimeout] = useState(
    Number(hook?.action_config?.timeout_seconds ?? 30)
  );
  const [cmdEnvVars, setCmdEnvVars] = useState<[string, string][]>(() => {
    const env = hook?.action_config?.env;
    if (env && typeof env === "object") {
      return Object.entries(env as Record<string, string>);
    }
    return [];
  });

  // Webhook action fields
  const [webhookUrl, setWebhookUrl] = useState(
    String(hook?.action_config?.url ?? "")
  );
  const [webhookMethod, setWebhookMethod] = useState(
    String(hook?.action_config?.method ?? "POST")
  );
  const [webhookHeaders, setWebhookHeaders] = useState<[string, string][]>(
    () => {
      const headers = hook?.action_config?.headers;
      if (headers && typeof headers === "object") {
        return Object.entries(headers as Record<string, string>);
      }
      return [];
    }
  );
  const [webhookBody, setWebhookBody] = useState(
    String(hook?.action_config?.body ?? "")
  );
  const [webhookTimeout, setWebhookTimeout] = useState(
    Number(hook?.action_config?.timeout_seconds ?? 30)
  );

  // Log action fields
  const [logLevel, setLogLevel] = useState(
    String(hook?.action_config?.level ?? "info")
  );
  const [logMessage, setLogMessage] = useState(
    String(hook?.action_config?.message ?? "")
  );

  // Notification action fields
  const [notifTitle, setNotifTitle] = useState(
    String(hook?.action_config?.title ?? "")
  );
  const [notifBody, setNotifBody] = useState(
    String(hook?.action_config?.body ?? "")
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildActionConfig = useCallback((): Record<string, unknown> => {
    switch (actionType) {
      case "command": {
        const config: Record<string, unknown> = {
          command: cmdCommand,
          timeout_seconds: cmdTimeout,
        };
        if (cmdWorkingDir) config.working_dir = cmdWorkingDir;
        if (cmdEnvVars.length > 0) {
          config.env = Object.fromEntries(cmdEnvVars.filter(([k]) => k.trim()));
        }
        return config;
      }
      case "webhook": {
        const config: Record<string, unknown> = {
          url: webhookUrl,
          method: webhookMethod,
          timeout_seconds: webhookTimeout,
        };
        if (webhookHeaders.length > 0) {
          config.headers = Object.fromEntries(
            webhookHeaders.filter(([k]) => k.trim())
          );
        }
        if (webhookBody) config.body = webhookBody;
        return config;
      }
      case "log":
        return { level: logLevel, message: logMessage };
      case "notification":
        return { title: notifTitle, body: notifBody };
    }
  }, [
    actionType,
    cmdCommand,
    cmdWorkingDir,
    cmdTimeout,
    cmdEnvVars,
    webhookUrl,
    webhookMethod,
    webhookHeaders,
    webhookBody,
    webhookTimeout,
    logLevel,
    logMessage,
    notifTitle,
    notifBody,
  ]);

  const validate = (): string | null => {
    if (!name.trim()) return "Name is required";
    switch (actionType) {
      case "command":
        if (!cmdCommand.trim()) return "Command is required";
        break;
      case "webhook":
        if (!webhookUrl.trim()) return "Webhook URL is required";
        break;
      case "log":
        if (!logMessage.trim()) return "Log message is required";
        break;
      case "notification":
        if (!notifTitle.trim()) return "Notification title is required";
        if (!notifBody.trim()) return "Notification body is required";
        break;
    }
    return null;
  };

  const handleSave = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const actionConfig = buildActionConfig();
      if (isEditing) {
        await onSave({
          name: name.trim(),
          description: description.trim() || null,
          trigger,
          action_type: actionType,
          action_config: actionConfig,
          enabled,
          execution_order: executionOrder,
          continue_on_failure: continueOnFailure,
          conditions,
        } as UpdateHookRequest);
      } else {
        await onSave({
          name: name.trim(),
          description: description.trim() || undefined,
          trigger,
          action_type: actionType,
          action_config: actionConfig,
          enabled,
          execution_order: executionOrder,
          continue_on_failure: continueOnFailure,
          conditions,
        } as CreateHookRequest);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save hook");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-raised border border-border-subtle/50 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle/50">
          <h2 className="text-lg font-semibold text-white">
            {isEditing ? "Edit Hook" : "Create Hook"}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-text-muted hover:text-white"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="p-6 space-y-6">
          {/* Basic Information */}
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-text-muted mb-1.5 block">
                Name <span className="text-red-400">*</span>
              </label>
              <Input
                placeholder="e.g., Slack Error Notification"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-surface-raised/50 border-border-subtle/50 text-white"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-text-muted mb-1.5 block">
                Description
              </label>
              <Textarea
                placeholder="Optional description..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="bg-surface-raised/50 border-border-subtle/50 text-white resize-none"
              />
            </div>
          </div>

          {/* Trigger Selection */}
          <div>
            <label className="text-sm font-medium text-text-muted mb-2 block">
              Trigger
            </label>
            <div className="grid grid-cols-2 gap-2">
              {TRIGGERS.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setTrigger(t.value)}
                  className={`p-3 rounded-lg border text-left transition-all ${
                    trigger === t.value
                      ? "border-brand-primary/50 bg-brand-primary/5 ring-1 ring-brand-primary/30"
                      : "border-border-subtle/30 bg-surface-canvas/20 hover:border-border-subtle/50"
                  }`}
                >
                  <p
                    className={`text-sm font-medium ${trigger === t.value ? "text-brand-primary" : "text-text-primary"}`}
                  >
                    {t.label}
                  </p>
                  <p className="text-xs text-text-muted mt-0.5">
                    {t.description}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Action Type Selection */}
          <div>
            <label className="text-sm font-medium text-text-muted mb-2 block">
              Action Type
            </label>
            <div className="grid grid-cols-2 gap-2">
              {ACTION_TYPES.map((a) => {
                const Icon = a.icon;
                return (
                  <button
                    key={a.value}
                    onClick={() => setActionType(a.value)}
                    className={`p-3 rounded-lg border text-left transition-all flex items-start gap-3 ${
                      actionType === a.value
                        ? "border-brand-primary/50 bg-brand-primary/5 ring-1 ring-brand-primary/30"
                        : "border-border-subtle/30 bg-surface-canvas/20 hover:border-border-subtle/50"
                    }`}
                  >
                    <Icon className={`w-5 h-5 mt-0.5 ${a.color}`} />
                    <div>
                      <p
                        className={`text-sm font-medium ${actionType === a.value ? "text-brand-primary" : "text-text-primary"}`}
                      >
                        {a.label}
                      </p>
                      <p className="text-xs text-text-muted mt-0.5">
                        {a.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Action Configuration */}
          <div className="space-y-4">
            <label className="text-sm font-medium text-text-muted block">
              Action Configuration
            </label>

            {actionType === "command" && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-text-muted mb-1 block">
                    Command <span className="text-red-400">*</span>
                  </label>
                  <Textarea
                    placeholder='echo "Task {{task_name}} completed"'
                    value={cmdCommand}
                    onChange={(e) => setCmdCommand(e.target.value)}
                    rows={3}
                    className="bg-surface-raised/50 border-border-subtle/50 text-white font-mono text-sm resize-none"
                  />
                  <p className="text-xs text-text-muted mt-1">
                    Supports variables: {"{{task_name}}"}, {"{{iteration}}"},
                    {"{{status}}"}, {"{{error}}"}
                  </p>
                </div>
                <div>
                  <label className="text-xs text-text-muted mb-1 block">
                    Working Directory
                  </label>
                  <Input
                    placeholder="e.g., C:\path\to\directory"
                    value={cmdWorkingDir}
                    onChange={(e) => setCmdWorkingDir(e.target.value)}
                    className="bg-surface-raised/50 border-border-subtle/50 text-white text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-text-muted mb-1 block">
                    Timeout (seconds)
                  </label>
                  <Input
                    type="number"
                    min={1}
                    max={600}
                    value={cmdTimeout}
                    onChange={(e) => setCmdTimeout(Number(e.target.value))}
                    className="bg-surface-raised/50 border-border-subtle/50 text-white text-sm w-32"
                  />
                </div>
                <div>
                  <label className="text-xs text-text-muted mb-1 block">
                    Environment Variables
                  </label>
                  {cmdEnvVars.map(([key, val], i) => (
                    <div key={i} className="flex items-center gap-2 mb-2">
                      <Input
                        placeholder="KEY"
                        value={key}
                        onChange={(e) => {
                          const updated = [...cmdEnvVars];
                          updated[i] = [e.target.value, val];
                          setCmdEnvVars(updated);
                        }}
                        className="bg-surface-raised/50 border-border-subtle/50 text-white text-sm flex-1 font-mono"
                      />
                      <span className="text-text-muted">=</span>
                      <Input
                        placeholder="value"
                        value={val}
                        onChange={(e) => {
                          const updated = [...cmdEnvVars];
                          updated[i] = [key, e.target.value];
                          setCmdEnvVars(updated);
                        }}
                        className="bg-surface-raised/50 border-border-subtle/50 text-white text-sm flex-1"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-text-muted hover:text-red-400"
                        onClick={() =>
                          setCmdEnvVars(cmdEnvVars.filter((_, j) => j !== i))
                        }
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-brand-primary hover:text-brand-primary/80"
                    onClick={() => setCmdEnvVars([...cmdEnvVars, ["", ""]])}
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    Add Variable
                  </Button>
                </div>
              </div>
            )}

            {actionType === "webhook" && (
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <label className="text-xs text-text-muted mb-1 block">
                      Method
                    </label>
                    <Select
                      value={webhookMethod}
                      onValueChange={setWebhookMethod}
                    >
                      <SelectTrigger className="bg-surface-raised/50 border-border-subtle/50 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-surface-raised border-border-subtle">
                        {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                          <SelectItem key={m} value={m}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-3">
                    <label className="text-xs text-text-muted mb-1 block">
                      URL <span className="text-red-400">*</span>
                    </label>
                    <Input
                      placeholder="https://hooks.slack.com/services/..."
                      value={webhookUrl}
                      onChange={(e) => setWebhookUrl(e.target.value)}
                      className="bg-surface-raised/50 border-border-subtle/50 text-white text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-text-muted mb-1 block">
                    Headers
                  </label>
                  {webhookHeaders.map(([key, val], i) => (
                    <div key={i} className="flex items-center gap-2 mb-2">
                      <Input
                        placeholder="Header-Name"
                        value={key}
                        onChange={(e) => {
                          const updated = [...webhookHeaders];
                          updated[i] = [e.target.value, val];
                          setWebhookHeaders(updated);
                        }}
                        className="bg-surface-raised/50 border-border-subtle/50 text-white text-sm flex-1 font-mono"
                      />
                      <span className="text-text-muted">:</span>
                      <Input
                        placeholder="value"
                        value={val}
                        onChange={(e) => {
                          const updated = [...webhookHeaders];
                          updated[i] = [key, e.target.value];
                          setWebhookHeaders(updated);
                        }}
                        className="bg-surface-raised/50 border-border-subtle/50 text-white text-sm flex-1"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-text-muted hover:text-red-400"
                        onClick={() =>
                          setWebhookHeaders(
                            webhookHeaders.filter((_, j) => j !== i)
                          )
                        }
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-brand-primary hover:text-brand-primary/80"
                    onClick={() =>
                      setWebhookHeaders([...webhookHeaders, ["", ""]])
                    }
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    Add Header
                  </Button>
                </div>
                <div>
                  <label className="text-xs text-text-muted mb-1 block">
                    Request Body
                  </label>
                  <Textarea
                    placeholder='{"text": "Task {{task_name}} completed with status {{status}}"}'
                    value={webhookBody}
                    onChange={(e) => setWebhookBody(e.target.value)}
                    rows={4}
                    className="bg-surface-raised/50 border-border-subtle/50 text-white font-mono text-sm resize-none"
                  />
                  <p className="text-xs text-text-muted mt-1">
                    Supports variable substitution like {"{{task_name}}"}
                  </p>
                </div>
                <div>
                  <label className="text-xs text-text-muted mb-1 block">
                    Timeout (seconds)
                  </label>
                  <Input
                    type="number"
                    min={1}
                    max={300}
                    value={webhookTimeout}
                    onChange={(e) => setWebhookTimeout(Number(e.target.value))}
                    className="bg-surface-raised/50 border-border-subtle/50 text-white text-sm w-32"
                  />
                </div>
              </div>
            )}

            {actionType === "log" && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-text-muted mb-1 block">
                    Log Level
                  </label>
                  <Select value={logLevel} onValueChange={setLogLevel}>
                    <SelectTrigger className="bg-surface-raised/50 border-border-subtle/50 text-sm w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-surface-raised border-border-subtle">
                      {["debug", "info", "warn", "error"].map((l) => (
                        <SelectItem key={l} value={l}>
                          {l}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-text-muted mb-1 block">
                    Message <span className="text-red-400">*</span>
                  </label>
                  <Textarea
                    placeholder="Task {{task_name}} iteration {{iteration}} status: {{status}}"
                    value={logMessage}
                    onChange={(e) => setLogMessage(e.target.value)}
                    rows={3}
                    className="bg-surface-raised/50 border-border-subtle/50 text-white text-sm resize-none"
                  />
                  <p className="text-xs text-text-muted mt-1">
                    Variables: {"{{task_run_id}}"}, {"{{task_name}}"},
                    {"{{iteration}}"}, {"{{status}}"}, {"{{error}}"}
                  </p>
                </div>
              </div>
            )}

            {actionType === "notification" && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-text-muted mb-1 block">
                    Title <span className="text-red-400">*</span>
                  </label>
                  <Input
                    placeholder="Task {{task_name}} Complete"
                    value={notifTitle}
                    onChange={(e) => setNotifTitle(e.target.value)}
                    className="bg-surface-raised/50 border-border-subtle/50 text-white text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-text-muted mb-1 block">
                    Body <span className="text-red-400">*</span>
                  </label>
                  <Textarea
                    placeholder="Completed iteration {{iteration}} with status {{status}}"
                    value={notifBody}
                    onChange={(e) => setNotifBody(e.target.value)}
                    rows={3}
                    className="bg-surface-raised/50 border-border-subtle/50 text-white text-sm resize-none"
                  />
                  <p className="text-xs text-text-muted mt-1">
                    Supports variable substitution.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Conditions */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <label className="text-sm font-medium text-text-muted block">
                  Conditions
                </label>
                <p className="text-xs text-text-muted">
                  Hook will only execute if all conditions are met
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-brand-primary hover:text-brand-primary/80"
                onClick={() =>
                  setConditions([
                    ...conditions,
                    { variable: "status", operator: "eq", value: "" },
                  ])
                }
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                Add Condition
              </Button>
            </div>
            {conditions.length === 0 ? (
              <p className="text-xs text-text-muted italic py-2">
                No conditions. Hook will always execute on trigger.
              </p>
            ) : (
              <div className="space-y-2">
                {conditions.map((cond, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Select
                      value={cond.variable}
                      onValueChange={(v) => {
                        const updated = [...conditions];
                        updated[i] = { ...cond, variable: v };
                        setConditions(updated);
                      }}
                    >
                      <SelectTrigger className="bg-surface-raised/50 border-border-subtle/50 text-sm w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-surface-raised border-border-subtle">
                        {CONDITION_VARIABLES.map((v) => (
                          <SelectItem key={v.value} value={v.value}>
                            {v.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={cond.operator}
                      onValueChange={(v) => {
                        const updated = [...conditions];
                        updated[i] = { ...cond, operator: v };
                        setConditions(updated);
                      }}
                    >
                      <SelectTrigger className="bg-surface-raised/50 border-border-subtle/50 text-sm w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-surface-raised border-border-subtle">
                        {CONDITION_OPERATORS.map((op) => (
                          <SelectItem key={op.value} value={op.value}>
                            {op.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder="value"
                      value={String(cond.value ?? "")}
                      onChange={(e) => {
                        const updated = [...conditions];
                        const raw = e.target.value;
                        let parsed: unknown = raw;
                        if (raw === "true") parsed = true;
                        else if (raw === "false") parsed = false;
                        else if (/^\d+$/.test(raw)) parsed = Number(raw);
                        updated[i] = { ...cond, value: parsed };
                        setConditions(updated);
                      }}
                      className="bg-surface-raised/50 border-border-subtle/50 text-white text-sm flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-text-muted hover:text-red-400"
                      onClick={() =>
                        setConditions(conditions.filter((_, j) => j !== i))
                      }
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Execution Settings */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-text-muted block">
              Execution Settings
            </label>
            <div>
              <label className="text-xs text-text-muted mb-1 block">
                Execution Order
              </label>
              <Input
                type="number"
                value={executionOrder}
                onChange={(e) => setExecutionOrder(Number(e.target.value))}
                className="bg-surface-raised/50 border-border-subtle/50 text-white text-sm w-32"
              />
              <p className="text-xs text-text-muted mt-1">
                Lower values execute first
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={enabled} onCheckedChange={setEnabled} />
              <label className="text-sm text-text-muted">Enabled</label>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={continueOnFailure}
                onCheckedChange={setContinueOnFailure}
              />
              <div>
                <label className="text-sm text-text-muted">
                  Continue on failure
                </label>
                <p className="text-xs text-text-muted">
                  Uncheck to stop execution if this hook fails
                </p>
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 text-red-400 bg-red-950/20 border border-red-500/30 rounded-lg p-3">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <p className="text-sm">{error}</p>
            </div>
          )}

          {/* Footer */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              onClick={onClose}
              className="text-text-muted hover:text-white"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-brand-primary hover:bg-brand-primary/90 text-black font-semibold"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  {isEditing ? "Save Changes" : "Create Hook"}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Hook Card
// ============================================================================

interface HookCardProps {
  hook: Hook;
  onEdit: (hook: Hook) => void;
  onDelete: (id: string) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onTest: (id: string) => void;
  testResult?: TestHookResponse | null;
  testing?: boolean;
  deleting?: boolean;
}

function HookCard({
  hook,
  onEdit,
  onDelete,
  onToggleEnabled,
  onTest,
  testResult,
  testing,
  deleting,
}: HookCardProps) {
  const [expanded, setExpanded] = useState(false);
  const triggerInfo = getTriggerInfo(hook.trigger);
  const actionInfo = getActionTypeInfo(hook.action_type);
  const ActionIcon = actionInfo.icon;

  return (
    <div
      className={`rounded-lg border transition-all ${
        hook.enabled
          ? "border-border-subtle/50 bg-surface-canvas/30"
          : "border-border-subtle/30 bg-surface-canvas/10 opacity-60"
      }`}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Drag handle */}
          <GripVertical className="w-4 h-4 text-text-muted/40 mt-1 flex-shrink-0 cursor-grab" />

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <p className="text-sm font-semibold text-text-primary">
                {hook.name}
              </p>
              <Badge
                variant={getTriggerBadgeVariant(hook.trigger)}
                className="text-[10px] px-1.5 py-0"
              >
                {triggerInfo.label}
              </Badge>
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 flex items-center gap-1"
              >
                <ActionIcon className={`w-3 h-3 ${actionInfo.color}`} />
                {actionInfo.label}
              </Badge>
              {!hook.enabled && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  Disabled
                </Badge>
              )}
              {!hook.continue_on_failure && (
                <Badge
                  variant="destructive"
                  className="text-[10px] px-1.5 py-0"
                >
                  Critical
                </Badge>
              )}
              {hook.conditions.length > 0 && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  {hook.conditions.length} condition
                  {hook.conditions.length !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>
            {hook.description && (
              <p className="text-xs text-text-muted italic truncate mb-1">
                {hook.description}
              </p>
            )}
            <p className="text-xs text-text-muted font-mono truncate">
              {getActionSummary(hook.action_type, hook.action_config)}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-text-muted hover:text-white"
              onClick={() => onToggleEnabled(hook.id, !hook.enabled)}
              title={hook.enabled ? "Disable" : "Enable"}
            >
              {hook.enabled ? (
                <Pause className="w-3.5 h-3.5" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-brand-primary hover:text-brand-primary/80"
              onClick={() => onTest(hook.id)}
              disabled={testing}
              title="Test Hook"
            >
              {testing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <PlayCircle className="w-3.5 h-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-text-muted hover:text-white"
              onClick={() => onEdit(hook)}
              title="Edit"
            >
              <Pencil className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-text-muted hover:text-red-400"
              onClick={() => onDelete(hook.id)}
              disabled={deleting}
              title="Delete"
            >
              {deleting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-text-muted hover:text-white"
              onClick={() => setExpanded(!expanded)}
              title={expanded ? "Collapse" : "Expand"}
            >
              {expanded ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </Button>
          </div>
        </div>

        {/* Test Result Toast */}
        {testResult && (
          <div
            className={`mt-3 p-3 rounded-lg border ${
              testResult.success
                ? "bg-green-950/20 border-green-500/30"
                : "bg-red-950/20 border-red-500/30"
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-green-400" />
              ) : (
                <XCircle className="w-4 h-4 text-red-400" />
              )}
              <span
                className={`text-sm font-medium ${testResult.success ? "text-green-400" : "text-red-400"}`}
              >
                {testResult.success ? "Test Passed" : "Test Failed"}
              </span>
              <span className="text-xs text-text-muted">
                ({testResult.duration_ms}ms)
              </span>
            </div>
            {testResult.output && (
              <pre className="text-xs text-text-muted font-mono mt-1 overflow-x-auto max-h-24 overflow-y-auto">
                {testResult.output}
              </pre>
            )}
            {testResult.error && (
              <p className="text-xs text-red-400 mt-1">{testResult.error}</p>
            )}
          </div>
        )}
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="border-t border-border-subtle/30 px-4 py-3 space-y-3 bg-surface-canvas/10">
          <div>
            <p className="text-xs font-medium text-text-muted mb-1">
              Action Configuration
            </p>
            <pre className="text-xs text-text-muted font-mono bg-surface-canvas/30 rounded p-2 overflow-x-auto max-h-40 overflow-y-auto">
              {JSON.stringify(hook.action_config, null, 2)}
            </pre>
          </div>
          {hook.conditions.length > 0 && (
            <div>
              <p className="text-xs font-medium text-text-muted mb-1">
                Conditions
              </p>
              <div className="space-y-1">
                {hook.conditions.map((c, i) => (
                  <p key={i} className="text-xs text-text-muted font-mono">
                    {c.variable} {c.operator} {JSON.stringify(c.value)}
                  </p>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-6 text-xs text-text-muted">
            <span>Order: {hook.execution_order}</span>
            <span>
              Created: {new Date(hook.created_at).toLocaleDateString()}
            </span>
            <span>
              Updated: {new Date(hook.updated_at).toLocaleDateString()}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function HooksPage() {
  const { isOffline, isLoading: healthLoading } = useRunnerHealth();
  const {
    data: hooks,
    isLoading: hooksLoading,
    error: hooksError,
    refetch,
  } = useHooks();

  const [showEditor, setShowEditor] = useState(false);
  const [editingHook, setEditingHook] = useState<Hook | undefined>(undefined);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, TestHookResponse>
  >({});
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleCreate = () => {
    setEditingHook(undefined);
    setShowEditor(true);
  };

  const handleEdit = (hook: Hook) => {
    setEditingHook(hook);
    setShowEditor(true);
  };

  const handleSave = async (data: CreateHookRequest | UpdateHookRequest) => {
    if (editingHook) {
      await runnerApi.updateHook(editingHook.id, data as UpdateHookRequest);
    } else {
      await runnerApi.createHook(data as CreateHookRequest);
    }
    refetch();
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await runnerApi.deleteHook(id);
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete hook");
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleEnabled = async (id: string, enabled: boolean) => {
    try {
      await runnerApi.setHookEnabled(id, enabled);
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle hook");
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    // Clear previous result for this hook
    setTestResults((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      const result = await runnerApi.testHook(id);
      setTestResults((prev) => ({ ...prev, [id]: result }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [id]: {
          success: false,
          error: err instanceof Error ? err.message : "Test failed",
          duration_ms: 0,
        },
      }));
    } finally {
      setTestingId(null);
    }
  };

  const filteredHooks = hooks?.filter((hook) => {
    if (!searchQuery.trim()) return true;
    const lower = searchQuery.toLowerCase();
    return (
      hook.name.toLowerCase().includes(lower) ||
      hook.trigger.toLowerCase().includes(lower) ||
      hook.action_type.toLowerCase().includes(lower) ||
      (hook.description ?? "").toLowerCase().includes(lower)
    );
  });

  if (healthLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-text-muted" />
      </div>
    );
  }

  if (isOffline) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
        <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
          <div className="flex items-center px-6 py-4">
            <Webhook className="w-6 h-6 text-sky-400 mr-3" />
            <h1 className="text-2xl font-bold bg-gradient-to-r from-sky-400 to-blue-400 bg-clip-text text-transparent">
              Lifecycle Hooks
            </h1>
          </div>
        </header>
        <main className="p-6 max-w-4xl mx-auto">
          <RunnerOfflineState message="Start the Qontinui Runner desktop app to configure lifecycle hooks." />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
      {/* Header */}
      <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <div className="flex items-center gap-3">
              <Webhook className="w-6 h-6 text-sky-400" />
              <h1 className="text-2xl font-bold bg-gradient-to-r from-sky-400 to-blue-400 bg-clip-text text-transparent">
                Lifecycle Hooks
              </h1>
            </div>
            <p className="text-sm text-text-muted mt-1 ml-9">
              Configure actions to run at specific execution events
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              className="text-text-muted hover:text-white"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button
              onClick={handleCreate}
              className="bg-brand-primary hover:bg-brand-primary/90 text-black font-semibold"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Hook
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6 max-w-4xl mx-auto space-y-6">
        {/* Error banner */}
        {error && (
          <div className="flex items-center justify-between gap-2 text-red-400 bg-red-950/20 border border-red-500/30 rounded-lg p-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <p className="text-sm">{error}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-red-400 hover:text-red-300"
              onClick={() => setError(null)}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}

        {/* Hooks List */}
        <Card className="bg-surface-raised/50 border-border-subtle/50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg text-white flex items-center gap-2">
                  <Zap className="w-5 h-5" />
                  Configured Hooks
                </CardTitle>
                <CardDescription className="text-text-muted mt-1">
                  Actions triggered by runner lifecycle events
                </CardDescription>
              </div>
              {hooks && hooks.length > 0 && (
                <Badge variant="secondary">{hooks.length} hooks</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Search */}
            {hooks && hooks.length > 3 && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <Input
                  placeholder="Search hooks..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 bg-surface-raised/50 border-border-subtle/50 text-white placeholder:text-text-muted"
                />
              </div>
            )}

            {hooksLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-20 bg-surface-raised/30 rounded-lg animate-pulse"
                  />
                ))}
              </div>
            ) : hooksError ? (
              <div className="flex items-center gap-2 text-red-400 py-8 justify-center">
                <AlertCircle className="w-5 h-5" />
                <p className="text-sm">Failed to load hooks</p>
              </div>
            ) : !filteredHooks || filteredHooks.length === 0 ? (
              <div className="text-center py-12">
                <Webhook className="w-10 h-10 mx-auto mb-3 text-text-muted" />
                <p className="text-sm text-text-muted mb-4">
                  {hooks && hooks.length > 0
                    ? "No hooks match your search"
                    : "No lifecycle hooks configured"}
                </p>
                {(!hooks || hooks.length === 0) && (
                  <Button
                    onClick={handleCreate}
                    className="bg-brand-primary hover:bg-brand-primary/90 text-black font-semibold"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Create Your First Hook
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredHooks.map((hook) => (
                  <HookCard
                    key={hook.id}
                    hook={hook}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onToggleEnabled={handleToggleEnabled}
                    onTest={handleTest}
                    testResult={testResults[hook.id]}
                    testing={testingId === hook.id}
                    deleting={deletingId === hook.id}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Info Card */}
        <Card className="bg-surface-raised/50 border-border-subtle/50">
          <CardContent className="py-6">
            <div className="grid grid-cols-4 gap-4">
              {ACTION_TYPES.map((a) => {
                const Icon = a.icon;
                return (
                  <div key={a.value} className="text-center">
                    <Icon className={`w-8 h-8 mx-auto mb-2 ${a.color}`} />
                    <p className="text-sm font-medium text-text-primary">
                      {a.label}
                    </p>
                    <p className="text-xs text-text-muted mt-1">
                      {a.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Hook Editor Modal */}
      {showEditor && (
        <HookEditor
          hook={editingHook}
          onSave={handleSave}
          onClose={() => {
            setShowEditor(false);
            setEditingHook(undefined);
          }}
        />
      )}
    </div>
  );
}
