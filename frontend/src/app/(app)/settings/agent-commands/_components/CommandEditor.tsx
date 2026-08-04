"use client";

import { ArrowLeft, Info, Loader2, Save } from "lucide-react";
import { MonacoField } from "@/components/builders/editors/MonacoField";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { ResetToDefaultDialog } from "./ResetToDefaultDialog";
import type { CommandRow } from "../types";

interface CommandEditorProps {
  row: CommandRow;
  body: string;
  onBodyChange: (value: string) => void;
  changeDescription: string;
  onChangeDescriptionChange: (value: string) => void;
  isDirty: boolean;
  saving: boolean;
  onSave: () => void;
  onBack: () => void;
  versionCount: number;
  resetting: boolean;
  onReset: () => void;
}

/**
 * Markdown editor for one command body.
 *
 * Uses the repo's existing `MonacoField` wrapper (`@monaco-editor/react` is
 * already a dependency) with `language="markdown"` — no new editor package.
 *
 * Two honesty rules are baked into the copy:
 *
 * * a save affects NEWLY spawned sessions only — a session already running has
 *   already had its commands written into its cwd, so nothing about it changes;
 * * for a command with no override, the editor starts BLANK, because
 *   qontinui-web never receives the runner's embedded default and cannot
 *   pre-fill it. Saving replaces the default wholesale rather than patching it.
 */
export function CommandEditor({
  row,
  body,
  onBodyChange,
  changeDescription,
  onChangeDescriptionChange,
  isDirty,
  saving,
  onSave,
  onBack,
  versionCount,
  resetting,
  onReset,
}: CommandEditorProps) {
  const isCustomized = row.provenance === "customized";

  return (
    <div className="space-y-4" data-testid="agent-command-editor">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" className="btn-ghost btn-sm" onClick={onBack}>
            <ArrowLeft className="size-3.5" />
            All commands
          </button>
          <span className="font-mono font-medium">/{row.name}</span>
          <ProvenanceBadge provenance={row.provenance} />
          {row.override && (
            <span className="badge badge-secondary">
              v{row.override.current_version}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isCustomized && (
            <ResetToDefaultDialog
              commandName={row.name}
              currentBody={row.override?.body ?? ""}
              versionCount={versionCount}
              busy={resetting}
              onConfirm={onReset}
            />
          )}
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={saving || !isDirty || !body.trim()}
            onClick={onSave}
            data-testid="agent-command-save-btn"
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            {isCustomized ? "Save new version" : "Customize this command"}
          </button>
        </div>
      </div>

      {/* Predictability: say what a save does and does NOT do. */}
      <div className="card">
        <div className="card-content flex gap-3">
          <Info className="size-4 shrink-0 mt-0.5 text-muted-foreground" />
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>
              Saving takes effect for{" "}
              <span className="font-medium text-foreground">
                newly spawned sessions
              </span>
              . Sessions that are already running received their commands when
              they started and keep running the body they started with — nothing
              changes underneath them.
            </p>
            {!isCustomized && (
              <p>
                This command has no override yet, so the editor starts blank:
                the shipped body lives inside the runner binary and is never
                uploaded here. Whatever you save{" "}
                <span className="font-medium text-foreground">replaces</span>{" "}
                the shipped body entirely for this account — it is not a patch
                on top of it.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="agent-command-body">
          Command body (markdown)
        </label>
        <div id="agent-command-body">
          <MonacoField
            value={body}
            onChange={onBodyChange}
            language="markdown"
            height="480px"
          />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="agent-command-change-description">
          What changed (optional)
        </label>
        <input
          id="agent-command-change-description"
          className="input"
          type="text"
          value={changeDescription}
          maxLength={500}
          placeholder="e.g. require a test-run citation before marking a phase done"
          onChange={(e) => onChangeDescriptionChange(e.target.value)}
          data-testid="agent-command-change-description"
        />
        <p className="text-xs text-muted-foreground">
          Stored on the new version so the history is readable later.
        </p>
      </div>

      {isDirty && (
        <p className="text-xs text-muted-foreground italic">
          Unsaved changes — nothing is stored, and no session sees them, until
          you save.
        </p>
      )}
    </div>
  );
}
