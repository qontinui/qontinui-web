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
import { httpClient } from "@/services/service-factory";
import { useCoordIdentity } from "@/components/admin/coord/use-coord-identity";
import { isCoordMember } from "@/lib/coord-permissions";

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
  // Coord gates memory upsert/delete on tenant membership only (no role tier),
  // so any coord member may edit/delete.
  const canEdit = isCoordMember(useCoordIdentity());
  const name = useMemo(() => {
    const raw = params?.name;
    if (!raw) return "";
    return Array.isArray(raw) ? raw[0] : raw;
  }, [params]);

  const [memory, setMemory] = useState<CoordMemoryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [name]);

  useEffect(() => {
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

  return (
    <div
      className="p-6 space-y-4 max-w-6xl mx-auto"
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
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-destructive">Failed to load: {error}</p>
          </CardContent>
        </Card>
      )}

      {loading && !memory ? (
        <Skeleton className="h-32 w-full" />
      ) : memory ? (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
          <div className="space-y-4 min-w-0">
            <Card data-testid="coord-memory-meta">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base flex-wrap">
                  <BookOpen className="h-4 w-4" />
                  <span className="font-mono truncate">{memory.name}</span>
                  {memory.type && (
                    <Badge variant="outline">{memory.type}</Badge>
                  )}
                  {memory.version !== null && memory.version !== undefined && (
                    <Badge variant="secondary">v{memory.version}</Badge>
                  )}
                  {memory.tombstoned && (
                    <Badge
                      variant="destructive"
                      data-testid="coord-memory-tombstoned-badge"
                    >
                      tombstoned
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2">
                {!canEdit ? (
                  <p
                    className="text-xs text-muted-foreground italic"
                    data-testid="coord-memory-readonly"
                  >
                    Read-only — editing and deleting memory require
                    coordination-layer access (a linked coord tenant
                    membership).
                  </p>
                ) : !editing ? (
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
                      <AlertDialogContent
                        data-testid="coord-memory-delete-dialog"
                      >
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
                          <AlertDialogCancel
                            data-testid="coord-memory-delete-cancel"
                          >
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
              </CardContent>
            </Card>

            <Card data-testid="coord-memory-content">
              <CardHeader>
                <CardTitle className="text-base">Content</CardTitle>
              </CardHeader>
              <CardContent>
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
              </CardContent>
            </Card>
          </div>

          <aside className="space-y-4">
            <Card data-testid="coord-memory-frontmatter">
              <CardHeader>
                <CardTitle className="text-sm">Frontmatter</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
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
                  <p className="tabular-nums">{memory.written_at ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">version</p>
                  <p className="tabular-nums">{memory.version ?? "—"}</p>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="coord-memory-history">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <HistoryIcon className="h-3.5 w-3.5" />
                  Version history
                  <Badge variant="outline" className="ml-auto">
                    {history.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {top10.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">
                    No prior versions.
                  </p>
                ) : (
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
                          {v.written_at ? ` — ${v.written_at}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground italic">
          Memory {name} not found.
        </p>
      )}
    </div>
  );
}
