"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle } from "lucide-react";
import { createLogger } from "@/lib/logger";
import {
  fetchRepoMergeProfile,
  patchRepoMergeProfile,
  writeMergeEnabled,
} from "@/lib/api/operations/prMerge";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";
import { httpErrorText } from "./httpError";
import {
  MergeEnabledBadge,
  pinChoice,
  pinSentence,
  pinValue,
  type PinChoice,
} from "./pinChoice";
import {
  overrideFieldsFrom,
  parseFloatOrThrow,
  parseIntOrThrow,
} from "./format";
import type {
  RawRepoOverride,
  RepoProfileResponse,
  TenantRepoRow,
} from "./types";

const log = createLogger("MergeOrchestrationSettings");

// ----------------------------------------------------------------------------
// Per-repo override card
// ----------------------------------------------------------------------------

export function RepoOverrideCard({
  repoRow,
  tenantPaused,
  ffLandHeadSyncWritable,
  onSaved,
}: {
  repoRow: TenantRepoRow;
  tenantPaused: boolean;
  /**
   * Whether coord's settings wire carries `ff_land_head_sync_enabled` — see
   * {@link ffLandHeadSyncSupported}.
   *
   * Threaded down from the TENANT profile rather than probed off this card's
   * own `repoProfile` fetch, deliberately: the capability is a property of the
   * coord BUILD, not of the repo, so deriving it per card would give one answer
   * per in-flight fetch and leave the control briefly enabled-then-disabled on
   * every mount. One read, one answer, every card.
   */
  ffLandHeadSyncWritable: boolean;
  onSaved: () => void;
}) {
  const [repoProfile, setRepoProfile] = useState<RepoProfileResponse | null>(
    null
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  // Whether the edit fields currently hold coord's stored overrides (seeded
  // from a `raw_override`), and whether enough is known to say they do not.
  // Together they drive the "not preloaded" notice.
  const [preloaded, setPreloaded] = useState(false);
  const [readSettled, setReadSettled] = useState(false);

  // What coord currently STORES for this repo's merge-enablement pin, and what
  // it currently RESOLVES to — both straight off the repo-list row.
  //
  // Deliberately NOT off the per-repo profile fetch, even though that read
  // carries the same two fields: the fetch is keyed on the repo name and so
  // never re-runs for a card that stays mounted, whereas the parent re-reads
  // `/pr-merge/repos` after every save. Reading the pin from the fetch would
  // leave the control showing the PRE-save pin — the same class of lie this
  // change exists to remove, just one release later.
  const storedPin: PinChoice = pinChoice(repoRow.merge_enabled_override);
  const resolvedMergeEnabled = repoRow.merge_enabled;

  // Local edit state, PRELOADED from what coord stores — where coord serves
  // the raw per-repo override columns (`raw_override`) beside the resolved
  // profile, which starts with the paired qontinui-coord change (plan
  // 2026-07-22-merge-settings-repo-override-preload, Phase 1). Each field below is seeded with the stored value — `null` (inheriting)
  // renders as blank / "inherit" — as soon as the profile read lands, and
  // re-seeded from the PATCH response after a save so the card shows what is
  // stored post-save rather than going stale (the profile GET runs once per
  // mount). Seeding never overwrites a field the operator has already edited.
  //
  // Saves stay dirty-tracked: only edited fields are PATCHed, and an edited
  // field left blank / "inherit" sends `null`, which coord's PatchField treats
  // as clear-to-inherit (SET col = NULL) — except escalate paths, whose column
  // is NOT NULL, so blank sends `[]` (its inherit value). Emptying a preloaded
  // field IS the reset — there is deliberately no separate "reset" button. An
  // omitted field is left unchanged (PatchField absent).
  //
  // Until that coord change is deployed `raw_override` is absent, and so it is
  // if the profile read fails: the card then stays write-only (an untouched
  // field is left unchanged) and says so in a muted notice.
  //
  // Merge enablement is separate: coord serves `merge_enabled_override` (the
  // raw pin) beside `profile.merge_enabled`, and that control reads the pin
  // off the repo-list row — see above.
  const [confidenceOverride, setConfidenceOverride] = useState<string>("");
  const [escalatePathsExtraText, setEscalatePathsExtraText] =
    useState<string>("");
  const [labelBudget, setLabelBudget] = useState<string>("");
  // The pin as the operator has it staged. Starts at whatever is stored, so
  // the rendered control and the database agree until someone changes it —
  // and "changed" is exactly `mergePin !== storedPin`.
  const [mergePin, setMergePin] = useState<PinChoice>(storedPin);
  // Re-sync when coord's stored pin moves under us (this card's own save, or
  // another operator's). Keyed on the stored value, so an operator's staged
  // edit survives an unrelated parent re-render.
  useEffect(() => {
    setMergePin(storedPin);
  }, [storedPin]);
  const [autoFixRedMainOverride, setAutoFixRedMainOverride] = useState<
    "inherit" | "true" | "false"
  >("inherit");
  // Still write-only: `raw_override` does not carry this column, so it starts
  // at "inherit" — which is also the stored default, every column being NULL
  // until someone graduates a repo.
  const [ffLandHeadSyncOverride, setFfLandHeadSyncOverride] = useState<
    "inherit" | "true" | "false"
  >("inherit");
  // Body keys the operator has edited this session; only these are PATCHed.
  //
  // Mirrored SYNCHRONOUSLY in `dirtyRef` (every write goes through
  // `markDirty` / `clearDirty`), so the async seeding paths — the initial
  // profile GET and the post-PATCH re-seed — always see the latest edits.
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const dirtyRef = useRef<Set<string>>(dirty);
  // True while a save is in flight; edits made meanwhile are recorded in
  // `editedDuringSaveRef` so the save's re-seed neither overwrites them nor
  // drops their dirty flags (the save's snapshot did not carry them).
  const savingRef = useRef(false);
  const editedDuringSaveRef = useRef<Set<string>>(new Set());
  // Set once a save has adopted coord's post-PATCH answer. A slow initial GET
  // resolving after that carries PRE-save values and must be ignored.
  const adoptedSaveResponseRef = useRef(false);
  const markDirty = useCallback((field: string) => {
    if (savingRef.current) editedDuringSaveRef.current.add(field);
    if (dirtyRef.current.has(field)) return;
    const next = new Set(dirtyRef.current).add(field);
    dirtyRef.current = next;
    setDirty(next);
  }, []);
  /**
   * The dirty flags to keep once a save has consumed `sent`: fields the save
   * did not carry, plus any edited again while it was in flight.
   */
  const dirtyAfterSave = useCallback(
    (sent: ReadonlySet<string>) =>
      new Set(
        [...dirtyRef.current].filter(
          (f) => !sent.has(f) || editedDuringSaveRef.current.has(f)
        )
      ),
    []
  );
  const clearDirty = useCallback(
    (sent: ReadonlySet<string>) => {
      const next = dirtyAfterSave(sent);
      dirtyRef.current = next;
      setDirty(next);
    },
    [dirtyAfterSave]
  );

  /**
   * Seed the edit fields from a stored raw override. Fields named in `keep`
   * (the operator's un-saved edits) are left alone.
   */
  const seedFromRaw = useCallback(
    (raw: RawRepoOverride, keep: ReadonlySet<string>) => {
      const f = overrideFieldsFrom(raw);
      if (!keep.has("confidence_threshold_override")) {
        setConfidenceOverride(f.confidence_threshold_override);
      }
      if (!keep.has("auto_merge_label_budget")) {
        setLabelBudget(f.auto_merge_label_budget);
      }
      if (!keep.has("escalate_paths_extra")) {
        setEscalatePathsExtraText(f.escalate_paths_extra);
      }
      if (!keep.has("auto_fix_red_main")) {
        setAutoFixRedMainOverride(f.auto_fix_red_main);
      }
      setPreloaded(true);
    },
    []
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch the resolved profile for THIS repo so the "inherited"
  // values are visible to the operator alongside their overrides.
  // The list-repos response carries framework_signals + provenance,
  // but the layered defaults require an extra fetch per card.
  useEffect(() => {
    let cancelled = false;
    fetchRepoMergeProfile(repoRow.repo)
      .then((body) => {
        if (cancelled) return;
        setReadSettled(true);
        if (adoptedSaveResponseRef.current) {
          // A save landed first, so this read carries PRE-save values: never
          // seed from it. It may still fill an empty `repoProfile` (a save
          // whose response body was unusable), which is what lets the card
          // state that its fields were not preloaded.
          setRepoProfile((prev) => prev ?? body);
          return;
        }
        setRepoProfile(body);
        if (body.raw_override) {
          seedFromRaw(body.raw_override, dirtyRef.current);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setReadSettled(true);
        // After a save has landed, a failed read is moot — the card already
        // shows (or knowingly lacks) what the save returned; an error line
        // here would sit beside correct fields.
        if (adoptedSaveResponseRef.current) return;
        setLoadError(httpErrorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, [repoRow.repo, seedFromRaw]);

  const handleSave = useCallback(async () => {
    setError(null);
    setSaving(true);
    // The dirty set this save sends. Edits made while it is in flight are
    // tracked separately and survive the save.
    const sent: ReadonlySet<string> = new Set(dirty);
    savingRef.current = true;
    editedDuringSaveRef.current = new Set();
    try {
      // Send ONLY fields the operator edited. coord's PatchRepoProfile treats
      // an absent field as "leave unchanged", so omitting untouched fields
      // avoids resetting/wiping overrides the operator never touched. A sent
      // field follows the PatchField contract: a value = Set, `null` = clear
      // to inherit. NOTE: coord's PatchRepoProfile does NOT accept
      // `line_budget_override` — sending it trips `deny_unknown_fields` and
      // 400s the whole PATCH — so that field is not sent (and its input was
      // removed; coord neither stores nor resolves a per-repo line budget).
      const body: Record<string, unknown> = {};
      if (dirty.has("confidence_threshold_override")) {
        body.confidence_threshold_override =
          confidenceOverride.trim() === ""
            ? null
            : parseFloatOrThrow(
                "confidence_threshold_override",
                confidenceOverride
              );
      }
      if (dirty.has("escalate_paths_extra")) {
        // No non-empty lines sends `[]`, NOT `null`. The column is
        // `TEXT[] NOT NULL DEFAULT '{}'`, so `'{}'` IS its "no extra paths"
        // (inherit) value, and a coord build that maps `null` to
        // `SET col = NULL` 500s the whole PATCH. `[]` works on every build.
        const paths = escalatePathsExtraText
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        body.escalate_paths_extra = paths;
      }
      if (dirty.has("auto_merge_label_budget")) {
        body.auto_merge_label_budget =
          labelBudget.trim() === ""
            ? null
            : parseIntOrThrow("auto_merge_label_budget", labelBudget);
      }
      if (dirty.has("auto_fix_red_main")) {
        body.auto_fix_red_main =
          autoFixRedMainOverride === "inherit"
            ? null
            : autoFixRedMainOverride === "true";
      }
      // Guarded on the capability as well as on `dirty`: the control is
      // disabled without it, so this can only be reached by a stale `dirty`
      // entry, and `deny_unknown_fields` would 400 the whole PATCH.
      if (ffLandHeadSyncWritable && dirty.has("ff_land_head_sync_enabled")) {
        body.ff_land_head_sync_enabled =
          ffLandHeadSyncOverride === "inherit"
            ? null
            : ffLandHeadSyncOverride === "true";
      }

      // Skip the PATCH entirely when no profile field changed (e.g. a
      // merge-enablement-only save) — an empty body is a wasted round-trip and
      // needlessly couples the enablement POST to the PATCH succeeding.
      if (Object.keys(body).length > 0) {
        const saved = await patchRepoMergeProfile(repoRow.repo, body);
        // The write landed, so the initial profile read — if it has not
        // arrived yet — now carries PRE-save values. Ignore it from here on,
        // whatever this response's body turns out to be.
        adoptedSaveResponseRef.current = true;
        setReadSettled(true);
        // The PATCH response has the profile read's shape. Adopt it so the
        // card shows what coord now STORES, and re-seed every field (the
        // save consumed the operator's edits). A body that does not parse,
        // or an older coord's body without `raw_override`, leaves the fields
        // as the operator typed them — which is what was just written.
        if (saved && typeof saved === "object" && saved.profile) {
          setRepoProfile(saved);
          setLoadError(null);
          if (saved.raw_override) {
            // Keep only fields edited outside this save; everything it sent
            // is replaced by what coord now stores.
            seedFromRaw(saved.raw_override, dirtyAfterSave(sent));
          }
        }
        // The PATCH consumed these edits; a later failure (the enablement
        // POST below) must not leave them flagged for a re-send.
        clearDirty(sent);
      }
      // Merge enablement is NOT a profile-PATCH field — it POSTs the audited
      // merge-enabled route with a repo scope. Unlike every other field on
      // this card it is not tracked by `dirty`: the control renders the STORED
      // pin, so "the operator changed it" is exactly `mergePin !== storedPin`.
      // All three values write, including `null` — clearing a pin back to
      // inherit is a real action here, not a no-op placeholder.
      if (mergePin !== storedPin) {
        try {
          await writeMergeEnabled({
            scope: `repo:${repoRow.repo}`,
            enabled: pinValue(mergePin),
            reason: "dashboard: per-repo override save",
          });
        } catch (err) {
          // Only a reply from coord is labelled; a transport failure
          // (no status) surfaces as itself.
          if (httpStatusOf(err) === null) throw err;
          throw new Error(
            `merge-enabled: ${httpErrorText(err, { withBody: true })}`
          );
        }
      }
      clearDirty(sent);
      onSaved();
    } catch (err) {
      log.warn("save repo profile failed", err);
      setError(httpErrorText(err));
    } finally {
      savingRef.current = false;
      editedDuringSaveRef.current = new Set();
      setSaving(false);
    }
  }, [
    repoRow.repo,
    dirty,
    confidenceOverride,
    escalatePathsExtraText,
    labelBudget,
    mergePin,
    storedPin,
    autoFixRedMainOverride,
    ffLandHeadSyncOverride,
    ffLandHeadSyncWritable,
    seedFromRaw,
    dirtyAfterSave,
    clearDirty,
    onSaved,
  ]);

  return (
    <Card data-testid={`repo-card-${repoRow.repo}`}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm font-mono">
          <span>{repoRow.repo}</span>
          <div className="flex items-center gap-1">
            <MergeEnabledBadge
              enabled={resolvedMergeEnabled}
              pin={storedPin}
              tenantPaused={tenantPaused}
              testId={`repo-merge-enabled-badge-${repoRow.repo}`}
            />
            {repoRow.role !== "owner" && (
              <Badge variant="outline" className="text-[10px] uppercase">
                {repoRow.role}
              </Badge>
            )}
            {repoRow.profile_source && (
              <Badge
                variant="outline"
                className="text-[10px] uppercase tracking-wide"
                data-testid={`repo-profile-source-${repoRow.repo}`}
              >
                {repoRow.profile_source}
              </Badge>
            )}
          </div>
        </CardTitle>
        {repoRow.framework_signals.length > 0 && (
          <div className="flex gap-1 flex-wrap mt-1">
            {repoRow.framework_signals.map((s) => (
              <Badge
                key={s}
                variant="secondary"
                className="font-mono text-[10px]"
              >
                {s}
              </Badge>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {loadError && (
          <p className="text-xs text-red-300 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            {loadError}
          </p>
        )}
        {readSettled && !preloaded && (
          // One notice for every way the fields end up NOT holding coord's
          // stored overrides; only the stated reason differs.
          <p
            className="text-xs text-muted-foreground"
            data-testid={
              loadError
                ? `repo-raw-override-load-failed-${repoRow.repo}`
                : `repo-raw-override-unavailable-${repoRow.repo}`
            }
          >
            {loadError
              ? "The current per-repo overrides could not be read, so they are not shown here."
              : repoProfile && !repoProfile.raw_override
                ? "This coord build does not report the current per-repo overrides, so they are not shown here."
                : "The current per-repo overrides were not loaded into these fields."}{" "}
            A field you leave untouched is left unchanged; a field you type into
            and then clear resets that override to inherit.
          </p>
        )}
        {repoProfile && (
          // Merge posture deliberately NOT repeated here. `repoProfile` comes
          // from a read issued once per mount and is refreshed only by a
          // profile PATCH — never by the merge-enabled POST — so a posture
          // rendered from it would lag a pin change and contradict the badge
          // above, which reads the repo-list row the parent re-fetches after
          // every save. Two answers on one card is the bug this change exists
          // to kill; the badge is the single place it is stated.
          <p className="text-xs text-muted-foreground">
            Effective: dwell={repoProfile.profile.min_green_dwell}s
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Confidence override</Label>
            <Input
              type="number"
              min={0}
              max={1}
              step="0.01"
              value={confidenceOverride}
              onChange={(e) => {
                setConfidenceOverride(e.target.value);
                markDirty("confidence_threshold_override");
              }}
              placeholder="inherit"
              data-testid={`repo-confidence-${repoRow.repo}`}
            />
          </div>
          <div className="space-y-1">
            <Label>Auto-merge label budget</Label>
            <Input
              type="number"
              min={0}
              value={labelBudget}
              onChange={(e) => {
                setLabelBudget(e.target.value);
                markDirty("auto_merge_label_budget");
              }}
              placeholder="inherit"
              data-testid={`repo-label-budget-${repoRow.repo}`}
            />
          </div>
          <div className="space-y-1">
            <Label>Merge enabled override</Label>
            <select
              className="w-full h-9 rounded-md border bg-background px-3 text-sm"
              value={mergePin}
              onChange={(e) => setMergePin(e.target.value as PinChoice)}
              data-testid={`repo-merge-enabled-${repoRow.repo}`}
            >
              <option value="inherit">
                inherit tenant (currently{" "}
                {resolvedMergeEnabled ? "enabled" : "paused"})
              </option>
              <option value="true">pin on (merges enabled)</option>
              <option value="false">pin off (merges paused)</option>
            </select>
            <p className="text-xs text-muted-foreground">
              {pinSentence(storedPin, resolvedMergeEnabled, tenantPaused)} Saved
              via the audited merge-enabled route. Choosing &quot;inherit
              tenant&quot; CLEARS the pin, so this repo follows the tenant
              default again.
            </p>
          </div>
          <div className="space-y-1">
            <Label>Auto-fix red main override</Label>
            <select
              className="w-full h-9 rounded-md border bg-background px-3 text-sm"
              value={autoFixRedMainOverride}
              onChange={(e) => {
                setAutoFixRedMainOverride(
                  e.target.value as "inherit" | "true" | "false"
                );
                markDirty("auto_fix_red_main");
              }}
              data-testid={`repo-auto-fix-red-main-${repoRow.repo}`}
            >
              <option value="inherit">inherit tenant</option>
              <option value="true">true (auto-spawn fix session)</option>
              <option value="false">false (never auto-spawn)</option>
            </select>
            <p className="text-xs text-muted-foreground">
              Per-repo override of the tenant-wide auto-spawn setting. On red
              main, coord opens a visible fix session on your device; the fix
              lands through coord&apos;s ordinary merge path.
            </p>
          </div>
          <div className="space-y-1">
            <Label>Merged-on-GitHub override</Label>
            <select
              className="w-full h-9 rounded-md border bg-background px-3 text-sm"
              value={ffLandHeadSyncOverride}
              disabled={!ffLandHeadSyncWritable}
              onChange={(e) => {
                setFfLandHeadSyncOverride(
                  e.target.value as "inherit" | "true" | "false"
                );
                markDirty("ff_land_head_sync_enabled");
              }}
              data-testid={`repo-ff-land-head-sync-${repoRow.repo}`}
            >
              <option value="inherit">inherit tenant</option>
              <option value="true">true (sync the head ref on a land)</option>
              <option value="false">false (leave the head ref behind)</option>
            </select>
            <p className="text-xs text-muted-foreground">
              {ffLandHeadSyncWritable
                ? "This is the per-repo graduation knob: turn it on for one repo, watch a window of lands, then move to the next. The benefit is very uneven per repo — 87.0% of qontinui-runner's lands rewrite shas against 9.7% of ui-bridge's — which is why it is graduated here and not tenant-wide."
                : "Not settable on this coord build — coord's settings API does not carry the field yet, so nothing can write it. See the tenant switch above."}
            </p>
          </div>
        </div>
        <div className="space-y-1">
          <Label>Escalate paths extra (one per line)</Label>
          <Textarea
            value={escalatePathsExtraText}
            onChange={(e) => {
              setEscalatePathsExtraText(e.target.value);
              markDirty("escalate_paths_extra");
            }}
            rows={2}
            placeholder={"app/**/page.tsx"}
            data-testid={`repo-escalate-paths-${repoRow.repo}`}
          />
          <p className="text-xs text-muted-foreground">
            UNIONed with the tenant-wide escalate-paths list.
          </p>
        </div>
        {error && (
          <p className="text-xs text-red-300 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            {error}
          </p>
        )}
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving}
          data-testid={`repo-save-${repoRow.repo}`}
        >
          {saving ? "Saving..." : "Save override"}
        </Button>
      </CardContent>
    </Card>
  );
}
