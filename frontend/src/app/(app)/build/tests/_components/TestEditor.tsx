"use client";

import {
  Code2,
  Tag,
  Wand2,
  Loader2,
  Download,
  Upload,
} from "lucide-react";
import {
  EditorHeader,
  EditorSection,
  MonacoField,
  ExecutionPanel,
  type ExecutionResult,
} from "@/components/builders/editors";
import { TagInput } from "@/components/builders/TagInput";
import { AiGeneratorPanel } from "@/components/builders/AiGeneratorPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageAnalyzer, type AnalysisData } from "@/components/test-builder/PageAnalyzer";
import { TestOrchestrator } from "@/components/test-builder/TestOrchestrator";
import { SpecWorkflowBuilder, type AnalyzedElement } from "@/components/test-builder/SpecWorkflowBuilder";
import type { RunnerTest } from "@/components/builders/hooks/useRunnerEntity";
import type { TestForm, EditorTab } from "../test-types";
import type { TestTypeConfig, AiTemplate } from "../test-types";
import { EDITOR_TABS, TEST_TYPE_MAP } from "../test-config";
import { getLanguageForTestType } from "../test-utils";
import { ScreenshotResultSection } from "./ScreenshotResultSection";
import { AiResultPreview } from "./AiResultPreview";

interface TestEditorProps {
  item: RunnerTest;
  form: TestForm;
  setForm: React.Dispatch<React.SetStateAction<TestForm>>;
  isDirty: boolean;
  isNew: boolean;
  isSaving: boolean;
  isOffline: boolean;
  selectedItem: RunnerTest | null;
  visibleTestTypes: readonly TestTypeConfig[];
  editorTab: EditorTab;
  setEditorTab: (tab: EditorTab) => void;
  analysisElements: AnalyzedElement[];
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  // AI state
  aiGenerating: boolean;
  aiResult: Record<string, unknown> | null;
  aiError: string | null;
  aiMetadataGenerating: boolean;
  currentAiTemplates: AiTemplate[];
  // Screenshot
  screenshotModalUrl: string | null;
  setScreenshotModalUrl: (url: string | null) => void;
  // Handlers
  handleSave: () => Promise<void>;
  handleDelete: () => Promise<void>;
  handleDuplicateTest: () => Promise<void>;
  handleTestTypeChange: (newType: string) => void;
  handleFillMetadataWithAi: () => Promise<void>;
  handleExport: () => void;
  handleImport: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handleExecuteTest: () => Promise<ExecutionResult>;
  handleAiGenerate: (prompt: string) => Promise<void>;
  handleAiAccept: () => void;
  handleAnalysisComplete: (analysis: AnalysisData) => void;
  handleApplyTestCode: (code: string) => void;
}

export function TestEditor({
  form,
  setForm,
  isDirty,
  isNew,
  isSaving,
  isOffline,
  selectedItem,
  visibleTestTypes,
  editorTab,
  setEditorTab,
  analysisElements,
  fileInputRef,
  aiGenerating,
  aiResult,
  aiError,
  aiMetadataGenerating,
  currentAiTemplates,
  screenshotModalUrl,
  setScreenshotModalUrl,
  handleSave,
  handleDelete,
  handleDuplicateTest,
  handleTestTypeChange,
  handleFillMetadataWithAi,
  handleExport,
  handleImport,
  handleExecuteTest,
  handleAiGenerate,
  handleAiAccept,
  handleAnalysisComplete,
  handleApplyTestCode,
}: TestEditorProps) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto p-6 space-y-4">
        {/* Tab Bar */}
        <div className="flex items-center gap-1 border-b border-border pb-0">
          {EDITOR_TABS.map((tab) => {
            const TabIcon = tab.icon;
            const isActive = editorTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setEditorTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-all border-b-2 -mb-[1px] ${
                  isActive
                    ? "text-emerald-400 border-emerald-400"
                    : "text-muted-foreground border-transparent hover:text-muted-foreground hover:border-border"
                }`}
              >
                <TabIcon className="size-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Page Analyzer Tab */}
        {editorTab === "analyzer" && (
          <PageAnalyzer onAnalysisComplete={handleAnalysisComplete} />
        )}

        {/* Test Orchestrator Tab */}
        {editorTab === "orchestrator" && (
          <TestOrchestrator onTestGenerated={(code) => handleApplyTestCode(code)} />
        )}

        {/* Spec Workflow Builder Tab */}
        {editorTab === "spec" && (
          <SpecWorkflowBuilder
            elements={analysisElements}
            onGenerate={(code) => handleApplyTestCode(code)}
          />
        )}

        {/* Editor Tab (existing content) */}
        {editorTab === "editor" && (
        <>
        {/* Header */}
        <EditorHeader
          name={form.name}
          onNameChange={(name) => setForm({ ...form, name })}
          onSave={handleSave}
          onDelete={!isNew ? handleDelete : undefined}
          onDuplicate={handleDuplicateTest}
          isSaving={isSaving}
          isDirty={isDirty}
          isNew={isNew}
          nameplaceholder="Test name..."
        />

        {/* Fill Metadata with AI + Import/Export toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs text-purple-400 border-purple-500/30 hover:bg-purple-500/10"
            onClick={handleFillMetadataWithAi}
            disabled={aiMetadataGenerating || !form.code.trim()}
            title="Analyze code and auto-fill name, description, and tags"
          >
            {aiMetadataGenerating ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Wand2 className="size-3" />
            )}
            Fill Metadata with AI
          </Button>

          <div className="flex-1" />

          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={handleExport}
            title="Export test as JSON"
          >
            <Download className="size-3" />
            Export
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => fileInputRef.current?.click()}
            title="Import test from JSON"
          >
            <Upload className="size-3" />
            Import
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleImport}
            className="hidden"
          />
        </div>

        {/* Description */}
        <EditorSection title="Description" defaultOpen={false}>
          <Textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Describe what this test does..."
            className="min-h-[80px] text-sm bg-background border-border resize-none"
          />
        </EditorSection>

        {/* Test Type (auto-fill template on type change) */}
        <EditorSection title="Test Type" icon={Code2}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {visibleTestTypes.map((type) => {
                const isSelected = form.test_type === type.id;
                const TypeIcon = type.icon;
                return (
                  <button
                    key={type.id}
                    type="button"
                    onClick={() => handleTestTypeChange(type.id)}
                    className={`
                      flex flex-col gap-1 p-3 rounded-lg border transition-all text-left
                      ${isSelected
                        ? `bg-${type.color}-500/10 border-${type.color}-500/40`
                        : "bg-muted/50 border-border hover:border-border"
                      }
                    `}
                  >
                    <div className="flex items-center gap-2">
                      <TypeIcon className={`size-3.5 ${isSelected ? `text-${type.color}-400` : "text-muted-foreground"}`} />
                      <span className={`text-sm font-medium ${isSelected ? "text-foreground" : "text-muted-foreground"}`}>
                        {type.label}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground ml-6">
                      {type.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </EditorSection>

        {/* URL (for web-based tests) */}
        {form.test_type === "qontinui_vision" && (
          <EditorSection title="Target URL" defaultOpen={false}>
            <div className="space-y-2">
              <Label htmlFor="test-url" className="text-sm text-muted-foreground">
                URL to test (optional)
              </Label>
              <Input
                id="test-url"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder="https://example.com"
                className="bg-muted border-border h-9 text-sm"
              />
            </div>
          </EditorSection>
        )}

        {/* Code (language auto-detection) */}
        <EditorSection title="Test Code" defaultOpen={true}>
          <MonacoField
            value={form.code}
            onChange={(code) => setForm({ ...form, code })}
            language={getLanguageForTestType(form.test_type)}
            height="400px"
          />
        </EditorSection>

        {/* Tags */}
        <EditorSection title="Tags" icon={Tag} defaultOpen={false}>
          <TagInput
            tags={form.tags}
            onChange={(tags) => setForm({ ...form, tags })}
            placeholder="Add tag..."
          />
        </EditorSection>

        {/* Execution Panel */}
        <ExecutionPanel
          onRun={handleExecuteTest}
          isRunnerOffline={isOffline}
          disabled={isNew || isDirty}
          runLabel="Run Test"
        />

        {/* Screenshot from last execution result */}
        {selectedItem && !isNew && (
          <ScreenshotResultSection
            testId={selectedItem.id}
            onOpenScreenshot={setScreenshotModalUrl}
          />
        )}

        {/* AI Generator (dynamic templates per test type) */}
        <AiGeneratorPanel
          title="AI Generate Test"
          accentColor="purple"
          templates={currentAiTemplates}
          placeholder="Describe the test you want to generate..."
          generating={aiGenerating}
          error={aiError}
          onGenerate={handleAiGenerate}
          result={aiResult ? <AiResultPreview aiResult={aiResult} /> : undefined}
          onAccept={handleAiAccept}
          acceptLabel="Apply to Test"
          extraInputs={
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                AI will generate for: {TEST_TYPE_MAP[form.test_type]?.label}
              </Label>
            </div>
          }
          disclaimer="AI-generated tests should be reviewed before execution"
        />
        </>
        )}
      </div>

      {/* Screenshot Modal */}
      <Dialog
        open={!!screenshotModalUrl}
        onOpenChange={(open) => !open && setScreenshotModalUrl(null)}
      >
        <DialogContent className="sm:max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Test Screenshot</DialogTitle>
          </DialogHeader>
          {screenshotModalUrl && (
            <div className="overflow-auto max-h-[75vh]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={screenshotModalUrl}
                alt="Test execution screenshot"
                className="w-full h-auto rounded"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
