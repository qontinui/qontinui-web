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
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  const [restoring, setRestoring] = useState(false);

  const fetchVersion = useCallback(async () => {
    if (!name || !version) return;
    try {
      const body = await httpClient.get<CoordMemoryVersionDetail>(
        `${API}/memory/${encodeURIComponent(name)}/version/${encodeURIComponent(version)}`
      );
      setEntry(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [name, version]);

  useEffect(() => {
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
      toast.error(
        e instanceof Error ? e.message : "Failed to restore version"
      );
    } finally {
      setRestoring(false);
    }
  }, [name, version, router]);

  return (
    <div
      className="p-6 space-y-4 max-w-5xl mx-auto"
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
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-destructive">Failed to load: {error}</p>
          </CardContent>
        </Card>
      )}

      {loading && !entry ? (
        <Skeleton className="h-32 w-full" />
      ) : entry ? (
        <>
          <Card data-testid="coord-memory-version-meta">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base flex-wrap">
                <BookOpen className="h-4 w-4" />
                <span className="font-mono truncate">{entry.name}</span>
                <Badge variant="secondary">v{entry.version}</Badge>
                {entry.type && <Badge variant="outline">{entry.type}</Badge>}
                <Badge variant="outline">read-only</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              {entry.written_at && <span>written {entry.written_at}</span>}
              {entry.written_by_agent && (
                <span>by {entry.written_by_agent}</span>
              )}
              {entry.written_by_device && (
                <span>on {entry.written_by_device}</span>
              )}
            </CardContent>
          </Card>

          <CoordAdminOnly>
          <Card data-testid="coord-memory-version-restore">
            <CardContent className="p-4">
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
                <AlertDialogContent
                  data-testid="coord-memory-restore-dialog"
                >
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
                    <AlertDialogCancel
                      data-testid="coord-memory-restore-cancel"
                    >
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
            </CardContent>
          </Card>
          </CoordAdminOnly>

          <Card data-testid="coord-memory-version-content">
            <CardHeader>
              <CardTitle className="text-base">Content (read-only)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {entry.content}
                </ReactMarkdown>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <p className="text-sm text-muted-foreground italic">
          Version {version} of memory {name} not found.
        </p>
      )}
    </div>
  );
}
