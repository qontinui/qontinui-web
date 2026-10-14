"use client";

/**
 * The expedited-land dials on the merge settings page — plan
 * `2026-10-13-coord-expedited-land-lever-for-agents` §6, Phase 1b.
 *
 * Four dials exist at BOTH tiers (tenant defaults, per-repo override):
 *
 * - `expedited_land` — `on` / `shadow` / `off`, or inherit. The lever's
 *   off-switch. coord classifies it a KILL SWITCH: no agent can write it over
 *   any door, so this page is the only place it moves.
 * - `expedite_max_files` / `expedite_max_changed_lines` — the S11 size
 *   overrides (positive integers; blank = inherit).
 * - `expedite_review_arm` — the S13 independence-review arm's off-switch.
 *
 * Four read states, kept apart on purpose — an unreadable off-switch must
 * never be drawn as "inherit" (served policy `verification-and-evidence`
 * `unknown-must-not-render-as-a-default`):
 *
 * - `unsupported` — coord does not serve the dials (an older build). The
 *   controls are disabled: posting an unknown key 400s the whole save.
 * - `unknown` — coord serves them but could not read them. The controls show
 *   "current value unknown" and stay WRITABLE, so the off-switch is reachable
 *   exactly when the read is not.
 * - `loaded` — the stored values seed the controls.
 * - `loading` — the per-repo read has not answered yet: values unknown, no
 *   notice, controls writable (the card is write-only until it answers, like
 *   every other per-repo field).
 */

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import type {
  ExpediteDials,
  ExpeditePatch,
  ExpeditedLandMode,
} from "@/lib/api/operations/prMerge";

/** `"unknown"` is a display state only — it is never sent. */
export type ExpeditedLandChoice = "unknown" | "inherit" | ExpeditedLandMode;
export type ReviewArmChoice = "unknown" | "inherit" | "true" | "false";

export interface ExpediteFields {
  expedited_land: ExpeditedLandChoice;
  /** Blank = inherit (or unknown, when the read failed). */
  expedite_max_files: string;
  expedite_max_changed_lines: string;
  expedite_review_arm: ReviewArmChoice;
}

export type ExpediteKey = keyof ExpediteFields;

export const EXPEDITE_KEYS: readonly ExpediteKey[] = [
  "expedited_land",
  "expedite_max_files",
  "expedite_max_changed_lines",
  "expedite_review_arm",
];

/**
 * `loading` is the per-repo card before its profile read has answered: the
 * values are not known yet, but nothing has failed, so no notice is shown.
 */
export type ExpediteReadState =
  | "unsupported"
  | "loading"
  | "unknown"
  | "loaded";

/**
 * The read state from the wire value: the key ABSENT (`undefined`) is an
 * older coord build; `null` is coord saying it could not read the columns.
 */
export function expediteReadState(
  dials: ExpediteDials | null | undefined
): ExpediteReadState {
  if (dials === undefined) return "unsupported";
  if (dials === null) return "unknown";
  return "loaded";
}

/** Seed the form from what coord stores. Unreadable renders as unknown. */
export function expediteFieldsFrom(
  dials: ExpediteDials | null | undefined
): ExpediteFields {
  if (!dials) {
    return {
      expedited_land: "unknown",
      expedite_max_files: "",
      expedite_max_changed_lines: "",
      expedite_review_arm: "unknown",
    };
  }
  return {
    // Through the closed set: a value outside it is shown as unknown, never
    // as whatever option the browser falls back to.
    expedited_land:
      dials.expedited_land === null
        ? "inherit"
        : (["on", "shadow", "off"] as const).includes(dials.expedited_land)
          ? dials.expedited_land
          : "unknown",
    expedite_max_files:
      dials.expedite_max_files === null ? "" : String(dials.expedite_max_files),
    expedite_max_changed_lines:
      dials.expedite_max_changed_lines === null
        ? ""
        : String(dials.expedite_max_changed_lines),
    expedite_review_arm:
      dials.expedite_review_arm === null
        ? "inherit"
        : dials.expedite_review_arm
          ? "true"
          : "false",
  };
}

/** A blank size is inherit (`null`); anything else must be a positive integer. */
function parsePositiveSize(field: string, raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  if (!/^\d+$/.test(t) || Number(t) <= 0 || Number(t) > 2_147_483_647) {
    throw new Error(
      `${field}: must be a positive whole number, or blank to inherit`
    );
  }
  return Number(t);
}

/**
 * The PATCH keys for the EDITED expedite fields only. An untouched field is
 * omitted (left unchanged coord-side). `"unknown"` is never sent: it can only
 * be the value of a field nobody edited. Throws on an invalid size, so a bad
 * value fails the save before anything is sent.
 */
export function expeditePatchFrom(
  fields: ExpediteFields,
  edited: ReadonlySet<string>
): ExpeditePatch {
  const patch: ExpeditePatch = {};
  if (edited.has("expedited_land") && fields.expedited_land !== "unknown") {
    patch.expedited_land =
      fields.expedited_land === "inherit" ? null : fields.expedited_land;
  }
  if (edited.has("expedite_max_files")) {
    patch.expedite_max_files = parsePositiveSize(
      "expedite_max_files",
      fields.expedite_max_files
    );
  }
  if (edited.has("expedite_max_changed_lines")) {
    patch.expedite_max_changed_lines = parsePositiveSize(
      "expedite_max_changed_lines",
      fields.expedite_max_changed_lines
    );
  }
  if (
    edited.has("expedite_review_arm") &&
    fields.expedite_review_arm !== "unknown"
  ) {
    patch.expedite_review_arm =
      fields.expedite_review_arm === "inherit"
        ? null
        : fields.expedite_review_arm === "true";
  }
  return patch;
}

/**
 * The four controls. Controlled: the owning card holds the state and the
 * dirty set. `testIdSuffix` is `""` on the tenant card and `-<repo>` on a
 * per-repo card, matching each card's existing test-id convention.
 */
export function ExpediteDialsSection({
  tier,
  fields,
  readState,
  onChange,
  testIdPrefix,
  testIdSuffix = "",
  busy = false,
}: {
  tier: "tenant" | "repo";
  fields: ExpediteFields;
  readState: ExpediteReadState;
  onChange: <K extends ExpediteKey>(key: K, value: ExpediteFields[K]) => void;
  testIdPrefix: string;
  testIdSuffix?: string;
  /** Disable the controls without changing the read state (a save in flight). */
  busy?: boolean;
}) {
  const disabled = readState === "unsupported" || busy;
  const unknown = readState === "unknown";
  const inheritLabel =
    tier === "tenant" ? "inherit (fleet default)" : "inherit tenant";
  // Only a LOADED read may say "inherit"; before it answers, it is unknown.
  const sizePlaceholder =
    readState === "loaded"
      ? "inherit"
      : readState === "unsupported"
        ? ""
        : "unknown";
  const id = (name: string) => `${testIdPrefix}-${name}${testIdSuffix}`;

  return (
    <div
      className="space-y-3 rounded-md border border-amber-500/40 px-3 py-2"
      data-testid={id("expedite")}
      data-read-state={readState}
    >
      <div>
        <p className="text-sm font-medium">Expedited land</p>
        <p className="text-xs text-muted-foreground">
          Lets coord land a red-main remedy or a coord-stalled PR on an
          agent&apos;s request, after re-checking every safety condition itself.
          These dials are operator-only: agents can never write them.
          {tier === "repo"
            ? " A per-repo value overrides the tenant default."
            : " A repo can override each one below."}
        </p>
      </div>
      {readState === "unsupported" && (
        <p
          className="text-xs text-amber-400"
          data-testid={id("expedite-unsupported")}
        >
          Not settable on this coord build: its settings API does not carry the
          expedited-land dials yet.
        </p>
      )}
      {unknown && (
        <p
          className="text-xs text-amber-400"
          data-testid={id("expedite-unknown")}
        >
          coord could not read the current values, so any not set here are shown
          as unknown, not as inherited. You can still set them; a field you
          leave untouched is left unchanged.
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor={id("expedited-land")}>Expedited land</Label>
          <select
            id={id("expedited-land")}
            className="select"
            value={fields.expedited_land}
            disabled={disabled}
            onChange={(e) =>
              onChange("expedited_land", e.target.value as ExpeditedLandChoice)
            }
            data-testid={id("expedited-land")}
          >
            {fields.expedited_land === "unknown" && (
              <option value="unknown" disabled>
                current value unknown
              </option>
            )}
            <option value="inherit">{inheritLabel}</option>
            <option value="on">on (land eligible requests)</option>
            <option value="shadow">
              shadow (record verdicts, land nothing)
            </option>
            <option value="off">off (refuse every request)</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("expedite-review-arm")}>
            Independence review arm
          </Label>
          <select
            id={id("expedite-review-arm")}
            className="select"
            value={fields.expedite_review_arm}
            disabled={disabled}
            onChange={(e) =>
              onChange("expedite_review_arm", e.target.value as ReviewArmChoice)
            }
            data-testid={id("expedite-review-arm")}
          >
            {fields.expedite_review_arm === "unknown" && (
              <option value="unknown" disabled>
                current value unknown
              </option>
            )}
            <option value="inherit">{inheritLabel}</option>
            <option value="true">
              on (sample landed expedites for review)
            </option>
            <option value="false">off (no review sampling)</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("expedite-max-files")}>Max files</Label>
          <Input
            id={id("expedite-max-files")}
            // Text, not `number`: a number input reports "" for input it
            // cannot parse, which would be sent as clear-to-inherit instead
            // of being refused by `parsePositiveSize`.
            type="text"
            inputMode="numeric"
            value={fields.expedite_max_files}
            disabled={disabled}
            onChange={(e) => onChange("expedite_max_files", e.target.value)}
            placeholder={sizePlaceholder}
            data-testid={id("expedite-max-files")}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("expedite-max-changed-lines")}>
            Max changed lines
          </Label>
          <Input
            id={id("expedite-max-changed-lines")}
            // Text, not `number`: a number input reports "" for input it
            // cannot parse, which would be sent as clear-to-inherit instead
            // of being refused by `parsePositiveSize`.
            type="text"
            inputMode="numeric"
            value={fields.expedite_max_changed_lines}
            disabled={disabled}
            onChange={(e) =>
              onChange("expedite_max_changed_lines", e.target.value)
            }
            placeholder={sizePlaceholder}
            data-testid={id("expedite-max-changed-lines")}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        The size limits cap what one expedited land may change (blank = inherit
        the built-in limit).
      </p>
    </div>
  );
}
