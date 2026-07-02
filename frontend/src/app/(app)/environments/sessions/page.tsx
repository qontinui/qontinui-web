"use client";

/**
 * /environments/sessions — the digital-twin Sessions surface (P4 of plan
 * `2026-07-02-digital-twin-session-identity-registry`).
 *
 * Sibling of /environments/machines: lists coord agent sessions by NAME
 * (label ?? derived_name — never a bare UUID as the primary identifier)
 * with topic search (`q=`), a status filter (live/stale/closed), and a
 * `?device=<coord_device_id>` deep link from the machines page. Row click
 * navigates to /environments/sessions/[key] (the resolver-backed detail
 * card). Data comes from `GET /api/v1/admin/agent-sessions` via
 * `services/agent-sessions-api.ts`.
 */

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  Boxes,
  Loader2,
  RefreshCw,
  Search,
  Server,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { relativeTime } from "@/components/operations/utils";
import {
  listAgentSessions,
  type AgentSessionRow,
  type AgentSessionStatus,
} from "@/services/agent-sessions-api";

const SEARCH_DEBOUNCE_MS = 300;
const LIST_LIMIT = 200;

type StatusFilter = "all" | AgentSessionStatus;

const STATUS_FILTERS: StatusFilter[] = ["all", "live", "stale", "closed"];

function shortId(id?: string | null): string {
  if (!id) return "—";
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

/** Row status: coord-supplied when present, else derived from closed_at. */
function rowStatus(s: AgentSessionRow): string {
  if (s.status) return s.status;
  return s.closed_at ? "closed" : "live";
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "live":
      return <Badge variant="success">live</Badge>;
    case "stale":
      return <Badge variant="warning">stale</Badge>;
    case "closed":
      return <Badge variant="secondary">closed</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function SessionsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialDeviceId = searchParams?.get("device") ?? "";

  const [sessions, setSessions] = useState<AgentSessionRow[]>([]);
  const [searchDegraded, setSearchDegraded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [deviceId, setDeviceId] = useState(initialDeviceId);

  // Debounce the search box → `q=` (topic search).
  useEffect(() => {
    const t = setTimeout(
      () => setDebouncedQuery(query.trim()),
      SEARCH_DEBOUNCE_MS
    );
    return () => clearTimeout(t);
  }, [query]);

  // Guard against out-of-order responses while typing.
  const fetchSeq = useRef(0);

  const fetchSessions = useCallback(async () => {
    const seq = ++fetchSeq.current;
    try {
      const data = await listAgentSessions({
        q: debouncedQuery || undefined,
        status: status === "all" ? undefined : status,
        device_id: deviceId || undefined,
        limit: LIST_LIMIT,
      });
      if (seq !== fetchSeq.current) return;
      setSessions(data.sessions);
      setSearchDegraded(Boolean(data.search_degraded));
      setLoadError(null);
    } catch (err) {
      if (seq !== fetchSeq.current) return;
      setLoadError(
        err instanceof Error ? err.message : "Failed to load sessions"
      );
    } finally {
      if (seq === fetchSeq.current) setLoading(false);
    }
  }, [debouncedQuery, status, deviceId]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  return (
    <div className="p-6 space-y-6" data-testid="twin-sessions-page">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Activity className="size-5" />
            Sessions
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Agent sessions across your machines — search by topic, drill into
            what each session is working on
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/environments">
              <Boxes className="size-4" />
              Environments
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/environments/machines">
              <Server className="size-4" />
              Machines
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setLoading(true);
              fetchSessions();
            }}
            className="text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </div>

      {/* Search + filters */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative max-w-sm flex-1 min-w-[16rem]">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search sessions by topic…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="bg-background border-border pl-8 text-sm"
              data-testid="twin-sessions-search"
            />
          </div>
          <div className="flex items-center gap-1">
            {STATUS_FILTERS.map((f) => (
              <Button
                key={f}
                variant={status === f ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setStatus(f)}
                data-testid={`twin-sessions-status-${f}`}
              >
                {f}
              </Button>
            ))}
          </div>
          {deviceId && (
            <Badge variant="outline" className="gap-1 font-mono">
              device {shortId(deviceId)}
              <button
                type="button"
                aria-label="Clear device filter"
                onClick={() => setDeviceId("")}
                className="ml-1 hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </Badge>
          )}
        </div>
        {searchDegraded && (
          <p className="text-xs text-muted-foreground">
            Topic search index not deployed yet — matching on names only for
            now.
          </p>
        )}
      </div>

      {/* Sessions table */}
      <div className="rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border bg-muted/50">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Activity className="size-4" />
              Agent Sessions
            </h3>
            {sessions.length > 0 && (
              <Badge variant="secondary">{sessions.length}</Badge>
            )}
          </div>
        </div>
        <div className="p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
            </div>
          ) : loadError && sessions.length === 0 ? (
            <div className="text-center py-12">
              <AlertTriangle className="size-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Couldn&apos;t load sessions.
              </p>
              <p className="text-xs text-muted-foreground mt-1">{loadError}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => {
                  setLoading(true);
                  fetchSessions();
                }}
              >
                <RefreshCw className="size-4" />
                Retry
              </Button>
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-12">
              <Activity className="size-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No sessions match the current filters.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>name</TableHead>
                  <TableHead>machine / env</TableHead>
                  <TableHead>working on</TableHead>
                  <TableHead className="w-[90px]">status</TableHead>
                  <TableHead className="w-[120px]">last seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((s) => (
                  <TableRow
                    key={s.id}
                    data-testid="twin-sessions-row"
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() =>
                      router.push(
                        `/environments/sessions/${encodeURIComponent(s.id)}`
                      )
                    }
                  >
                    <TableCell>
                      {s.name ? (
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            {s.name}
                          </p>
                          <p
                            className="font-mono text-[10px] text-muted-foreground"
                            title={s.id}
                          >
                            {shortId(s.id)}
                          </p>
                        </div>
                      ) : (
                        <span className="font-mono text-xs" title={s.id}>
                          {shortId(s.id)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {/* List rows carry only the coord device id; the bound
                          machine/environment render on the detail card. */}
                      {shortId(s.device_id)}
                    </TableCell>
                    <TableCell className="text-xs max-w-[24rem]">
                      {s.summary ? (
                        <span className="line-clamp-2">{s.summary}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={rowStatus(s)} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {relativeTime(s.last_seen)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SessionsPage() {
  // useSearchParams (the ?device= deep link) needs a Suspense boundary for
  // Next.js static prerendering of this client page.
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <SessionsPageInner />
    </Suspense>
  );
}
