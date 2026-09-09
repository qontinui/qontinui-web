"use client";

/**
 * /admin/coord/memory/[name] — single-memory detail view.
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 6 (Wave 3c).
 *
 * Reads `GET /api/v1/operations/memory/{name}` (latest version per Q3
 * LWW). Renders content as markdown with frontmatter shown in a
 * sidebar. Operator can edit (writes a new immutable version), delete
 * (soft-delete tombstone), or jump to a historical version.
 *
 * ## Console style (Phase 3 Wave 3)
 *
 * The ROUTE survives (D1 — an editor, a destructive action and a version
 * picker make this a workspace, and it is what `<MemoryRow>`'s "Open full
 * page" opens). What changed, per
 * `frontend/docs/console-ui-style-guide.md`:
 *
 * - **R9** — five `<Card><CardHeader><CardTitle>` wrappers are gone. The body
 *   is `p-3 sm:p-6 space-y-4` (it was a flat `p-6`), and the meta header — a
 *   card title restating the name already in the breadcrumb above it, plus a
 *   second card body holding the buttons — collapses into one strip.
 * - **R3/R4** — the memory's type is now the SAME `<StatusBadge>` `/memory`
 *   renders (`deriveMemoryStatus`), with the matching accent. It was a bare
 *   `<Badge variant="outline">{memory.type}</Badge>`, which painted a type
 *   this build has never heard of exactly like a known one.
 * - **R2** — `written_at` was a raw ISO string in the frontmatter panel and in
 *   every version-picker option. Both render through the console formatters
 *   now: relative in the line, absolute in the title.
 * - **R7** — `Frontmatter` and `Version history` are supporting material, so
 *   they collapse. Both open by DEFAULT, because `admin.spec.ts:696-702`
 *   asserts `coord-memory-frontmatter`, `coord-memory-history` and
 *   `coord-memory-version-select` are all visible without a click.
 *
 * **The version picker deliberately stays a `<Select>`, not a `<RecordList>`.**
 * It is a NAVIGATION control in a 280px sidebar — one line that lists ten
 * versions — and expanding it into ten rows would make this page strictly less
 * dense, which is the opposite of what R2 is for. `coord-memory-version-select`
 * and `coord-memory-version-option-<n>` are frozen authored testids (D4a).
 *
 * Every authored `data-testid` is carried across unchanged (D4a).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft,
  BookOpen,
  Edit3,
  History as HistoryIcon,
  Save,
  Trash2,
  X,
} from "lucide-react";
import {
  CollapsiblePanel,
  INERT,
  RowTime,
  StatusBadge,
  absoluteTime,
  isNotFoundError,
  relativeTime,
  rowAccentProps,
} from "@/components/console";
import {
  MEMORY_STATUS_PALETTE,
  deriveMemoryStatus,
} from "@/components/admin/coord/memoryStatus";
import { httpClient } from "@/services/service-factory";
import {
  CoordAdminOnly,
  ReadOnlyNotice,
} from "@/components/admin/coord/CoordAdminOnly";

const API = "/api/v1/operations";

interface MemoryVersionEntry {
  version: number;
  written_at?: string | null;
  written_by_agent?: string | null;
}

interface CoordMemoryDetail {
  name: string;
  content: string;
  description?: string | null;
  type?: string | null;
  version?: number | null;
  written_at?: string | null;
  written_by_agent?: string | null;
  written_by_device?: string | null;
  history?: MemoryVersionEntry[];
  tombstoned?: boolean;
}

export default function CoordMemoryDetailPage() {
  const params = useParams<{ name: string }>();
  const router = useRouter();
  const name = useMemo(() => {
    const raw = params?.name;
    if (!raw) return "";
    return Array.isArray(raw) ? raw[0] : raw;
  }, [params]);

  const [memory, setMemory] = useState<CoordMemoryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /**
   * The read failed with coord's own 404 — it answered, and the answer was
   * "no live memory by that name". Coord also 404s a SOFT-DELETED memory
   * (`memories.rs`), so without this every tombstoned memory would read as an
   * infrastructure fault rather than as the deletion it is.
   */
  const [notFound, setNotFound] = useState(false);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchMemory = useCallback(async () => {
    if (!name) return;
    try {
      const body = await httpClient.get<CoordMemoryDetail>(
        `${API}/memory/${encodeURIComponent(name)}`
      );
      setMemory(body);
      setDraft(body.content ?? "");
      setError(null);
      setNotFound(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setNotFound(isNotFoundError(e));
    } finally {
      setLoading(false);
    }
  }, [name]);

  useEffect(() => {
    // Drop the previous name's memory first: the catch never nulls `memory`,
    // so a 404 after a successful load would render the OLD memory's content
    // under the new name — and both arms below sit behind `memory === null`.
    // `fetchMemory` keys on `name`, so this fires on a route change and not on
    // `onSave`'s refresh, which calls it directly; this route does not poll.
    setMemory(null);
    setError(null);
    setNotFound(false);
    setLoading(true);
    fetchMemory();
  }, [fetchMemory]);

  const onSave = useCallback(async () => {
    if (!name) return;
    setSaving(true);
    try {
      await httpClient.post(`${API}/memory/upsert`, {
        name,
        content: draft,
        description: memory?.description ?? undefined,
        type: memory?.type ?? undefined,
      });
      toast.success("Memory saved (new version)");
      setEditing(false);
      await fetchMemory();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save memory");
    } finally {
      setSaving(false);
    }
  }, [name, draft, memory?.description, memory?.type, fetchMemory]);

  const onDelete = useCallback(async () => {
    if (!name) return;
    setDeleting(true);
    try {
      await httpClient.delete(`${API}/memory/${encodeURIComponent(name)}`);
      toast.success("Memory tombstoned (recoverable via restore)");
      router.push("/admin/coord/memory");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete memory");
    } finally {
      setDeleting(false);
    }
  }, [name, router]);

  const onJumpToVersion = useCallback(
    (versionStr: string) => {
      if (!versionStr || !name) return;
      router.push(
        `/admin/coord/memory/${encodeURIComponent(name)}/version/${versionStr}`
      );
    },
    [name, router]
  );

  const history = memory?.history ?? [];
  const top10 = history.slice(0, 10);
  /**
   * More versions exist than the picker can offer.
   *
   * **NOT `history.length > top10.length`.** Coord already caps this array
   * server-side (`memories.rs`, `ORDER BY version DESC LIMIT 10`) and the web
   * proxy passes it through, so `history.length` is never above 10 and that
   * predicate is dead on arrival — it would render the disclosure never, on
   * exactly the memories that need it.
   *
   * The head version number is the signal that survives the cap: versions are
   * assigned monotonically, so a head of 42 over 10 returned rows means 32 are
   * not on the wire at all. `?? 0` keeps an older coord that omits `version`
   * silent rather than guessing.
   */
  const headVersion = memory?.version ?? 0;
  // `top10.length > 0` keeps the badge and the body agreeing: the picker below
  // is guarded on it, so without it a response carrying `version: 5` and no
  // `history` at all would print `0/5` beside "No prior versions."
  const historyTruncated = top10.length > 0 && headVersion > history.length;

  return (
    <div
      className="p-3 sm:p-6 space-y-4 max-w-6xl mx-auto"
      data-testid="coord-memory-detail-page"
    >
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/admin/coord/memory")}
          data-testid="coord-memory-back-btn"
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1" />
          Memory
        </Button>
        <span className="text-muted-foreground">/</span>
        <span className="font-mono text-sm">{name}</span>
      </div>

      {error && (
        <p className="text-sm text-destructive">Failed to load: {error}</p>
      )}

      {loading && !memory ? (
        <Skeleton className="h-32 w-full" />
      ) : memory ? (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
          <div className="space-y-4 min-w-0">
            {/* R9/R3/R4 — one strip: identity, the same status badge `/memory`
                renders, and the actions that used to need a second card body
                under a ~72px card header. */}
            <div
              data-testid="coord-memory-meta"
              {...rowAccentProps(
                deriveMemoryStatus(memory),
                "rounded-lg border border-border bg-card/30 px-4 py-3 space-y-2"
              )}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="font-mono text-sm truncate">
                  {memory.name}
                </span>
                <StatusBadge
                  status={deriveMemoryStatus(memory)}
                  palette={MEMORY_STATUS_PALETTE}
                />
                {memory.version !== null && memory.version !== undefined && (
                  <Badge
                    variant="secondary"
                    className="font-mono text-[11px]"
                    title="The monotonic version HEAD, not a count of versions."
                  >
                    v{memory.version}
                  </Badge>
                )}
                {memory.tombstoned && (
                  /*
                   * R3 — this was `variant="destructive"`, i.e. RED, on a
                   * TERMINAL state nobody must act on. Nothing clears a
                   * tombstone and nothing decays while it sits; the operator
                   * is reading a soft-deleted document, which is a fact about
                   * the document, not a task. Red here is the same bug R3
                   * opens by naming — colour encoding how alarming the WORD
                   * sounds rather than whose move it is — and it is the more
                   * expensive half of that bug, because a red badge nobody
                   * must act on is what teaches the eye to skip red.
                   *
                   * So: calm hue, and the thing worth knowing said in WORDS
                   * (the guide's third case). The word "tombstoned" plus this
                   * title carry strictly more than the colour did.
                   *
                   * `INERT` is imported rather than spelled, and this badge is
                   * deliberately NOT run through `MEMORY_STATUS_PALETTE`:
                   * `memoryStatus.ts` keys its tones off the memory's TYPE and
                   * is total over that, while tombstoning is an orthogonal
                   * lifecycle flag. Folding a fourth tone in would make the
                   * table non-total over the thing it claims to describe.
                   * `paletteDisagreements` therefore does not see this line —
                   * stated here rather than left for the next reader to
                   * discover.
                   */
                  <Badge
                    variant="outline"
                    className={INERT}
                    title="Soft-deleted: reads filter this memory out. The full version history is retained and any prior version can be restored — nothing is lost and nothing needs doing."
                    data-testid="coord-memory-tombstoned-badge"
                  >
                    tombstoned
                  </Badge>
                )}
                {memory.written_at && (
                  <RowTime at={memory.written_at} verb="Written" />
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <CoordAdminOnly
                  fallback={
                    <ReadOnlyNotice label="Editing and deleting memories is administrator only." />
                  }
                >
                  {!editing ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setDraft(memory.content);
                          setEditing(true);
                        }}
                        data-testid="coord-memory-edit-btn"
                      >
                        <Edit3 className="h-3.5 w-3.5 mr-1" />
                        Edit
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={deleting}
                            data-testid="coord-memory-delete-btn"
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-1" />
                            {deleting ? "Deleting..." : "Delete"}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent data-testid="coord-memory-delete-dialog">
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              Tombstone this memory?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              Soft-delete sets a tombstone marker so reads
                              filter it out. The full version history is
                              retained; you can restore from any prior version.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel data-testid="coord-memory-delete-cancel">
                              Cancel
                            </AlertDialogCancel>
                            <AlertDialogAction asChild>
                              <DestructiveButton
                                onClick={onDelete}
                                data-testid="coord-memory-delete-confirm"
                              >
                                Tombstone
                              </DestructiveButton>
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        onClick={onSave}
                        disabled={saving}
                        data-testid="coord-memory-save-btn"
                      >
                        <Save className="h-3.5 w-3.5 mr-1" />
                        {saving ? "Saving..." : "Save"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setDraft(memory.content);
                          setEditing(false);
                        }}
                        data-testid="coord-memory-cancel-btn"
                      >
                        <X className="h-3.5 w-3.5 mr-1" />
                        Cancel
                      </Button>
                    </>
                  )}
                </CoordAdminOnly>
              </div>
            </div>

            <section
              data-testid="coord-memory-content"
              className="rounded-lg border border-border bg-card/30 px-4 py-3"
            >
              {editing ? (
                <Tabs defaultValue="edit">
                  <TabsList>
                    <TabsTrigger
                      value="edit"
                      data-testid="coord-memory-tab-edit"
                    >
                      Edit
                    </TabsTrigger>
                    <TabsTrigger
                      value="preview"
                      data-testid="coord-memory-tab-preview"
                    >
                      Preview
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="edit">
                    <Textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={24}
                      className="font-mono text-sm"
                      data-testid="coord-memory-editor"
                    />
                  </TabsContent>
                  <TabsContent value="preview">
                    <div
                      className="prose prose-sm max-w-none dark:prose-invert"
                      data-testid="coord-memory-editor-preview"
                    >
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {draft}
                      </ReactMarkdown>
                    </div>
                  </TabsContent>
                </Tabs>
              ) : (
                <div
                  className="prose prose-sm max-w-none dark:prose-invert"
                  data-testid="coord-memory-rendered"
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {memory.content}
                  </ReactMarkdown>
                </div>
              )}
            </section>
          </div>

          <aside className="space-y-4">
            {/* R7 — the frontmatter is support material, so it folds. It opens
                by default: `admin.spec.ts:696` asserts this panel is visible
                without a click, and the whole point of the sidebar is that the
                provenance is readable at a glance. */}
            <CollapsiblePanel
              titleAs="h2"
              className="p-3"
              defaultOpen
              storageKey="coord-memory-frontmatter"
              title="Frontmatter"
              data-testid="coord-memory-frontmatter"
              contentClassName="space-y-2 text-xs"
            >
              {memory.description && (
                <div>
                  <p className="text-muted-foreground">description</p>
                  <p>{memory.description}</p>
                </div>
              )}
              <div>
                <p className="text-muted-foreground">type</p>
                <p>{memory.type ?? "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">written_by_agent</p>
                <p className="font-mono break-all">
                  {memory.written_by_agent ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">written_by_device</p>
                <p className="font-mono break-all">
                  {memory.written_by_device ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">written_at</p>
                {/* R2 — never a raw ISO string on a surface. Relative in the
                    line, absolute in the title. */}
                <p title={absoluteTime(memory.written_at)}>
                  {memory.written_at ? relativeTime(memory.written_at) : "—"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">version</p>
                <p className="tabular-nums">{memory.version ?? "—"}</p>
              </div>
            </CollapsiblePanel>

            {/* R7 — same treatment, same reason it opens by default:
                `admin.spec.ts:699-702` asserts both this panel and the select
                inside it are visible with no click. */}
            <CollapsiblePanel
              titleAs="h2"
              className="p-3"
              defaultOpen
              storageKey="coord-memory-history"
              icon={<HistoryIcon className="h-3.5 w-3.5" />}
              title="Version history"
              summary={
                <Badge
                  variant="outline"
                  className="font-mono text-[11px]"
                  title={
                    historyTruncated
                      ? `${headVersion} versions exist; coord returns and this picker lists the ${top10.length} most recent.`
                      : undefined
                  }
                >
                  {historyTruncated
                    ? `${top10.length}/${headVersion}`
                    : history.length}
                </Badge>
              }
              data-testid="coord-memory-history"
            >
              {top10.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  No prior versions.
                </p>
              ) : (
                <>
                  <Select onValueChange={onJumpToVersion}>
                    <SelectTrigger
                      className="w-full"
                      data-testid="coord-memory-version-select"
                    >
                      <SelectValue placeholder="Jump to version..." />
                    </SelectTrigger>
                    <SelectContent>
                      {top10.map((v) => (
                        <SelectItem
                          key={v.version}
                          value={String(v.version)}
                          data-testid={`coord-memory-version-option-${v.version}`}
                        >
                          v{v.version}
                          {v.written_at
                            ? ` — ${relativeTime(v.written_at)}`
                            : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* The badge printed `history.length` while the picker
                      offered ten — but coord caps the array at ten too, so a
                      memory with 42 versions advertised TEN and silently hid
                      32, with the operator's only cue being failing to find a
                      version. Same disclosure discipline `/plans` uses for its
                      capped fetch window. */}
                  {historyTruncated && (
                    <p
                      className="mt-1.5 text-[11px] text-muted-foreground"
                      data-testid="coord-memory-history-truncated"
                    >
                      Showing the {top10.length} most recent of {headVersion}
                      {" "}versions. Older ones are reachable by URL:
                      {" "}
                      <span className="font-mono">
                        /admin/coord/memory/{name}/version/&lt;n&gt;
                      </span>
                      .
                    </p>
                  )}
                </>
              )}
            </CollapsiblePanel>
          </aside>
        </div>
      ) : error !== null && !notFound ? (
        // R6 — "not found" is a claim about the corpus. A memory that reads as
        // absent is the one an operator concludes was never written, which is
        // exactly the wrong conclusion to draw from an unreachable coord — and
        // exactly the right one to draw from coord's own 404.
        <p
          className="text-sm text-muted-foreground italic"
          data-testid="coord-memory-detail-unknown"
        >
          Could not read memory {name} — whether it exists is unknown, not no.
        </p>
      ) : (
        <p
          className="text-sm text-muted-foreground italic"
          data-testid="coord-memory-detail-missing"
        >
          Memory {name} not found.
        </p>
      )}
    </div>
  );
}
