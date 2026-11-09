"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useOptionalTenant } from "@/contexts/tenant-context";
import { fetchAutoPublishStatus } from "@/lib/api/operations/coordPromptDocuments";
import {
  ACTIVE_TENANT_STORAGE_KEY,
  readActiveTenantId,
} from "@/services/http-client";
import {
  AlertTriangle,
  ArrowDownToLine,
  CloudDownload,
  History,
  ListTree,
  NotebookText,
  Pencil,
  Plus,
  RotateCw,
  Send,
} from "lucide-react";
import { usePromptDocuments } from "../_hooks/usePromptDocuments";
import {
  usePromptDocumentPublications,
  type UpstreamDecisionOutcome,
} from "../_hooks/usePromptDocumentPublications";
import { usePublishAll, type PublishAllState } from "../_hooks/usePublishAll";
import { PromptDocumentCreateDialog } from "./PromptDocumentCreateDialog";
import { PromptDocumentEditorDialog } from "./PromptDocumentEditorDialog";
import { PromptDocumentHistoryDialog } from "./PromptDocumentHistoryDialog";
import { PromptDocumentPublishDialog } from "./PromptDocumentPublishDialog";
import { PromptDocumentUpstreamDialog } from "./PromptDocumentUpstreamDialog";
import { PublishAllDialog } from "./PublishAllDialog";
import { AdoptAllDialog, type AdoptAllPreviewSource } from "./AdoptAllDialog";
import { PublishModeControl } from "./PublishModeControl";
import { ClauseManagerDialog } from "./ClauseManagerDialog";
import { AgentWriteAccessControl } from "./AgentWriteAccessControl";
import { upstreamBadge } from "../_lib/upstreamStatus";
import {
  adoptAllCandidates,
  coordSaidNotSystemTenant,
  isNotSystemTenantAnswer,
  publishSurfaceRetired,
  type AdoptAllCandidate,
} from "../_lib/adoptAll";
import {
  autoPublishBadge,
  autoPublishStatusByDocument,
} from "../_lib/autoPublishBadge";
import type {
  AgentWriteTier,
  AutoPublishStatusEntry,
  ClauseConflictChoice,
  Publication,
  PromptDocument,
  PromptDocumentKind,
  PromptDocumentSummary,
  PublishMode,
} from "../types";
import {
  BAND_META,
  isInertSessionBriefing,
  isPublishableKind,
  KIND_META,
  kindsInBand,
  PROMPT_DOCUMENT_BANDS,
  SESSION_BRIEFING_DOCUMENT_NAMES,
} from "../types";

/** What the page says when another tab has changed the stored project. */
const CROSS_TAB_MESSAGE =
  "The active project was changed in another tab — reload to continue.";

/**
 * Ask coord, now, whether the active project is the system tenant, through
 * the publish-all status door: it answers `200` only to the system tenant and
 * `403 not_system_tenant` to every other. Anything else is UNKNOWN.
 */
async function probeTenancy(
  tenant: string | null
): Promise<"not_system" | "system" | "unknown"> {
  try {
    await fetchAutoPublishStatus({ tenant });
    return "system";
  } catch (err) {
    return isNotSystemTenantAnswer(err) ? "not_system" : "unknown";
  }
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/**
 * The prompt-document list, grouped by kind under two bands, with the edit +
 * history dialogs.
 *
 * Discoverability without clutter: all thirteen kinds are on one page under
 * their own headings — the operator sees the whole surface at a glance — while
 * bodies (the bulk) stay behind the editor, and the diff stays behind the
 * history view. A kind with no documents is omitted rather than shown as an
 * empty shell.
 *
 * **The BAND is not omitted, and that asymmetry is the point.** Thirteen kind
 * groups in one flat run made the reader re-derive, per group, which question
 * that kind answers, so the groups sit under `Behavior` ("how a session must
 * act") and `Intent` ("what we are building, for whom, and what 'better'
 * means") — `PROMPT_DOCUMENT_BANDS` / `KIND_BAND` in `../types`. A band with no
 * documents still renders, carrying its own "nothing here yet" line: an ABSENT
 * Intent band reads as "this product has no intent layer", which is the
 * silent-empty-is-unknown failure applied to a heading. The one case where the
 * line is withheld is the one where emptiness genuinely is not known — coord
 * unreachable, or its store unprovisioned — and the notices above say so
 * instead.
 *
 * Bands are presentational only: nothing filters by band, no route addresses
 * one, and the create dialog offers every kind regardless.
 */
export function PromptDocumentList({
  autoPublishRefreshKey = 0,
  publishAllState,
  onCrossTabChange,
  writeGuardRef,
}: {
  /**
   * Bumped by the page when something outside this list changes what the
   * auto-publish status read would say — today the D5 switch. Each change
   * re-takes that read; the initial value takes none of its own (the hook
   * already reads on mount).
   */
  autoPublishRefreshKey?: number;
  /**
   * The page's own {@link usePublishAll} result, when the page owns the status
   * read so the auto-publish dial can share it (plan
   * `2026-10-17-auto-publish-lands-via-coord-2290-adoption` Phase 4: ONE fetch
   * for the list's badges and the dial's observed worker). Omitted, the list
   * reads for itself — which is how it is mounted standalone.
   */
  publishAllState?: PublishAllState;
  /**
   * Told whether another tab's project switch is in effect, so the page can
   * disable its own controls beside the list's. Called on every change.
   */
  onCrossTabChange?: (changed: boolean) => void;
  /**
   * Given the list's call-time write guard (`true`: send; `false`: another
   * tab's switch is in effect — nothing is sent, and the notice is raised),
   * so the page's own settings can check it at the moment they write.
   */
  writeGuardRef?: WriteGuardRef;
} = {}) {
  return publishAllState ? (
    <PromptDocumentListBody
      autoPublishRefreshKey={autoPublishRefreshKey}
      publishAllState={publishAllState}
      onCrossTabChange={onCrossTabChange}
      writeGuardRef={writeGuardRef}
    />
  ) : (
    <SelfReadingPromptDocumentList
      autoPublishRefreshKey={autoPublishRefreshKey}
      onCrossTabChange={onCrossTabChange}
      writeGuardRef={writeGuardRef}
    />
  );
}

/** Where the list hands the page its call-time write guard. */
export type WriteGuardRef = { current: (() => boolean) | null };

/** The list reading the publish-all surface itself — no page owns the read. */
function SelfReadingPromptDocumentList({
  autoPublishRefreshKey,
  onCrossTabChange,
  writeGuardRef,
}: {
  autoPublishRefreshKey: number;
  onCrossTabChange?: (changed: boolean) => void;
  writeGuardRef?: WriteGuardRef;
}) {
  const publishAllState = usePublishAll();
  return (
    <PromptDocumentListBody
      autoPublishRefreshKey={autoPublishRefreshKey}
      publishAllState={publishAllState}
      onCrossTabChange={onCrossTabChange}
      writeGuardRef={writeGuardRef}
    />
  );
}

function PromptDocumentListBody({
  autoPublishRefreshKey,
  publishAllState,
  onCrossTabChange,
  writeGuardRef,
}: {
  autoPublishRefreshKey: number;
  publishAllState: PublishAllState;
  onCrossTabChange?: (changed: boolean) => void;
  writeGuardRef?: WriteGuardRef;
}) {
  // The project stored when this page mounted (`null`: none stored yet) —
  // the one its first status read is pinned to. Captured once, before any
  // request was sent.
  const [mountTenant] = useState<string | null>(() => readActiveTenantId());
  const tenantContext = useOptionalTenant();
  // Whether the provider was still loading when this page mounted — i.e.
  // whether its reconcile is of the SAME stored project this page's first
  // reads carried. The layout's provider outlives client-side navigation and
  // never follows another tab's write, so one that had loaded earlier can name
  // a project this page was never served in.
  const [providerLoadingAtMount] = useState<boolean>(
    () => tenantContext !== null && tenantContext.loading
  );
  /**
   * The project this page's reads were SERVED in — `undefined` while that is
   * not known — as first resolved.
   *
   * - No provider (mounted standalone, under test): the project the page
   *   loaded with.
   * - The project the page loaded with is in the provider's membership list:
   *   that project — coord serves a member id as asked.
   * - It is not (none stored yet, or a stale id), and the provider was still
   *   loading when this page mounted: the provider's RECONCILED project. Those
   *   first reads were served the home project (coord's override is
   *   fail-soft), and the provider's reconcile of that same stored value is
   *   the home project too — so a fresh browser's seed is not a switch.
   * - It is not, and the provider had loaded before this page mounted (a
   *   client-side navigation): UNKNOWN. The provider's project then predates
   *   this page and says nothing about what its reads were served.
   * - The provider is loading, or failed: UNKNOWN.
   *
   * UNKNOWN offers nothing.
   */
  const resolvedPageTenant: string | null | undefined = (() => {
    if (tenantContext === null) return mountTenant;
    if (tenantContext.loading || tenantContext.error !== null) {
      return undefined;
    }
    if (
      mountTenant !== null &&
      tenantContext.tenants.some((t) => t.id === mountTenant)
    ) {
      return mountTenant;
    }
    return providerLoadingAtMount ? tenantContext.activeTenantId : undefined;
  })();
  const providerReady =
    tenantContext !== null &&
    !tenantContext.loading &&
    tenantContext.error === null;
  // The provider's project as this page last saw it loaded, and the project
  // the page followed it to. A CHANGE of the provider's project is THIS tab
  // switching project through the provider (another tab's write never
  // reaches this tab's provider), and the page follows it — to whichever
  // project it changed to, the one the provider had loaded in included.
  const providerTenant = providerReady
    ? tenantContext.activeTenantId
    : undefined;
  const [seenProviderTenant, setSeenProviderTenant] = useState<
    string | null | undefined
  >(providerTenant);
  const [followedTenant, setFollowedTenant] = useState<
    string | null | undefined
  >(undefined);
  useEffect(() => {
    if (providerTenant === undefined || providerTenant === seenProviderTenant) {
      return;
    }
    if (seenProviderTenant !== undefined) setFollowedTenant(providerTenant);
    setSeenProviderTenant(providerTenant);
  }, [providerTenant, seenProviderTenant]);
  /**
   * The page's project: as first resolved, until THIS tab switches project
   * through the provider — then the page follows it (re-reading below).
   * Another tab's switch is not followed: it is detected (`crossTabChange`)
   * and every write is withheld until the page is reloaded.
   */
  const pageTenant: string | null | undefined =
    followedTenant !== undefined ? followedTenant : resolvedPageTenant;

  /**
   * The project the cross-tab GUARD compares against: the page's project, or
   * — once that has been known — the last one known while it is UNKNOWN
   * again. A provider `refresh()` (a project rename, for one) puts the
   * provider back into `loading`, which makes `pageTenant` UNKNOWN for that
   * round trip; the rows on screen are still the last known project's, so
   * the guard must not lift. Only the guard reads this: Adopt all and the
   * list re-reads keep treating UNKNOWN as offering nothing.
   */
  const lastKnownPageTenant = useRef<string | null | undefined>(undefined);
  if (pageTenant !== undefined) lastKnownPageTenant.current = pageTenant;
  const guardTenant: string | null | undefined =
    pageTenant !== undefined ? pageTenant : lastKnownPageTenant.current;

  /**
   * True while the stored project differs from the page's because ANOTHER
   * tab changed it. The HTTP client reads the stored project per request, so
   * from then on every unpinned write would land in that project while this
   * page shows its own rows — so the page's controls are disabled, writes are
   * refused at call time, and the page asks to be reloaded.
   *
   * Computed against `guardTenant` whenever that is (re-)anchored — first
   * known, or followed to after THIS tab's own switch, whose storage write
   * has already happened by then — and on every `storage` event for the key,
   * which only OTHER tabs receive. Another tab switching back clears it. A
   * page whose project has never been known has nothing to compare and is
   * not guarded.
   */
  const [crossTabChange, setCrossTabChange] = useState(false);
  useEffect(() => {
    setCrossTabChange(
      guardTenant !== undefined && readActiveTenantId() !== guardTenant
    );
    if (guardTenant === undefined) return;
    const onStorage = (event: StorageEvent) => {
      // `null`: the other tab cleared storage — which clears the project too.
      if (event.key !== null && event.key !== ACTIVE_TENANT_STORAGE_KEY) return;
      setCrossTabChange(readActiveTenantId() !== guardTenant);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [guardTenant]);
  useEffect(() => {
    onCrossTabChange?.(crossTabChange);
  }, [crossTabChange, onCrossTabChange]);

  // Read through a ref so `writeAllowed` — and every guarded function built
  // on it below — keeps ONE identity for the page's lifetime. Several of them
  // sit in a dialog's effect dependencies (the history dialog's version list,
  // the upstream dialog's publication reads), where a new identity per render
  // re-fetches and resets the operator's selection.
  const guardTenantRef = useRef(guardTenant);
  guardTenantRef.current = guardTenant;

  /**
   * The call-time half of the guard: the listener above covers what is on
   * screen, this covers the race (a switch whose event has not arrived, a
   * dialog already open). `true` lets the request go; `false` sends nothing,
   * says why, and raises the notice. A page whose project has never been
   * known keeps the unguarded behaviour.
   */
  const writeAllowed = useCallback((): boolean => {
    const tenant = guardTenantRef.current;
    if (tenant === undefined || readActiveTenantId() === tenant) return true;
    setCrossTabChange(true);
    toast.error(`${CROSS_TAB_MESSAGE} Nothing was sent.`);
    return false;
  }, []);
  useEffect(() => {
    if (!writeGuardRef) return;
    writeGuardRef.current = writeAllowed;
    return () => {
      writeGuardRef.current = null;
    };
  }, [writeGuardRef, writeAllowed]);
  /** `fn`, answering `refused` without calling it while the guard says no. */
  const guard = useCallback(
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>, refused: R) =>
      async (...args: A): Promise<R> =>
        writeAllowed() ? fn(...args) : refused,
    [writeAllowed]
  );

  const {
    documents,
    documentsTenant,
    newestReadTenant,
    loading,
    saving,
    error,
    degraded,
    reload,
    fetchDocument,
    fetchVersions,
    fetchVersion,
    createDocument,
    updateDocument,
    restoreDefault,
    restoreVersion,
  } = usePromptDocuments();

  // Re-read the rows, pinned to the page's project, whenever that project
  // changes — first resolved, or followed to — and the NEWEST read sent (not
  // the newest landed) went out in another: this tab's own switch, a switch
  // back before the previous switch's read answered, or a fresh browser's
  // mount read, which went out with no project. The newest read owns the
  // list, so this one supersedes whatever is still in flight. Only on a
  // change of the page's project, so a row write's own re-read is left as
  // it was before this change.
  useEffect(() => {
    if (pageTenant === undefined) return;
    const sentIn = newestReadTenant();
    // None sent yet: nothing is in flight to supersede.
    if (sentIn === undefined) return;
    if (sentIn !== pageTenant) void reload({ tenant: pageTenant });
  }, [pageTenant, newestReadTenant, reload]);

  const {
    publishing,
    publishUnavailable,
    fetchPublication,
    publish,
    deciding,
    adoptUpstream,
    keepMine,
    fetchMergePreview,
    applyMerge,
  } = usePromptDocumentPublications();

  // The dialogs' doors, behind the guard. Memoized on the underlying
  // function, so a stable door stays stable (see `guardTenantRef`).
  const guardedCreate = useMemo(
    () => guard(createDocument, null),
    [guard, createDocument]
  );
  const guardedUpdate = useMemo(
    () => guard(updateDocument, false),
    [guard, updateDocument]
  );
  const guardedRestoreDefault = useMemo(
    () => guard(restoreDefault, false),
    [guard, restoreDefault]
  );
  const guardedFetchVersions = useMemo(
    () => guard(fetchVersions, null),
    [guard, fetchVersions]
  );
  const guardedFetchVersion = useMemo(
    () => guard(fetchVersion, null),
    [guard, fetchVersion]
  );
  const guardedFetchPublication = useMemo(
    () => guard(fetchPublication, null),
    [guard, fetchPublication]
  );
  const guardedFetchMergePreview = useMemo(
    () => guard(fetchMergePreview, null),
    [guard, fetchMergePreview]
  );

  /**
   * The publish-all surface (plan
   * `2026-09-19-policy-publish-all-and-auto-publish` D1/D4): the changed-document
   * preview that the button's count comes from, and the auto-publisher's pending
   * work that the row badges come from.
   *
   * `publishAllUnavailable` latches coord's `not_system_tenant` — or this
   * deployment's not-yet-proxied 404 — stamped with the project its request
   * was pinned to, and `publishAllRetired` below is the gate it puts on the
   * button and every publish-mode control. It is tracked separately from
   * `publishUnavailable` above on purpose: the two doors can answer differently
   * during a deploy (coord carrying `/publish` but not yet `/publish-all`), and
   * folding them would hide a working control because a different one is
   * missing.
   */
  const {
    candidates: publishAllCandidates,
    loadCandidates: loadPublishAllPreview,
    previewing: previewingPublishAll,
    status: autoPublishStatus,
    publishingEnabled: autoPublishEnabled,
    changedCount,
    publishing: publishingAll,
    savingMode,
    setPublishMode,
    modeSchemaPending,
    unavailable: publishAllUnavailable,
    answeredFor: statusAnsweredFor,
    reload: reloadPublishAll,
    publishAll,
  } = publishAllState;

  const [createOpen, setCreateOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [clausesOpen, setClausesOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishAllOpen, setPublishAllOpen] = useState(false);
  const [upstreamOpen, setUpstreamOpen] = useState(false);
  const [adoptAllOpen, setAdoptAllOpen] = useState(false);
  const [adoptAllPreview, setAdoptAllPreview] = useState<
    AdoptAllCandidate[] | null
  >(null);
  const [adoptAllSource, setAdoptAllSource] =
    useState<AdoptAllPreviewSource>("fresh");
  const [adoptAllDegraded, setAdoptAllDegraded] = useState<string | null>(null);
  const [adoptAllTenant, setAdoptAllTenant] = useState<string | null>(null);
  // The project the preview was read in — a ref, because the run's guard is
  // read between requests, long after the render that started it.
  const adoptAllTenantRef = useRef<string | null>(null);
  // Bumped by every open: only the newest open's re-read may become the
  // preview, so a slow read from an earlier open cannot land late over it.
  const adoptAllRequest = useRef(0);
  const [publishTarget, setPublishTarget] =
    useState<PromptDocumentSummary | null>(null);
  const [editing, setEditing] = useState<PromptDocument | null>(null);
  const [loadingBody, setLoadingBody] = useState(false);

  /** Open the freshly-created document straight into the editor. */
  const openCreated = (doc: PromptDocument) => {
    setEditing(doc);
    setLoadingBody(false);
    setEditorOpen(true);
  };

  /** The list carries no bodies — fetch the full document before editing. */
  const loadFull = async (
    doc: PromptDocumentSummary
  ): Promise<PromptDocument | null> => {
    setEditing(null);
    setLoadingBody(true);
    const full = await fetchDocument(doc.kind, doc.name);
    setEditing(full);
    setLoadingBody(false);
    return full;
  };

  const openEdit = async (doc: PromptDocumentSummary) => {
    if (!writeAllowed()) return;
    setEditorOpen(true);
    await loadFull(doc);
  };

  const openHistory = async (doc: PromptDocumentSummary) => {
    if (!writeAllowed()) return;
    setHistoryOpen(true);
    await loadFull(doc);
  };

  const openClauses = async (doc: PromptDocumentSummary) => {
    if (!writeAllowed()) return;
    setClausesOpen(true);
    await loadFull(doc);
  };

  /**
   * The three-way upstream view needs this tenant's BODY as its "ours" side,
   * which the list does not carry — same fetch the editor and history views do.
   */
  const openUpstream = async (doc: PromptDocumentSummary) => {
    if (!writeAllowed()) return;
    setUpstreamOpen(true);
    await loadFull(doc);
  };

  /**
   * The three decisions the upstream dialog offers (plan
   * `2026-09-04-cross-tenant-policy-publishing` D4 / Phase 7). Each carries
   * the open document's `current_version` as the concurrency check, and on
   * success re-reads the list — every one of them moves the tracked version,
   * so the badge state on the row is stale the moment coord answers — and
   * closes the dialog, because the comparison it was showing no longer
   * describes the document.
   */
  const settleDecision = async (
    doc: PromptDocument,
    outcome: UpstreamDecisionOutcome<unknown>
  ): Promise<boolean> => {
    if (outcome.ok) {
      setUpstreamOpen(false);
      await reload();
      return true;
    }
    // The decision was made against a version that is no longer current.
    // Retrying with the same number would refuse forever, so put the LIVE
    // document in front of the operator: re-reading it re-runs the dialog's
    // comparison against the version coord actually holds.
    if (outcome.refusal === "document_moved") {
      const full = await fetchDocument(doc.kind, doc.name);
      if (full) setEditing(full);
    }
    return false;
  };

  const handleAdoptUpstream = async (
    doc: PromptDocument,
    publication: Publication
  ): Promise<boolean> =>
    writeAllowed() &&
    settleDecision(
      doc,
      await adoptUpstream(
        doc.kind,
        doc.name,
        publication.publication_version,
        doc.current_version
      )
    );

  const handleKeepMine = async (
    doc: PromptDocument,
    publication: Publication
  ): Promise<boolean> =>
    writeAllowed() &&
    settleDecision(
      doc,
      await keepMine(
        doc.kind,
        doc.name,
        publication.publication_version,
        doc.current_version
      )
    );

  const handleMergeClauses = async (
    doc: PromptDocument,
    publication: Publication,
    resolutions: Record<string, ClauseConflictChoice>
  ): Promise<boolean> =>
    writeAllowed() &&
    settleDecision(
      doc,
      await applyMerge(
        doc.kind,
        doc.name,
        publication.publication_version,
        doc.current_version,
        resolutions
      )
    );

  /**
   * Publishing needs no body here: coord promotes the document's own current
   * version, and `expected_version` is the optimistic-concurrency check that
   * the version shown on this row is still the one coord holds.
   */
  const openPublish = (doc: PromptDocumentSummary) => {
    if (!writeAllowed()) return;
    setPublishTarget(doc);
    setPublishOpen(true);
  };

  /**
   * Roll the open document back to `version`, then re-read it so the history
   * dialog's diff immediately describes the NEW current version rather than the
   * one that was current a moment ago.
   */
  const handleRestoreVersion = async (
    kind: PromptDocumentKind,
    name: string,
    version: number,
    changeNote: string
  ): Promise<boolean> => {
    if (!writeAllowed()) return false;
    const ok = await restoreVersion(kind, name, version, changeNote);
    if (ok) {
      const full = await fetchDocument(kind, name);
      if (full) setEditing(full);
    }
    return ok;
  };

  /**
   * Memoized so the history dialog's load effect (which has `target` in its
   * dependency list) fires on a genuine document change instead of on every
   * render of this list — an inline object literal is a new reference each
   * time. Without this, any re-render of this list (the `saving` flag toggling
   * during a restore, for instance) refetched the version list and reset the
   * dialog's selected version out from under the operator.
   */
  const historyTarget = useMemo(
    () =>
      editing
        ? {
            kind: editing.kind,
            name: editing.name,
            label: editing.description ?? editing.name,
            // Whether a restore-to-default exists for this document — the
            // history dialog names it as the way out of a snapshot today's
            // content rules refuse, and must not name it when there is none.
            hasDefault: editing.default_source != null,
          }
        : null,
    [editing]
  );

  // Re-take the status read when the page says the switch moved. Skips the
  // mount value: `usePublishAll` has already read once by then.
  const seenRefreshKey = useRef(autoPublishRefreshKey);
  useEffect(() => {
    if (seenRefreshKey.current === autoPublishRefreshKey) return;
    seenRefreshKey.current = autoPublishRefreshKey;
    void reloadPublishAll();
  }, [autoPublishRefreshKey, reloadPublishAll]);

  /**
   * The auto-publish status, indexed by `kind/name` so a row is an O(1) lookup
   * rather than a scan per render.
   *
   * Empty when the status read failed or this is not the system tenant, and an
   * absent entry renders NO badge — the same "absent is UNKNOWN, and UNKNOWN
   * renders nothing" rule the upstream badge column already follows.
   */
  const statusByDocument = useMemo(
    () => autoPublishStatusByDocument(autoPublishStatus),
    [autoPublishStatus]
  );

  /**
   * Open the publish-all dialog, taking a FRESH dry run as it opens.
   *
   * The preview is not held from page load: the versions the operator is about
   * to confirm should be the ones coord returned seconds ago, and the dry run
   * is a POST on an admin write door that a page load has no business making.
   * The dialog renders its own loading state until this resolves.
   */
  const openPublishAll = async () => {
    setPublishAllOpen(true);
    await loadPublishAllPreview();
  };

  /**
   * How many documents coord says have an upstream update — the "Adopt all
   * updates (N)" count. Coord's `update_available` as served, never a local
   * comparison (`../_lib/upstreamStatus`); absent is not counted.
   */
  const updatesAvailable = useMemo(
    () => documents.filter((d) => d.update_available === true).length,
    [documents]
  );

  /**
   * Whether adopt-all may be offered: coord has ANSWERED that THIS PAGE'S
   * project is not positively the system tenant. In the system tenant its own
   * policies read `update_available` with nothing tracked, and one confirmed
   * run would replace every policy edited since publication with the older
   * published body; while the answer is unknown, the control is not offered.
   *
   * The answer counts only when its stamp IS the page's project — a refusal
   * stamped with another project, or with none (a `null` pin can be replayed
   * after a token refresh under whatever project is stored by then), is not
   * counted. It is not offered while the stored project differs from the
   * page's, whose rows another tab's switch would otherwise put this button
   * over, nor over rows read in any project but the page's (a switch whose
   * re-read has not landed yet). Per-row Adopt is unaffected. Opening re-asks
   * coord (`openAdoptAll`), so this governs only whether the button shows.
   */
  const adoptAllOffered =
    pageTenant !== undefined &&
    readActiveTenantId() === pageTenant &&
    documentsTenant === pageTenant &&
    coordSaidNotSystemTenant(publishAllUnavailable, pageTenant) &&
    updatesAvailable > 0;

  // The gate on "Publish all changed" and every publish-mode control: a
  // refusal another project earned does not hide them once this project's
  // own status read has answered. See `publishSurfaceRetired`.
  const publishAllRetired = publishSurfaceRetired(
    publishAllUnavailable,
    pageTenant,
    statusAnsweredFor
  );

  /**
   * Re-take the status read, PINNED to the page's project, whenever that
   * project is known and is not the one the last read was taken for: a
   * fresh browser's or a stale id's reconcile (the mount read went out with
   * what was stored, `null` or the stale id, so its answer is not stamped
   * with the page's project and is not counted), and every switch this tab
   * makes — back to the project it mounted in too.
   */
  const statusTakenFor = useRef<string | null | undefined>(mountTenant);
  useEffect(() => {
    if (pageTenant === undefined || pageTenant === statusTakenFor.current) {
      return;
    }
    statusTakenFor.current = pageTenant;
    void reloadPublishAll({ tenant: pageTenant });
  }, [pageTenant, reloadPublishAll]);

  /**
   * The project the preview was read in — and every request of the run is
   * pinned to — named from ITS OWN row in the membership list. Never the
   * provider's active project, which can be a different one (a provider that
   * predates a client-side navigation). Not in the list: the id itself, said
   * to be unknown.
   */
  const runTenantRow =
    adoptAllTenant === null
      ? undefined
      : tenantContext?.tenants.find((t) => t.id === adoptAllTenant);
  const tenantLabel =
    adoptAllTenant === null
      ? "your home project (none selected)"
      : runTenantRow
        ? runTenantRow.name?.trim() ||
          runTenantRow.slug?.trim() ||
          adoptAllTenant
        : `${adoptAllTenant} (unknown project — not in this page's project list)`;

  /**
   * Open adopt-all on a FRESH read of the list, and freeze that read as the
   * preview. Every adopt is pinned to the versions on these rows, so they
   * should be the ones coord served seconds ago rather than whatever this page
   * read when it loaded — the same reason publish-all takes its dry run at
   * open.
   *
   * The project is pinned too. The HTTP client reads the active project on
   * every request, so another tab switching it would otherwise retarget this
   * page's writes: a preview is refused outright when the project already
   * differs from the one this page (and coord's system-tenant answer) was
   * loaded in, and the run re-checks it before every request.
   */
  const openAdoptAll = async () => {
    const request = ++adoptAllRequest.current;
    const tenant = readActiveTenantId();
    adoptAllTenantRef.current = tenant;
    setAdoptAllTenant(tenant);
    setAdoptAllPreview(null);
    setAdoptAllSource("fresh");
    setAdoptAllDegraded(null);
    setAdoptAllOpen(true);
    const refuse = (source: AdoptAllPreviewSource) => {
      setAdoptAllSource(source);
      setAdoptAllPreview([]);
    };
    // `pageTenant` is never `undefined` here — the button is not offered then —
    // and an unknown page project could not be "unchanged" in any case.
    if (pageTenant === undefined || tenant !== pageTenant) {
      return refuse("tenant_changed");
    }
    // Ask coord AGAIN, now, in this project: the answer that showed the button
    // may be minutes old. The list is re-read beside it. Both are PINNED to
    // the project, so a retry after another tab switched cannot answer for a
    // different one.
    const [tenancy, fresh] = await Promise.all([
      probeTenancy(tenant),
      reload({ tenant }),
    ]);
    // A later open owns the preview; this read arrived too late to be it.
    if (request !== adoptAllRequest.current) return;
    // Both answers must be about the project the preview will be pinned to.
    if (readActiveTenantId() !== tenant) return refuse("tenant_changed");
    if (tenancy === "system") return refuse("system_tenant");
    if (tenancy === "unknown") return refuse("tenancy_unknown");
    if (fresh === null) {
      // No fresh read of THIS project: offer nothing. The rows on the page are
      // not evidence of what it holds — they may be another project's.
      return refuse("reread_failed");
    } else if (fresh.degraded !== null) {
      // A degraded answer's list is UNKNOWN, not empty — offer nothing.
      setAdoptAllSource("degraded");
      setAdoptAllDegraded(fresh.degraded);
      setAdoptAllPreview([]);
    } else {
      setAdoptAllPreview(adoptAllCandidates(fresh.documents));
    }
  };

  const initialLoading = loading && documents.length === 0;

  /**
   * Whether "this band holds nothing" is a FACT we may state.
   *
   * A band renders its own empty line so an unauthored Intent layer reads as
   * "nobody has written one yet" rather than as a layer this product does not
   * have. That line is only honest when coord actually answered: a transport
   * failure (`error`) or an unprovisioned store (`degraded`) makes the corpus
   * UNKNOWN, and the notices above already say which. In those states the
   * bands render nothing rather than asserting emptiness on no evidence.
   */
  const canAssertEmpty = !initialLoading && !degraded && !error;

  return (
    <div className="space-y-6">
      {crossTabChange ? (
        <div
          className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-200"
          role="alert"
          data-testid="prompt-documents-cross-tab"
        >
          <AlertTriangle className="size-4 shrink-0" />
          <p className="min-w-0 flex-1">
            {CROSS_TAB_MESSAGE} Until then this page sends no changes: its
            controls are disabled, and a change confirmed in a dialog or
            settings confirmation that was already open is refused. The
            documents shown are still this page&apos;s project, and a change
            made here would land in the other one.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => window.location.reload()}
            data-testid="prompt-documents-cross-tab-reload"
          >
            <RotateCw className="size-4" />
            Reload
          </Button>
        </div>
      ) : null}
      {/*
        The list's controls are disabled while another tab's switch is in
        effect — a disabled fieldset is the one switch that reaches them all.
        The dialogs render outside it (and portal out of it in any case), so
        their doors are refused at call time instead.
      */}
      <fieldset
        disabled={crossTabChange}
        className="m-0 min-w-0 space-y-6 border-0 p-0"
        data-testid="prompt-documents-controls"
      >
        <div className="flex flex-wrap items-center justify-end gap-2">
          {/*
          D1 — visible only when N > 0. There is no disabled state and no "0
          changed" label: a button that can never do anything is noise on every
          page load in every tenant, and its absence already says the one thing
          it would say. The count is coord's dry run, not a local derivation.
        */}
          {!publishAllRetired && changedCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => void openPublishAll()}
              data-testid="publish-all"
            >
              <Send className="size-4" />
              Publish all changed ({changedCount})
            </Button>
          )}
          {/*
          The inbound twin of the control above: shown only when coord serves
          at least one `update_available === true` AND has answered that this
          is not the system tenant, with no disabled "0" state for the same
          reason.
        */}
          {adoptAllOffered && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => void openAdoptAll()}
              data-testid="adopt-all"
            >
              <ArrowDownToLine className="size-4" />
              Adopt all updates ({updatesAvailable})
            </Button>
          )}
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => setCreateOpen(true)}
            data-testid="new-document"
          >
            <Plus className="size-4" />
            New document
          </Button>
        </div>

        {initialLoading && (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Loading documents…
          </div>
        )}

        {/* Coord refused or is unreachable: we know nothing, and say so. */}
        {error && (
          <div
            className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5"
            data-testid="prompt-documents-error"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-sm text-amber-800 dark:text-amber-200">
              Couldn&apos;t reach coord: {error}.{" "}
              {documents.length > 0
                ? "Showing the last documents loaded — they may be out of date."
                : "No documents could be loaded."}
            </p>
          </div>
        )}

        {/* Coord answered, but its store isn't provisioned yet (deploy window). */}
        {degraded && (
          <div
            className="flex items-start gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2.5"
            data-testid="prompt-documents-degraded"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Coord reports its prompt-document store isn&apos;t provisioned yet
              ({degraded}). This list is empty because the documents can&apos;t
              be read — not because none exist.
            </p>
          </div>
        )}

        {/*
        Publishing was offered, and coord (or this deployment's proxy) answered
        that it is not available here. The controls are gone from every row
        after that answer, so the answer has to be visible somewhere — a
        control that disappears without a word reads as a bug in the page.
      */}
        {publishUnavailable && (
          <div
            className="flex items-start gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2.5"
            data-testid="prompt-documents-publish-unavailable"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {publishUnavailable.refusal === "not_system_tenant"
                ? "Publishing to the fleet is available only from the system tenant, and coord says this is not it. The Publish controls are hidden for the rest of this visit."
                : publishUnavailable.refusal === "not_proxied"
                  ? "This deployment does not carry the publish route yet, so the Publish controls are hidden for the rest of this visit. Nothing was published."
                  : publishUnavailable.detail}
            </p>
          </div>
        )}

        {/*
        A publish-mode write was refused in a way that points at the `pdpub_03`
        migration not being applied yet.

        Coord's READS of `publish_mode` degrade on a missing column and answer
        UNDECIDED, so this page works fine against a coord deployed ahead of the
        migration — right up until someone tries to SET a mode. That write
        deliberately does not degrade: an authority decision the schema cannot
        hold must not look like it was saved. So the failure is real, expected,
        and temporary, and it needs to read that way. A bare "failed to save"
        toast sends an operator to debug a system behaving exactly as designed,
        and it vanishes before they can act on it.

        The control is NOT retired, unlike the not-system-tenant case: the
        migration lands during this page's lifetime and the operator needs the
        setting to still be there when it does.
      */}
        {modeSchemaPending && (
          <div
            className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5"
            data-testid="publish-mode-schema-pending"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="text-sm text-amber-800 dark:text-amber-200">
              <p className="font-medium">
                Coord cannot record a publish mode yet.
              </p>
              <p className="mt-1">
                Its <code className="font-mono">publish_mode</code> column is
                most likely not migrated ({" "}
                <code className="font-mono">pdpub_03</code> ). Reading a mode
                degrades to &quot;undecided&quot; so this page still works, but
                the write refuses rather than degrading — a decision the schema
                cannot hold must not look like it was saved. Nothing was
                changed. Coord said: {modeSchemaPending}
              </p>
            </div>
          </div>
        )}

        {(documents.length > 0 || canAssertEmpty) &&
          PROMPT_DOCUMENT_BANDS.map((band) => {
            // Authority order is `PROMPT_DOCUMENT_KINDS`', preserved within the
            // band — the band regroups the list, it does not re-rank it.
            const populated = kindsInBand(band).filter((kind) =>
              documents.some((d) => d.kind === kind)
            );
            return (
              <section
                key={band}
                className="space-y-4"
                data-testid={`kind-band-${band}`}
              >
                <div className="border-b border-border pb-1.5">
                  <h2 className="text-xs font-semibold uppercase tracking-wide">
                    {BAND_META[band].label}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {BAND_META[band].question}
                  </p>
                </div>

                {populated.length === 0 ? (
                  // `canAssertEmpty` is re-checked HERE, not just on the outer
                  // gate. The outer gate passes on `documents.length > 0` alone,
                  // and a failed refetch KEEPS the last-good list on screen
                  // (`usePromptDocuments`, deliberately) — so a stale list with
                  // an error banner would otherwise reach this branch and state
                  // "nobody has authored one" on no evidence. Emptiness is a fact
                  // only when coord actually answered; otherwise render nothing
                  // and let the banner above say the view is stale.
                  canAssertEmpty ? (
                    <p
                      className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground"
                      data-testid={`kind-band-empty-${band}`}
                    >
                      No {BAND_META[band].label.toLowerCase()} documents yet —
                      nothing here says {BAND_META[band].question}.
                    </p>
                  ) : null
                ) : (
                  populated.map((kind) => {
                    const group = documents.filter((d) => d.kind === kind);
                    return (
                      <section key={kind} data-testid={`kind-group-${kind}`}>
                        <div className="mb-2">
                          <h3 className="text-sm font-semibold">
                            {KIND_META[kind].label}
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            {KIND_META[kind].description}
                          </p>
                        </div>
                        <div className="space-y-2">
                          {group.map((doc) => (
                            <DocumentRow
                              key={`${doc.kind}/${doc.name}`}
                              doc={doc}
                              saving={saving}
                              onEdit={() => openEdit(doc)}
                              onHistory={() => openHistory(doc)}
                              onSetAgentWriteTier={(tier) =>
                                guardedUpdate(doc.kind, doc.name, {
                                  // The explicit TIER, never the legacy boolean.
                                  // `agent_writable: true` is read by coord as
                                  // "at least allow", which cannot PRODUCE
                                  // `allow_with_notification` — so an operator
                                  // choosing the notification tier got plain
                                  // `allow` and the agent writes it authorised
                                  // landed unannounced.
                                  agent_write_tier: tier,
                                  change_description: `Agent write tier set to \`${tier}\` by an operator`,
                                })
                              }
                              onClauses={
                                doc.kind === "policy"
                                  ? () => openClauses(doc)
                                  : undefined
                              }
                              onUpstream={
                                doc.update_available === true
                                  ? () => openUpstream(doc)
                                  : undefined
                              }
                              onPublish={
                                isPublishableKind(doc.kind) &&
                                publishUnavailable === null
                                  ? () => openPublish(doc)
                                  : undefined
                              }
                              // D4 — the publish-mode control sits on every
                              // document of a publishable kind. It is withheld
                              // once coord has said the publishing surface does
                              // not apply here at all, for the same reason the
                              // Publish button is: the mode is meaningful only on
                              // system-tenant rows, and a control whose only
                              // outcome is a refusal is a dead end.
                              onSetPublishMode={
                                isPublishableKind(doc.kind) &&
                                !publishAllRetired
                                  ? async (mode) => {
                                      if (!writeAllowed()) return false;
                                      const ok = await setPublishMode(
                                        doc.kind,
                                        doc.name,
                                        mode
                                      );
                                      // The mode takes coord's VERSIONING path,
                                      // so a successful write bumps
                                      // `current_version` and the row must be
                                      // re-read or it shows a stale one beside
                                      // its new mode.
                                      if (ok) await reload();
                                      return ok;
                                    }
                                  : undefined
                              }
                              savingPublishMode={savingMode}
                              // Absent ⇒ no badge. Coord did not name this
                              // document as a candidate, which is UNKNOWN rather
                              // than "nothing is scheduled".
                              autoPublish={statusByDocument.get(
                                `${doc.kind}/${doc.name}`
                              )}
                              autoPublishEnabled={autoPublishEnabled}
                            />
                          ))}
                        </div>
                      </section>
                    );
                  })
                )}
              </section>
            );
          })}
      </fieldset>

      <PromptDocumentCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        saving={saving}
        onCreate={guardedCreate}
        onCreated={openCreated}
      />

      <PromptDocumentEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        document={editing}
        loadingBody={loadingBody}
        saving={saving}
        onUpdate={guardedUpdate}
        onRestore={guardedRestoreDefault}
        onShowHistory={() => {
          setEditorOpen(false);
          setHistoryOpen(true);
        }}
      />

      <PromptDocumentHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        target={historyTarget}
        currentBody={editing?.body ?? ""}
        currentVersion={editing?.current_version ?? 0}
        fetchVersions={guardedFetchVersions}
        fetchVersion={guardedFetchVersion}
        saving={saving}
        onRestoreVersion={handleRestoreVersion}
      />

      <PromptDocumentPublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        doc={publishTarget}
        publishing={publishing}
        onPublish={async (target, releaseNote) => {
          if (!writeAllowed()) return null;
          const res = await publish(
            target.kind,
            target.name,
            target.current_version,
            releaseNote
          );
          // A publication moves `latest_publication_version` for every row of
          // this `(kind, name)` — including this one — so the list is re-read
          // rather than left showing the badge state from before the publish.
          //
          // It also retires this document from the publish-all candidate set
          // and clears any auto-publish hold on it, so the dry run and the
          // status read are re-taken beside it. Skipping that would leave the
          // "Publish all changed (N)" count one too high and a settles-at badge
          // promising an automatic publication that has already happened by
          // hand — both stale in the direction that reads as a live schedule.
          if (res) await Promise.all([reload(), reloadPublishAll()]);
          return res;
        }}
      />

      <PublishAllDialog
        open={publishAllOpen}
        onOpenChange={setPublishAllOpen}
        candidates={publishAllCandidates}
        previewing={previewingPublishAll}
        publishing={publishingAll}
        onPublishAll={async (selected, releaseNote) => {
          // The confirm, not the preview: `publishAll` pins the project
          // stored NOW, which is another tab's once it has switched.
          if (!writeAllowed()) return null;
          const res = await publishAll(selected, releaseNote);
          // Same reasoning as the single publish above, and more of it: an
          // armed batch can move every row on the page at once.
          if (res) await Promise.all([reload(), reloadPublishAll()]);
          return res;
        }}
      />

      <AdoptAllDialog
        open={adoptAllOpen}
        onOpenChange={setAdoptAllOpen}
        candidates={adoptAllPreview}
        previewSource={adoptAllSource}
        degradedReason={adoptAllDegraded}
        tenantLabel={tenantLabel}
        tenantUnchanged={() =>
          readActiveTenantId() === adoptAllTenantRef.current
        }
        // The per-document door, quiet: the dialog reports every row itself,
        // so a toast per document would only repeat it.
        onAdopt={(kind, name, publicationVersion, expectedVersion) =>
          adoptUpstream(kind, name, publicationVersion, expectedVersion, {
            silent: true,
            // Pinned: a re-issued write cannot land in another project.
            tenant: adoptAllTenantRef.current,
          })
        }
        // Every adopt moved a tracked version and a body, so the rows' badges
        // and the publish-all count are stale the moment the run ends. The
        // re-read also goes back to the dialog, which checks every row it
        // could not confirm against it. It must be a read of the RUN'S project
        // — the HTTP client reads the project per request — or it would
        // reconcile one project's rows against another's list; so a project
        // that changed before or during it makes it no answer, as does a
        // degraded one. A project that changed before it is not re-read at
        // all: this page's rows are better stale than another project's.
        onFinished={async () => {
          const runTenant = adoptAllTenantRef.current;
          if (readActiveTenantId() !== runTenant) return null;
          const [reread] = await Promise.all([
            reload({ tenant: runTenant }),
            reloadPublishAll(),
          ]);
          if (readActiveTenantId() !== runTenant) return null;
          return reread && reread.degraded === null ? reread.documents : null;
        }}
      />

      <PromptDocumentUpstreamDialog
        open={upstreamOpen}
        onOpenChange={setUpstreamOpen}
        doc={editing}
        loadingBody={loadingBody}
        fetchPublication={guardedFetchPublication}
        onAdoptUpstream={handleAdoptUpstream}
        onKeepMine={handleKeepMine}
        fetchMergePreview={guardedFetchMergePreview}
        onMergeClauses={handleMergeClauses}
        saving={deciding}
      />

      <ClauseManagerDialog
        open={clausesOpen}
        onOpenChange={setClausesOpen}
        document={editing?.kind === "policy" ? editing : null}
        loadingBody={loadingBody}
        onDocsReload={reload}
        canWrite={writeAllowed}
      />
    </div>
  );
}

interface DocumentRowProps {
  doc: PromptDocumentSummary;
  /** True while any document write is in flight — disables the access toggle. */
  saving: boolean;
  onEdit: () => void;
  onHistory: () => void;
  /**
   * Set this document's per-document agent write TIER.
   *
   * A tier, not a boolean: the boolean is coord's legacy projection and cannot
   * express `allow_with_notification`.
   */
  onSetAgentWriteTier: (tier: AgentWriteTier) => Promise<boolean>;
  /** Only set for `policy` documents — opens the structured clause manager. */
  onClauses?: () => void;
  /**
   * Set only when coord served `update_available === true` — opens the
   * three-way upstream view. Absent means there is nothing to decide, not that
   * the feature is missing.
   */
  onUpstream?: () => void;
  /**
   * Set for a publishable kind, until coord answers that publishing is not
   * available in this tenant at all. See `usePromptDocumentPublications` for
   * why the console offers this rather than pre-gating it.
   */
  onPublish?: () => void;
  /**
   * Set this document's publish mode — `auto`, `manual` or `never` (plan
   * `2026-09-19-policy-publish-all-and-auto-publish` D2).
   *
   * Set for a publishable kind, until coord answers that the publishing surface
   * does not apply here — same gate, same reason, as `onPublish`. Absent means
   * the control is not offered; it never means the mode is undecided, which is
   * a state the control itself renders.
   */
  onSetPublishMode?: (mode: PublishMode) => Promise<boolean>;
  /** True while a publish-mode PATCH is in flight — disables that picker only. */
  savingPublishMode?: boolean;
  /**
   * This document's entry in the auto-publish status read, when coord named it
   * as a candidate. `undefined` is UNKNOWN and renders no badge.
   */
  autoPublish?: AutoPublishStatusEntry;
  /**
   * Coord's resolved D5 switch. `false` turns a schedule into an
   * "Auto-publish off" badge; `undefined` is UNKNOWN and changes nothing.
   */
  autoPublishEnabled?: boolean;
}

function DocumentRow({
  doc,
  saving,
  onEdit,
  onHistory,
  onSetAgentWriteTier,
  onClauses,
  onUpstream,
  onPublish,
  onSetPublishMode,
  savingPublishMode,
  autoPublish,
  autoPublishEnabled,
}: DocumentRowProps) {
  // A document with a `default_source` has a shipped default the editor can
  // restore; one without is hand-authored with nothing to fall back to.
  const restorable = doc.default_source != null;
  /**
   * A `session_briefing` row under a name the runner does not resolve.
   *
   * The create dialog warns about this at authoring time, which covers exactly
   * one of the ways such a row appears. It does not cover a row seeded before
   * that warning existed, nor one an agent created through
   * `coord_write_prompt_document` — and that second case is not hypothetical:
   * coord's `AGENT_UNWRITABLE_DOCUMENTS` lists the three canonical
   * `(kind, name)` PAIRS, so every other briefing name is agent-writable by
   * default. For those rows this list is the only place an operator ever meets
   * them, and until now it rendered them identically to the three live ones,
   * under a heading that says this kind becomes the fleet's system prompt.
   *
   * Flagged rather than hidden: the row is legal, coord stores and versions it,
   * and hiding it would be worse — an operator would lose the one view that
   * shows it exists. Only the exception is marked, so the common case (the
   * three live briefings) stays uncluttered.
   */
  const inertBriefing = isInertSessionBriefing(doc.kind, doc.name);
  /**
   * The publication-channel badge, read STRAIGHT off the four fields coord
   * serves — `upstream_publication_version`, `latest_publication_version`,
   * `local_modified`, `update_available`. Nothing here compares a body; see
   * `../_lib/upstreamStatus` for why re-deriving `local_modified` in a browser
   * would invert its degrade polarity and put a tenant's own edits at risk.
   */
  const upstream = upstreamBadge(doc);
  /**
   * The auto-publish badge — "publishes automatically at <time> (24 h | 6 h)"
   * or "held: <token>" — read straight off coord's status entry.
   *
   * Nothing here computes a settle time or a hold. The clock keys on the newest
   * version whose BODY differs from its predecessor's (so a metadata-only
   * `publish_mode` version does not move it) and the wait depends on a
   * direction classified against the last publication; a browser holds neither
   * input. See `../_lib/autoPublishBadge`.
   */
  const autoPublishState = autoPublishBadge(autoPublish, autoPublishEnabled);
  return (
    <div
      className="group flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-3"
      data-testid={`doc-row-${doc.kind}-${doc.name}`}
    >
      <NotebookText
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            {doc.description ?? doc.name}
          </span>
          <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {doc.kind === "policy" ? `{{policy:${doc.name}}}` : doc.name}
          </code>
          <span
            className="inline-flex shrink-0 items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
            title={
              restorable
                ? "Has a built-in default — the editor can restore it."
                : "Hand-authored — no built-in default to restore to."
            }
          >
            {restorable ? "Restorable" : "Custom"}
          </span>
          {upstream && (
            <span
              className={
                upstream.tone === "attention"
                  ? "inline-flex shrink-0 items-center rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400"
                  : "inline-flex shrink-0 items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
              }
              title={upstream.title}
              data-testid={`doc-upstream-${upstream.testId}-${doc.kind}-${doc.name}`}
            >
              {upstream.label}
            </span>
          )}
          {autoPublishState && (
            <span
              className={
                autoPublishState.tone === "attention"
                  ? "inline-flex shrink-0 items-center rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400"
                  : "inline-flex shrink-0 items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
              }
              title={autoPublishState.title}
              data-testid={`doc-auto-publish-${autoPublishState.testId}-${doc.kind}-${doc.name}`}
            >
              {autoPublishState.label}
            </span>
          )}
          {doc.withdrawn === true && (
            // Muted, not amber: a withdrawn record waits on nobody (R3). Only
            // an explicit `true` — a coord predating withdrawal omits the
            // field, and that must not read as a live record either.
            <span
              className="inline-flex shrink-0 items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
              title={
                doc.withdrawn_reason
                  ? `Withdrawn — no longer counts as a decision. Reason given: ${doc.withdrawn_reason}`
                  : "Withdrawn — no longer counts as a decision."
              }
              data-testid={`doc-withdrawn-${doc.kind}-${doc.name}`}
            >
              Withdrawn
            </span>
          )}
          {inertBriefing && (
            <span
              className="inline-flex shrink-0 items-center rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400"
              title={`Never injected into a prompt: the runner fetches only ${SESSION_BRIEFING_DOCUMENT_NAMES.join(
                ", "
              )} by name and never lists this kind. Coord's built-in write protection covers those three names specifically, so this row is also agent-writable unless an operator protects it.`}
              data-testid={`doc-inert-${doc.kind}-${doc.name}`}
            >
              Inert
            </span>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          v{doc.current_version} · edited by {doc.updated_by ?? "unknown"} ·{" "}
          {formatWhen(doc.updated_at)}
        </p>
      </div>

      <AgentWriteAccessControl
        doc={doc}
        saving={saving}
        onSet={onSetAgentWriteTier}
      />

      {onSetPublishMode && (
        <PublishModeControl
          doc={doc}
          saving={saving || savingPublishMode === true}
          // Coord's answer for what the worker WILL set on an undecided
          // document, served only while the mode is null. Passed down rather
          // than derived: deriving it needs coord's carve-out list and its five
          // lint patterns, and the day either changes this console would name
          // the wrong default with total confidence.
          undecidedDefault={autoPublish?.undecided_default}
          onSet={onSetPublishMode}
        />
      )}

      {onUpstream && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={onUpstream}
          title="Compare against the available publication"
          data-testid={`doc-upstream-${doc.kind}-${doc.name}`}
        >
          <CloudDownload className="size-4" />
        </Button>
      )}
      {onPublish && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={onPublish}
          title="Publish this document to the fleet"
          data-testid={`doc-publish-${doc.kind}-${doc.name}`}
        >
          <Send className="size-4" />
        </Button>
      )}
      {onClauses && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={onClauses}
          title="Structured clauses"
          data-testid={`doc-clauses-${doc.kind}-${doc.name}`}
        >
          <ListTree className="size-4" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        onClick={onHistory}
        title="Version history"
        data-testid={`doc-history-${doc.kind}-${doc.name}`}
      >
        <History className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        onClick={onEdit}
        title="Edit document"
        data-testid={`doc-edit-${doc.kind}-${doc.name}`}
      >
        <Pencil className="size-4" />
      </Button>
    </div>
  );
}
