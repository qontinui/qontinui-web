"use client";

/**
 * /admin/coord/plans/[slug] — single plan view.
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 2 (Wave 2).
 *
 * Renders:
 *   - Plan metadata (slug / status / current_phase / shipped_at)
 *   - Markdown body
 *   - Status history timeline from `plan_status_history`
 *   - Transition button — POST /api/v1/operations/plans/{slug}/transition
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, FileText, GitCommit, History } from "lucide-react";
import { httpClient } from "@/services/service-factory";
import { useCoordIdentity } from "@/components/admin/coord/use-coord-identity";
import { canAdminCoord } from "@/lib/coord-permissions";

const API = "/api/v1/operations";

const TRANSITION_TARGETS = [
  "drafted",
  "vetted",
  "in_progress",
  "blocked",
  "shipped",
  "archived",
];

interface CoordPlanDetail {
  slug: string;
  title?: string;
  status?: string;
  current_phase?: string | null;
  content?: string;
  updated_at?: string | null;
  shipped_at?: string | null;
}

interface PlanHistoryEntry {
  status: string;
  transitioned_at: string;
  actor?: string | null;
  note?: string | null;
}

interface PlanHistoryResponse {
  slug?: string;
  history?: PlanHistoryEntry[];
}

export default function CoordPlanDetailPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  // Plan status transition is an ADMIN-only operator action (coord#598 matrix:
  // `POST /plans/:slug/transition` is wrapped by the operator-admin require_role
  // gate), so the transition card is hidden for non-admin members.
  const canTransition = canAdminCoord(useCoordIdentity());
  const slug = useMemo(() => {
    const raw = params?.slug;
    if (!raw) return "";
    return Array.isArray(raw) ? raw[0] : raw;
  }, [params]);

  const [plan, setPlan] = useState<CoordPlanDetail | null>(null);
  const [history, setHistory] = useState<PlanHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newStatus, setNewStatus] = useState("in_progress");
  const [note, setNote] = useState("");
  const [transitioning, setTransitioning] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!slug) return;
    try {
      const planBody = await httpClient.get<CoordPlanDetail>(
        `${API}/plans/${encodeURIComponent(slug)}`
      );
      setPlan(planBody);
      // History is best-effort — don't fail the whole page if it errors.
      try {
        const historyBody = await httpClient.get<PlanHistoryResponse>(
          `${API}/plans/${encodeURIComponent(slug)}/history`
        );
        setHistory(historyBody.history ?? []);
      } catch {
        // ignore — history is supplementary
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    setLoading(true);
    fetchAll();
  }, [fetchAll]);

  const onTransition = useCallback(async () => {
    if (!slug || !newStatus) return;
    setTransitioning(true);
    try {
      await httpClient.post(
        `${API}/plans/${encodeURIComponent(slug)}/transition`,
        {
          status: newStatus,
          note: note || undefined,
        }
      );
      toast.success(`Plan transitioned to ${newStatus}`);
      setNote("");
      await fetchAll();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Failed to transition plan"
      );
    } finally {
      setTransitioning(false);
    }
  }, [slug, newStatus, note, fetchAll]);

  return (
    <div
      className="p-3 sm:p-6 space-y-4 max-w-5xl mx-auto"
      data-testid="coord-plan-detail-page"
    >
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/admin/coord/plans")}
          data-testid="coord-plan-back-btn"
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1" />
          Plans
        </Button>
        <span className="text-muted-foreground">/</span>
        <span className="font-mono text-sm">{slug}</span>
      </div>

      {error && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-destructive">Failed to load: {error}</p>
          </CardContent>
        </Card>
      )}

      {loading && !plan ? (
        <Skeleton className="h-32 w-full" />
      ) : plan ? (
        <>
          <Card data-testid="coord-plan-meta">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                {plan.title || plan.slug}
                {plan.status && (
                  <Badge variant="outline" className="ml-2">
                    {plan.status}
                  </Badge>
                )}
                {plan.current_phase && (
                  <Badge variant="secondary">
                    phase: {plan.current_phase}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
          </Card>

          {canTransition && (
          <Card data-testid="coord-plan-transition">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <GitCommit className="h-4 w-4" />
                Transition status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">
                    new status
                  </label>
                  <Select value={newStatus} onValueChange={setNewStatus}>
                    <SelectTrigger
                      className="w-[180px]"
                      data-testid="coord-plan-new-status"
                    >
                      <SelectValue placeholder="status" />
                    </SelectTrigger>
                    <SelectContent>
                      {TRANSITION_TARGETS.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
                  <label className="text-xs text-muted-foreground">
                    note (optional)
                  </label>
                  <Input
                    placeholder="note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    data-testid="coord-plan-transition-note"
                  />
                </div>
                <Button
                  onClick={onTransition}
                  disabled={transitioning || !newStatus}
                  data-testid="coord-plan-transition-submit"
                >
                  {transitioning ? "Transitioning..." : "Apply"}
                </Button>
              </div>
            </CardContent>
          </Card>
          )}

          <Card data-testid="coord-plan-history">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="h-4 w-4" />
                Status history
                <Badge variant="outline" className="ml-2">
                  {history.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  No status history yet.
                </p>
              ) : (
                <ul className="space-y-1">
                  {history.map((h, i) => (
                    <li
                      key={i}
                      data-testid="coord-plan-history-row"
                      className="flex items-center gap-2 text-sm"
                    >
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {h.transitioned_at}
                      </span>
                      <Badge variant="outline">{h.status}</Badge>
                      {h.actor && (
                        <span className="text-xs text-muted-foreground">
                          by {h.actor}
                        </span>
                      )}
                      {h.note && (
                        <span className="text-xs text-muted-foreground italic">
                          “{h.note}”
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {plan.content && (
            <Card data-testid="coord-plan-content">
              <CardHeader>
                <CardTitle className="text-base">Plan body</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {plan.content}
                  </ReactMarkdown>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground italic">
          Plan {slug} not found.
        </p>
      )}
    </div>
  );
}
