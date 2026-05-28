"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { Input } from "@/components/ui/input";
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
  GitBranch,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { OPERATIONS_API, relativeTime } from "@/components/operations/utils";

interface CanonicalRepo {
  repo: string;
  mirror_state?: string | null;
  last_reconciled_at?: string | null;
  created_at?: string | null;
}

interface ReposResponse {
  repos: CanonicalRepo[];
}

const FETCH_OPTS: RequestInit = {
  credentials: "include",
  cache: "no-store",
};

function mirrorBadgeVariant(state: string | null | undefined) {
  switch (state) {
    case "synced":
      return "success" as const;
    case "drifting":
      return "warning" as const;
    case "error":
      return "destructive" as const;
    default:
      return "secondary" as const;
  }
}

function mirrorLabel(state: string | null | undefined) {
  if (!state) return "unknown";
  return state;
}

function isValidRepoSlug(slug: string): boolean {
  const parts = slug.split("/");
  if (parts.length !== 2) return false;
  const [owner, name] = parts;
  return (owner ?? "").length > 0 && (name ?? "").length > 0;
}

export default function ReposSettingsPage() {
  const [repos, setRepos] = useState<CanonicalRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [slug, setSlug] = useState("");
  const [adding, setAdding] = useState(false);

  const fetchRepos = useCallback(async () => {
    try {
      const res = await fetch(`${OPERATIONS_API}/repos`, FETCH_OPTS);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = (await res.json()) as ReposResponse;
      setRepos(data.repos ?? []);
    } catch {
      toast.error("Failed to load repositories");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRepos();
  }, [fetchRepos]);

  const handleAdd = async () => {
    const trimmed = slug.trim();
    if (!isValidRepoSlug(trimmed)) {
      toast.error("Invalid format -- use owner/name");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch(`${OPERATIONS_API}/repos`, {
        ...FETCH_OPTS,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: trimmed }),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(detail || `${res.status}`);
      }
      toast.success(`Registered ${trimmed}`);
      setSlug("");
      await fetchRepos();
    } catch (err) {
      toast.error(
        `Failed to register repository: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (repo: string) => {
    try {
      const res = await fetch(
        `${OPERATIONS_API}/repos?repo=${encodeURIComponent(repo)}`,
        { ...FETCH_OPTS, method: "DELETE" }
      );
      if (!res.ok) throw new Error(`${res.status}`);
      toast.success(`Removed ${repo}`);
      await fetchRepos();
    } catch {
      toast.error(`Failed to remove ${repo}`);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <GitBranch className="size-5" />
            Repositories
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Manage coordinated repositories
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setLoading(true);
            fetchRepos();
          }}
          className="text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="size-4" />
        </Button>
      </div>

      {/* Add repo form */}
      <div className="rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border bg-muted/50">
          <h3 className="text-sm font-medium">Add Repository</h3>
          <p className="text-xs text-muted-foreground">
            Register a GitHub repository for coordination
          </p>
        </div>
        <div className="p-4">
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              handleAdd();
            }}
          >
            <Input
              type="text"
              placeholder="owner/name"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="bg-background border-border max-w-sm font-mono text-sm"
            />
            <Button
              type="submit"
              variant="brand-primary"
              size="sm"
              disabled={adding || !slug.trim()}
            >
              {adding ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Add Repository
            </Button>
          </form>
        </div>
      </div>

      {/* Repo list */}
      <div className="rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border bg-muted/50">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium flex items-center gap-2">
                <GitBranch className="size-4" />
                Registered Repositories
              </h3>
              <p className="text-xs text-muted-foreground">
                Repositories tracked by the coordinator
              </p>
            </div>
            {repos.length > 0 && (
              <Badge variant="secondary">{repos.length}</Badge>
            )}
          </div>
        </div>
        <div className="p-4">
          {repos.length === 0 ? (
            <div className="text-center py-12">
              <GitBranch className="size-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No repositories registered yet. Add one above to get started.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {repos.map((repo) => (
                <div
                  key={repo.repo}
                  className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <GitBranch className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium font-mono truncate">
                        {repo.repo}
                      </p>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                        {repo.last_reconciled_at && (
                          <span>
                            Reconciled {relativeTime(repo.last_reconciled_at)}
                          </span>
                        )}
                        {repo.created_at && (
                          <span>
                            Added{" "}
                            {new Date(repo.created_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={mirrorBadgeVariant(repo.mirror_state)}>
                      {mirrorLabel(repo.mirror_state)}
                    </Badge>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <Trash2 className="size-4 text-muted-foreground" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Remove repository?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            This will deregister{" "}
                            <span className="font-mono font-medium">
                              {repo.repo}
                            </span>{" "}
                            from coordination. You can re-add it later.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction asChild>
                            <DestructiveButton
                              onClick={() => handleDelete(repo.repo)}
                            >
                              Remove
                            </DestructiveButton>
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
