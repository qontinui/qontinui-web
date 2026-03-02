import type { Tab } from "./SnapshotTabBar";
import {
  SnapshotElementBrowser,
  type BrowsableElement,
} from "../snapshot/SnapshotElementBrowser";
import {
  ElementDetailPanel,
  type ElementDetail,
} from "../snapshot/ElementDetailPanel";
import {
  AnnotationEditor,
  type AnnotationData,
} from "../snapshot/AnnotationEditor";
import {
  SnapshotComparer,
  type SnapshotDiff,
} from "../snapshot/SnapshotComparer";
import { TestSpecEditor } from "../shared/TestSpecEditor";
import { TestOutputPanel } from "../shared/TestOutputPanel";
import type { SnapshotElement } from "../shared/spec-generators";
import type { SpecConfig } from "@qontinui/ui-bridge/specs";
import type { SpecGroup } from "../types";

interface TabLayerProps {
  tab: Tab;
  activeTab: Tab;
  children: React.ReactNode;
}

function TabLayer({ tab, activeTab, children }: TabLayerProps) {
  return (
    <div
      className="absolute inset-0 overflow-auto"
      style={{
        zIndex: activeTab === tab ? 2 : 0,
        pointerEvents: activeTab === tab ? "auto" : "none",
        visibility: activeTab === tab ? "visible" : "hidden",
      }}
    >
      {children}
    </div>
  );
}

interface SnapshotTabContentProps {
  activeTab: Tab;
  showComparison: boolean;
  snapshotDiff: SnapshotDiff | null;
  onCloseComparison: () => void;
  browsableElements: BrowsableElement[];
  selectedElementId: string | null;
  onSelectElement: (id: string | null) => void;
  selectedDetail: ElementDetail | null;
  onEditAnnotation: (id: string) => void;
  elements: SnapshotElement[];
  annotations: Map<string, AnnotationData>;
  onSaveAnnotation: (annotation: AnnotationData) => Promise<void>;
  isSavingAnnotation: boolean;
  specs: SpecGroup[];
  onSpecsChange: (specs: SpecGroup[]) => void;
  onGenerate: () => void;
  isGenerating: boolean;
  output: SpecConfig | null;
}

export function SnapshotTabContent({
  activeTab,
  showComparison,
  snapshotDiff,
  onCloseComparison,
  browsableElements,
  selectedElementId,
  onSelectElement,
  selectedDetail,
  onEditAnnotation,
  elements,
  annotations,
  onSaveAnnotation,
  isSavingAnnotation,
  specs,
  onSpecsChange,
  onGenerate,
  isGenerating,
  output,
}: SnapshotTabContentProps) {
  return (
    <div className="flex-1 min-h-0 overflow-hidden relative">
      {showComparison && (
        <div className="absolute inset-0" style={{ zIndex: 3 }}>
          <SnapshotComparer diff={snapshotDiff} onBack={onCloseComparison} />
        </div>
      )}
      <TabLayer tab="elements" activeTab={activeTab}>
        <div className="flex h-full">
          <div className="w-72 flex-shrink-0">
            <SnapshotElementBrowser
              elements={browsableElements}
              selectedId={selectedElementId}
              onSelect={onSelectElement}
            />
          </div>
          <div className="flex-1">
            <ElementDetailPanel
              element={selectedDetail}
              onEditAnnotation={onEditAnnotation}
            />
          </div>
        </div>
      </TabLayer>
      <TabLayer tab="annotations" activeTab={activeTab}>
        <AnnotationEditor
          elements={elements.map((e) => ({
            id: e.id,
            label: e.label || e.id,
            type: e.type,
          }))}
          annotations={annotations}
          onSave={onSaveAnnotation}
          isSaving={isSavingAnnotation}
        />
      </TabLayer>
      <TabLayer tab="specs" activeTab={activeTab}>
        <TestSpecEditor
          specs={specs}
          onSpecsChange={onSpecsChange}
          onGenerate={onGenerate}
          isGenerating={isGenerating}
        />
      </TabLayer>
      <TabLayer tab="output" activeTab={activeTab}>
        <TestOutputPanel output={output} />
      </TabLayer>
    </div>
  );
}
