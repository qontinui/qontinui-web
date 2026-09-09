"use client";

/**
 * The editor for ONE unit, at ONE layer.
 *
 * Three things it is built to make visible, because the two-layer model is
 * useless if the operator cannot see which layer they are looking at:
 *
 * 1. **The layer switch is the primary control**, not a preference buried in a
 *    menu. `Account override` and `Fleet default` are separate rows with
 *    separate files and separate version chains; switching re-seeds the draft
 *    from the layer you moved to.
 * 2. **A fleet write is superuser-only** — the backend refuses otherwise — so
 *    a non-superuser sees the fleet layer read-only, with the reason stated
 *    rather than a button that 403s.
 * 3. **A blank editor means "nothing stored at this layer"**, never "the text
 *    is empty". The runner's embedded copy is not pre-filled: when a runner
 *    has published it to this account it is offered as a starting point and
 *    labelled by the build that published it; when none has, the editor says
 *    it holds no copy instead of implying it knows.
 *
 * Rule references — `frontend/docs/console-ui-style-guide.md`: **R9** (page
 * chrome stays with the shell; this is a body, not a titled card), **R3** (the
 * only status colour comes from `ProvenanceBadge`) and **R8** (no derivation
 * in this JSX).
 */

import {
  ArrowLeft,
  ArrowLeftRight,
  Info,
  Loader2,
  Lock,
  PackageOpen,
  Save,
} from "lucide-react";
import { MonacoField } from "@/components/builders/editors/MonacoField";
import type { AgentTextUnit, UnitFiles } from "@/lib/api/agent-text-units";
import {
  CopySourceBadge,
  ImportedFromBadge,
  ProvenanceBadge,
} from "./ProvenanceBadge";
import { ResetToDefaultDialog, type RestorePreview } from "./ResetToDefaultDialog";
import { UnitFileTabs } from "./UnitFileTabs";
import { baselineLabel, statusOf, totalBytes } from "../_lib/unitRows";
import {
  LAYER_LABEL,
  entrypointFor,
  type UnitKindConfig,
  type UnitRow,
  type WritableLayer,
} from "../types";

/** Monaco has no shell grammar registered here, so a `.sh` sibling is edited
 *  as plaintext rather than mislabelled as markdown. */
function languageFor(path: string | null): string {
  if (!path) return "markdown";
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".ts") || path.endsWith(".js")) return "javascript";
  if (path.endsWith(".py")) return "python";
  return "plaintext";
}

function LayerSwitch({
  value,
  onChange,
  canWriteFleet,
  accountStored,
  fleetStored,
}: {
  value: WritableLayer;
  onChange: (layer: WritableLayer) => void;
  canWriteFleet: boolean;
  accountStored: boolean;
  fleetStored: boolean;
}) {
  const options: Array<{
    id: WritableLayer;
    stored: boolean;
    title: string;
  }> = [
    {
      id: "account",
      stored: accountStored,
      title:
        "This account's own copy. It wins over the fleet default for this account only.",
    },
    {
      id: "fleet",
      stored: fleetStored,
      title: canWriteFleet
        ? "The fleet-wide copy, inherited by every account that has not overridden this unit. Writing it changes them all."
        : "The fleet-wide copy. Reading it is open to anyone; writing it requires a superuser.",
    },
  ];

  return (
    <div
      className="inline-flex items-center gap-1 rounded-md border border-border bg-card/30 p-0.5"
      role="group"
      aria-label="Editing layer"
      data-testid="unit-layer-switch"
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          title={option.title}
          aria-pressed={value === option.id}
          data-testid={`unit-layer-${option.id}`}
          className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors ${
            value === option.id
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {option.id === "fleet" && !canWriteFleet && (
            <Lock className="size-3" aria-hidden />
          )}
          {LAYER_LABEL[option.id]}
          <span className="font-mono text-[10px] opacity-60">
            {option.stored ? "stored" : "none"}
          </span>
        </button>
      ))}
    </div>
  );
}

interface UnitEditorProps {
  config: UnitKindConfig;
  row: UnitRow;
  editLayer: WritableLayer;
  onEditLayerChange: (layer: WritableLayer) => void;
  canWriteFleet: boolean;
  /** The stored row of the layer being edited, or `null` when it has none. */
  editing: AgentTextUnit | null;
  entrypoint: string;
  files: UnitFiles;
  activePath: string | null;
  onSelectPath: (path: string) => void;
  onFileChange: (path: string, content: string) => void;
  onAddFile: (path: string) => string | null;
  onRenameFile: (from: string, to: string) => string | null;
  onDeleteFile: (path: string) => string | null;
  onSeedFromOtherLayer: () => void;
  /** Copy the published embedded default into the draft. `null` when there is
   *  none to copy, or the layer is read-only. */
  onSeedFromBaseline: (() => void) | null;
  changeDescription: string;
  onChangeDescriptionChange: (value: string) => void;
  isDirty: boolean;
  saving: boolean;
  onSave: () => void;
  onBack: () => void;
  versionCount: number;
  deleting: boolean;
  onDelete: () => void;
}

export function UnitEditor({
  config,
  row,
  editLayer,
  onEditLayerChange,
  canWriteFleet,
  editing,
  entrypoint,
  files,
  activePath,
  onSelectPath,
  onFileChange,
  onAddFile,
  onRenameFile,
  onDeleteFile,
  onSeedFromOtherLayer,
  onSeedFromBaseline,
  changeDescription,
  onChangeDescriptionChange,
  isDirty,
  saving,
  onSave,
  onBack,
  versionCount,
  deleting,
  onDelete,
}: UnitEditorProps) {
  const status = statusOf(row);
  const readOnly = editLayer === "fleet" && !canWriteFleet;
  const identity = config.invokePrefix
    ? `${config.invokePrefix}${row.name}`
    : `${row.name}/`;
  const otherLayer: WritableLayer = editLayer === "account" ? "fleet" : "account";
  const otherStored = otherLayer === "fleet" ? row.fleet : row.account;
  const bytes = totalBytes(files);
  const embeddedNoun = row.embedded
    ? `the copy embedded in the runner binary (${baselineLabel(row.embedded.published_by_version)})`
    : "the copy embedded in the runner binary";
  const fallsBackTo =
    editLayer === "account" && row.fleet ? "the fleet default" : embeddedNoun;
  // What the reset dialog PREVIEWS: the next layer down, as text. The fleet
  // default when the account override is going and one exists; otherwise the
  // published embedded copy; otherwise nothing — and `null` is rendered as
  // "cannot be previewed", never as an empty body.
  const restores: RestorePreview | null =
    editLayer === "account" && row.fleet
      ? {
          label: `the fleet default (v${row.fleet.current_version})`,
          files: row.fleet.files,
          entrypoint: row.fleet.entrypoint,
        }
      : row.embedded
        ? {
            label: baselineLabel(row.embedded.published_by_version),
            files: row.embedded.files,
            entrypoint: entrypointFor(config.kind, row.name),
          }
        : null;

  return (
    <div className="space-y-4" data-testid="unit-editor">
      {/* Identity + actions, one line. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={onBack}
            data-testid="unit-editor-back"
          >
            <ArrowLeft className="size-3.5" />
            All {config.label.toLowerCase()}
          </button>
          <span className="font-mono text-sm font-medium">{identity}</span>
          <ProvenanceBadge status={status} />
          {!row.isInvocable && <CopySourceBadge />}
          {editing && (
            <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px]">
              v{editing.current_version}
            </span>
          )}
          {editing && (
            <ImportedFromBadge
              sourcePath={editing.source_path}
              sourceCommit={editing.source_commit}
            />
          )}
        </div>
        <div className="flex items-center gap-2">
          {editing && !readOnly && (
            <ResetToDefaultDialog
              unitName={row.name}
              layer={editLayer}
              fallsBackTo={fallsBackTo}
              restores={restores}
              currentFiles={editing.files}
              versionCount={versionCount}
              busy={deleting}
              onConfirm={onDelete}
            />
          )}
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={saving || !isDirty || readOnly}
            onClick={onSave}
            data-testid="unit-save-btn"
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            {editing ? "Save new version" : `Create this ${LAYER_LABEL[editLayer].toLowerCase()}`}
          </button>
        </div>
      </div>

      {/* Which layer am I editing? */}
      <div className="flex flex-wrap items-center gap-3">
        <LayerSwitch
          value={editLayer}
          onChange={onEditLayerChange}
          canWriteFleet={canWriteFleet}
          accountStored={row.account !== null}
          fleetStored={row.fleet !== null}
        />
        {otherStored && !readOnly && (
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={onSeedFromOtherLayer}
            title={`Replace the draft with the ${LAYER_LABEL[otherLayer].toLowerCase()}'s files. Nothing is saved until you save.`}
            data-testid="unit-seed-from-other-layer"
          >
            <ArrowLeftRight className="size-3.5" />
            Start from the {LAYER_LABEL[otherLayer].toLowerCase()}
          </button>
        )}
        {row.embedded && onSeedFromBaseline && (
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={onSeedFromBaseline}
            title={`Replace the draft with the copy ${baselineLabel(row.embedded.published_by_version)}. Nothing is saved until you save.`}
            data-testid="unit-seed-from-baseline"
          >
            <PackageOpen className="size-3.5" />
            Start from the copy {baselineLabel(row.embedded.published_by_version)}
          </button>
        )}
        <span className="font-mono text-[11px] text-muted-foreground">
          {Object.keys(files).length} file
          {Object.keys(files).length === 1 ? "" : "s"} · {bytes.toLocaleString()}{" "}
          bytes
        </span>
      </div>

      {/* Predictability: say what a save does and does NOT do. */}
      <div className="flex gap-3 rounded-md border border-border bg-card/30 px-3 py-2">
        <Info
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <div className="space-y-1 text-sm text-muted-foreground">
          {config.deliveryCaveat ? (
            <p className="text-amber-300" data-testid="unit-delivery-caveat">
              {config.deliveryCaveat} The provisioning target it will be written
              to is{" "}
              <span className="font-mono text-xs">
                {config.provisionTarget}
              </span>
              .
            </p>
          ) : (
            <p>
              Saving takes effect for{" "}
              <span className="font-medium text-foreground">
                newly spawned sessions
              </span>
              , which receive this unit at{" "}
              <span className="font-mono text-xs">
                {config.provisionTarget}
              </span>
              . Sessions already running keep the text they started with —
              nothing changes underneath them.
            </p>
          )}
          {readOnly && (
            <p className="text-amber-300" data-testid="unit-readonly-note">
              You are viewing the fleet default. Reading it is open to any
              member; writing it requires a superuser, because one write there
              changes every account that has not overridden this{" "}
              {config.singular}.
            </p>
          )}
          {!editing && !readOnly && (
            <p>
              Nothing is stored at this layer yet, so the editor starts blank.{" "}
              {row.embedded ? (
                <>
                  The runner&apos;s embedded copy —{" "}
                  {baselineLabel(row.embedded.published_by_version)} — is shown
                  in the &quot;Published default&quot; panel below, and
                  &quot;Start from&quot; above copies it into the draft.
                </>
              ) : (
                <>
                  The runner&apos;s embedded copy lives inside its binary, and
                  no runner has published it to this account, so it cannot be
                  shown here.
                </>
              )}{" "}
              Whatever you save{" "}
              <span className="font-medium text-foreground">replaces</span> the
              layer below it wholesale; it is not a patch on top of it.
            </p>
          )}
          {editLayer === "account" && row.pinsFleet && (
            <p className="text-red-300" data-testid="unit-pinned-note">
              This override is byte-identical to the fleet default. It changes
              nothing today and will keep serving this snapshot after the fleet
              default is edited — delete it to follow the fleet again.
            </p>
          )}
          {!row.isInvocable && (
            <p>
              The leading underscore marks this as a copy-source spec. It is
              carried and provisioned alongside the others so a unit citing it
              by path resolves it, but the harness never offers it as{" "}
              <span className="font-mono text-xs">/{row.name}</span>.
            </p>
          )}
        </div>
      </div>

      <UnitFileTabs
        config={config}
        files={files}
        activePath={activePath}
        entrypoint={entrypoint}
        onSelect={onSelectPath}
        onAdd={onAddFile}
        onRename={onRenameFile}
        onDelete={onDeleteFile}
        disabled={readOnly}
      />

      <div className="form-group">
        <label className="form-label" htmlFor="unit-file-body">
          {activePath ? (
            <span className="font-mono">{activePath}</span>
          ) : (
            "No file selected"
          )}
        </label>
        <div id="unit-file-body">
          {activePath ? (
            <MonacoField
              value={files[activePath] ?? ""}
              onChange={(value) => onFileChange(activePath, value)}
              language={languageFor(activePath)}
              height="480px"
              readOnly={readOnly}
            />
          ) : (
            <p className="rounded-md border border-border bg-card/30 px-3 py-6 text-center text-sm text-muted-foreground">
              Add {entrypoint} above to start this {config.singular}.
            </p>
          )}
        </div>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="unit-change-description">
          What changed (optional)
        </label>
        <input
          id="unit-change-description"
          className="input"
          type="text"
          value={changeDescription}
          maxLength={500}
          disabled={readOnly}
          placeholder="e.g. require a test-run citation before marking a phase done"
          onChange={(e) => onChangeDescriptionChange(e.target.value)}
          data-testid="unit-change-description"
        />
        <p className="text-xs text-muted-foreground">
          Stored on the new version so the history is readable later.
        </p>
      </div>

      {isDirty && !readOnly && (
        <p className="text-xs italic text-muted-foreground">
          Unsaved changes — nothing is stored, and no session sees them, until
          you save.
        </p>
      )}
    </div>
  );
}
