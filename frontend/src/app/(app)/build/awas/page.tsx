"use client";

import { useState, useCallback } from "react";
import {
  runnerApi,
  type AwasActionInfo,
  type AwasDiscoverResponse,
  type AwasCheckSupportResponse,
  type AwasExecuteResponse,
} from "@/lib/runner-api";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Webhook,
  Search,
  Play,
  ChevronDown,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActionParamValue {
  [key: string]: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract a flat list of parameter names from the opaque `parameters` field. */
function extractParamNames(parameters: unknown): string[] {
  if (!parameters) return [];

  // Handle JSON Schema-style { type: "object", properties: { ... } }
  if (
    typeof parameters === "object" &&
    parameters !== null &&
    "properties" in parameters
  ) {
    const props = (parameters as Record<string, unknown>).properties;
    if (typeof props === "object" && props !== null) {
      return Object.keys(props);
    }
  }

  // Handle simple { key: type } maps
  if (typeof parameters === "object" && parameters !== null) {
    return Object.keys(parameters);
  }

  return [];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AwasBuilderPage() {
  // -- Discovery state --
  const [url, setUrl] = useState("");
  const [checking, setChecking] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [supportResult, setSupportResult] =
    useState<AwasCheckSupportResponse | null>(null);
  const [discoverResult, setDiscoverResult] =
    useState<AwasDiscoverResponse | null>(null);
  const [manifestOpen, setManifestOpen] = useState(false);

  // -- Actions state --
  const [actions, setActions] = useState<AwasActionInfo[]>([]);
  const [actionsUrl, setActionsUrl] = useState<string | null>(null);
  const [expandedAction, setExpandedAction] = useState<string | null>(null);
  const [actionParams, setActionParams] = useState<
    Record<string, ActionParamValue>
  >({});

  // -- Execution state --
  const [executing, setExecuting] = useState<string | null>(null);
  const [executeResult, setExecuteResult] =
    useState<AwasExecuteResponse | null>(null);
  const [executedActionId, setExecutedActionId] = useState<string | null>(null);

  // -- Error state --
  const [error, setError] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const resetResults = useCallback(() => {
    setSupportResult(null);
    setDiscoverResult(null);
    setManifestOpen(false);
    setActions([]);
    setActionsUrl(null);
    setExpandedAction(null);
    setActionParams({});
    setExecuteResult(null);
    setExecutedActionId(null);
    setError(null);
  }, []);

  const handleCheckSupport = useCallback(async () => {
    if (!url.trim()) return;
    resetResults();
    setChecking(true);
    setError(null);
    try {
      const res = await runnerApi.awasCheckSupport(url.trim());
      setSupportResult(res);
      if (!res.supported) {
        toast.info("This URL does not advertise AWAS support.");
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to check support";
      setError(msg);
      toast.error(msg);
    } finally {
      setChecking(false);
    }
  }, [url, resetResults]);

  const handleDiscover = useCallback(async () => {
    if (!url.trim()) return;
    resetResults();
    setDiscovering(true);
    setError(null);
    try {
      const res = await runnerApi.awasDiscover(url.trim());
      setDiscoverResult(res);
      if (res.success) {
        toast.success("Discovery complete");
        // Automatically fetch actions
        try {
          const actionsRes = await runnerApi.awasListActions();
          setActions(actionsRes.actions ?? []);
          setActionsUrl(actionsRes.url ?? null);
        } catch {
          // Actions list may not be available yet - that's OK
        }
      } else {
        setError(res.error ?? "Discovery failed");
        toast.error(res.error ?? "Discovery failed");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Discovery failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setDiscovering(false);
    }
  }, [url, resetResults]);

  const handleToggleAction = useCallback(
    (actionId: string) => {
      setExpandedAction((prev) => (prev === actionId ? null : actionId));
      // Clear execution result when switching actions
      if (executedActionId !== actionId) {
        setExecuteResult(null);
        setExecutedActionId(null);
      }
    },
    [executedActionId]
  );

  const handleParamChange = useCallback(
    (actionId: string, paramName: string, value: string) => {
      setActionParams((prev) => ({
        ...prev,
        [actionId]: {
          ...(prev[actionId] ?? {}),
          [paramName]: value,
        },
      }));
    },
    []
  );

  const handleExecute = useCallback(
    async (action: AwasActionInfo) => {
      const targetUrl = actionsUrl ?? url.trim();
      if (!targetUrl) return;

      setExecuting(action.id);
      setExecuteResult(null);
      setExecutedActionId(null);
      try {
        const params = actionParams[action.id];
        const cleanParams =
          params && Object.keys(params).length > 0 ? params : undefined;
        const res = await runnerApi.awasExecute(
          targetUrl,
          action.id,
          cleanParams as Record<string, unknown> | undefined
        );
        setExecuteResult(res);
        setExecutedActionId(action.id);
        if (res.success) {
          toast.success(`Action "${action.name}" executed successfully`);
        } else {
          toast.error(res.error ?? "Execution failed");
        }
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Execution failed";
        setExecuteResult({ success: false, error: msg });
        setExecutedActionId(action.id);
        toast.error(msg);
      } finally {
        setExecuting(null);
      }
    },
    [url, actionsUrl, actionParams]
  );

  // -------------------------------------------------------------------------
  // Derived
  // -------------------------------------------------------------------------

  const isLoading = checking || discovering;
  const hasActions = actions.length > 0;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
      {/* Header */}
      <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Webhook className="w-6 h-6 text-brand-primary" />
            <h1 className="text-2xl font-bold text-text-primary">
              AWAS Explorer
            </h1>
            <Badge
              variant="outline"
              className="text-xs border-yellow-500/30 text-yellow-400"
            >
              Experimental
            </Badge>
          </div>
        </div>
      </header>

      <main className="p-6 max-w-4xl mx-auto space-y-6">
        {/* ----------------------------------------------------------------- */}
        {/* Discovery Section                                                  */}
        {/* ----------------------------------------------------------------- */}
        <Card className="bg-surface-raised/50 border-border-subtle/50">
          <CardHeader>
            <CardTitle className="text-lg text-text-primary flex items-center gap-2">
              <Search className="size-5 text-brand-primary" />
              Discover AWAS Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-text-muted">
                Target URL
              </Label>
              <Input
                placeholder="https://example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && url.trim()) {
                    handleDiscover();
                  }
                }}
                className="bg-surface-hover border-border-subtle"
              />
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={handleCheckSupport}
                disabled={isLoading || !url.trim()}
                className="gap-2"
              >
                {checking ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
                Check Support
              </Button>
              <Button
                variant="brand-primary"
                onClick={handleDiscover}
                disabled={isLoading || !url.trim()}
                className="gap-2"
              >
                {discovering ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Search className="size-4" />
                )}
                Discover
              </Button>
            </div>

            {/* Status display */}
            {isLoading && (
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <Loader2 className="size-4 animate-spin" />
                <span data-content-role="status" data-content-label="awas discovery status">
                  {checking
                    ? "Checking AWAS support..."
                    : "Discovering actions..."}
                </span>
              </div>
            )}

            {error && !isLoading && (
              <div className="flex items-center gap-2 text-sm text-red-400 bg-red-950/20 border border-red-500/20 rounded-lg px-3 py-2">
                <XCircle className="size-4 shrink-0" />
                {error}
              </div>
            )}

            {supportResult != null && !isLoading && (
              <div
                className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${
                  supportResult.supported
                    ? "text-green-400 bg-green-950/20 border border-green-500/20"
                    : "text-yellow-400 bg-yellow-950/20 border border-yellow-500/20"
                }`}
              >
                {supportResult.supported ? (
                  <CheckCircle2 className="size-4 shrink-0" />
                ) : (
                  <XCircle className="size-4 shrink-0" />
                )}
                <span data-content-role="status" data-content-label="awas support status">
                  {supportResult.supported
                    ? `AWAS supported (v${supportResult.version ?? "unknown"})`
                    : "AWAS not supported at this URL"}
                </span>
                {supportResult.manifest_url && (
                  <span className="text-text-muted ml-1 truncate">
                    - {supportResult.manifest_url}
                  </span>
                )}
              </div>
            )}

            {/* Manifest collapsible */}
            {discoverResult?.success && discoverResult.manifest != null && (
              <Collapsible open={manifestOpen} onOpenChange={setManifestOpen}>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-2 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors w-full"
                  >
                    <ChevronDown
                      className={`size-4 transition-transform ${
                        manifestOpen ? "" : "-rotate-90"
                      }`}
                    />
                    View Manifest
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2">
                  <pre className="text-xs font-mono bg-surface-canvas border border-border-subtle/50 rounded-lg p-4 overflow-auto max-h-80 text-text-secondary">
                    {JSON.stringify(discoverResult.manifest, null, 2)}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            )}
          </CardContent>
        </Card>

        {/* ----------------------------------------------------------------- */}
        {/* Actions Section                                                    */}
        {/* ----------------------------------------------------------------- */}
        {hasActions && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-text-primary">
                Discovered Actions
              </h2>
              <Badge variant="secondary">{actions.length} found</Badge>
            </div>

            {actions.map((action) => {
              const isExpanded = expandedAction === action.id;
              const paramNames = extractParamNames(action.parameters);
              const hasParams = paramNames.length > 0;
              const isExecuting = executing === action.id;
              const showResult =
                executedActionId === action.id && executeResult !== null;

              return (
                <Card
                  key={action.id}
                  className="bg-surface-raised/50 border-border-subtle/50 hover:border-brand-primary/40 transition-all"
                >
                  <CardContent className="p-0">
                    {/* Action header - clickable */}
                    <button
                      type="button"
                      onClick={() => handleToggleAction(action.id)}
                      className="w-full text-left p-4 flex items-start justify-between gap-4"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span data-content-role="label" data-content-label="action name" className="font-medium text-text-primary">
                            {action.name}
                          </span>
                          {action.method && (
                            <Badge
                              variant="outline"
                              className={`text-[10px] uppercase font-mono ${
                                action.method === "GET"
                                  ? "text-green-400 border-green-500/30"
                                  : action.method === "POST"
                                    ? "text-blue-400 border-blue-500/30"
                                    : action.method === "PUT"
                                      ? "text-yellow-400 border-yellow-500/30"
                                      : action.method === "DELETE"
                                        ? "text-red-400 border-red-500/30"
                                        : "text-text-muted border-border-subtle"
                              }`}
                            >
                              {action.method}
                            </Badge>
                          )}
                          {action.intent && (
                            <Badge
                              variant="outline"
                              className="text-[10px] text-purple-400 border-purple-500/30"
                            >
                              {action.intent}
                            </Badge>
                          )}
                        </div>
                        {action.description && (
                          <p className="text-sm text-text-muted truncate">
                            {action.description}
                          </p>
                        )}
                        {action.endpoint && (
                          <p className="text-xs text-text-muted font-mono mt-1 truncate">
                            {action.endpoint}
                          </p>
                        )}
                      </div>
                      <ChevronDown
                        className={`size-4 text-text-muted shrink-0 mt-1 transition-transform ${
                          isExpanded ? "" : "-rotate-90"
                        }`}
                      />
                    </button>

                    {/* Expanded content */}
                    {isExpanded && (
                      <div className="px-4 pb-4 space-y-4 border-t border-border-subtle/30 pt-4">
                        {/* Parameter form */}
                        {hasParams && (
                          <div className="space-y-3">
                            <Label className="text-xs text-text-muted uppercase tracking-wider">
                              Parameters
                            </Label>
                            {paramNames.map((paramName) => (
                              <div key={paramName} className="space-y-1">
                                <Label className="text-xs text-text-secondary">
                                  {paramName}
                                </Label>
                                <Input
                                  placeholder={`Enter ${paramName}...`}
                                  value={
                                    actionParams[action.id]?.[paramName] ?? ""
                                  }
                                  onChange={(e) =>
                                    handleParamChange(
                                      action.id,
                                      paramName,
                                      e.target.value
                                    )
                                  }
                                  className="bg-surface-hover border-border-subtle"
                                />
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Execute button */}
                        <Button
                          variant="brand-primary"
                          size="sm"
                          onClick={() => handleExecute(action)}
                          disabled={isExecuting}
                          className="gap-2"
                        >
                          {isExecuting ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Play className="size-4" />
                          )}
                          {isExecuting ? "Executing..." : "Execute"}
                        </Button>

                        {/* Execution result */}
                        {showResult && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              {executeResult.success ? (
                                <>
                                  <CheckCircle2 className="size-4 text-green-400" />
                                  <span data-content-role="status" data-content-label="execution result" className="text-sm font-medium text-green-400">
                                    Success
                                  </span>
                                </>
                              ) : (
                                <>
                                  <XCircle className="size-4 text-red-400" />
                                  <span data-content-role="status" data-content-label="execution result" className="text-sm font-medium text-red-400">
                                    Failed
                                  </span>
                                </>
                              )}
                            </div>
                            {executeResult.error && (
                              <p className="text-sm text-red-400">
                                {executeResult.error}
                              </p>
                            )}
                            {executeResult.result !== undefined &&
                              executeResult.result !== null && (
                                <pre className="text-xs font-mono bg-surface-canvas border border-border-subtle/50 rounded-lg p-4 overflow-auto max-h-64 text-text-secondary">
                                  {typeof executeResult.result === "string"
                                    ? executeResult.result
                                    : JSON.stringify(
                                        executeResult.result,
                                        null,
                                        2
                                      )}
                                </pre>
                              )}
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* ----------------------------------------------------------------- */}
        {/* Empty state when discovery succeeded but no actions found          */}
        {/* ----------------------------------------------------------------- */}
        {discoverResult?.success && !hasActions && !discovering && (
          <Card className="bg-surface-raised/30 border-border-subtle/50 border-dashed">
            <CardContent className="py-12 text-center">
              <Webhook className="w-12 h-12 mx-auto mb-3 text-text-muted" />
              <h3 className="text-lg font-medium text-text-secondary mb-1">
                No Actions Discovered
              </h3>
              <p className="text-sm text-text-muted max-w-md mx-auto">
                The discovery completed successfully but no AWAS actions were
                found at this URL. The site may not expose any executable
                actions.
              </p>
            </CardContent>
          </Card>
        )}

        {/* ----------------------------------------------------------------- */}
        {/* Initial empty state                                                */}
        {/* ----------------------------------------------------------------- */}
        {!discoverResult && !supportResult && !isLoading && !error && (
          <Card className="bg-surface-raised/30 border-border-subtle/50 border-dashed">
            <CardContent className="py-12 text-center">
              <Webhook className="w-16 h-16 mx-auto mb-4 text-text-muted" />
              <h3 className="text-xl font-medium text-text-secondary mb-2">
                Autonomous Web Action Standards
              </h3>
              <p className="text-sm text-text-muted max-w-lg mx-auto">
                Enter a URL above to check for AWAS support or discover
                available actions. AWAS enables programmatic interaction with web
                applications through standardized action manifests.
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
