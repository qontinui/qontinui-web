import { useCallback, useMemo } from "react";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { usePageSpecs } from "@/hooks/usePageSpecs";
import { useDiscoveredSpec } from "@/lib/ui-bridge/use-discovered-specs";
import type { SpecConfig } from "@qontinui/ui-bridge/specs";
import type { AnnotationData } from "./snapshot/AnnotationEditor";
import type { SnapshotElement } from "./shared/spec-generators";
import type { SnapshotData } from "./shared/spec-generators";
import type { SpecGroup } from "./types";
import { SnapshotCapturePanel } from "./snapshot/SnapshotCapturePanel";
import { SnapshotTabBar, type Tab } from "./_components/SnapshotTabBar";
import { SnapshotTabContent } from "./_components/SnapshotTabContent";
import { useExtensionConnection } from "./_hooks/useExtensionConnection";
import { useSnapshotCapture } from "./_hooks/useSnapshotCapture";
import { useSnapshotAnnotations } from "./_hooks/useSnapshotAnnotations";
import { useSnapshotSpecs } from "./_hooks/useSnapshotSpecs";
import { useSnapshotDerivedData } from "./_hooks/useSnapshotDerivedData";

export type { BrowserTab } from "./_hooks/useExtensionConnection";

interface SnapshotTestGeneratorProps {
  runnerUrl?: string;
}

export function SnapshotTestGenerator({
  runnerUrl = "http://localhost:9876",
}: SnapshotTestGeneratorProps) {
  const pageSpec = useDiscoveredSpec("snapshot-test-generator");
  const postCaptureSpec = useDiscoveredSpec("snapshot-post-capture");
  const specsToLoad = useMemo<Record<string, SpecConfig>>(() => {
    if (!pageSpec || !postCaptureSpec) {
      return {} as Record<string, SpecConfig>;
    }
    return {
      "snapshot-test-generator": pageSpec.config,
      "snapshot-post-capture": postCaptureSpec.config,
    };
  }, [pageSpec, postCaptureSpec]);
  usePageSpecs(specsToLoad);

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

  const connection = useExtensionConnection(runnerUrl);

  const capture = useSnapshotCapture({
    runnerUrl,
    selectedTabId: connection.selectedTabId,
    snapshotData,
    setElements,
    setSnapshotData,
    setAnnotations,
    setIsConnected: connection.setIsConnected,
  });

  const { isSavingAnnotation, handleSaveAnnotation } = useSnapshotAnnotations({
    runnerUrl,
    setAnnotations,
  });

  const { isGenerating, output, handleGenerate } = useSnapshotSpecs({
    snapshotData,
    elements,
    specs,
    setSpecs,
    setActiveTab,
  });

  const { browsableElements, selectedDetail } = useSnapshotDerivedData({
    elements,
    annotations,
    specs,
    selectedElementId,
  });

  const handleTabChange = useCallback(
    (tab: Tab) => {
      setActiveTab(tab);
      capture.setShowComparison(false);
    },
    [setActiveTab, capture]
  );

  const handleEditAnnotation = useCallback(
    (id: string) => {
      setSelectedElementId(id);
      setActiveTab("annotations");
    },
    [setSelectedElementId, setActiveTab]
  );

  return (
    <div className="flex flex-col h-full">
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

      <SnapshotCapturePanel
        isConnected={connection.isConnected}
        isCapturing={capture.isCapturing}
        hasPreviousSnapshot={!!capture.previousSnapshot}
        onCapture={capture.handleCapture}
        onCompare={capture.handleCompare}
        runnerUrl={runnerUrl}
        browserTabs={connection.browserTabs}
        selectedTabId={connection.selectedTabId}
        onSelectTab={connection.handleSelectTab}
        onRefreshTabs={connection.handleRefreshTabs}
        isLoadingTabs={connection.isLoadingTabs}
        captureError={capture.captureError}
      />

      <SnapshotTabBar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        specs={specs}
      />

      <SnapshotTabContent
        activeTab={activeTab}
        showComparison={capture.showComparison}
        snapshotDiff={capture.snapshotDiff}
        onCloseComparison={() => capture.setShowComparison(false)}
        browsableElements={browsableElements}
        selectedElementId={selectedElementId}
        onSelectElement={setSelectedElementId}
        selectedDetail={selectedDetail}
        onEditAnnotation={handleEditAnnotation}
        elements={elements}
        annotations={annotations}
        onSaveAnnotation={handleSaveAnnotation}
        isSavingAnnotation={isSavingAnnotation}
        specs={specs}
        onSpecsChange={setSpecs}
        onGenerate={handleGenerate}
        isGenerating={isGenerating}
        output={output}
      />
    </div>
  );
}
