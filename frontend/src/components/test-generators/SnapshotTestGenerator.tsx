/**
 * SnapshotTestGenerator
 *
 * Main component for the Snapshot Test Generator page (Tier 1).
 * Provides 4 tabs: Elements, Annotations, Test Specs, Output.
 *
 * Connects to the runner's browser extension bridge to capture element
 * snapshots from external browser tabs, author annotations, generate
 * test specifications, and export results.
 */

import { useState, useCallback, useMemo, useEffect } from "react";
import { Layers, Tag, TestTube2, FileOutput } from "lucide-react";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { SnapshotCapturePanel } from "./snapshot/SnapshotCapturePanel";
import {
  SnapshotElementBrowser,
  type BrowsableElement,
} from "./snapshot/SnapshotElementBrowser";
import {
  ElementDetailPanel,
  type ElementDetail,
} from "./snapshot/ElementDetailPanel";
import {
  AnnotationEditor,
  type AnnotationData,
} from "./snapshot/AnnotationEditor";
import {
  SnapshotComparer,
  type SnapshotDiff,
} from "./snapshot/SnapshotComparer";
import { TestSpecEditor } from "./shared/TestSpecEditor";
import { TestOutputPanel } from "./shared/TestOutputPanel";
import {
  generateSpecsFromSnapshot,
  type SnapshotData,
  type SnapshotElement,
} from "./shared/spec-generators";
import type { SpecConfig } from "@qontinui/ui-bridge/specs";
import type { SpecGroup, NonVisualState, GeneratorSpecMetadata } from "./types";
import { usePageSpecs } from "@/hooks/usePageSpecs";
import pageSpec from "./snapshot-test-generator.spec.uibridge.json";
import postCaptureSpec from "./snapshot-post-capture.spec.uibridge.json";

type Tab = "elements" | "annotations" | "specs" | "output";

export interface BrowserTab {
  id: number;
  title: string;
  url: string;
  active: boolean;
}

interface SnapshotTestGeneratorProps {
  runnerUrl?: string;
}

/** Send a command to the browser extension via the runner */
async function extensionCommand<T = unknown>(
  runnerUrl: string,
  action: string,
  params: Record<string, unknown> = {},
  timeoutSecs = 15
): Promise<T> {
  const res = await fetch(`${runnerUrl}/extension/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, params, timeout_secs: timeoutSecs }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Extension command "${action}" failed (${res.status}): ${text}`
    );
  }
  const result = await res.json();
  if (result.success === false) {
    throw new Error(result.error || `Extension command "${action}" failed`);
  }
  return (result.data ?? result) as T;
}

export function SnapshotTestGenerator({
  runnerUrl = "http://localhost:9876",
}: SnapshotTestGeneratorProps) {
  // Load page specs into the global SpecStore for Chrome extension discovery
  usePageSpecs({
    "snapshot-test-generator": pageSpec as unknown as SpecConfig,
    "snapshot-post-capture": postCaptureSpec as unknown as SpecConfig,
  });

  // Persisted state (survives navigation)
  const [activeTab, setActiveTab] = useLocalStorage<Tab>(
    "stg:activeTab",
    "elements"
  );
  const [selectedElementId, setSelectedElementId] = useLocalStorage<
    string | null
  >("stg:selectedElementId", null);
  const [elements, setElements] = useLocalStorage<SnapshotElement[]>(
    "stg:elements",
    []
  );
  const [snapshotData, setSnapshotData] = useLocalStorage<SnapshotData | null>(
    "stg:snapshotData",
    null
  );
  const [annotations, setAnnotations] = useLocalStorage<
    Map<string, AnnotationData>
  >("stg:annotations", new Map(), {
    serialize: (map) => JSON.stringify(Array.from(map.entries())),
    deserialize: (str) => new Map(JSON.parse(str)),
  });
  const [specs, setSpecs] = useLocalStorage<SpecGroup[]>("stg:specs", []);

  // Transient state (reset on navigation)
  const [isConnected, setIsConnected] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [browserTabs, setBrowserTabs] = useState<BrowserTab[]>([]);
  const [selectedTabId, setSelectedTabId] = useState<number | null>(null);
  const [isLoadingTabs, setIsLoadingTabs] = useState(false);
  const [isSavingAnnotation, setIsSavingAnnotation] = useState(false);
  const [previousSnapshot, setPreviousSnapshot] = useState<SnapshotData | null>(
    null
  );
  const [snapshotDiff, setSnapshotDiff] = useState<SnapshotDiff | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // Check connection — verify both runner and browser extension are reachable
  const checkConnection = useCallback(async () => {
    try {
      const res = await fetch(`${runnerUrl}/extension/status`);
      if (!res.ok) {
        setIsConnected(false);
        return;
      }
      const data = await res.json();
      setIsConnected(data.data?.connected === true);
    } catch {
      setIsConnected(false);
    }
  }, [runnerUrl]);

  // Check connection on mount
  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  // Fetch available browser tabs
  const handleRefreshTabs = useCallback(async () => {
    setIsLoadingTabs(true);
    try {
      const data = await extensionCommand<{ tabs?: BrowserTab[] }>(
        runnerUrl,
        "listTabs"
      );
      const tabs = data.tabs || [];
      setBrowserTabs(tabs);
      // Auto-select the active tab if none selected
      if (selectedTabId === null) {
        const activeTab = tabs.find((t) => t.active);
        if (activeTab) setSelectedTabId(activeTab.id);
      }
    } catch (err) {
      console.error("Failed to list tabs:", err);
    } finally {
      setIsLoadingTabs(false);
    }
  }, [runnerUrl, selectedTabId]);

  // Fetch tabs when connected
  useEffect(() => {
    if (isConnected) {
      handleRefreshTabs();
    }
  }, [isConnected, handleRefreshTabs]);

  // Select a browser tab for capture
  const handleSelectTab = useCallback(
    async (tabId: number) => {
      setSelectedTabId(tabId);
      try {
        await extensionCommand(runnerUrl, "selectTab", { tabId });
      } catch (err) {
        console.error("Failed to select tab:", err);
      }
    },
    [runnerUrl]
  );

  // Capture snapshot via the browser extension's getElements command
  const handleCapture = useCallback(async () => {
    setIsCapturing(true);
    setCaptureError(null);
    try {
      // If a tab is selected, ensure it's the active target
      if (selectedTabId !== null) {
        await extensionCommand(runnerUrl, "selectTab", {
          tabId: selectedTabId,
        });
      }

      // Get elements from the selected browser tab
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await extensionCommand<any>(runnerUrl, "getElements");
      const rawElements = data.elements || [];

      // Also get the active tab info for page URL/title
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let pageInfo: any = {};
      try {
        pageInfo = await extensionCommand(runnerUrl, "getActiveTab");
      } catch {
        // Page info is optional
      }

      // Parse ExternalElement[] into SnapshotElement[]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsedElements: SnapshotElement[] = rawElements.map((el: any) => {
        const accessibility = el.accessibility || {};
        return {
          id: el.id || "",
          type: el.type || el.tagName || "unknown",
          label:
            el.label || accessibility.accessibleName || el.text || el.id || "",
          role: accessibility.role || el.role,
          ariaLabel: accessibility.ariaLabel || accessibility.accessibleName,
          isInteractive:
            Array.isArray(el.actions) &&
            el.actions.some((a: string) =>
              ["click", "type", "select", "check", "toggle"].includes(a)
            ),
          isVisible: el.visible !== false,
          isEnabled: el.enabled !== false,
          isRequired: accessibility.required || el.required,
          value: el.value,
          checked: el.checked,
          formId: el.formId,
          attributes: el.attributes || el.dataAttributes,
        };
      });

      // Build form data from elements that have formId
      const formIds = new Set(
        parsedElements.filter((e) => e.formId).map((e) => e.formId!)
      );
      const forms = Array.from(formIds).map((formId) => ({
        id: formId,
        name: formId,
        action: undefined as string | undefined,
        fields: parsedElements.filter((e) => e.formId === formId),
        hasSubmitButton: parsedElements.some(
          (e) =>
            e.formId === formId &&
            (e.type === "submit" || e.role === "button") &&
            /submit|sign|log\s?in|register/i.test(e.label || "")
        ),
      }));

      // No modal detection via getElements — leave empty
      const modals: SnapshotData["modals"] = [];

      const snapshotDataNew: SnapshotData = {
        elements: parsedElements,
        forms,
        modals,
        pageUrl: pageInfo.url || pageInfo.tab?.url,
        pageTitle: pageInfo.title || pageInfo.tab?.title,
      };

      // Save previous for comparison
      if (snapshotData) {
        setPreviousSnapshot(snapshotData);
      }

      setElements(parsedElements);
      setSnapshotData(snapshotDataNew);
      setAnnotations(new Map());
      setIsConnected(true);

      if (parsedElements.length === 0) {
        setCaptureError(
          "No elements found. Make sure the target page is loaded and the extension has access."
        );
      }
    } catch (err) {
      console.error("Capture failed:", err);
      setCaptureError(err instanceof Error ? err.message : "Capture failed");
    } finally {
      setIsCapturing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runnerUrl, snapshotData, selectedTabId]);

  // Compare snapshots
  const handleCompare = useCallback(() => {
    if (!snapshotData || !previousSnapshot) return;

    const currentIds = new Set(snapshotData.elements.map((e) => e.id));
    const prevIds = new Set(previousSnapshot.elements.map((e) => e.id));

    const added = snapshotData.elements
      .filter((e) => !prevIds.has(e.id))
      .map((e) => ({ id: e.id, label: e.label || e.id, type: e.type }));

    const removed = previousSnapshot.elements
      .filter((e) => !currentIds.has(e.id))
      .map((e) => ({ id: e.id, label: e.label || e.id, type: e.type }));

    const changed: SnapshotDiff["changed"] = [];
    for (const el of snapshotData.elements) {
      const prev = previousSnapshot.elements.find((p) => p.id === el.id);
      if (!prev) continue;
      const changes: string[] = [];
      if (el.isVisible !== prev.isVisible)
        changes.push(`visible: ${prev.isVisible} -> ${el.isVisible}`);
      if (el.isEnabled !== prev.isEnabled)
        changes.push(`enabled: ${prev.isEnabled} -> ${el.isEnabled}`);
      if (el.value !== prev.value)
        changes.push(`value: "${prev.value || ""}" -> "${el.value || ""}"`);
      if (changes.length > 0) {
        changed.push({
          id: el.id,
          label: el.label || el.id,
          type: el.type,
          changes,
        });
      }
    }

    const unchanged = snapshotData.elements.filter(
      (e) => prevIds.has(e.id) && !changed.some((c) => c.id === e.id)
    ).length;

    setSnapshotDiff({ added, removed, changed, unchanged });
    setShowComparison(true);
  }, [snapshotData, previousSnapshot]);

  // Save annotation
  const handleSaveAnnotation = useCallback(
    async (annotation: AnnotationData) => {
      setIsSavingAnnotation(true);
      try {
        await fetch(
          `${runnerUrl}/ui-bridge/annotations/${annotation.elementId}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(annotation),
          }
        );
        setAnnotations((prev) => {
          const next = new Map(prev);
          next.set(annotation.elementId, annotation);
          return next;
        });
      } catch (err) {
        console.error("Failed to save annotation:", err);
      } finally {
        setIsSavingAnnotation(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runnerUrl]
  );

  // Generate specs
  const handleGenerate = useCallback(() => {
    if (!snapshotData) return;
    setIsGenerating(true);
    const stateId = `state-${Date.now()}`;
    const generated = generateSpecsFromSnapshot(snapshotData, stateId);
    setSpecs(generated);
    setIsGenerating(false);
    setActiveTab("specs");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotData]);

  // Build browsable elements
  const browsableElements: BrowsableElement[] = useMemo(
    () =>
      elements.map((el) => ({
        id: el.id,
        type: el.type,
        label: el.label || el.id,
        isInteractive: el.isInteractive,
        isAnnotated: annotations.has(el.id),
        hasSpecs: specs.some((s) =>
          s.assertions.some(
            (a) => a.target.type === "elementId" && a.target.elementId === el.id
          )
        ),
      })),
    [elements, annotations, specs]
  );

  // Build selected element detail
  const selectedDetail: ElementDetail | null = useMemo(() => {
    if (!selectedElementId) return null;
    const el = elements.find((e) => e.id === selectedElementId);
    if (!el) return null;
    const ann = annotations.get(el.id);
    return {
      id: el.id,
      type: el.type,
      label: el.label || el.id,
      role: el.role,
      ariaLabel: el.ariaLabel,
      isVisible: el.isVisible,
      isEnabled: el.isEnabled,
      isInteractive: el.isInteractive,
      value: el.value,
      checked: el.checked,
      actions: el.isInteractive ? ["click", "type", "focus"] : ["focus"],
      annotation: ann
        ? {
            description: ann.description,
            purpose: ann.purpose,
            notes: ann.notes,
            tags: ann.tags,
          }
        : undefined,
      attributes: el.attributes,
    };
  }, [selectedElementId, elements, annotations]);

  // Build output
  const output: SpecConfig | null = useMemo(() => {
    if (specs.length === 0 || !snapshotData) return null;
    const now = new Date().toISOString();
    const state: NonVisualState = {
      id: specs[0]?.stateId || "state-default",
      name: snapshotData.pageTitle || "Page Snapshot",
      description: `Snapshot of ${snapshotData.pageUrl || "unknown page"}`,
      elementIds: elements.map((e) => e.id),
      pageUrl: snapshotData.pageUrl,
      pageTitle: snapshotData.pageTitle,
      confidence: 1.0,
    };
    const metadata: GeneratorSpecMetadata = {
      generatorType: "snapshot",
      pageUrl: snapshotData.pageUrl,
      states: [state],
      transitions: [],
      snapshotMetadata: {
        snapshotId: `snapshot-${Date.now()}`,
        pageUrl: snapshotData.pageUrl || "",
        pageTitle: snapshotData.pageTitle || "",
        capturedAt: now,
        elementCount: elements.length,
        formCount: snapshotData.forms.length,
        modalCount: snapshotData.modals.length,
      },
      createdAt: now,
      updatedAt: now,
    };
    return {
      version: "1.0.0" as const,
      description: `Snapshot specs for ${snapshotData.pageTitle || snapshotData.pageUrl || "page"}`,
      groups: specs,
      metadata,
    };
  }, [specs, snapshotData, elements]);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "elements", label: "Elements", icon: <Layers className="w-4 h-4" /> },
    {
      id: "annotations",
      label: "Annotations",
      icon: <Tag className="w-4 h-4" />,
    },
    {
      id: "specs",
      label: "Test Specs",
      icon: <TestTube2 className="w-4 h-4" />,
    },
    { id: "output", label: "Output", icon: <FileOutput className="w-4 h-4" /> },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Title bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-700">
        <h2
          className="text-lg font-semibold text-neutral-100"
          data-ui-element
          role="heading"
          aria-level={2}
        >
          Snapshot Test Generator
        </h2>
        <span
          className="px-2 py-0.5 text-[10px] bg-emerald-500/20 text-emerald-400 rounded-full font-medium"
          data-ui-element
        >
          beta
        </span>
      </div>

      {/* Capture bar */}
      <SnapshotCapturePanel
        isConnected={isConnected}
        isCapturing={isCapturing}
        hasPreviousSnapshot={!!previousSnapshot}
        onCapture={handleCapture}
        onCompare={handleCompare}
        runnerUrl={runnerUrl}
        browserTabs={browserTabs}
        selectedTabId={selectedTabId}
        onSelectTab={handleSelectTab}
        onRefreshTabs={handleRefreshTabs}
        isLoadingTabs={isLoadingTabs}
        captureError={captureError}
      />

      {/* Tabs */}
      <div className="flex border-b border-neutral-700 bg-neutral-800/50">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              setShowComparison(false);
            }}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${
              activeTab === tab.id
                ? "text-emerald-400 border-emerald-400 bg-neutral-900/50"
                : "text-neutral-400 border-transparent hover:text-neutral-200 hover:bg-neutral-700/30"
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.id === "specs" && specs.length > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] bg-emerald-500/20 text-emerald-400 rounded">
                {specs.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content — all tabs stay mounted (visibility:hidden preserves DOM
          presence for bridge.discover(), unlike display:none which removes from
          layout entirely). Active tab gets visibility:visible. */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        {showComparison && (
          <div className="absolute inset-0" style={{ zIndex: 3 }}>
            <SnapshotComparer
              diff={snapshotDiff}
              onBack={() => setShowComparison(false)}
            />
          </div>
        )}
        <div
          className="absolute inset-0 overflow-auto"
          style={{
            zIndex: activeTab === "elements" ? 2 : 0,
            pointerEvents: activeTab === "elements" ? "auto" : "none",
            visibility: activeTab === "elements" ? "visible" : "hidden",
          }}
        >
          <div className="flex h-full">
            <div className="w-72 flex-shrink-0">
              <SnapshotElementBrowser
                elements={browsableElements}
                selectedId={selectedElementId}
                onSelect={setSelectedElementId}
              />
            </div>
            <div className="flex-1">
              <ElementDetailPanel
                element={selectedDetail}
                onEditAnnotation={(id) => {
                  setSelectedElementId(id);
                  setActiveTab("annotations");
                }}
              />
            </div>
          </div>
        </div>
        <div
          className="absolute inset-0 overflow-auto"
          style={{
            zIndex: activeTab === "annotations" ? 2 : 0,
            pointerEvents: activeTab === "annotations" ? "auto" : "none",
            visibility: activeTab === "annotations" ? "visible" : "hidden",
          }}
        >
          <AnnotationEditor
            elements={elements.map((e) => ({
              id: e.id,
              label: e.label || e.id,
              type: e.type,
            }))}
            annotations={annotations}
            onSave={handleSaveAnnotation}
            isSaving={isSavingAnnotation}
          />
        </div>
        <div
          className="absolute inset-0 overflow-auto"
          style={{
            zIndex: activeTab === "specs" ? 2 : 0,
            pointerEvents: activeTab === "specs" ? "auto" : "none",
            visibility: activeTab === "specs" ? "visible" : "hidden",
          }}
        >
          <TestSpecEditor
            specs={specs}
            onSpecsChange={setSpecs}
            onGenerate={handleGenerate}
            isGenerating={isGenerating}
          />
        </div>
        <div
          className="absolute inset-0 overflow-auto"
          style={{
            zIndex: activeTab === "output" ? 2 : 0,
            pointerEvents: activeTab === "output" ? "auto" : "none",
            visibility: activeTab === "output" ? "visible" : "hidden",
          }}
        >
          <TestOutputPanel output={output} />
        </div>
      </div>
    </div>
  );
}
