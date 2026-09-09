"use client";

/**
 * /admin/coord/memory/[name]/version/[version] — historical version view.
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 6 (Wave 3c).
 *
 * Read-only. The "Restore this version" button calls
 * `POST /api/v1/operations/memory/{name}/restore` which copies the
 * historical version into a fresh append (new head version) per Q3's
 * event-sourced shape.
 *
 * ## Console style (Phase 3 Wave 3)
 *
 * The ROUTE survives (D1 — a read-only workspace with its own destructive
 * action and its own deep link). What changed, per
 * `frontend/docs/console-ui-style-guide.md`:
 *
 * - **R9** — three `<Card><CardHeader><CardTitle>` wrappers are gone. Two of
 *   them cost ~72px of header each to say something the breadcrumb one line
 *   above already said, and the third wrapped a single button in a card. The
 *   body is `p-3 sm:p-6 space-y-4` (it was a flat `p-6`).
 * - **R3/R4** — the memory's type is now the SAME `<StatusBadge>` `/memory`
 *   and the detail route render (`deriveMemoryStatus`), with the matching
 *   accent, instead of a bare outline badge that painted an unrecognised type
 *   like a known one.
 * - **R2** — `written_at` was a raw ISO string; it renders through `<RowTime>`
 *   now.
 *
 * The restore button keeps its own container testid
 * (`coord-memory-version-restore`) so the frozen contract survives the card
 * being deleted. Every authored `data-testid` is carried across unchanged
 * (D4a).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
import { ArrowLeft, BookOpen, RotateCcw } from "lucide-react";
import {
  RowTime,
  StatusBadge,
  isNotFoundError,
  rowAccentProps,
} from "@/components/console";
import {
  MEMORY_STATUS_PALETTE,
  deriveMemoryStatus,
} from "@/components/admin/coord/memoryStatus";
import { httpClient } from "@/services/service-factory";
import { CoordAdminOnly } from "@/components/admin/coord/CoordAdminOnly";

const API = "/api/v1/operations";

interface CoordMemoryVersionDetail {
  name: string;
  version: number;
  content: string;
  description?: string | null;
  type?: string | null;
  written_at?: string | null;
  written_by_agent?: string | null;
  written_by_device?: string | null;
}

export default function CoordMemoryVersionPage() {
  const params = useParams<{ name: string; version: string }>();
  const router = useRouter();

  const name = useMemo(() => {
    const raw = params?.name;
    if (!raw) return "";
    return Array.isArray(raw) ? raw[0] : raw;
  }, [params]);
  const version = useMemo(() => {
    const raw = params?.version;
    if (!raw) return "";
    return Array.isArray(raw) ? raw[0] : raw;
  }, [params]);

  const [entry, setEntry] = useState<CoordMemoryVersionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** The read failed with coord's own 404 — "no version N of this memory".
   *  See `isNotFoundError` for why a status code is needed here at all. */
  const [notFound, setNotFound] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const fetchVersion = useCallback(async () => {
    if (!name || !version) return;
    try {
      const body = await httpClient.get<CoordMemoryVersionDetail>(
        `${API}/memory/${encodeURIComponent(name)}/version/${encodeURIComponent(version)}`
      );
      setEntry(body);
      setError(null);
      setNotFound(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setNotFound(isNotFoundError(e));
    } finally {
      setLoading(false);
    }
  }, [name, version]);

  useEffect(() => {
    // Drop the previous version's entry first: the catch never nulls `entry`,
    // so a 404 after a successful load would render v3's content under v4's
    // heading — the worst possible failure on a route whose entire job is
    // "what did this memory say at version N?". Both arms below sit behind
    // `entry === null`. This route does not poll.
    setEntry(null);
    setError(null);
    setNotFound(false);
    setLoading(true);
    fetchVersion();
  }, [fetchVersion]);

  const onRestore = useCallback(async () => {
    if (!name || !version) return;
    setRestoring(true);
    try {
      await httpClient.post(
        `${API}/memory/${encodeURIComponent(name)}/restore`,
        { version: Number(version) }
      );
      toast.success(`Restored v${version} as the new head version`);
      router.push(`/admin/coord/memory/${encodeURIComponent(name)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to restore version");
    } finally {
      setRestoring(false);
    }
  }, [name, version, router]);

  return (
    <div
      className="p-3 sm:p-6 space-y-4 max-w-5xl mx-auto"
      data-testid="coord-memory-version-page"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/admin/coord/memory")}
          data-testid="coord-memory-version-back-list"
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1" />
          Memory
        </Button>
        <span className="text-muted-foreground">/</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            router.push(`/admin/coord/memory/${encodeURIComponent(name)}`)
          }
          data-testid="coord-memory-version-back-detail"
        >
          <span className="font-mono">{name}</span>
        </Button>
        <span className="text-muted-foreground">/</span>
        <span className="font-mono text-sm">v{version}</span>
      </div>

      {error && (
        <p className="text-sm text-destructive">Failed to load: {error}</p>
      )}

      {loading && !entry ? (
        <Skeleton className="h-32 w-full" />
      ) : entry ? (
        <>
          {/* R9/R3/R4 — one strip, carrying the same status badge and accent
              the memory list and detail route render. */}
          <div
            data-testid="coord-memory-version-meta"
            {...rowAccentProps(
              deriveMemoryStatus(entry),
              "rounded-lg border border-border bg-card/30 px-4 py-3 space-y-2"
            )}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="font-mono text-sm truncate">{entry.name}</span>
              <Badge variant="secondary" className="font-mono text-[11px]">
                v{entry.version}
              </Badge>
              <StatusBadge
                status={deriveMemoryStatus(entry)}
                palette={MEMORY_STATUS_PALETTE}
              />
              <Badge variant="outline" className="text-[11px]">
                read-only
              </Badge>
              {entry.written_at && (
                <RowTime at={entry.written_at} verb="Written" />
              )}
            </div>
            {/* The version's own `description`. It is fetched by this route
                and was rendered by neither — so the one-line summary the
                `/memory/[name]` frontmatter panel shows disappeared one click
                deeper, on the page whose entire job is "what did this memory
                say at v{n}?". A version's description can differ from head's;
                showing head's would be worse than showing none. */}
            {entry.description && (
              <p
                data-testid="coord-memory-version-description"
                className="text-xs text-muted-foreground"
              >
                {entry.description}
              </p>
            )}
            {/* R8 — the raw provenance ids sit last, muted and mono. */}
            <div className="flex flex-wrap gap-x-3 font-mono text-[10px] text-muted-foreground/60 break-all">
              {entry.written_by_agent && (
                <span>agent {entry.written_by_agent}</span>
              )}
              {entry.written_by_device && (
                <span>device {entry.written_by_device}</span>
              )}
            </div>
          </div>

          <CoordAdminOnly>
            <div data-testid="coord-memory-version-restore">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    size="sm"
                    disabled={restoring}
                    data-testid="coord-memory-restore-btn"
                  >
                    <RotateCcw className="h-3.5 w-3.5 mr-1" />
                    {restoring ? "Restoring..." : "Restore this version"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent data-testid="coord-memory-restore-dialog">
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Restore v{entry.version} as the new head?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      Copies v{entry.version}&apos;s content into a fresh write.
                      The append-only history is preserved; existing newer
                      versions stay intact, just not the head.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel data-testid="coord-memory-restore-cancel">
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={onRestore}
                      data-testid="coord-memory-restore-confirm"
                    >
                      Restore
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CoordAdminOnly>

          <section
            data-testid="coord-memory-version-content"
            className="rounded-lg border border-border bg-card/30 px-4 py-3"
          >
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {entry.content}
              </ReactMarkdown>
            </div>
          </section>
        </>
      ) : error !== null && !notFound ? (
        // R6 — this route exists to answer "what did this memory say before?".
        // A read that never landed must not answer it with "that version never
        // existed". Coord's own 404 does answer exactly that, and keeps the
        // sentence below.
        <p
          className="text-sm text-muted-foreground italic"
          data-testid="coord-memory-version-unknown"
        >
          Could not read version {version} of memory {name} — whether it exists
          is unknown, not no.
        </p>
      ) : (
        <p
          className="text-sm text-muted-foreground italic"
          data-testid="coord-memory-version-missing"
        >
          Version {version} of memory {name} not found.
        </p>
      )}
    </div>
  );
}
