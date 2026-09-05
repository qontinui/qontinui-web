"use client";

import { useEffect, useMemo, useState } from "react";
import { PackageOpen } from "lucide-react";
import type {
  AgentTextUnitDefault,
  UnitFiles,
} from "@/lib/api/agent-text-units";
import { VersionDiff } from "./VersionDiff";
import { baselineLabel, diffFileSets } from "../_lib/unitRows";

interface BaselineDiffProps {
  unitName: string;
  /** "command" / "skill", for prose. */
  singular: string;
  /** This unit's published copy, or `null`. */
  baseline: AgentTextUnitDefault | null;
  /** The version of the roster the account holds, or `null` for no roster.
   *  Distinguishes "no runner has published anything" from "the roster does
   *  not carry this name". */
  rosterVersion: string | null;
  /** Set when the defaults read FAILED — the baseline is then UNKNOWN. */
  baselineError: string | null;
  /** The stored text on the right-hand side and how the console names it. */
  currentLabel: string;
  currentFiles: UnitFiles;
  currentChecksum: string | null;
}

/**
 * The stored text of the edited layer against the copy the runner SHIPS —
 * plan `2026-08-31-runner-publishes-embedded-command-defaults`, Phase 6.
 *
 * The left-hand side is the runner-published embedded default and it is
 * labelled **"published by runner vX.Y.Z"**, never "the default": an org with
 * devices on different builds has no single default, the server's monotonic
 * guard is a mitigation rather than a fix (a downgrade still wins; equal
 * versions tie-break last-writer), and a label claiming more would be a lie
 * the diff is built on. The caveat is stated on the panel, not buried.
 *
 * **The unavailable arm STAYS** (Design decision 7), and it has three honest
 * shapes that are not collapsed into one:
 *
 * * the read failed — the baseline is UNKNOWN, not absent;
 * * no runner has published to this account — a web-only account, devices on
 *   a build that does not publish, a runner with no token;
 * * a roster exists but does not carry this name — the unit is stored text
 *   with nothing shipped behind it.
 *
 * None of them fabricates an empty left side. Absent is unknown, not empty.
 */
export function BaselineDiff({
  unitName,
  singular,
  baseline,
  rosterVersion,
  baselineError,
  currentLabel,
  currentFiles,
  currentChecksum,
}: BaselineDiffProps) {
  const [path, setPath] = useState<string | null>(null);

  const fileDiff = useMemo(
    () => diffFileSets(baseline?.files ?? {}, currentFiles),
    [baseline, currentFiles]
  );

  // Land on a file that differs; an identical one is the least useful default.
  useEffect(() => {
    const preferred =
      fileDiff.changed[0] ??
      fileDiff.added[0] ??
      fileDiff.removed[0] ??
      fileDiff.all[0] ??
      null;
    setPath((current) =>
      current && fileDiff.all.includes(current) ? current : preferred
    );
  }, [fileDiff]);

  const label = baseline ? baselineLabel(baseline.published_by_version) : null;
  const identical =
    baseline !== null &&
    currentChecksum !== null &&
    baseline.checksum === currentChecksum;

  return (
    <div
      className="rounded-md border border-border bg-card/30"
      data-testid="unit-baseline"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <PackageOpen className="size-4 text-muted-foreground" aria-hidden />
        <span className="text-sm font-medium">Published default</span>
        <span className="text-xs text-muted-foreground">
          {label
            ? `${unitName}, ${label}`
            : `what the runner ships for ${unitName}`}
        </span>
      </div>

      <div className="space-y-3 px-3 py-3">
        {baselineError !== null ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="unit-baseline-unavailable"
            data-reason="unknown"
          >
            The published defaults could not be read ({baselineError}), so
            whether a baseline exists for {unitName} is unknown from here. Not
            shown rather than guessed.
          </p>
        ) : rosterVersion === null ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="unit-baseline-unavailable"
            data-reason="none-published"
          >
            No runner has published its embedded defaults to this account, so
            there is nothing to compare {unitName} against. A baseline appears
            once a device signed in to this account runs a runner build that
            publishes; a web-only account, or devices on an older build, have
            none — and the runner still resolves its own embedded copy either
            way.
          </p>
        ) : baseline === null || label === null ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="unit-baseline-unavailable"
            data-reason="not-in-roster"
          >
            The roster published by runner v{rosterVersion} does not include{" "}
            {unitName}, so there is no shipped copy to compare against — this{" "}
            {singular} exists only as stored text.
          </p>
        ) : (
          <>
            <p
              className="text-xs italic text-muted-foreground"
              data-testid="unit-baseline-caveat"
            >
              The left side is the copy {label}. That is the newest build that
              published to this account, not an authoritative default: devices
              on other builds ship their own copies, an older build cannot
              overwrite this one, but a genuine downgrade can, and two devices
              on the same build tie-break to whichever published last.
            </p>

            {identical && (
              <p
                className="text-xs text-muted-foreground"
                data-testid="unit-baseline-identical"
              >
                The {currentLabel} is byte-identical to the copy {label} — it
                changes nothing that ships today.
              </p>
            )}

            <div className="flex flex-wrap items-end gap-3">
              <div className="form-group">
                <label className="form-label" htmlFor="unit-baseline-file">
                  File
                </label>
                <select
                  id="unit-baseline-file"
                  className="input font-mono text-xs"
                  value={path ?? ""}
                  onChange={(e) => setPath(e.target.value)}
                  data-testid="unit-baseline-file"
                >
                  {fileDiff.all.map((p) => (
                    <option key={p} value={p}>
                      {p}
                      {fileDiff.changed.includes(p)
                        ? " (changed)"
                        : fileDiff.added.includes(p)
                          ? " (only stored)"
                          : fileDiff.removed.includes(p)
                            ? " (only shipped)"
                            : ""}
                    </option>
                  ))}
                </select>
              </div>
              <p
                className="pb-2 text-xs text-muted-foreground"
                data-testid="unit-baseline-file-summary"
              >
                {fileDiff.changed.length +
                  fileDiff.added.length +
                  fileDiff.removed.length ===
                0
                  ? "Every file is identical to the shipped copy."
                  : [
                      fileDiff.changed.length
                        ? `${fileDiff.changed.length} changed`
                        : null,
                      fileDiff.added.length
                        ? `${fileDiff.added.length} only stored`
                        : null,
                      fileDiff.removed.length
                        ? `${fileDiff.removed.length} only shipped`
                        : null,
                      fileDiff.unchanged.length
                        ? `${fileDiff.unchanged.length} unchanged`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
              </p>
            </div>

            {path && (
              <VersionDiff
                leftLabel={label}
                rightLabel={currentLabel}
                path={path}
                leftText={
                  path in baseline.files ? (baseline.files[path] ?? "") : null
                }
                rightText={
                  path in currentFiles ? (currentFiles[path] ?? "") : null
                }
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
