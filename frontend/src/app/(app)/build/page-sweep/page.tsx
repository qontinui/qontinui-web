"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Globe,
  Tags,
  Loader2,
  Plug,
  PlugZap,
  Wifi,
  AlertCircle,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  Trash2,
  Play,
  ExternalLink,
  FileQuestion,
  Info,
  Scan,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { BuilderLayout } from "@/components/builders/BuilderLayout";
import { useBuilderPage } from "@/components/builders/hooks/useBuilderPage";
import { useLocalStorageCrud } from "@/hooks/useLocalStorageCrud";
import {
  EditorHeader,
  EditorSection,
} from "@/components/builders/editors";
import { TagInput } from "@/components/builders/TagInput";
import { AiGeneratorPanel } from "@/components/builders/AiGeneratorPanel";
import { runnerApi } from "@/lib/runner/runner-api-object";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { usePageSpecs } from "@/hooks/usePageSpecs";
import { useProject } from "@/hooks/automation";
import { createSequence } from "@/lib/api/workflow-sequences";
import { parseDiscoveredSpecs } from "@/lib/ui-bridge/spec-parser";
import { useAutomatedDiscovery } from "@/hooks/use-automated-discovery";
import { useTargetSelector } from "@/hooks/useTargetSelector";
import { TargetSelector } from "@/components/ui-bridge/TargetSelector";
import {
  type PageSweepItem,
  type PageSweepForm,
  type PageEntry,
  type SweepOptions,
  type SpecGroupEntry,
  toForm,
  defaultForm,
  toPayload,
  mergeDiscoveredPages,
  noSpecPageEntry,
  buildPerPagePrompt,
} from "@/lib/page-sweep-generator";
import type { SpecConfig } from "@qontinui/ui-bridge/specs";
import pageSpecJson from "./page-sweep.spec.uibridge.json";

const pageSpec = pageSpecJson as unknown as SpecConfig;

// =============================================================================
// Main Component
// =============================================================================

export default function PageSweepPage() {
  usePageSpecs({ "page-sweep": pageSpec });
  const storage = useLocalStorageCrud<PageSweepItem>(
    "qontinui-page-sweep-configs"
  );

  const items: PageSweepItem[] = storage.data || [];

  const builder = useBuilderPage<PageSweepItem, PageSweepForm>({
    items,
    isLoading: storage.isLoading,
    error: storage.error,
    isOffline: false,
    toForm,
    defaultForm,
    toPayload,
    onCreate: async (data) => {
      return await storage.create(
        data as Omit<PageSweepItem, "id" | "created_at" | "updated_at">
      );
    },
    onUpdate: async (id, data) => {
      return await storage.update(id, data as Partial<PageSweepItem>);
    },
    onDelete: (id) => storage.delete(id),
    refetch: storage.refetch,
  });

  return (
    <BuilderLayout<PageSweepItem>
      title="Page Sweep"
      icon={Globe}
      iconColor="text-cyan-400"
      accentColor="teal"
      items={builder.items}
      isLoading={builder.isLoading}
      error={builder.error}
      isOffline={builder.isOffline}
      selectedItem={builder.selectedItem}
      onSelect={builder.onSelect}
      onNew={builder.onNew}
      onDelete={builder.onDelete}
      refetch={builder.refetch}
      pageDescription="Generate spec-driven verification workflows for every page in your application. Connect to an SDK app, discover page specs, then generate and run workflows for each page."
      emptyIcon={Globe}
      emptyTitle="No sweep configs yet"
      emptyDescription="Create a Page Sweep config to generate per-page workflows"
      itemLabel="sweep config"
      searchPlaceholder="Search sweep configs..."
      initialSelectedId={builder.initialSelectedId}
      renderListItem={(item, isSelected) => (
        <SweepListItem item={item} isSelected={isSelected} />
      )}
      renderEditor={(item) => (
        <SweepEditor
          item={item}
          form={builder.form}
          setForm={builder.setForm}
          isDirty={builder.isDirty}
          isNew={builder.isNew}
          isSaving={builder.isSaving}
          onSave={builder.save}
          onDelete={builder.deleteSelected}
        />
      )}
    />
  );
}

// =============================================================================
// List Item
// =============================================================================

function SweepListItem({
  item,
  isSelected,
}: {
  item: PageSweepItem;
  isSelected: boolean;
}) {
  const selectedPages = item.pages?.filter((p) => p.selected).length ?? 0;
  const totalPages = item.pages?.length ?? 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Globe
          className={`size-4 shrink-0 ${isSelected ? "text-cyan-400" : "text-text-muted"}`}
        />
        <span
          className={`text-sm font-medium truncate ${isSelected ? "text-text-primary" : "text-text-secondary"}`}
        >
          {item.name}
        </span>
      </div>
      <div className="flex items-center gap-1.5 pl-6">
        {totalPages > 0 && (
          <Badge
            variant="secondary"
            className="text-[10px] px-1.5 bg-cyan-500/10 text-cyan-400 border-cyan-500/30"
          >
            {selectedPages}/{totalPages} page{totalPages !== 1 ? "s" : ""}
          </Badge>
        )}
        {item.last_generated_at && (
          <Badge
            variant="secondary"
            className="text-[10px] px-1.5 bg-surface-raised text-text-muted"
          >
            generated
          </Badge>
        )}
      </div>
      {item.description && (
        <p className="text-xs text-text-muted truncate pl-6">
          {item.description}
        </p>
      )}
    </div>
  );
}

// =============================================================================
// Editor
// =============================================================================

interface SweepEditorProps {
  item: PageSweepItem;
  form: PageSweepForm;
  setForm: (
    form: PageSweepForm | ((prev: PageSweepForm) => PageSweepForm)
  ) => void;
  isDirty: boolean;
  isNew: boolean;
  isSaving: boolean;
  onSave: () => void;
  onDelete: () => void;
}

function SweepEditor({
  form,
  setForm,
  isDirty,
  isNew,
  isSaving,
  onSave,
  onDelete,
}: SweepEditorProps) {
  const { projectId } = useProject();

  // Connection state
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectedAppName, setConnectedAppName] = useState("");
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Auto-connect: check for existing SDK connection on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await runnerApi.uiBridgeStatus();
        if (cancelled) return;
        if (status?.connected) {
          setIsConnected(true);
          setConnectedAppName(
            status.app?.appName || status.url || "Connected"
          );
          // Populate app_url from the active connection if the form field is empty
          if (!form.app_url.trim() && status.url) {
            setForm((prev) => ({ ...prev, app_url: status.url! }));
          }
        }
      } catch {
        // Runner offline — ignore
      }
    })();
    return () => {
      cancelled = true;
    };
    // Only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Discovery state
  const [isDiscovering, setIsDiscovering] = useState(false);

  // Tab targeting (shared hook)
  const {
    targets,
    selectedTargetId,
    setSelectedTargetId,
    refresh: refreshTargets,
    isLoading: isLoadingTargets,
  } = useTargetSelector({ selfPathname: "/build/page-sweep" });

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateStatus, setGenerateStatus] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Automated discovery
  const automated = useAutomatedDiscovery({
    appOrigin: form.app_url,
    targetTabId: selectedTargetId ?? undefined,
  });

  // Expanded page cards
  const [expandedPages, setExpandedPages] = useState<Set<string>>(new Set());

  const updateField = <K extends keyof PageSweepForm>(
    field: K,
    value: PageSweepForm[K]
  ) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const updateSweepOption = <K extends keyof SweepOptions>(
    key: K,
    value: SweepOptions[K]
  ) => {
    setForm((prev) => ({
      ...prev,
      sweep_options: { ...prev.sweep_options, [key]: value },
    }));
  };

  // --- SDK Connection ---

  const handleConnect = useCallback(async () => {
    if (!form.app_url.trim()) return;
    setIsConnecting(true);
    setConnectionError(null);
    try {
      await runnerApi.uiBridgeConnect({ url: form.app_url.trim() });
      const status = await runnerApi.uiBridgeStatus();
      if (status?.connected) {
        setIsConnected(true);
        setConnectedAppName(
          status.app?.appName || status.url || "Connected"
        );
        await refreshTargets();
      } else {
        throw new Error("Connection failed");
      }
    } catch (err) {
      setConnectionError(
        err instanceof Error ? err.message : "Failed to connect"
      );
    } finally {
      setIsConnecting(false);
    }
  }, [form.app_url, refreshTargets]);

  const handleDisconnect = useCallback(async () => {
    try {
      await runnerApi.uiBridgeDisconnect();
    } catch {
      // Ignore
    }
    setIsConnected(false);
    setConnectedAppName("");
    setConnectionError(null);
  }, []);

  // --- Spec Discovery ---

  const handleDiscoverAllPages = useCallback(async () => {
    if (!isConnected) return;
    setConnectionError(null);
    const pages = await automated.discoverAllPages();
    if (pages.length > 0) {
      const mergedPages = mergeDiscoveredPages(form.pages, pages);
      setForm((prev) => ({ ...prev, pages: mergedPages }));
      const withSpecs = pages.filter((p) => p.has_specs).length;
      const withoutSpecs = pages.filter((p) => !p.has_specs).length;
      toast.success(
        `Discovered ${pages.length} page${pages.length !== 1 ? "s" : ""} (${withSpecs} with specs, ${withoutSpecs} without)`
      );
    } else if (automated.error) {
      setConnectionError(automated.error);
    } else {
      toast.info("No navigable pages found from the current page");
    }
  }, [isConnected, form.pages, setForm, automated]);

  const handleDiscoverCurrentPage = useCallback(async () => {
    if (!isConnected) return;
    setIsDiscovering(true);
    setConnectionError(null);
    try {
      const res = await runnerApi.uiBridgeDiscover({ action: "getSpecs" });
      const newSpecs = parseDiscoveredSpecs(res?.specs);

      if (newSpecs.length === 0) {
        // No specs found — track as a no-spec page
        try {
          const snapshot = await runnerApi.uiBridgeSnapshot();
          const url = (snapshot as Record<string, unknown>)?.url;
          if (typeof url === "string") {
            const pathname = new URL(url).pathname;
            const noSpecEntry = noSpecPageEntry(pathname);
            const mergedPages = mergeDiscoveredPages(form.pages, [noSpecEntry]);
            setForm((prev) => ({ ...prev, pages: mergedPages }));
            toast.info(`No specs on ${pathname} — added as no-spec page`);
          } else {
            toast.info("No specs found on the current page");
          }
        } catch {
          toast.info("No specs found on the current page");
        }
        return;
      }

      const mergedPages = mergeDiscoveredPages(form.pages, newSpecs);
      setForm((prev) => ({ ...prev, pages: mergedPages }));
      toast.success(
        `Discovered ${newSpecs.length} spec${newSpecs.length !== 1 ? "s" : ""}`
      );
    } catch (err) {
      setConnectionError(
        err instanceof Error ? err.message : "Failed to discover specs"
      );
    } finally {
      setIsDiscovering(false);
    }
  }, [isConnected, form.pages, setForm]);

  // --- Page Selection ---

  const togglePageSelected = (pageUrl: string) => {
    setForm((prev) => ({
      ...prev,
      pages: prev.pages.map((p) =>
        p.page_url === pageUrl && p.has_specs
          ? { ...p, selected: !p.selected }
          : p
      ),
    }));
  };

  const toggleGroupSelected = (pageUrl: string, groupId: string) => {
    setForm((prev) => ({
      ...prev,
      pages: prev.pages.map((p) =>
        p.page_url === pageUrl
          ? {
              ...p,
              groups: p.groups.map((g) =>
                g.id === groupId ? { ...g, selected: !g.selected } : g
              ),
            }
          : p
      ),
    }));
  };

  const togglePageExpanded = (pageUrl: string) => {
    setExpandedPages((prev) => {
      const next = new Set(prev);
      if (next.has(pageUrl)) {
        next.delete(pageUrl);
      } else {
        next.add(pageUrl);
      }
      return next;
    });
  };

  const updatePageInstructions = (pageUrl: string, value: string) => {
    setForm((prev) => ({
      ...prev,
      pages: prev.pages.map((p) =>
        p.page_url === pageUrl
          ? { ...p, additional_instructions: value }
          : p
      ),
    }));
  };

  const removePage = (pageUrl: string) => {
    setForm((prev) => ({
      ...prev,
      pages: prev.pages.filter((p) => p.page_url !== pageUrl),
    }));
  };

  const selectAllPages = () => {
    setForm((prev) => ({
      ...prev,
      pages: prev.pages.map((p) =>
        p.has_specs ? { ...p, selected: true } : p
      ),
    }));
  };

  const deselectAllPages = () => {
    setForm((prev) => ({
      ...prev,
      pages: prev.pages.map((p) =>
        p.has_specs ? { ...p, selected: false } : p
      ),
    }));
  };

  // --- Generation ---

  const handleGenerate = useCallback(
    async (andRun: boolean) => {
      const selectedPages = form.pages.filter((p) => p.selected);
      if (selectedPages.length === 0) {
        setGenerateError("No pages selected");
        return;
      }

      setIsGenerating(true);
      setGenerateError(null);
      setGenerateStatus("Starting generation...");

      try {
        const taskRunIds: string[] = [];

        // Generate a workflow for each selected page
        for (const [i, page] of selectedPages.entries()) {
          setGenerateStatus(
            `Generating workflow ${i + 1}/${selectedPages.length}: ${page.page_url}...`
          );

          const prompt = buildPerPagePrompt(
            page,
            form.sweep_options.additional_context
          );

          const response = await runnerApi.generateWorkflowAsync({
            description: prompt,
            category: "page-sweep",
            tags: ["page-sweep", "spec-generated", page.page_url],
            discovery_mode: form.sweep_options.discovery_mode,
            provider: form.sweep_options.provider || undefined,
            model: form.sweep_options.model || undefined,
          });

          taskRunIds.push(response.task_run_id);
        }

        // Poll for all generations to complete and collect workflow IDs
        setGenerateStatus(
          `Waiting for ${taskRunIds.length} generation${taskRunIds.length !== 1 ? "s" : ""} to complete...`
        );

        const workflowIds: string[] = [];
        for (const taskRunId of taskRunIds) {
          const workflowId = await pollForGeneratedWorkflow(taskRunId);
          if (workflowId) {
            workflowIds.push(workflowId);
          }
        }

        if (workflowIds.length === 0) {
          throw new Error("No workflows were generated successfully");
        }

        // Create a workflow sequence
        setGenerateStatus("Creating workflow sequence...");

        let sequenceId: string | undefined;
        if (projectId) {
          try {
            const sequence = await createSequence(projectId, {
              name: `Page Sweep: ${form.name || "Untitled"}`,
              description: `Generated from page sweep config with ${workflowIds.length} page${workflowIds.length !== 1 ? "s" : ""}`,
              workflow_ids: workflowIds,
              stop_on_failure: false,
            });
            sequenceId = sequence.id;
          } catch {
            // Sequence creation is optional — may fail if backend is offline
            console.warn("Failed to create workflow sequence in backend");
          }
        }

        // Update the config with generation results
        setForm((prev) => ({
          ...prev,
          last_sequence_id: sequenceId,
          last_generated_at: new Date().toISOString(),
        }));

        const msg = `Generated ${workflowIds.length} workflow${workflowIds.length !== 1 ? "s" : ""}${sequenceId ? " and saved sequence" : ""}`;
        setGenerateStatus(msg);
        toast.success(msg);

        // Optionally run the sequence
        if (andRun && workflowIds.length > 0) {
          setGenerateStatus("Starting sequence execution...");
          const result = await runnerApi.runWorkflowSequence(
            workflowIds,
            false
          );
          setGenerateStatus(
            `Sequence running (task: ${result.task_run_id})`
          );
          toast.success("Page sweep sequence started");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Generation failed";
        setGenerateError(msg);
        setGenerateStatus(null);
      } finally {
        setIsGenerating(false);
      }
    },
    [form, projectId, setForm]
  );

  // Summary counts
  const specPages = form.pages.filter((p) => p.has_specs);
  const noSpecPages = form.pages.filter((p) => !p.has_specs);
  const selectedPages = form.pages.filter((p) => p.selected && p.has_specs);
  const totalGroups = selectedPages.reduce(
    (sum, p) => sum + p.groups.filter((g) => g.selected).length,
    0
  );
  const totalAssertions = selectedPages.reduce(
    (sum, p) =>
      sum +
      p.groups
        .filter((g) => g.selected)
        .reduce((gs, g) => gs + g.assertion_count, 0),
    0
  );

  return (
    <div className="flex flex-col h-full">
      <EditorHeader
        name={form.name}
        onNameChange={(name) => updateField("name", name)}
        onSave={onSave}
        onDelete={onDelete}
        isSaving={isSaving}
        isDirty={isDirty}
        isNew={isNew}
        nameplaceholder="Page sweep config name..."
      />

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Description */}
        <EditorSection title="Description" defaultOpen={false}>
          <Textarea
            value={form.description}
            onChange={(e) => updateField("description", e.target.value)}
            placeholder="Describe this page sweep configuration..."
            rows={2}
            className="bg-surface-raised/50 border-border-subtle text-sm resize-none"
          />
        </EditorSection>

        {/* App Connection */}
        <EditorSection title="App Connection" defaultOpen={true}>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Input
                value={form.app_url}
                onChange={(e) => updateField("app_url", e.target.value)}
                placeholder="http://localhost:3001"
                className="flex-1 bg-surface-raised/50 border-border-subtle h-8 text-sm"
                disabled={isConnected}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !isConnected) handleConnect();
                }}
              />
              {isConnected ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs text-red-400 border-red-400/30 hover:bg-red-400/10"
                  onClick={handleDisconnect}
                >
                  <PlugZap className="size-3.5 mr-1" />
                  Disconnect
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={handleConnect}
                  disabled={isConnecting || !form.app_url.trim()}
                >
                  {isConnecting ? (
                    <Loader2 className="size-3.5 mr-1 animate-spin" />
                  ) : (
                    <Plug className="size-3.5 mr-1" />
                  )}
                  {isConnecting ? "Connecting..." : "Connect"}
                </Button>
              )}
            </div>

            {isConnected && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1 text-xs text-green-400">
                    <Wifi className="size-3" />
                    {connectedAppName}
                  </span>
                </div>

                {/* Target selector */}
                {targets.length > 1 && (
                  <TargetSelector
                    targets={targets}
                    selectedTargetId={selectedTargetId}
                    onTargetChange={setSelectedTargetId}
                    onRefresh={refreshTargets}
                    isLoading={isLoadingTargets}
                  />
                )}

                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={handleDiscoverCurrentPage}
                    disabled={isDiscovering || automated.isRunning}
                  >
                    {isDiscovering ? (
                      <Loader2 className="size-3 mr-1 animate-spin" />
                    ) : (
                      <ShieldCheck className="size-3 mr-1" />
                    )}
                    {isDiscovering ? "Discovering..." : "Discover Current Page"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs text-cyan-400 border-cyan-500/30 hover:bg-cyan-500/10"
                    onClick={handleDiscoverAllPages}
                    disabled={isDiscovering || automated.isRunning}
                  >
                    {automated.isRunning ? (
                      <Loader2 className="size-3 mr-1 animate-spin" />
                    ) : (
                      <Scan className="size-3 mr-1" />
                    )}
                    {automated.isRunning ? "Crawling..." : "Discover All Pages"}
                  </Button>
                </div>

                {/* Auto-crawl progress bar */}
                {automated.isRunning && automated.progress && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[10px] text-text-muted">
                      <span className="truncate max-w-[200px]">
                        {automated.progress.currentPage || "Starting..."}
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span>
                          {automated.progress.currentIndex}/{automated.progress.totalPages}
                        </span>
                        <button
                          onClick={automated.cancel}
                          className="text-red-400 hover:text-red-300 transition-colors"
                          title="Cancel"
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    </div>
                    <div className="h-1.5 bg-surface-raised rounded-full overflow-hidden">
                      <div
                        className="h-full bg-cyan-500 rounded-full transition-all duration-300"
                        style={{
                          width: `${automated.progress.totalPages > 0 ? (automated.progress.currentIndex / automated.progress.totalPages) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-text-muted">
                      <span className="text-green-400">
                        {automated.progress.pagesWithSpecs} with specs
                      </span>
                      <span className="text-yellow-400">
                        {automated.progress.pagesWithoutSpecs} without
                      </span>
                    </div>
                  </div>
                )}

                {automated.error && !automated.isRunning && (
                  <div className="flex items-center gap-1.5 text-xs text-red-400">
                    <AlertCircle className="size-3 shrink-0" />
                    {automated.error}
                  </div>
                )}
              </div>
            )}

            {connectionError && (
              <div className="flex items-center gap-1.5 text-xs text-red-400">
                <AlertCircle className="size-3 shrink-0" />
                {connectionError}
              </div>
            )}

            {!isConnected && !connectionError && (
              <p className="text-xs text-text-muted">
                Connect to an SDK-integrated app. Use &quot;Discover All
                Pages&quot; to auto-crawl, or navigate manually and click
                &quot;Discover Current Page&quot;.
              </p>
            )}
          </div>
        </EditorSection>

        {/* Pages */}
        <EditorSection
          title={`Pages (${selectedPages.length}/${specPages.length} selected${noSpecPages.length > 0 ? `, ${noSpecPages.length} no-spec` : ""})`}
          defaultOpen={true}
        >
          {form.pages.length === 0 ? (
            <p className="text-xs text-text-muted py-2">
              No pages discovered yet. Connect to your app and discover specs
              from each page.
            </p>
          ) : (
            <div className="space-y-3">
              {/* Select all/none controls */}
              <div className="flex items-center gap-2 text-xs">
                <button
                  onClick={selectAllPages}
                  className="text-text-muted hover:text-text-primary transition-colors"
                >
                  Select All
                </button>
                <span className="text-text-muted/50">/</span>
                <button
                  onClick={deselectAllPages}
                  className="text-text-muted hover:text-text-primary transition-colors"
                >
                  None
                </button>
                {totalGroups > 0 && (
                  <span className="text-text-muted ml-auto">
                    {totalGroups} group{totalGroups !== 1 ? "s" : ""},{" "}
                    {totalAssertions} assertion
                    {totalAssertions !== 1 ? "s" : ""}
                  </span>
                )}
              </div>

              {/* Page cards */}
              <div className="space-y-2">
                {form.pages.map((page) => (
                  <PageCard
                    key={page.page_url}
                    page={page}
                    isExpanded={expandedPages.has(page.page_url)}
                    onToggleSelected={() => togglePageSelected(page.page_url)}
                    onToggleExpanded={() => togglePageExpanded(page.page_url)}
                    onToggleGroup={(groupId) =>
                      toggleGroupSelected(page.page_url, groupId)
                    }
                    onUpdateInstructions={(val) =>
                      updatePageInstructions(page.page_url, val)
                    }
                    onRemove={() => removePage(page.page_url)}
                  />
                ))}
              </div>
            </div>
          )}
        </EditorSection>

        {/* Sweep Options */}
        <EditorSection title="Sweep Options" defaultOpen={true}>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-text-muted">
                Global Context (all pages)
              </Label>
              <Textarea
                value={form.sweep_options.additional_context || ""}
                onChange={(e) =>
                  updateSweepOption("additional_context", e.target.value)
                }
                placeholder="Additional context applied to all page workflows..."
                rows={2}
                className="bg-surface-raised/50 border-border-subtle text-sm resize-none"
              />
            </div>
          </div>
        </EditorSection>

        {/* Generate & Run */}
        <EditorSection title="Generate & Run" defaultOpen={true}>
          <div className="space-y-3">
            {/* Pre-generation summary */}
            {form.pages.length > 0 && (
              <div className="space-y-2 text-xs">
                {selectedPages.length > 0 && (
                  <div className="rounded-md border border-cyan-500/20 bg-cyan-500/5 p-2.5">
                    <p className="text-text-secondary font-medium mb-1">
                      Will generate ({selectedPages.length})
                    </p>
                    <ul className="space-y-0.5 text-text-muted">
                      {selectedPages.map((p) => {
                        const groupCount = p.groups.filter(
                          (g) => g.selected
                        ).length;
                        const assertCount = p.groups
                          .filter((g) => g.selected)
                          .reduce((s, g) => s + g.assertion_count, 0);
                        return (
                          <li key={p.page_url} className="flex items-center gap-1.5">
                            <span className="truncate">{p.page_url}</span>
                            <span className="shrink-0 text-text-muted/60">
                              {groupCount}g / {assertCount}a
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                {noSpecPages.length > 0 && (
                  <div className="rounded-md border border-border-subtle bg-surface-raised/30 p-2.5">
                    <p className="text-text-muted font-medium mb-1">
                      Skipped — no specs ({noSpecPages.length})
                    </p>
                    <ul className="space-y-0.5 text-text-muted/60">
                      {noSpecPages.map((p) => (
                        <li key={p.page_url} className="truncate">
                          {p.page_url}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button
                onClick={() => handleGenerate(false)}
                disabled={isGenerating || selectedPages.length === 0}
                className="bg-cyan-600 hover:bg-cyan-700 text-white"
                size="sm"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="size-3 mr-1.5 animate-spin" />
                    Generating...
                  </>
                ) : (
                  "Generate Workflows"
                )}
              </Button>
              <Button
                onClick={() => handleGenerate(true)}
                disabled={isGenerating || selectedPages.length === 0}
                variant="outline"
                size="sm"
                className="text-xs"
              >
                <Play className="size-3 mr-1" />
                Generate & Run
              </Button>
            </div>

            {generateStatus && (
              <p className="text-xs text-cyan-400">{generateStatus}</p>
            )}
            {generateError && (
              <p className="text-xs text-red-400">{generateError}</p>
            )}

            {form.last_generated_at && (
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <span>
                  Last generated:{" "}
                  {new Date(form.last_generated_at).toLocaleString()}
                </span>
                {form.last_sequence_id && (
                  <a
                    href="/execute"
                    className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300 transition-colors"
                  >
                    View on Execute <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
            )}
          </div>
        </EditorSection>

        {/* Tags */}
        <EditorSection title="Tags" icon={Tags} defaultOpen={false}>
          <TagInput
            tags={form.tags}
            onChange={(tags) => updateField("tags", tags)}
            placeholder="Add tag..."
          />
        </EditorSection>

        {/* AI Advisor */}
        <AiGeneratorPanel
          title="AI Sweep Advisor"
          accentColor="teal"
          placeholder="Describe what kind of sweep you want..."
          generating={false}
          error={null}
          onGenerate={async (prompt) => {
            // Apply template to global context
            updateSweepOption("additional_context", prompt);
          }}
          templates={[
            {
              label: "Quick smoke test",
              prompt:
                "Focus on critical assertions only. Skip info-level checks. Quick verification of core page functionality.",
            },
            {
              label: "Full regression",
              prompt:
                "Thorough verification of all assertion groups. Include all severity levels. Report any discrepancies.",
            },
            {
              label: "Accessibility audit",
              prompt:
                "Focus on accessibility-related assertions. Check ARIA labels, keyboard navigation, color contrast, and screen reader compatibility.",
            },
          ]}
        />
      </div>
    </div>
  );
}

// =============================================================================
// Page Card
// =============================================================================

interface PageCardProps {
  page: PageEntry;
  isExpanded: boolean;
  onToggleSelected: () => void;
  onToggleExpanded: () => void;
  onToggleGroup: (groupId: string) => void;
  onUpdateInstructions: (value: string) => void;
  onRemove: () => void;
}

function PageCard({
  page,
  isExpanded,
  onToggleSelected,
  onToggleExpanded,
  onToggleGroup,
  onUpdateInstructions,
  onRemove,
}: PageCardProps) {
  const selectedGroups = page.groups.filter((g) => g.selected).length;
  const totalAssertions = page.groups
    .filter((g) => g.selected)
    .reduce((sum, g) => sum + g.assertion_count, 0);

  // No-spec page: muted, not expandable, not selectable
  if (!page.has_specs) {
    return (
      <div className="rounded-lg border border-border-subtle bg-surface-raised/20 opacity-50">
        <div className="flex items-start gap-2.5 p-3">
          <Checkbox checked={false} disabled className="mt-0.5 opacity-40" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-muted truncate">
                {page.page_url}
              </span>
              <Badge
                variant="secondary"
                className="text-[10px] px-1.5 bg-yellow-500/10 text-yellow-500/70 border-yellow-500/20 shrink-0"
              >
                <FileQuestion className="size-2.5 mr-0.5" />
                No specs
              </Badge>
            </div>
            <p className="text-[10px] text-text-muted/60 mt-0.5">
              No page specs discovered — workflow cannot be generated
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-text-muted hover:text-red-400 shrink-0"
            onClick={onRemove}
            title="Remove page"
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      </div>
    );
  }

  // Separate semantic vs assertion groups
  const semanticGroups = page.groups.filter((g) => g.category === "semantic");
  const assertionGroups = page.groups.filter(
    (g) => g.category !== "semantic"
  );

  return (
    <div
      className={`rounded-lg border transition-colors ${
        page.selected
          ? "border-cyan-500/40 bg-cyan-500/5"
          : "border-border-subtle bg-surface-raised/30 opacity-60"
      }`}
    >
      {/* Card header */}
      <div className="flex items-start gap-2.5 p-3">
        <Checkbox
          checked={page.selected}
          onCheckedChange={onToggleSelected}
          className="mt-0.5"
        />
        <div
          className="flex-1 min-w-0 cursor-pointer"
          onClick={onToggleExpanded}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary truncate">
              {page.page_url}
            </span>
            {isExpanded ? (
              <ChevronDown className="size-3.5 text-text-muted shrink-0" />
            ) : (
              <ChevronRight className="size-3.5 text-text-muted shrink-0" />
            )}
          </div>
          {/* Truncated description in collapsed header only */}
          {!isExpanded && page.spec_description && (
            <p className="text-xs text-text-muted mt-0.5 line-clamp-2">
              {page.spec_description}
            </p>
          )}
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] text-text-muted">
              {selectedGroups}/{page.groups.length} group
              {page.groups.length !== 1 ? "s" : ""}, {totalAssertions}{" "}
              assertion{totalAssertions !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-text-muted hover:text-red-400 shrink-0"
          onClick={onRemove}
          title="Remove page"
        >
          <Trash2 className="size-3" />
        </Button>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-border-subtle px-3 pb-3 pt-2 space-y-3">
          {/* Semantic spec description (full, prominent) */}
          {page.spec_description && (
            <div className="rounded-md border-l-2 border-cyan-500/50 bg-cyan-500/5 px-3 py-2">
              <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">
                {page.spec_description}
              </p>
            </div>
          )}

          {/* Semantic groups (category="semantic") */}
          {semanticGroups.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[10px] text-cyan-400/80 uppercase tracking-wider font-medium">
                Page Purpose
              </span>
              {semanticGroups.map((group) => (
                <div
                  key={group.id}
                  className="rounded-md bg-cyan-500/5 border border-cyan-500/15 p-2"
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Info className="size-3 text-cyan-400/70" />
                    <span className="text-xs text-text-secondary font-medium">
                      {group.name}
                    </span>
                  </div>
                  {group.description && (
                    <p className="text-[11px] text-text-muted leading-relaxed ml-[18px]">
                      {group.description}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Assertion groups */}
          {assertionGroups.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] text-text-muted uppercase tracking-wider">
                Assertion Groups
              </span>
              {assertionGroups.map((group) => (
                <AssertionGroupCard
                  key={group.id}
                  group={group}
                  onToggle={() => onToggleGroup(group.id)}
                />
              ))}
            </div>
          )}

          {/* Per-page instructions */}
          <div className="space-y-1">
            <Label className="text-[10px] text-text-muted">
              Additional Instructions
            </Label>
            <Textarea
              value={page.additional_instructions || ""}
              onChange={(e) => onUpdateInstructions(e.target.value)}
              placeholder="Optional per-page instructions for AI generation..."
              rows={2}
              className="bg-surface-raised/50 border-border-subtle text-xs resize-none"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Assertion Group Card (shows group + individual assertions)
// =============================================================================

function AssertionGroupCard({
  group,
  onToggle,
}: {
  group: SpecGroupEntry;
  onToggle: () => void;
}) {
  const [showAssertions, setShowAssertions] = useState(false);

  return (
    <div className="rounded hover:bg-surface-raised/50">
      <label className="flex items-start gap-2 p-1.5 cursor-pointer">
        <Checkbox
          checked={group.selected}
          onCheckedChange={onToggle}
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-text-secondary truncate">
              {group.name}
            </span>
            <Badge
              variant="secondary"
              className="text-[9px] px-1 py-0 bg-surface-raised text-text-muted border-border-subtle shrink-0"
            >
              {group.category}
            </Badge>
          </div>
          {group.description && (
            <p className="text-[10px] text-text-muted mt-0.5">
              {group.description}
            </p>
          )}
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[10px] text-text-muted">
              {group.assertion_count} assertion
              {group.assertion_count !== 1 ? "s" : ""}
            </span>
            {group.assertions.length > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowAssertions(!showAssertions);
                }}
                className="text-[10px] text-cyan-400/70 hover:text-cyan-400 transition-colors"
              >
                {showAssertions ? "hide" : "show"}
              </button>
            )}
          </div>
        </div>
      </label>

      {/* Individual assertions */}
      {showAssertions && group.assertions.length > 0 && (
        <div className="ml-7 mr-2 mb-1.5 space-y-0.5">
          {group.assertions.map((a) => (
            <div
              key={a.id}
              className="flex items-start gap-1.5 text-[10px] py-0.5"
            >
              <SeverityBadge severity={a.severity} />
              <span
                className={`${a.enabled ? "text-text-muted" : "text-text-muted/40 line-through"}`}
              >
                {a.description}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SeverityBadge({
  severity,
}: {
  severity: "critical" | "warning" | "info";
}) {
  const styles = {
    critical: "bg-red-500/15 text-red-400 border-red-500/25",
    warning: "bg-yellow-500/15 text-yellow-400 border-yellow-500/25",
    info: "bg-blue-500/10 text-blue-400/70 border-blue-500/20",
  };
  return (
    <span
      className={`text-[9px] px-1 py-0 rounded border shrink-0 leading-[14px] ${styles[severity]}`}
    >
      {severity}
    </span>
  );
}

// =============================================================================
// Helpers
// =============================================================================

/** Poll a task run until it completes and return the generated workflow ID */
async function pollForGeneratedWorkflow(
  taskRunId: string,
  maxWaitMs = 300_000,
  intervalMs = 3000
): Promise<string | null> {
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    try {
      const taskRun = await runnerApi.getTaskRun(taskRunId);
      const status = taskRun.status?.toLowerCase();

      if (status === "completed" || status === "success") {
        // Try to get the generated workflow ID from result data
        try {
          const resultData = await runnerApi.getTaskRunResultData(taskRunId);
          const data = (resultData as Record<string, unknown>).data || resultData;
          if (typeof (data as Record<string, unknown>).workflow_id === "string") {
            return (data as Record<string, unknown>).workflow_id as string;
          }
        } catch {
          // Result data may not have workflow_id
        }

        // Fallback: try workflow state
        try {
          const state = await runnerApi.getTaskRunWorkflowState(taskRunId);
          const stateData = (state as Record<string, unknown>).data || state;
          if (
            typeof (stateData as Record<string, unknown>).generated_workflow_id ===
            "string"
          ) {
            return (stateData as Record<string, unknown>)
              .generated_workflow_id as string;
          }
        } catch {
          // Workflow state may not have generated_workflow_id
        }

        // If we can't find a workflow ID, return null
        return null;
      }

      if (status === "failed" || status === "error" || status === "cancelled") {
        return null;
      }
    } catch {
      // Task run fetch failed, keep polling
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return null; // Timed out
}
