import { useState, useCallback } from "react";
import {
  type Hook,
  type HookTrigger,
  type HookActionType,
  type HookCondition,
  type CreateHookRequest,
  type UpdateHookRequest,
} from "@/lib/runner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus, Trash2, Save, AlertCircle, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TRIGGERS,
  ACTION_TYPES,
  CONDITION_VARIABLES,
  CONDITION_OPERATORS,
} from "../_lib";

interface HookEditorProps {
  hook?: Hook;
  onSave: (hook: CreateHookRequest | UpdateHookRequest) => Promise<void>;
  onClose: () => void;
}

export function HookEditor({ hook, onSave, onClose }: HookEditorProps) {
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
