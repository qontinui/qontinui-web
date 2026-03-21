"use client";

import { useState } from "react";
import {
  Settings,
  Tags,
  Layers,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { EditorHeader, EditorSection, ExecutionPanel, type ExecutionResult } from "@/components/builders/editors";
import { TagInput } from "@/components/builders/TagInput";
import { AssignChecksDialog } from "@/components/builders/AssignChecksDialog";
import { runnerApi } from "@/lib/runner/runner-api-object";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { CheckGroupItem } from "@/services/library-service";
import type { CheckGroupForm } from "../check-utils";

interface CheckGroupEditorProps {
  item: CheckGroupItem;
  form: CheckGroupForm;
  setForm: (form: CheckGroupForm | ((prev: CheckGroupForm) => CheckGroupForm)) => void;
  isDirty: boolean;
  isNew: boolean;
  isSaving: boolean;
  onSave: () => void;
  onDelete: () => void;
  checksMap: Map<string, { id: string; name: string; description?: string | null; check_type: string }>;
}

export function CheckGroupEditor({ item, form, setForm, isDirty, isNew, isSaving, onSave, onDelete, checksMap }: CheckGroupEditorProps) {
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);

  const updateField = <K extends keyof CheckGroupForm>(field: K, value: CheckGroupForm[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleAssignChecks = (checkIds: string[]) => {
    updateField("check_ids", checkIds);
    setAssignDialogOpen(false);
  };

  const handleRemoveCheck = (checkId: string) => {
    updateField("check_ids", form.check_ids.filter((id) => id !== checkId));
  };

  const handleMoveCheck = (index: number, direction: "up" | "down") => {
    const newIds = [...form.check_ids];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newIds.length) return;
    const temp = newIds[index]!;
    newIds[index] = newIds[targetIndex]!;
    newIds[targetIndex] = temp;
    updateField("check_ids", newIds);
  };

  const assignedChecks = form.check_ids
    .map((id) => checksMap.get(id))
    .filter(Boolean);

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
        nameplaceholder="Check group name..."
      />

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Description */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Description</Label>
          <Textarea
            value={form.description}
            onChange={(e) => updateField("description", e.target.value)}
            placeholder="Describe what this check group does..."
            className="min-h-[60px] text-sm bg-muted border-border resize-none"
          />
        </div>

        {/* Checks */}
        <EditorSection title="Checks" defaultOpen={true}>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {form.check_ids.length} {form.check_ids.length === 1 ? "check" : "checks"} assigned
              </span>
              <button
                onClick={() => setAssignDialogOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 rounded border border-teal-500/30 transition-colors"
              >
                <Plus className="size-3.5" />
                Assign Checks
              </button>
            </div>

            {assignedChecks.length > 0 ? (
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {assignedChecks.map((check, index) => check && (
                  <div
                    key={check.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 bg-muted rounded-lg border border-border"
                  >
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={() => handleMoveCheck(index, "up")}
                        disabled={index === 0}
                        className="p-0.5 text-muted-foreground hover:text-muted-foreground disabled:opacity-30 disabled:cursor-not-allowed rounded transition-colors"
                      >
                        <ChevronUp className="size-3.5" />
                      </button>
                      <button
                        onClick={() => handleMoveCheck(index, "down")}
                        disabled={index === assignedChecks.length - 1}
                        className="p-0.5 text-muted-foreground hover:text-muted-foreground disabled:opacity-30 disabled:cursor-not-allowed rounded transition-colors"
                      >
                        <ChevronDown className="size-3.5" />
                      </button>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-foreground truncate">{check.name}</span>
                        <Badge variant="secondary" className="text-[10px] px-1.5 bg-green-500/10 text-green-400 border-green-500/30 shrink-0">
                          {check.check_type}
                        </Badge>
                      </div>
                      {check.description && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{check.description}</p>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemoveCheck(check.id)}
                      className="shrink-0 p-1 text-muted-foreground hover:text-red-400 rounded transition-colors"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 bg-muted/50 border border-border rounded-lg text-center">
                <Layers className="size-8 text-muted-foreground mx-auto mb-2 opacity-50" />
                <p className="text-sm text-muted-foreground">No checks assigned yet</p>
                <p className="text-xs text-muted-foreground mt-1">Click &quot;Assign Checks&quot; to add checks</p>
              </div>
            )}
          </div>
        </EditorSection>

        {/* Settings */}
        <EditorSection title="Settings" icon={Settings} defaultOpen={true}>
          <div className="space-y-3">
            <label aria-label="Stop on Failure" htmlFor="field-1" className="flex items-center justify-between p-2.5 bg-muted rounded-lg border border-border cursor-pointer">
              <div>
                <span className="text-sm text-muted-foreground block">Stop on Failure</span>
                <span className="text-xs text-muted-foreground">Stop executing when a check fails</span>
              </div>
              <input id="field-1"
                type="checkbox"
                checked={form.stop_on_failure}
                onChange={(e) => updateField("stop_on_failure", e.target.checked)}
                className="w-4 h-4"
              />
            </label>
            <label aria-label="Run in Parallel" htmlFor="field-0" className="flex items-center justify-between p-2.5 bg-muted rounded-lg border border-border cursor-pointer">
              <div>
                <span className="text-sm text-muted-foreground block">Run in Parallel</span>
                <span className="text-xs text-muted-foreground">Execute all checks simultaneously</span>
              </div>
              <input id="field-0"
                type="checkbox"
                checked={form.run_in_parallel}
                onChange={(e) => updateField("run_in_parallel", e.target.checked)}
                className="w-4 h-4"
              />
            </label>
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

        {/* Execution */}
        {!isNew && (
          <ExecutionPanel
            onRun={async () => {
              try {
                const response = await runnerApi.runCheckGroup(item.id);
                return {
                  success: response.status === "success",
                  output: response.output || `${response.passed_checks}/${response.total_checks} checks passed`,
                  error: response.error || undefined,
                  duration_ms: response.duration,
                } as ExecutionResult;
              } catch (err) {
                return {
                  success: false,
                  error: err instanceof Error ? err.message : "Execution failed",
                } as ExecutionResult;
              }
            }}
            runLabel="Run Check Group"
            disabled={isNew || form.check_ids.length === 0}
          />
        )}
      </div>

      <AssignChecksDialog
        open={assignDialogOpen}
        onOpenChange={setAssignDialogOpen}
        groupId={item?.id || ""}
        selectedCheckIds={form.check_ids}
        onSave={handleAssignChecks}
      />
    </div>
  );
}
