"use client";

/**
 * The Add view — one URL or a pasted list; per submission: scope, notes.
 *
 * The tier is NOT a field. The worker's `precheck` derives it and writes it
 * onto the job; this view shows the derived tier and its reason as soon as it
 * exists (the page's poll hands the job rows in), and says "not derived yet"
 * until then.
 */

import { useMemo, useState, type FormEvent } from "react";
import {
  BackendErrorMessage,
  RecordList,
  RecordRow,
  StatusBadge,
} from "@/components/console";
import { Button } from "@/components/ui/button";
import type {
  CaptureJob,
  CaptureJobBatchCreate,
  CaptureJobBatchResult,
  CaptureJobBrowser,
} from "@/lib/api/design-refs";
import { createCaptureJobs } from "@/lib/api/design-refs";
import {
  JOB_PALETTE,
  jobStatus,
  parseUrlList,
  tierReading,
} from "../_lib/jobStatus";

type Scope = "page" | "crawl" | "flow";

export interface AddViewProps {
  /** Every job the page's poll holds — submitted ids are looked up here. */
  jobs: readonly CaptureJob[];
  /** Called with the new jobs so the page re-reads the queue at once. */
  onSubmitted: (created: CaptureJob[]) => void;
}

export function AddView({ jobs, onSubmitted }: AddViewProps) {
  const [text, setText] = useState("");
  const [scope, setScope] = useState<Scope>("page");
  const [depth, setDepth] = useState(1);
  const [goal, setGoal] = useState("");
  const [notes, setNotes] = useState("");
  const [browser, setBrowser] = useState<CaptureJobBrowser>("launched");
  const [reproduction, setReproduction] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<CaptureJobBatchResult | null>(null);

  const urls = useMemo(() => parseUrlList(text), [text]);
  const needsGoal = scope === "flow" && goal.trim() === "";
  const canSubmit = urls.length > 0 && !needsGoal && !busy;

  // The submitted jobs, kept current from the page's poll so the derived tier
  // appears here without a second request.
  const submitted = useMemo(() => {
    if (!result) return [];
    const byId = new Map(jobs.map((j) => [j.id, j]));
    return result.created.map((j) => byId.get(j.id) ?? j);
  }, [result, jobs]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const body: CaptureJobBatchCreate = {
      urls,
      scope_kind: scope,
      crawl_depth: scope === "crawl" ? depth : null,
      flow_goal: scope === "flow" ? goal.trim() : null,
      notes: notes.trim() === "" ? null : notes.trim(),
      source: "operator",
      is_reproduction: reproduction,
      browser,
    };
    try {
      const out = await createCaptureJobs(body);
      setResult(out);
      if (out.created.length > 0) {
        setText("");
        onSubmitted(out.created);
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="space-y-4"
      data-testid="design-refs-add"
      data-ui-bridge-id="design-refs-add"
    >
      <form
        onSubmit={onSubmit}
        className="space-y-3 max-w-3xl"
        data-testid="design-refs-add-form"
      >
        <label className="block space-y-1">
          <span className="text-sm font-medium">URLs</span>
          <textarea
            className="input w-full font-mono text-xs min-h-[8rem]"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"https://example.com/pricing\nhttps://another.example"}
            data-testid="design-refs-add-urls"
            data-ui-bridge-id="design-refs-add-urls"
          />
          <span
            className="text-xs text-muted-foreground"
            data-testid="design-refs-add-count"
          >
            {urls.length === 0
              ? "One URL per line."
              : `${urls.length} URL${urls.length === 1 ? "" : "s"} — one job each.`}
          </span>
        </label>

        <div className="flex flex-wrap gap-3">
          <label className="space-y-1">
            <span className="block text-sm font-medium">Scope</span>
            <select
              className="input"
              value={scope}
              onChange={(e) => setScope(e.target.value as Scope)}
              data-testid="design-refs-add-scope"
              data-ui-bridge-id="design-refs-add-scope"
            >
              <option value="page">This page</option>
              <option value="crawl">Crawl from here</option>
              <option value="flow">A flow (describe the goal)</option>
            </select>
          </label>
          {scope === "crawl" && (
            <label className="space-y-1">
              <span className="block text-sm font-medium">Depth</span>
              <input
                type="number"
                min={1}
                max={10}
                className="input w-20"
                value={depth}
                onChange={(e) =>
                  setDepth(
                    Math.min(10, Math.max(1, Number(e.target.value) || 1))
                  )
                }
                data-testid="design-refs-add-depth"
              />
            </label>
          )}
          <label className="space-y-1">
            <span className="block text-sm font-medium">Browser</span>
            <select
              className="input"
              value={browser}
              onChange={(e) => setBrowser(e.target.value as CaptureJobBrowser)}
              data-testid="design-refs-add-browser"
              title="Attached uses your own Chrome, for sites a headless browser cannot get into."
            >
              <option value="launched">Launched by the worker</option>
              <option value="attached">Attached to my Chrome</option>
            </select>
          </label>
        </div>

        {scope === "flow" && (
          <label className="block space-y-1">
            <span className="text-sm font-medium">Flow goal</span>
            <input
              className="input w-full"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. sign up and reach the dashboard"
              data-testid="design-refs-add-goal"
            />
          </label>
        )}

        <label className="block space-y-1">
          <span className="text-sm font-medium">Notes</span>
          <input
            className="input w-full"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            data-testid="design-refs-add-notes"
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={reproduction}
            onChange={(e) => setReproduction(e.target.checked)}
            data-testid="design-refs-add-reproduction"
          />
          This is a reproduction of a real site (an internal benchmark; always
          private)
        </label>

        <p
          className="text-xs text-muted-foreground m-0"
          data-testid="design-refs-add-tier-note"
        >
          The tier is not chosen here. The worker reads each site&apos;s
          robots.txt and the page itself, and the tier and the reason appear on
          the job below.
        </p>

        <Button
          type="submit"
          disabled={!canSubmit}
          data-testid="design-refs-add-submit"
          data-ui-bridge-id="design-refs-add-submit"
        >
          {busy
            ? "Adding…"
            : urls.length > 1
              ? `Add ${urls.length} URLs`
              : "Add URL"}
        </Button>
        {needsGoal && (
          <p className="text-xs text-muted-foreground m-0">
            A flow needs a goal.
          </p>
        )}
      </form>

      {error !== null && (
        <div
          role="alert"
          className="text-sm text-red-300"
          data-testid="design-refs-add-error"
        >
          <BackendErrorMessage error={error} />
        </div>
      )}

      {result && result.refused.length > 0 && (
        <section className="space-y-1" data-testid="design-refs-add-refused">
          <h2 className="text-sm font-medium">Not added</h2>
          <ul className="text-sm space-y-1">
            {result.refused.map((r) => (
              <li key={r.url} data-testid="design-refs-add-refused-row">
                <span className="font-mono text-xs">{r.url}</span>
                <span className="text-muted-foreground"> — {r.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {result && (
        <section className="space-y-2" data-testid="design-refs-add-submitted">
          <h2 className="text-sm font-medium">Added ({submitted.length})</h2>
          <RecordList
            items={submitted}
            itemKey={(j) => j.id}
            loaded
            empty={
              <p className="text-sm text-muted-foreground italic">
                Nothing was added.
              </p>
            }
            renderRow={(job, ctx) => {
              const status = jobStatus(job);
              const tier = tierReading(job);
              return (
                <RecordRow
                  data-testid="design-refs-add-job"
                  expanded={ctx.expanded}
                  onToggle={ctx.onToggle}
                  attention={status.attention}
                  identity={
                    <span className="font-mono text-[11px]">{job.domain}</span>
                  }
                  label={<span title={job.url}>{job.url}</span>}
                  status={<StatusBadge status={status} palette={JOB_PALETTE} />}
                  reason={`tier: ${tier.label} — ${tier.reason}`}
                  reasonTestId="design-refs-add-job-tier"
                />
              );
            }}
          />
        </section>
      )}
    </div>
  );
}
