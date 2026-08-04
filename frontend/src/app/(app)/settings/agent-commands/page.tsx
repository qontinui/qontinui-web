"use client";

/**
 * /settings/agent-commands — customize the agent commands the runner
 * provisions into every spawned session.
 *
 * Resolution is **account override → embedded default**. The runner ships
 * `/vet-plan`, `/implement-plan`, … compiled into its binary, so the product
 * works offline, unauthenticated and on first run. This page owns the OPTIONAL
 * account layer: an override row exists only once the account customizes a
 * command, and "Reset to default" deletes that row so the embedded copy applies
 * again.
 *
 * Backend: `GET/POST /api/v1/agent-commands`,
 * `GET/PATCH/DELETE /api/v1/agent-commands/{name}`,
 * `GET /api/v1/agent-commands/{name}/versions`,
 * `POST /api/v1/agent-commands/{name}/revert`
 * (plan `2026-07-29-account-versioned-agent-commands.md`, Phase 4).
 *
 * What this page deliberately does NOT do: diff a body against the shipped
 * default. The default exists only inside the runner binary and is never
 * uploaded, so there is no baseline server-side to compare with. The diff here
 * is version-to-version, and the missing baseline is stated rather than faked.
 */

import { useState } from "react";
import { Loader2, RefreshCw, SquareTerminal } from "lucide-react";
import { CommandEditor } from "./_components/CommandEditor";
import { CommandList } from "./_components/CommandList";
import { VersionHistory } from "./_components/VersionHistory";
import { useAgentCommands } from "./_hooks/useAgentCommands";
import { validateCommandName } from "./types";

export default function AgentCommandsSettingsPage() {
  const {
    rows,
    loading,
    loadError,
    retryLoad,
    selected,
    selectCommand,
    clearSelection,
    draftBody,
    setDraftBody,
    changeDescription,
    setChangeDescription,
    isDirty,
    saving,
    saveDraft,
    versions,
    versionsLoading,
    versionsError,
    busyAction,
    revertToVersion,
    resetToDefault,
  } = useAgentCommands();

  const [newName, setNewName] = useState("");
  const [newNameError, setNewNameError] = useState<string | null>(null);

  const handleAddCommand = () => {
    const name = newName.trim().toLowerCase();
    const error = validateCommandName(name);
    if (error) {
      setNewNameError(error);
      return;
    }
    setNewNameError(null);
    setNewName("");
    selectCommand(name);
  };

  return (
    <div
      className="p-6 space-y-6 max-w-4xl"
      data-page-id="settings-agent-commands"
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <SquareTerminal className="size-5 text-primary" />
        <div>
          <h1 className="text-lg font-semibold">Agent Commands</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Customize the command procedures the runner writes into each new
            session. A command you have not customized is served from the copy
            embedded in the runner, so everything keeps working offline and
            before you change anything.
          </p>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin" />
          Loading agent commands…
        </div>
      )}

      {!loading && loadError && (
        <div className="card">
          <div className="card-content space-y-3">
            <p className="form-error">
              Failed to load your agent commands: {loadError}
            </p>
            <p className="text-xs text-muted-foreground">
              This lists your account&apos;s overrides only. While it is
              failing, what a session would actually receive is unknown from
              here — the runner still resolves its embedded defaults regardless.
            </p>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={retryLoad}
            >
              <RefreshCw className="size-3.5" />
              Retry
            </button>
          </div>
        </div>
      )}

      {!loading && !loadError && !selected && (
        <>
          <CommandList
            rows={rows}
            selectedName={null}
            onSelect={selectCommand}
          />

          <div className="card">
            <div className="card-content space-y-3">
              <div className="form-group">
                <label className="form-label" htmlFor="agent-command-new-name">
                  Customize another command
                </label>
                <p className="text-xs text-muted-foreground">
                  Any command the runner provisions can be overridden by name —
                  the list above is not a fixed set. Enter the slug exactly as
                  the runner uses it (for example{" "}
                  <span className="font-mono">implement-plan</span>). An
                  override for a name the runner does not provision is simply
                  never used.
                </p>
                <div className="flex items-start gap-2">
                  <input
                    id="agent-command-new-name"
                    className="input"
                    type="text"
                    value={newName}
                    maxLength={64}
                    placeholder="command-slug"
                    onChange={(e) => {
                      setNewName(e.target.value);
                      setNewNameError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddCommand();
                    }}
                    data-testid="agent-command-new-name"
                  />
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={handleAddCommand}
                    data-testid="agent-command-new-submit"
                  >
                    Open editor
                  </button>
                </div>
                {newNameError && <p className="form-error">{newNameError}</p>}
              </div>
            </div>
          </div>
        </>
      )}

      {!loading && !loadError && selected && (
        <>
          <CommandEditor
            row={selected}
            body={draftBody}
            onBodyChange={setDraftBody}
            changeDescription={changeDescription}
            onChangeDescriptionChange={setChangeDescription}
            isDirty={isDirty}
            saving={saving}
            onSave={() => void saveDraft()}
            onBack={clearSelection}
            versionCount={versions.length}
            resetting={busyAction === "reset"}
            onReset={() => void resetToDefault()}
          />

          {selected.override && (
            <VersionHistory
              commandName={selected.name}
              versions={versions}
              loading={versionsLoading}
              error={versionsError}
              headVersion={selected.override.current_version}
              reverting={busyAction === "revert"}
              onRevert={(versionNumber) => void revertToVersion(versionNumber)}
            />
          )}
        </>
      )}
    </div>
  );
}
