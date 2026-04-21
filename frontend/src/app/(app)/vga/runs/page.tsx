"use client";

/**
 * /vga/runs — paginated index of VGA runs.
 *
 * Columns: run id (linked to /vga/runs/[runId]), state machine name,
 * target process, status, started at, duration. Filters: status,
 * target_process (free-text), date range. Pagination: 50 rows/page.
 *
 * Filter state is mirrored into the URL via `URLSearchParams` so a
 * page reload preserves the view.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { VgaRunListItem } from "@/app/api/vga/runs/route";

const PAGE_SIZE = 50;
const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "drifted", label: "Drifted" },
];

function formatDuration(start: string, end: string | null): string {
  if (!end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function statusTone(status: string): {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
} {
  switch (status) {
    case "succeeded":
    case "success":
      return { label: "Succeeded", variant: "secondary" };
    case "failed":
      return { label: "Failed", variant: "destructive" };
    case "drifted":
      return { label: "Drifted", variant: "outline" };
    case "running":
      return { label: "Running", variant: "default" };
    default:
      return { label: status, variant: "outline" };
  }
}

interface RunsListResponse {
  runs: VgaRunListItem[];
  total: number;
}

async function fetchRuns(params: URLSearchParams): Promise<RunsListResponse> {
  const resp = await fetch(`/api/vga/runs?${params.toString()}`, {
    cache: "no-store",
  });
  if (!resp.ok) {
    let detail = "";
    try {
      const body = (await resp.json()) as { error?: string; detail?: string };
      detail = body.error ?? body.detail ?? "";
    } catch {
      detail = await resp.text().catch(() => "");
    }
    throw new Error(
      `${resp.status} ${resp.statusText}${detail ? `: ${detail}` : ""}`
    );
  }
  return (await resp.json()) as RunsListResponse;
}

export default function VgaRunsIndexPage() {
  const router = useRouter();
  const sp = useSearchParams();

  // URL-backed filter state (seed from current URL once per navigation).
  const [status, setStatus] = useState<string>(sp.get("status") ?? "all");
  const [targetProcess, setTargetProcess] = useState<string>(
    sp.get("target_process") ?? ""
  );
  const [since, setSince] = useState<string>(sp.get("since") ?? "");
  const [until, setUntil] = useState<string>(sp.get("until") ?? "");
  const [page, setPage] = useState<number>(() => {
    const raw = Number.parseInt(sp.get("page") ?? "1", 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 1;
  });

  // Sync state → URL query string.
  useEffect(() => {
    const next = new URLSearchParams();
    if (status !== "all") next.set("status", status);
    if (targetProcess.trim()) next.set("target_process", targetProcess.trim());
    if (since) next.set("since", since);
    if (until) next.set("until", until);
    if (page > 1) next.set("page", String(page));
    const nextStr = next.toString();
    const currentStr = sp.toString();
    if (nextStr !== currentStr) {
      router.replace(`/vga/runs${nextStr ? `?${nextStr}` : ""}`, {
        scroll: false,
      });
    }
  }, [status, targetProcess, since, until, page, router, sp]);

  // Query string for the API call.
  const apiParams = useMemo(() => {
    const p = new URLSearchParams();
    if (status !== "all") p.set("status", status);
    if (targetProcess.trim()) p.set("target_process", targetProcess.trim());
    if (since) {
      // Treat bare YYYY-MM-DD as start-of-day UTC.
      p.set(
        "since",
        since.length === 10
          ? new Date(`${since}T00:00:00Z`).toISOString()
          : since
      );
    }
    if (until) {
      p.set(
        "until",
        until.length === 10
          ? new Date(`${until}T23:59:59Z`).toISOString()
          : until
      );
    }
    p.set("limit", String(PAGE_SIZE));
    p.set("offset", String((page - 1) * PAGE_SIZE));
    return p;
  }, [status, targetProcess, since, until, page]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["vga", "runs", apiParams.toString()],
    queryFn: () => fetchRuns(apiParams),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });

  const resetToFirstPage = useCallback(() => setPage(1), []);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const startIndex = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endIndex = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/vga" aria-label="Back to VGA landing">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <h1 className="text-lg font-semibold text-foreground">VGA runs</h1>
          <Badge variant="outline">{total} total</Badge>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Filters</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label
                htmlFor="filter-status"
                className="text-xs text-muted-foreground"
              >
                Status
              </label>
              <Select
                value={status}
                onValueChange={(v) => {
                  setStatus(v);
                  resetToFirstPage();
                }}
              >
                <SelectTrigger id="filter-status" className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <label
                htmlFor="filter-target"
                className="text-xs text-muted-foreground"
              >
                Target process
              </label>
              <Input
                id="filter-target"
                value={targetProcess}
                onChange={(e) => setTargetProcess(e.target.value)}
                onBlur={resetToFirstPage}
                onKeyDown={(e) => {
                  if (e.key === "Enter") resetToFirstPage();
                }}
                placeholder="notepad++.exe"
                className="w-[220px]"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label
                htmlFor="filter-since"
                className="text-xs text-muted-foreground"
              >
                Since
              </label>
              <Input
                id="filter-since"
                type="date"
                value={since}
                onChange={(e) => {
                  setSince(e.target.value);
                  resetToFirstPage();
                }}
                className="w-[170px]"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label
                htmlFor="filter-until"
                className="text-xs text-muted-foreground"
              >
                Until
              </label>
              <Input
                id="filter-until"
                type="date"
                value={until}
                onChange={(e) => {
                  setUntil(e.target.value);
                  resetToFirstPage();
                }}
                className="w-[170px]"
              />
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setStatus("all");
                setTargetProcess("");
                setSince("");
                setUntil("");
                resetToFirstPage();
              }}
            >
              Reset
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="text-sm text-red-500">
                Failed to load runs: {(error as Error).message}
              </div>
            ) : (data?.runs.length ?? 0) === 0 ? (
              <div className="text-sm text-muted-foreground py-10 text-center">
                No runs match these filters.
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[140px]">Run</TableHead>
                      <TableHead>State machine</TableHead>
                      <TableHead>Target process</TableHead>
                      <TableHead className="w-[120px]">Status</TableHead>
                      <TableHead className="w-[180px]">Started</TableHead>
                      <TableHead className="w-[100px]">Duration</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.runs ?? []).map((run) => {
                      const tone = statusTone(run.status);
                      return (
                        <TableRow key={run.id}>
                          <TableCell className="font-mono text-xs">
                            <Link
                              href={`/vga/runs/${run.id}`}
                              className="underline hover:text-primary"
                            >
                              {run.id.slice(0, 8)}
                            </Link>
                          </TableCell>
                          <TableCell className="truncate max-w-[260px]">
                            {run.stateMachineName ?? (
                              <span className="text-muted-foreground font-mono text-xs">
                                {run.stateMachineId.slice(0, 8)}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="truncate max-w-[220px]">
                            {run.targetProcess ?? (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant={tone.variant}>{tone.label}</Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(run.startedAt).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatDuration(run.startedAt, run.endedAt)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>

                <div className="flex items-center justify-between pt-4">
                  <div className="text-xs text-muted-foreground">
                    {total === 0
                      ? "0 runs"
                      : `${startIndex}–${endIndex} of ${total}`}
                    {isFetching && !isLoading ? (
                      <span className="ml-2 italic">updating…</span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1 || isLoading}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="size-4" />
                      Prev
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Page {page} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages || isLoading}
                      onClick={() =>
                        setPage((p) => Math.min(totalPages, p + 1))
                      }
                      aria-label="Next page"
                    >
                      Next
                      <ChevronRight className="size-4" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
