"use client";

/**
 * The agent text-unit console body, parameterized by `kind`.
 *
 * `/admin/coord/agent-commands` and `/admin/coord/agent-skills` are the same
 * editor over the same corpus — one `project.agent_text_units` table with a
 * `kind` discriminator and a `files` map — so they are one component with two
 * thin route files, not two pages that will drift. Adding the third kind
 * (`.claude/agents/*.md`, which has the identical delivery gap) is a
 * `UNIT_KIND_CONFIGS` entry plus a route file.
 *
 * Rule references — `frontend/docs/console-ui-style-guide.md`: **R1** (health
 * strip first, derived from data already on the page, never a second fetch),
 * **R6** (filter tabs with live counts, `–` for an unfetched count, and a
 * right-aligned filter input), **R9** (the shell owns the title; the body is
 * `p-3 sm:p-6 space-y-4`) and **R8** (every derivation is in `_lib/unitRows.ts`).
 */

import { useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { BaselineDiff } from "./BaselineDiff";
import { UnitEditor } from "./UnitEditor";
import { UnitList } from "./UnitList";
import { VersionHistory } from "./VersionHistory";
import { useAgentTextUnits } from "../_hooks/useAgentTextUnits";
import {
  UNIT_FILTERS,
  deriveCorpusHealth,
  filterCounts,
  matchesFilter,
  matchesQuery,
  type UnitFilterId,
} from "../_lib/unitRows";
import {
  LAYER_LABEL,
  UNIT_KIND_CONFIGS,
  validateUnitName,
  type UnitKind,
} from "../types";

const LIGHT_CLASS: Record<string, string> = {
  ok: "bg-emerald-500",
  attention: "bg-red-500",
  unknown: "bg-muted-foreground",
};

const HEADLINE_CLASS: Record<string, string> = {
  ok: "text-foreground/90",
  attention: "text-red-300",
  unknown: "text-muted-foreground",
};

export function AgentTextUnitsConsole({ kind }: { kind: UnitKind }) {
  const config = UNIT_KIND_CONFIGS[kind];
  const { user } = useAuth();
  const canWriteFleet = user?.is_superuser === true;

  const state = useAgentTextUnits({ config, canWriteFleet });
  const {
    rows,
    loading,
    loaded,
    loadError,
    truncated,
    retryLoad,
    baseline,
    baselineError,
    selected,
    selectUnit,
    clearSelection,
    editLayer,
    setEditLayer,
    editing,
    entrypoint,
    draftFiles,
    activePath,
    setActivePath,
    setFileContent,
    addFile,
    renameFile,
    deleteFile,
    seedFromOtherLayer,
    seedFromBaseline,
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
    deleteLayer,
  } = state;

  const [filter, setFilter] = useState<UnitFilterId>("all");
  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("");
  const [newNameError, setNewNameError] = useState<string | null>(null);

  const health = useMemo(
    () => deriveCorpusHealth(config, rows, loaded),
    [config, rows, loaded]
  );
  const counts = useMemo(() => filterCounts(rows), [rows]);
  const visible = useMemo(
    () => rows.filter((row) => matchesFilter(row, filter) && matchesQuery(row, query)),
    [rows, filter, query]
  );

  const handleAdd = () => {
    const name = newName.trim().toLowerCase();
    const error = validateUnitName(name);
    if (error) {
      setNewNameError(error);
      return;
    }
    setNewNameError(null);
    setNewName("");
    selectUnit(name);
  };

  return (
    <div
      className="space-y-4 overflow-x-auto p-3 sm:p-6"
      data-testid={`coord-${config.kind}-units-page`}
      data-page-id={`admin-coord-agent-${config.kind}s`}
    >
      {/* R1 — one derived traffic-light row, from data already on the page. */}
      <div
        className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card/30 px-3 py-2"
        data-testid="unit-health-strip"
      >
        <span
          className={`inline-block size-2.5 shrink-0 rounded-full ${LIGHT_CLASS[health.level]}`}
          aria-hidden
        />
        <span className={`text-[13px] font-semibold ${HEADLINE_CLASS[health.level]}`}>
          {health.headline}
        </span>
        {health.detail && (
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {health.detail}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {health.badges.map((badge) => (
            <span
              key={badge.label}
              className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
              data-testid={`unit-health-${badge.label}`}
            >
              {badge.label} {badge.value}
            </span>
          ))}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">{config.description}</p>

      {config.deliveryCaveat && (
        <p
          className="text-xs italic text-amber-300"
          data-testid="unit-delivery-caveat-page"
        >
          {config.deliveryCaveat}
        </p>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading the {config.singular} corpus…
        </div>
      )}

      {!loading && loadError && (
        <div className="space-y-3 rounded-md border border-border bg-card/30 px-3 py-3">
          <p className="form-error">
            Failed to load the {config.singular} corpus: {loadError}
          </p>
          <p className="text-xs text-muted-foreground">
            While this is failing, what a session would actually receive is
            unknown from here — the runner still resolves its embedded defaults
            regardless. An empty list would be a guess, so none is shown.
          </p>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={retryLoad}
            data-testid="unit-retry"
          >
            <RefreshCw className="size-3.5" />
            Retry
          </button>
        </div>
      )}

      {!loading && !loadError && truncated && (
        <p className="text-xs italic text-amber-300" data-testid="unit-truncated">
          The corpus is larger than one page, so this list is truncated. Narrow
          it with the filter before drawing a conclusion from what is missing.
        </p>
      )}

      {!loading && !loadError && !selected && (
        <>
          {/* R6 — filter tabs with live counts and a right-aligned filter input. */}
          <div className="flex flex-wrap items-center gap-1.5">
            {UNIT_FILTERS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                aria-pressed={filter === tab.id}
                data-testid={`unit-filter-${tab.id}`}
                className={`rounded-md px-2 py-1 text-xs transition-colors ${
                  filter === tab.id
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}{" "}
                <span className="font-mono opacity-70">
                  {loaded ? counts[tab.id] : "–"}
                </span>
              </button>
            ))}
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="filter: name, file path…"
              className="ml-auto w-56 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs"
              data-testid="unit-query"
            />
          </div>

          <UnitList
            config={config}
            rows={visible}
            onSelect={selectUnit}
            emptyMessage={
              rows.length === 0
                ? `Nothing stored at either layer yet. Name a ${config.singular} below to author one.`
                : "No unit matches this filter."
            }
          />

          <div className="space-y-2 rounded-md border border-border bg-card/30 px-3 py-3">
            <label className="form-label" htmlFor="unit-new-name">
              Author another {config.singular}
            </label>
            <p className="text-xs text-muted-foreground">
              The corpus is open — any name the runner provisions can be stored,
              and the list above is not a fixed set. Enter the slug exactly as
              the runner uses it (for example{" "}
              <span className="font-mono">
                {config.kind === "skill" ? "coord-revive" : "implement-plan"}
              </span>
              ). A leading underscore marks a copy-source spec, which is carried
              and provisioned but never invocable.
            </p>
            <div className="flex items-start gap-2">
              <input
                id="unit-new-name"
                className="input"
                type="text"
                value={newName}
                maxLength={64}
                placeholder={`${config.singular}-slug`}
                onChange={(e) => {
                  setNewName(e.target.value);
                  setNewNameError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                }}
                data-testid="unit-new-name"
              />
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={handleAdd}
                data-testid="unit-new-submit"
              >
                Open editor
              </button>
            </div>
            {newNameError && <p className="form-error">{newNameError}</p>}
          </div>
        </>
      )}

      {!loading && !loadError && selected && (
        <>
          <UnitEditor
            config={config}
            row={selected}
            editLayer={editLayer}
            onEditLayerChange={setEditLayer}
            canWriteFleet={canWriteFleet}
            editing={editing}
            entrypoint={entrypoint}
            files={draftFiles}
            activePath={activePath}
            onSelectPath={setActivePath}
            onFileChange={setFileContent}
            onAddFile={addFile}
            onRenameFile={renameFile}
            onDeleteFile={deleteFile}
            onSeedFromOtherLayer={seedFromOtherLayer}
            onSeedFromBaseline={
              selected.embedded && !(editLayer === "fleet" && !canWriteFleet)
                ? seedFromBaseline
                : null
            }
            changeDescription={changeDescription}
            onChangeDescriptionChange={setChangeDescription}
            isDirty={isDirty}
            saving={saving}
            onSave={() => void saveDraft()}
            onBack={clearSelection}
            versionCount={versions.length}
            deleting={busyAction === "delete"}
            onDelete={() => void deleteLayer()}
          />

          {editing && (
            <VersionHistory
              unitName={selected.name}
              layer={editLayer}
              versions={versions}
              loading={versionsLoading}
              error={versionsError}
              headVersion={editing.current_version}
              reverting={busyAction === "revert"}
              readOnly={editLayer === "fleet" && !canWriteFleet}
              onRevert={(versionNumber) => void revertToVersion(versionNumber)}
            />
          )}

          {editing && (
            <BaselineDiff
              unitName={selected.name}
              singular={config.singular}
              baseline={selected.embedded}
              rosterVersion={baseline?.published_by_version ?? null}
              baselineError={baselineError}
              currentLabel={`${LAYER_LABEL[editLayer].toLowerCase()} v${editing.current_version}`}
              currentFiles={editing.files}
              currentChecksum={editing.checksum}
            />
          )}
        </>
      )}
    </div>
  );
}
