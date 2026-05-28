"use client";

import {
  Settings,
  MessageSquare,
  Tags,
  Eye,
  Code,
  Camera,
  Download,
  Upload,
  ShieldCheck,
  RefreshCw,
  AtSign,
  X,
  Loader2,
  AlertTriangle,
  FileText,
} from "lucide-react";
import { EditorHeader, EditorSection, ExecutionPanel, MonacoField, type ExecutionResult } from "@/components/builders/editors";
import { TagInput } from "@/components/builders/TagInput";
import { AiGeneratorPanel } from "@/components/builders/AiGeneratorPanel";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { runnerApi } from "@/lib/runner/runner-api-object";
import type { PlaywrightScript } from "@/lib/runner/types/library";
import type { ScriptForm } from "../script-utils";
import { DEFAULT_SCRIPT_CONTENT } from "../script-utils";
import { useScriptEditor } from "../_hooks/useScriptEditor";
import { PromptSnippetMentionDropdown } from "./PromptSnippetMentionDropdown";
import { AutoRefineSection } from "./AutoRefineSection";

interface ScriptEditorProps {
  item: PlaywrightScript;
  form: ScriptForm;
  setForm: (form: ScriptForm) => void;
  isDirty: boolean;
  isNew: boolean;
  isSaving: boolean;
  onSave: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onOpenSnippetManager: () => void;
}

export function ScriptEditor({
  item,
  form,
  setForm,
  isDirty,
  isNew,
  isSaving,
  onSave,
  onDelete,
  onDuplicate,
  onOpenSnippetManager,
}: ScriptEditorProps) {
  const editor = useScriptEditor({
    item,
    form,
    setForm,
    isDirty,
    isNew,
    onSave,
    onDelete,
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <EditorHeader
        name={form.name}
        onNameChange={(name) => editor.updateField("name", name)}
        onSave={onSave}
        onDelete={() => editor.setDeleteDialogOpen(true)}
        onDuplicate={onDuplicate}
        isSaving={isSaving}
        isDirty={isDirty}
        isNew={isNew}
        nameplaceholder="Playwright test name..."
      >
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-muted-foreground hover:text-muted-foreground"
          onClick={editor.handleExport}
          title="Export as JSON"
        >
          <Download className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-muted-foreground hover:text-muted-foreground"
          onClick={editor.handleImport}
          title="Import from JSON"
        >
          <Upload className="size-3.5" />
        </Button>
        <input
          ref={editor.fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={editor.handleFileChange}
        />
      </EditorHeader>

      {/* Draft Restore Banner */}
      {editor.hasDraft && !isDirty && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-sm">
          <AlertTriangle className="size-4 text-amber-400 shrink-0" />
          <span className="flex-1 text-amber-300 text-xs">
            You have an unsaved draft for this playwright test.
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-amber-400 hover:text-amber-300"
            onClick={editor.handleRestoreDraft}
          >
            Restore Draft
          </Button>
          <DestructiveButton
            size="sm"
            className="h-6 px-2 text-xs text-muted-foreground hover:text-muted-foreground"
            onClick={editor.handleDiscardDraft}
          >
            Discard
          </DestructiveButton>
        </div>
      )}

      {/* View Mode Toggle */}
      <div className="flex items-center gap-1 px-4 pt-3 pb-1">
        <div className="inline-flex items-center rounded-lg bg-muted border border-border p-0.5">
          <button
            onClick={() => editor.setViewMode("description")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              editor.viewMode === "description"
                ? "bg-blue-500/20 text-blue-400 shadow-sm"
                : "text-muted-foreground hover:text-muted-foreground"
            }`}
          >
            <Eye className="size-3.5" />
            Description
          </button>
          <button
            onClick={() => editor.setViewMode("code")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              editor.viewMode === "code"
                ? "bg-blue-500/20 text-blue-400 shadow-sm"
                : "text-muted-foreground hover:text-muted-foreground"
            }`}
          >
            <Code className="size-3.5" />
            Code
          </button>
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="h-7 ml-auto text-xs text-indigo-400 hover:text-indigo-300 gap-1.5"
          onClick={onOpenSnippetManager}
          title="Manage prompt snippets"
        >
          <FileText className="size-3.5" />
          Manage Snippets
        </Button>

        {!isNew && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground hover:text-muted-foreground gap-1.5"
            onClick={editor.handleValidateCoverage}
            disabled={editor.isValidatingCoverage}
            title="Validate that code covers all requirements from description"
          >
            {editor.isValidatingCoverage ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="size-3.5" />
            )}
            Validate Coverage
          </Button>
        )}
      </div>

      {/* Coverage Warnings */}
      {editor.coverageWarnings.length > 0 && (
        <div className="mx-4 mt-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="size-4 text-amber-400" />
            <span className="text-xs font-medium text-amber-400">
              Coverage Gaps Found
            </span>
            <button
              onClick={() => editor.setCoverageWarnings([])}
              className="ml-auto text-muted-foreground hover:text-muted-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <ul className="space-y-1">
            {editor.coverageWarnings.map((warning, i) => (
              <li key={i} className="text-xs text-amber-300/80 pl-6">
                - {warning}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Editor Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* View Mode: Description */}
        {editor.viewMode === "description" && (
          <>
            {/* Description with Regeneration */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Label htmlFor="description" className="text-xs text-muted-foreground">
                  Description
                </Label>
                {form.script_content.trim() &&
                  form.script_content !== DEFAULT_SCRIPT_CONTENT && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-muted-foreground gap-1"
                      onClick={editor.handleRegenerateDescription}
                      disabled={editor.isRegenerating}
                      title="Regenerate description from code"
                    >
                      {editor.isRegenerating ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3" />
                      )}
                      Regenerate from code
                    </Button>
                  )}

                <div className="relative ml-auto">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-muted-foreground gap-1"
                    onClick={() => {
                      editor.setSnippetTarget("description");
                      editor.setSnippetQuery("");
                      editor.setShowSnippetDropdown(!editor.showSnippetDropdown);
                    }}
                    title="Insert prompt snippet reference"
                  >
                    <AtSign className="size-3" />
                    Snippet
                  </Button>
                  {editor.showSnippetDropdown &&
                    editor.snippetTarget === "description" &&
                    editor.promptSnippetsQuery.data && (
                      <PromptSnippetMentionDropdown
                        snippets={editor.promptSnippetsQuery.data}
                        query={editor.snippetQuery}
                        onSelect={(s) => {
                          editor.handleSnippetSelect(s);
                          editor.setShowSnippetDropdown(false);
                        }}
                        onClose={() => editor.setShowSnippetDropdown(false)}
                      />
                    )}
                </div>
              </div>
              <Textarea
                ref={editor.descriptionRef}
                id="description"
                value={form.description}
                onChange={(e) => editor.updateField("description", e.target.value)}
                onKeyUp={(e) => editor.handleTextareaKeyUp(e, "description")}
                placeholder="What does this test do? Type @ to reference a prompt snippet."
                className="min-h-[80px] text-sm bg-muted border-border resize-none"
              />
            </div>

            {/* AI Instructions (in Description mode) */}
            <EditorSection
              title="AI Instructions"
              icon={MessageSquare}
              defaultOpen={!!form.ai_instructions}
            >
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Label
                    htmlFor="ai_instructions"
                    className="text-xs text-muted-foreground"
                  >
                    Instructions for AI-assisted execution
                  </Label>
                  <div className="relative ml-auto">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-muted-foreground gap-1"
                      onClick={() => {
                        editor.setSnippetTarget("ai_instructions");
                        editor.setSnippetQuery("");
                        editor.setShowSnippetDropdown(!editor.showSnippetDropdown);
                      }}
                      title="Insert prompt snippet reference"
                    >
                      <AtSign className="size-3" />
                      Snippet
                    </Button>
                    {editor.showSnippetDropdown &&
                      editor.snippetTarget === "ai_instructions" &&
                      editor.promptSnippetsQuery.data && (
                        <PromptSnippetMentionDropdown
                          snippets={editor.promptSnippetsQuery.data}
                          query={editor.snippetQuery}
                          onSelect={(s) => {
                            editor.handleSnippetSelect(s);
                            editor.setShowSnippetDropdown(false);
                          }}
                          onClose={() => editor.setShowSnippetDropdown(false)}
                        />
                      )}
                  </div>
                </div>
                <Textarea
                  ref={editor.aiInstructionsRef}
                  id="ai_instructions"
                  value={form.ai_instructions}
                  onChange={(e) =>
                    editor.updateField("ai_instructions", e.target.value)
                  }
                  onKeyUp={(e) => editor.handleTextareaKeyUp(e, "ai_instructions")}
                  placeholder="Optional: Provide context or special instructions for AI automation. Type @ to reference a prompt snippet."
                  className="min-h-[80px] text-sm bg-muted border-border resize-none"
                />
              </div>
            </EditorSection>
          </>
        )}

        {/* View Mode: Code */}
        {editor.viewMode === "code" && (
          <div className="space-y-1.5">
            <Label htmlFor="script" className="text-xs text-muted-foreground">
              Script Content
            </Label>
            <MonacoField
              value={form.script_content}
              onChange={(value) => editor.updateField("script_content", value)}
              language="typescript"
              height="500px"
            />
          </div>
        )}

        {/* Configuration Section */}
        <EditorSection title="Configuration" icon={Settings} defaultOpen={true}>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="target_url" className="text-xs text-muted-foreground">
                Target URL
              </Label>
              <Input
                id="target_url"
                value={form.target_url}
                onChange={(e) => editor.updateField("target_url", e.target.value)}
                placeholder="https://example.com"
                className="bg-muted border-border h-8 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="category" className="text-xs text-muted-foreground">
                Category
              </Label>
              <Input
                id="category"
                value={form.category}
                onChange={(e) => editor.updateField("category", e.target.value)}
                placeholder="e.g., auth, forms, navigation"
                className="bg-muted border-border h-8 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="browser" className="text-xs text-muted-foreground">
                Browser
              </Label>
              <Select
                value={form.browser}
                onValueChange={(value) => editor.updateField("browser", value)}
              >
                <SelectTrigger
                  id="browser"
                  className="bg-muted border-border h-8 text-sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="chromium">Chromium</SelectItem>
                  <SelectItem value="firefox">Firefox</SelectItem>
                  <SelectItem value="webkit">WebKit (Safari)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="display_mode" className="text-xs text-muted-foreground">
                Display Mode
              </Label>
              <Select
                value={form.display_mode}
                onValueChange={(value) => editor.updateField("display_mode", value)}
              >
                <SelectTrigger
                  id="display_mode"
                  className="bg-muted border-border h-8 text-sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="headless">Headless</SelectItem>
                  <SelectItem value="headed">Headed</SelectItem>
                  <SelectItem value="slow-mo">Slow Motion</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="timeout" className="text-xs text-muted-foreground">
                Timeout (seconds)
              </Label>
              <Input
                id="timeout"
                type="number"
                value={form.timeout_seconds}
                onChange={(e) =>
                  editor.updateField("timeout_seconds", parseInt(e.target.value, 10) || 30)
                }
                min={1}
                max={600}
                className="bg-muted border-border h-8 text-sm"
              />
            </div>
          </div>
        </EditorSection>

        {/* Visual Context Section */}
        <EditorSection title="Visual Context" icon={Camera} defaultOpen={false}>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs text-foreground">
                  Screenshot on Failure
                </Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Capture screenshot when a test fails
                </p>
              </div>
              <Switch
                checked={form.screenshot_on_failure}
                onCheckedChange={(checked) =>
                  editor.updateField("screenshot_on_failure", checked)
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs text-foreground">
                  Trace Recording
                </Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Record a trace for post-mortem debugging
                </p>
              </div>
              <Switch
                checked={form.trace_enabled}
                onCheckedChange={(checked) =>
                  editor.updateField("trace_enabled", checked)
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs text-foreground">
                  Video Recording
                </Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Record video of test execution
                </p>
              </div>
              <Switch
                checked={form.video_enabled}
                onCheckedChange={(checked) =>
                  editor.updateField("video_enabled", checked)
                }
              />
            </div>

            {form.video_enabled && (
              <div className="pl-4 border-l-2 border-blue-500/20">
                <div className="flex items-center gap-2">
                  <Label className="text-[11px] text-muted-foreground whitespace-nowrap">
                    Enable video after iteration
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    max={20}
                    value={editor.videoAfterIterations}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10) || 0;
                      editor.setVideoAfterIterations(v);
                      try { localStorage.setItem("qontinui-autorefine-video-after-iterations", String(v)); } catch {}
                    }}
                    className="bg-muted border-border h-7 text-sm w-16"
                  />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Video recording starts after this many auto-refine iterations (0 = always record)
                </p>
              </div>
            )}
          </div>
        </EditorSection>

        {/* AI Instructions Section (shown when in Code view mode) */}
        {editor.viewMode === "code" && (
          <EditorSection
            title="AI Instructions"
            icon={MessageSquare}
            defaultOpen={false}
          >
            <div className="space-y-1.5">
              <Label
                htmlFor="ai_instructions_code"
                className="text-xs text-muted-foreground"
              >
                Instructions for AI-assisted execution
              </Label>
              <Textarea
                id="ai_instructions_code"
                value={form.ai_instructions}
                onChange={(e) =>
                  editor.updateField("ai_instructions", e.target.value)
                }
                placeholder="Optional: Provide context or special instructions for AI automation"
                className="min-h-[80px] text-sm bg-muted border-border resize-none"
              />
            </div>
          </EditorSection>
        )}

        {/* Tags Section */}
        <EditorSection title="Tags" icon={Tags} defaultOpen={false}>
          <TagInput
            tags={form.tags}
            onChange={(tags) => editor.updateField("tags", tags)}
            placeholder="Add tag..."
          />
        </EditorSection>

        {/* Execution Panel */}
        {!isNew && (
          <ExecutionPanel
            onRun={async () => {
              try {
                const result = await runnerApi.runPlaywrightTest(item.id);
                return {
                  success: true,
                  output: `Started task run: ${result.task_run_id}`,
                } as ExecutionResult;
              } catch (err) {
                return {
                  success: false,
                  error: err instanceof Error ? err.message : "Execution failed",
                } as ExecutionResult;
              }
            }}
            runLabel="Run Test"
            disabled={isNew}
          />
        )}

        {/* Auto-Refine Loop */}
        {!isNew && (
          <AutoRefineSection
            isAutoRefining={editor.isAutoRefining}
            autoRefineIteration={editor.autoRefineIteration}
            autoRefineMaxIterations={editor.autoRefineMaxIterations}
            setAutoRefineMaxIterations={editor.setAutoRefineMaxIterations}
            autoRefineLog={editor.autoRefineLog}
            autoRefineUserHint={editor.autoRefineUserHint}
            setAutoRefineUserHint={editor.setAutoRefineUserHint}
            runAutoRefine={editor.runAutoRefine}
            stopAutoRefine={editor.stopAutoRefine}
          />
        )}

        {/* AI Generator Panel */}
        <AiGeneratorPanel
          title="Generate with AI"
          accentColor="purple"
          templates={[
            {
              label: "Login Test",
              prompt:
                "Create a login test with username and password fields",
            },
            {
              label: "Form Validation",
              prompt: "Create a form validation test",
            },
            {
              label: "Navigation Test",
              prompt:
                "Create a navigation test for the main menu",
            },
            {
              label: "Button Click",
              prompt:
                "Create a test that clicks a button and verifies the result",
            },
          ]}
          placeholder="Describe the test you want to generate..."
          generating={editor.aiGenerating}
          error={editor.aiError}
          onGenerate={editor.handleAiGenerate}
          disclaimer="AI test generation is experimental"
        />
      </div>

      {/* Delete Confirmation Dialog */}
      {editor.deleteDialogOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-muted border border-border rounded-lg p-6 max-w-md">
            <h3 className="text-lg font-semibold text-foreground mb-2">
              Delete Playwright Test
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              Are you sure you want to delete &quot;{form.name}&quot;? This action
              cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                /* eslint-disable-next-line @qontinui-web/no-unwrapped-destructive-handler -- cancel button; closes the dialog without performing the destructive action */
                onClick={() => editor.setDeleteDialogOpen(false)}
                className="px-4 py-2 text-sm bg-muted border border-border rounded hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <DestructiveButton
                onClick={editor.handleDelete}
                className="px-4 py-2 text-sm"
              >
                Delete
              </DestructiveButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
