import { useState, useCallback } from "react";
import {
  Loader2,
  AlertCircle,
  ShieldCheck,
  Trash2,
  Play,
  Scan,
  X,
  Tags,
} from "lucide-react";
import { toast } from "sonner";
import { EditorHeader, EditorSection } from "@/components/builders/editors";
import { TagInput } from "@/components/builders/TagInput";
import { AiGeneratorPanel } from "@/components/builders/AiGeneratorPanel";
import { runnerApi } from "@/lib/runner/runner-api-object";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseDiscoveredSpecs } from "@/lib/ui-bridge/spec-parser";
import { useAutomatedDiscovery } from "@/hooks/use-automated-discovery";
import { useAppBrowser } from "@/hooks/useAppBrowser";
import { AppBrowser } from "@/components/shared/AppBrowser";
import {
  type PageSweepItem,
  type PageSweepForm,
  type SweepOptions,
  mergeDiscoveredPages,
  noSpecPageEntry,
  buildPerPagePrompt,
} from "@/lib/page-sweep-generator";
import { PageInstructionsButton } from "./PageInstructionsButton";
import { pollForGeneratedWorkflow } from "./helpers";

export interface SweepEditorProps {
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

export function SweepEditor({
  form,
  setForm,
  isDirty,
  isNew,
  isSaving,
  onSave,
  onDelete,
}: SweepEditorProps) {
  // App browser hook for connection + page discovery
  const browser = useAppBrowser({ selfPathname: "/build/page-sweep" });

  // Discovery state
  const [isDiscovering, setIsDiscovering] = useState(false);

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateStatus, setGenerateStatus] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Automated discovery
  const automated = useAutomatedDiscovery({
    appOrigin: browser.activeConnection?.url || form.app_url,
    targetTabId: browser.selectedTargetId ?? undefined,
  });

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

  // Sync app_url from browser connection
  const activeUrl = browser.activeConnection?.url;
  if (activeUrl && !form.app_url.trim()) {
    setForm((prev) => ({ ...prev, app_url: activeUrl }));
  }

  // --- Spec Discovery ---

  const handleDiscoverAllPages = useCallback(async () => {
    if (!browser.isConnected) return;
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
      // Error shown via automated.error
    } else {
      toast.info("No navigable pages found from the current page");
    }
  }, [browser.isConnected, form.pages, setForm, automated]);

  const handleDiscoverCurrentPage = useCallback(async () => {
    if (!browser.isConnected) return;
    setIsDiscovering(true);
    try {
      const res = await runnerApi.uiBridgeDiscover({ action: "getSpecs" });
      const newSpecs = parseDiscoveredSpecs(res?.specs);

      if (newSpecs.length === 0) {
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
      toast.error(
        err instanceof Error ? err.message : "Failed to discover specs"
      );
    } finally {
      setIsDiscovering(false);
    }
  }, [browser.isConnected, form.pages, setForm]);

  // Handle page click from tree: discover specs for that page
  const handlePageClick = useCallback(
    async (url: string) => {
      if (!browser.isConnected || isDiscovering || automated.isRunning) return;
      setIsDiscovering(true);

      browser.updatePageStatus(url, {
        hasSpecs: false,
        specGroupCount: 0,
        isLoading: true,
        isActive: true,
      });

      try {
        // Navigate to the page
        await runnerApi.uiBridgePageNavigate(
          url,
          browser.selectedTargetId ?? undefined
        );
        await new Promise((resolve) => setTimeout(resolve, 2500));

        // Discover specs
        const res = await runnerApi.uiBridgeDiscover({ action: "getSpecs" });
        const newSpecs = parseDiscoveredSpecs(res?.specs);

        if (newSpecs.length > 0) {
          const mergedPages = mergeDiscoveredPages(form.pages, newSpecs);
          setForm((prev) => ({ ...prev, pages: mergedPages }));
          const groupCount = newSpecs.reduce(
            (sum, s) => sum + (s.config?.groups?.length ?? 0),
            0
          );
          browser.updatePageStatus(url, {
            hasSpecs: true,
            specGroupCount: groupCount,
            isLoading: false,
            isActive: true,
          });
          toast.success(`Discovered specs for ${url}`);
        } else {
          const snapshot = await runnerApi.uiBridgeSnapshot();
          const snapshotUrl = (snapshot as Record<string, unknown>)?.url;
          const pathname =
            typeof snapshotUrl === "string"
              ? new URL(snapshotUrl).pathname
              : url;
          const noSpecEntry = noSpecPageEntry(pathname);
          const mergedPages = mergeDiscoveredPages(form.pages, [noSpecEntry]);
          setForm((prev) => ({ ...prev, pages: mergedPages }));
          browser.updatePageStatus(url, {
            hasSpecs: false,
            specGroupCount: 0,
            isLoading: false,
            isActive: true,
          });
          toast.info(`No specs on ${pathname}`);
        }
      } catch {
        browser.updatePageStatus(url, {
          hasSpecs: false,
          specGroupCount: 0,
          isLoading: false,
          isActive: false,
        });
      } finally {
        setIsDiscovering(false);
      }
    },
    [browser, isDiscovering, automated.isRunning, form.pages, setForm]
  );

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

        setForm((prev) => ({
          ...prev,
          last_generated_at: new Date().toISOString(),
        }));

        const msg = `Generated ${workflowIds.length} workflow${workflowIds.length !== 1 ? "s" : ""}`;
        setGenerateStatus(msg);
        toast.success(msg);

        if (andRun && workflowIds.length > 0) {
          setGenerateStatus("Starting multi-stage execution...");
          const result = await runnerApi.runComposedWorkflow(
            workflowIds,
            false
          );
          setGenerateStatus(`Running (task: ${result.task_run_id})`);
          toast.success("Page sweep started");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Generation failed";
        setGenerateError(msg);
        setGenerateStatus(null);
      } finally {
        setIsGenerating(false);
      }
    },
    [form, setForm]
  );

  // Summary counts (semantic groups only)
  const specPages = form.pages.filter((p) => p.has_specs);
  const noSpecPages = form.pages.filter((p) => !p.has_specs);
  const selectedPages = form.pages.filter((p) => p.selected && p.has_specs);
  const totalGroups = selectedPages.reduce(
    (sum, p) =>
      sum +
      p.groups.filter((g) => g.selected && g.category === "semantic").length,
    0
  );
  const totalAssertions = selectedPages.reduce(
    (sum, p) =>
      sum +
      p.groups
        .filter((g) => g.selected && g.category === "semantic")
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

        {/* App Connection (via AppBrowser) */}
        <EditorSection title="App Connection" defaultOpen={true}>
          <div className="space-y-3">
            <AppBrowser
              browser={browser}
              onPageClick={handlePageClick}
              isBusy={isDiscovering || automated.isRunning}
              showSpecStatus
              variant="flat"
            >
              {/* Discovery buttons — always rendered, disabled when not connected */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={handleDiscoverCurrentPage}
                    disabled={
                      !browser.isConnected ||
                      isDiscovering ||
                      automated.isRunning
                    }
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
                    disabled={
                      !browser.isConnected ||
                      isDiscovering ||
                      automated.isRunning
                    }
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
                          {automated.progress.currentIndex}/
                          {automated.progress.totalPages}
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
            </AppBrowser>
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

              {/* Flat page list */}
              <div className="max-h-[320px] overflow-y-auto space-y-3 pr-1">
                {form.pages.map((page) => {
                  const semanticGroups = page.groups.filter(
                    (g) => g.category === "semantic"
                  );
                  const selectedSemantic = semanticGroups.filter(
                    (g) => g.selected
                  );

                  if (!page.has_specs) {
                    return (
                      <div key={page.page_url} className="opacity-50">
                        <div className="flex items-center gap-2 py-0.5">
                          <span className="text-sm text-text-muted truncate flex-1">
                            {page.page_url}
                          </span>
                          <Badge
                            variant="secondary"
                            className="text-[10px] px-1.5 bg-yellow-500/10 text-yellow-500/70 border-yellow-500/20 shrink-0"
                          >
                            No specs
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-text-muted hover:text-red-400 shrink-0"
                            onClick={() => removePage(page.page_url)}
                            title="Remove page"
                          >
                            <Trash2 className="size-3" />
                          </Button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={page.page_url} className="space-y-0.5">
                      {/* Page header row */}
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={page.selected}
                          onCheckedChange={() =>
                            togglePageSelected(page.page_url)
                          }
                        />
                        <span
                          className={`text-sm font-medium truncate flex-1 ${
                            page.selected
                              ? "text-text-primary"
                              : "text-text-muted"
                          }`}
                        >
                          {page.page_url}
                        </span>
                        {semanticGroups.length > 0 && (
                          <span className="text-[10px] text-text-muted shrink-0">
                            {selectedSemantic.length}/{semanticGroups.length}
                          </span>
                        )}
                        <PageInstructionsButton
                          value={page.additional_instructions || ""}
                          onChange={(val) =>
                            setForm((prev) => ({
                              ...prev,
                              pages: prev.pages.map((p) =>
                                p.page_url === page.page_url
                                  ? { ...p, additional_instructions: val }
                                  : p
                              ),
                            }))
                          }
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-text-muted hover:text-red-400 shrink-0"
                          onClick={() => removePage(page.page_url)}
                          title="Remove page"
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                      {/* Semantic group rows */}
                      {semanticGroups.map((group) => (
                        <label
                          key={group.id}
                          className="flex items-center gap-2 pl-6 py-0.5 cursor-pointer hover:bg-surface-raised/30 rounded"
                        >
                          <Checkbox
                            checked={group.selected}
                            onCheckedChange={() =>
                              toggleGroupSelected(page.page_url, group.id)
                            }
                            className="size-3.5"
                          />
                          <span className="text-xs text-text-secondary truncate">
                            {group.description || group.name}
                          </span>
                        </label>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </EditorSection>

        {/* Sweep Options */}
        <EditorSection title="Sweep Options" defaultOpen={true}>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-text-muted">Generation Mode</Label>
              <Select
                value={form.sweep_options.discovery_mode}
                onValueChange={(val) =>
                  updateSweepOption(
                    "discovery_mode",
                    val as SweepOptions["discovery_mode"]
                  )
                }
              >
                <SelectTrigger className="h-8 bg-surface-raised/50 border-border-subtle text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">
                    Auto (discover specs if needed)
                  </SelectItem>
                  <SelectItem value="enabled">
                    Enabled (always discover)
                  </SelectItem>
                  <SelectItem value="disabled">
                    Disabled (skip discovery)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
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

      {/* Generate & Run — fixed footer, always visible */}
      <div className="border-t border-border-subtle/50 bg-surface-base/80 backdrop-blur-sm p-4 space-y-3">
        {/* Pre-generation summary */}
        {form.pages.length > 0 && selectedPages.length > 0 && (
          <div className="rounded-md border border-cyan-500/20 bg-cyan-500/5 p-2.5 text-xs">
            <p className="text-text-secondary font-medium mb-1">
              Will generate ({selectedPages.length})
            </p>
            <ul className="space-y-0.5 text-text-muted">
              {selectedPages.map((p) => {
                const groupCount = p.groups.filter(
                  (g) => g.selected && g.category === "semantic"
                ).length;
                const assertCount = p.groups
                  .filter((g) => g.selected && g.category === "semantic")
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
          </div>
        )}
      </div>
    </div>
  );
}
