"use client";

/**
 * Model & effort by spawn type — the operator's launch setting for each kind
 * of session the fleet spawns. Plan
 * `2026-11-15-operator-sets-spawn-model-and-effort-per-spawn-type` Phase 5
 * (D7, V11).
 *
 * A sibling of the Spawn paths matrix, not more columns on it: that matrix is
 * one row per spawn PATH and its switches; this is one row per spawn TYPE (the
 * work-type vocabulary coord classifies a dispatch into), so a post-merge
 * follow-up and a plan implementation that ride the same path are set apart.
 *
 * Rows are what coord serves — the panel keeps no list of its own. Each row
 * has two selects whose first option is inherit (`null` on the wire): the
 * spawned session runs at the model / effort of the session that originated
 * it. A row saves on its own, and what it shows after a save is coord's
 * answer to the PUT. A read that failed is UNKNOWN, never "Inherit".
 *
 * Operator only: the page unmounts it while presenting (`OperatorOnly`), since
 * every control here is a write and coord's descriptions are its own words.
 */

import { useLayoutEffect, useRef, useState } from "react";
import { CheckCircle2, Cpu, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { INERT, RefreshButton, UNKNOWN_AMBER } from "@/components/console";
import { cn } from "@/lib/utils";
import type {
  EffortLevel,
  ModelFamily,
  SpawnLaunchSettingRow,
} from "@/lib/api/spawnLaunchSettings";
import { UnknownNote } from "./UnknownNote";
import {
  useSpawnLaunchSettings,
  type LaunchWriteState,
} from "../_lib/useSpawnLaunchSettings";

/** The select value standing for `null` (inherit). */
const INHERIT = "";

/** `post_merge` → "Post merge"; `pr_fix_red_ci` → "PR fix red CI". */
export function spawnTypeLabel(spawnType: string): string {
  const words = spawnType.split("_").filter(Boolean);
  const UPPER = new Set(["pr", "ci"]);
  return words
    .map((w, i) =>
      UPPER.has(w)
        ? w.toUpperCase()
        : i === 0
          ? w.charAt(0).toUpperCase() + w.slice(1)
          : w
    )
    .join(" ");
}

/** "sonnet" → "Sonnet (latest)". */
export function modelFamilyLabel(family: ModelFamily): string {
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} (latest)`;
}

function formatWhen(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

interface Draft {
  model: ModelFamily | null;
  effort: EffortLevel | null;
}

function SettingRow({
  row,
  families,
  levels,
  canEdit,
  write,
  onSave,
}: {
  row: SpawnLaunchSettingRow;
  families: readonly ModelFamily[];
  levels: readonly EffortLevel[];
  canEdit: boolean;
  write: LaunchWriteState | undefined;
  onSave: (draft: Draft) => void;
}) {
  // Per field: `undefined` follows coord's row, so a refresh that changes the
  // field the operator did not touch shows (and saves) coord's newer value.
  const [draft, setDraft] = useState<Partial<Draft>>({});
  const shown: Draft = {
    model: draft.model !== undefined ? draft.model : row.model,
    effort: draft.effort !== undefined ? draft.effort : row.effort,
  };
  const dirty = shown.model !== row.model || shown.effort !== row.effort;
  const saving = write?.phase === "saving";
  const unknown = write?.phase === "unknown" ? write.reason : null;
  const id = row.spawn_type;
  const when = formatWhen(row.updated_at);
  const phase = write?.phase;

  // Once a save settles — read back, refused or unconfirmed — the row shows
  // coord's value again, never the request.
  // A layout effect, so the request is never painted over the read-back.
  const wasSaving = useRef(false);
  useLayoutEffect(() => {
    if (wasSaving.current && phase !== "saving") setDraft({});
    wasSaving.current = phase === "saving";
  }, [phase]);

  return (
    <tr
      className="align-top border-t border-border"
      data-testid="spawn-launch-row"
      data-spawn-type={id}
    >
      <td className="py-1.5 pr-3">
        <div className="font-medium text-sm">{spawnTypeLabel(id)}</div>
        {row.description && (
          <div className="text-xs text-muted-foreground max-w-md">
            {row.description}
          </div>
        )}
      </td>
      <td className="py-1.5 pr-3">
        {unknown !== null ? (
          <Badge
            variant="outline"
            className={cn("text-[11px] font-medium", UNKNOWN_AMBER)}
            title={`Whether the last save was applied is unknown (${unknown}); re-reading.`}
            data-testid="spawn-launch-model-unknown"
          >
            UNKNOWN
          </Badge>
        ) : (
          <select
            className="select h-8 py-1 text-xs min-w-[11rem]"
            aria-label={`Model for ${spawnTypeLabel(id)}`}
            value={shown.model ?? INHERIT}
            disabled={!canEdit || saving}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                model:
                  e.target.value === INHERIT
                    ? null
                    : (e.target.value as ModelFamily),
              }))
            }
            data-testid="spawn-launch-model"
          >
            <option value={INHERIT}>Inherit from originating session</option>
            {families.map((f) => (
              <option key={f} value={f}>
                {modelFamilyLabel(f)}
              </option>
            ))}
          </select>
        )}
      </td>
      <td className="py-1.5 pr-3">
        {unknown !== null ? (
          <Badge
            variant="outline"
            className={cn("text-[11px] font-medium", UNKNOWN_AMBER)}
            data-testid="spawn-launch-effort-unknown"
          >
            UNKNOWN
          </Badge>
        ) : (
          <select
            className="select h-8 py-1 text-xs min-w-[7rem]"
            aria-label={`Effort for ${spawnTypeLabel(id)}`}
            value={shown.effort ?? INHERIT}
            disabled={!canEdit || saving}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                effort:
                  e.target.value === INHERIT
                    ? null
                    : (e.target.value as EffortLevel),
              }))
            }
            data-testid="spawn-launch-effort"
          >
            <option value={INHERIT}>Inherit</option>
            {levels.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        )}
      </td>
      <td className="py-1.5 pr-3">
        {unknown !== null ? (
          <Badge
            variant="outline"
            className={cn("text-[11px] font-medium", UNKNOWN_AMBER)}
            data-testid="spawn-launch-source-unknown"
          >
            UNKNOWN
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className={cn("text-[11px] font-medium", INERT)}
            title={
              row.source === "stored"
                ? "An operator saved a setting for this spawn type."
                : "Nothing saved for this spawn type: both fields inherit."
            }
            data-testid="spawn-launch-source"
          >
            {row.source}
          </Badge>
        )}
      </td>
      <td
        className="py-1.5 pr-3 text-xs text-muted-foreground"
        data-testid="spawn-launch-last-set"
      >
        {unknown !== null ? (
          "unknown until a re-read answers"
        ) : row.updated_by || when ? (
          <>
            {row.updated_by ?? "unknown writer"}
            {when && <div>{when}</div>}
          </>
        ) : (
          "—"
        )}
      </td>
      <td className="py-1.5 pr-3">
        {canEdit && (
          <div className="flex flex-col items-start gap-1">
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={!dirty || saving || unknown !== null}
              onClick={() => onSave(shown)}
              data-testid="spawn-launch-save"
            >
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              Save
            </Button>
            {write?.phase === "saved" && !dirty && (
              <span
                className="flex items-center gap-1 text-[11px] text-muted-foreground"
                role="status"
                data-testid="spawn-launch-saved"
              >
                <CheckCircle2 className="size-3 text-emerald-600 dark:text-emerald-400" />
                Saved — showing coord&apos;s read-back
              </span>
            )}
            {write?.phase === "refused" && (
              <span
                className="text-[11px] text-foreground max-w-[14rem]"
                role="alert"
                data-testid="spawn-launch-refused"
              >
                Not applied: {write.message}
              </span>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

export function SpawnLaunchSettingsPanel() {
  const { data, error, loading, writes, reload, save } =
    useSpawnLaunchSettings();

  return (
    <section
      className="space-y-2"
      data-testid="spawn-launch-settings"
      data-ui-bridge-id="spawn-launch-settings"
      id="spawn-launch-settings"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium flex items-center gap-1.5">
            <Cpu className="h-4 w-4 text-muted-foreground" aria-hidden />
            Model &amp; effort by spawn type
          </h2>
          <p className="text-xs text-muted-foreground m-0 max-w-3xl">
            Which model family and reasoning effort each kind of spawned session
            launches at. A setting applies to every fleet computer&apos;s spawns
            of that type from the next dispatch, on runners that support it.
            Inherit (the default) runs the spawn at the model or effort of the
            session that originated it — the one that created the gate, or the
            pull request&apos;s author session — and where nothing can be
            inherited the session starts at its account default. A family runs
            its latest model. Ultracode is not set here.
          </p>
        </div>
        <RefreshButton
          onRefresh={reload}
          label="Re-read spawn launch settings"
          title="Re-read the model and effort settings coord holds"
          data-testid="spawn-launch-refresh"
        />
      </div>

      {data === null ? (
        loading ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="spawn-launch-loading"
          >
            Reading the spawn launch settings…
          </p>
        ) : (
          <UnknownNote role="alert" data-testid="spawn-launch-unknown">
            UNKNOWN — the spawn launch settings could not be read
            {error ? ` (${error})` : ""}. Which model and effort each spawn type
            launches at is unknown; refresh to retry.
          </UnknownNote>
        )
      ) : (
        <>
          {error && (
            <UnknownNote role="status" data-testid="spawn-launch-stale">
              The last refresh failed ({error}); showing the last good read.
            </UnknownNote>
          )}
          {!data.can_edit && (
            <p
              className="text-xs text-muted-foreground m-0"
              data-testid="spawn-launch-readonly"
            >
              Read-only: changing these needs the administrator role in the
              selected project.
            </p>
          )}
          {data.settings.length === 0 ? (
            <p
              className="text-sm text-muted-foreground"
              data-testid="spawn-launch-empty"
            >
              Coord serves no settable spawn type.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table
                className="w-full text-sm"
                data-testid="spawn-launch-table"
              >
                <thead>
                  <tr className="text-left text-[11px] text-muted-foreground">
                    <th className="py-1 pr-3 font-medium">Spawn type</th>
                    <th className="py-1 pr-3 font-medium">Model</th>
                    <th className="py-1 pr-3 font-medium">Effort</th>
                    <th className="py-1 pr-3 font-medium">Source</th>
                    <th className="py-1 pr-3 font-medium">Last set</th>
                    <th className="py-1 pr-3 font-medium">
                      <span className="sr-only">Save</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.settings.map((row) => (
                    <SettingRow
                      // Keyed on the type alone: a refresh never discards an
                      // unsaved draft; a settled save clears it (SettingRow).
                      key={row.spawn_type}
                      row={row}
                      families={data.model_families}
                      levels={data.effort_levels}
                      canEdit={data.can_edit}
                      write={writes[row.spawn_type]}
                      onSave={(draft) => void save(row.spawn_type, draft)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
