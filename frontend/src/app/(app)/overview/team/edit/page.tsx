"use client";

/**
 * Project Overview — the estimate editor (tenant admins only).
 *
 * Deliberately thin. The plan's Phase 2 asks for three things and this does
 * exactly those: a mermaid-`gantt` import for the schedule, CSV paste for the
 * role and allocation tables, and one Save. There is no autosave, no
 * per-field write and no conflict-resolution scheme — the shared overview
 * authoring layer (plan `2026-09-20-overview-authoring-layer`) owns those,
 * and this editor is meant to be refitted onto it rather than to anticipate
 * it.
 *
 * The interaction model is the same three steps everywhere: paste, see what
 * was read, then decide. Nothing reaches the server until Save, and Save
 * carries the version the draft was loaded from, so a peer's save is refused
 * with a 409 rather than silently overwritten.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { LoadFailure } from "@/components/overview/LoadFailure";
import { formatMicros } from "@/components/overview/money";
import { NotAvailable } from "@/components/overview/UnavailableNotes";
import { estimateVocabulary } from "@/components/overview/vocabulary";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth-context";
import { useTenant } from "@/contexts/tenant-context";
import {
  parseAllocationsCsv,
  parseEffortsCsv,
  parseRolesCsv,
  sumPersonDays,
} from "../../_lib/csv";
import {
  createEstimate,
  fetchEstimate,
  fetchEstimates,
  pickBaseline,
  saveEstimateContent,
  type EstimateDetail,
  type EstimatePurposeOption,
} from "../../_lib/estimate-api";
import { ganttToPhases, parseMermaidGantt } from "../../_lib/gantt";
import { IssueList, PasteBox } from "./_components/PasteBox";
import {
  applyGanttImport,
  draftFromEstimate,
  draftProblems,
  draftToContent,
  type Draft,
} from "./_lib/draft";
import { statusAfterEdit, type Status } from "./_lib/status";

const TEAM_ROUTE = "/overview/team";

const PURPOSES: {
  value: EstimatePurposeOption;
  label: string;
  help: string;
}[] = [
  {
    value: "budget",
    label: "A budget",
    help: "Money this project is expected to spend. What it actually spends will be tracked against it.",
  },
  {
    value: "comparison",
    label: "A comparison",
    help: "What the work would cost delivered conventionally. A baseline to compare against, not money this project will spend.",
  },
  {
    value: "forecast",
    label: "A forecast",
    help: "A projection of the likely cost, with no commitment.",
  },
];

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-[family-name:var(--font-overview-serif)] text-[1.375rem] text-foreground">
      {children}
    </h2>
  );
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * `httpClient` throws `Error("PUT <url> failed: <status> - <body>")`, so the
 * status and the body have to come back out of the message. Anchoring on
 * `failed: <status>` is what makes that exact rather than a substring hunt:
 * `message.includes("409")` also matched a 500 whose body happened to
 * mention 409, and missed a real one whose wording changed.
 *
 * The same convention `describeFailure` in `components/overview/LoadFailure`
 * already reads.
 */
function failureStatus(message: string): number | null {
  const match = /failed:\s*(\d{3})\b/.exec(message);
  return match ? Number(match[1]) : null;
}

/** The version the server reports in a 409 body, when it says one. */
function conflictVersion(message: string): number | null {
  const body = message.slice(message.indexOf(" - ") + 3);
  try {
    const parsed = JSON.parse(body) as {
      detail?: { current_version?: unknown };
    };
    const version = parsed.detail?.current_version;
    return typeof version === "number" ? version : null;
  } catch {
    return null;
  }
}

function CreateEstimate({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("Estimate v0.1");
  const [purpose, setPurpose] = useState<EstimatePurposeOption>("budget");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <section
      className="max-w-[38rem]"
      data-ui-bridge-id="overview.estimate-editor.create"
    >
      <Heading>Set up this project&rsquo;s estimate</Heading>
      <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
        An estimate is the plan the project is measured against: its phases, the
        roles it needs and what they come to. What it MEANS is the first choice,
        because every figure is described in those terms afterwards.
      </p>

      <label
        htmlFor="estimate-name"
        className="mt-6 block text-sm font-medium text-foreground"
      >
        Name
      </label>
      <input
        id="estimate-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="mt-1 w-full max-w-sm rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-ui-bridge-id="overview.estimate-editor.create.name"
      />

      <fieldset className="mt-6">
        <legend className="text-sm font-medium text-foreground">
          What is it?
        </legend>
        <div className="mt-2 space-y-3">
          {PURPOSES.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer gap-3"
              data-ui-bridge-id={`overview.estimate-editor.create.purpose.${option.value}`}
            >
              <input
                type="radio"
                name="purpose"
                value={option.value}
                checked={purpose === option.value}
                onChange={() => setPurpose(option.value)}
                className="mt-1"
              />
              <span>
                <span className="block text-sm text-foreground">
                  {option.label}
                </span>
                <span className="block text-sm leading-relaxed text-muted-foreground">
                  {option.help}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {error && (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={busy || name.trim() === ""}
        onClick={() => {
          setBusy(true);
          setError(null);
          createEstimate({ name: name.trim(), purpose, is_baseline: true })
            .then(onCreated)
            .catch((err) => setError(errorText(err)))
            .finally(() => setBusy(false));
        }}
        className="mt-6 inline-flex min-h-9 items-center rounded-md bg-primary px-3.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-ui-bridge-id="overview.estimate-editor.create.submit"
      >
        {busy ? "Creating…" : "Create it"}
      </button>
    </section>
  );
}

function GanttImport({
  onImport,
  busy = false,
}: {
  onImport: (text: string) => void;
  /** A save is in flight — see `PasteBox`'s `busy`. */
  busy?: boolean;
}) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ReturnType<
    typeof parseMermaidGantt
  > | null>(null);

  const errors = preview?.issues.filter((i) => i.severity === "error") ?? [];

  return (
    <div
      className="rounded-md border border-border p-4"
      data-ui-bridge-id="overview.estimate-editor.gantt"
    >
      <label
        htmlFor="gantt-input"
        className="block text-sm font-medium text-foreground"
      >
        Import the schedule from a mermaid gantt chart
      </label>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        Paste the chart from the delivery plan. Each <code>section</code>{" "}
        becomes a phase and each bar becomes a task. Dates have to be written
        YYYY-MM-DD.
      </p>
      <textarea
        id="gantt-input"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPreview(null);
        }}
        rows={10}
        spellCheck={false}
        placeholder={
          "gantt\n    dateFormat YYYY-MM-DD\n    excludes weekends\n    section A0 Mobilisation\n    Kick-off :a0t1, 2026-01-05, 5d"
        }
        className="mt-3 w-full rounded-md border border-border bg-background p-2 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-ui-bridge-id="overview.estimate-editor.gantt.input"
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={text.trim() === ""}
          onClick={() => setPreview(parseMermaidGantt(text))}
          className="inline-flex min-h-9 items-center rounded-md border border-border px-3 text-sm text-foreground hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-ui-bridge-id="overview.estimate-editor.gantt.read"
        >
          Read it
        </button>
        {preview && preview.taskCount > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              onImport(text);
              setText("");
              setPreview(null);
            }}
            className="inline-flex min-h-9 items-center rounded-md bg-primary px-3 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-ui-bridge-id="overview.estimate-editor.gantt.apply"
          >
            Use this schedule
          </button>
        )}
        {preview && (
          <p
            role="status"
            className="text-sm text-muted-foreground"
            data-ui-bridge-id="overview.estimate-editor.gantt.summary"
          >
            {preview.taskCount === 0
              ? "No task could be read from that chart."
              : `Read ${preview.phases.length} phase${preview.phases.length === 1 ? "" : "s"} and ${preview.taskCount} task${preview.taskCount === 1 ? "" : "s"}.`}
            {errors.length > 0 &&
              ` ${errors.length} line${errors.length === 1 ? "" : "s"} could not be read.`}
            {preview.excludesWeekends &&
              " Durations were laid out over working days, as the chart excludes weekends."}
          </p>
        )}
      </div>
      {preview && (
        <IssueList
          issues={preview.issues}
          uiBridgeId="overview.estimate-editor.gantt.issues"
        />
      )}
      {preview && preview.taskCount > 0 && (
        <ul
          className="mt-4 space-y-2 text-sm"
          data-ui-bridge-id="overview.estimate-editor.gantt.preview"
        >
          {preview.phases.map((phase) => (
            <li key={phase.code}>
              <span className="font-mono text-xs text-muted-foreground">
                {phase.code}
              </span>{" "}
              <span className="text-foreground">{phase.name}</span>{" "}
              <span className="text-muted-foreground">
                {phase.plannedStart} &rarr; {phase.plannedEnd} &middot;{" "}
                {phase.tasks.length} task{phase.tasks.length === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EstimateEditor({
  detail,
  onSaved,
}: {
  detail: EstimateDetail;
  onSaved: (fresh: EstimateDetail) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFromEstimate(detail));
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const vocabulary = estimateVocabulary(detail.estimate.purpose);

  // A fresh load (after a save, or after a reload following a conflict)
  // replaces the working copy wholesale — there is no merge here on purpose.
  //
  // It must NOT clear the status: saving sets "saved" and then hands back
  // the fresh estimate, which lands here and used to wipe the confirmation
  // in the same tick, so a successful save looked exactly like one that
  // never happened.
  useEffect(() => {
    setDraft(draftFromEstimate(detail));
  }, [detail]);

  /**
   * Every change to the working copy goes through here, so that "Saved as
   * version N" cannot outlive the thing it describes.
   *
   * Leaving the banner up until the next save is the opposite error to
   * wiping it instantly, and the worse one: a reader who has just pasted
   * three new tables would be looking at a sentence claiming the Team page
   * shows them. It does not — they are unsaved.
   */
  const editDraft = (update: (current: Draft) => Draft) => {
    setDraft(update);
    setStatus(statusAfterEdit);
  };

  const problems = draftProblems(draft);
  const blocking = problems.filter((p) => p.severity === "error");

  const save = () => {
    setStatus({ kind: "saving" });
    saveEstimateContent(detail.estimate.id, draftToContent(draft)).then(
      (fresh) => {
        setStatus({ kind: "saved", version: fresh.estimate.version });
        onSaved(fresh);
      },
      (err) => {
        const message = errorText(err);
        if (failureStatus(message) === 409) {
          setStatus({
            kind: "conflict",
            currentVersion: conflictVersion(message),
          });
        } else {
          setStatus({ kind: "failed", message });
        }
      }
    );
  };

  return (
    <div className="space-y-12" data-ui-bridge-id="overview.estimate-editor">
      <section>
        <p className="text-sm text-muted-foreground">
          {detail.estimate.name} &middot; {vocabulary.noun}
        </p>
        <p className="mt-2 max-w-[46rem] text-[15px] leading-relaxed text-muted-foreground">
          Nothing on this page is saved until you press Save. Each import
          replaces the table it belongs to, so you can paste a corrected table
          over a wrong one.
        </p>
      </section>

      <section className="space-y-4">
        <Heading>Phases and tasks</Heading>
        <GanttImport
          busy={status.kind === "saving"}
          onImport={(text) => {
            const parsed = ganttToPhases(parseMermaidGantt(text));
            editDraft((d) => applyGanttImport(d, parsed));
          }}
        />
        <div
          className="rounded-md border border-border p-4"
          data-ui-bridge-id="overview.estimate-editor.phases"
        >
          <h3 className="text-sm font-medium text-foreground">
            In the working copy now
          </h3>
          {draft.phases.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No phases yet.</p>
          ) : (
            <ul className="mt-2 space-y-1.5 text-sm">
              {draft.phases.map((phase) => (
                <li
                  key={phase.code}
                  data-ui-bridge-id={`overview.estimate-editor.phases.${phase.code}`}
                >
                  <span className="font-mono text-xs text-muted-foreground">
                    {phase.code}
                  </span>{" "}
                  <span className="text-foreground">{phase.name}</span>{" "}
                  <span className="text-muted-foreground">
                    {phase.planned_start ?? "no start"} &rarr;{" "}
                    {phase.planned_end ?? "no end"} &middot;{" "}
                    {phase.tasks.length} task
                    {phase.tasks.length === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <Heading>Roles and rates</Heading>
        <PasteBox
          id="overview.estimate-editor.roles-paste"
          label="Paste the role table"
          help="One role per line: code, name, what they do, day rate, currency, and whether they are the client's own person. Only the code is required."
          placeholder={
            "code,name,responsibility,day_rate,currency,client_side\nDL,Delivery lead,Runs the delivery,900,EUR,no"
          }
          parse={parseRolesCsv}
          describe={(rows) =>
            `${rows.length} role${rows.length === 1 ? "" : "s"}`
          }
          onApply={(rows) => editDraft((d) => ({ ...d, roles: rows }))}
          busy={status.kind === "saving"}
        />
        <div
          className="overflow-x-auto rounded-md border border-border p-4"
          data-ui-bridge-id="overview.estimate-editor.roles"
        >
          <h3 className="text-sm font-medium text-foreground">
            In the working copy now
          </h3>
          {draft.roles.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No roles yet.</p>
          ) : (
            <table className="mt-2 w-full min-w-[30rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-1.5 pr-4 font-medium text-muted-foreground">
                    Code
                  </th>
                  <th className="py-1.5 pr-4 font-medium text-muted-foreground">
                    Role
                  </th>
                  <th className="py-1.5 pr-4 text-right font-medium text-muted-foreground">
                    Day rate
                  </th>
                  <th className="py-1.5 font-medium text-muted-foreground">
                    Whose
                  </th>
                </tr>
              </thead>
              <tbody>
                {draft.roles.map((role) => (
                  <tr key={role.code} className="border-b border-border/60">
                    <td className="py-1.5 pr-4 font-mono text-xs text-muted-foreground">
                      {role.code}
                    </td>
                    <td className="py-1.5 pr-4 text-foreground">{role.name}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums text-foreground">
                      {formatMicros(role.day_rate_micros, role.currency) ?? (
                        <NotAvailable label="not priced" />
                      )}
                    </td>
                    <td className="py-1.5 text-muted-foreground">
                      {role.client_side ? "Client’s" : "Ours"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <Heading>How much of each role, per phase</Heading>
        <PasteBox
          id="overview.estimate-editor.allocations-paste"
          label="Paste the allocation matrix"
          help="The first row names the phases; each row after it is a role. A blank cell means that role is not on that phase, which is not the same as none of them."
          placeholder={"role,A0,A1,A2\nDL,0.5,0.5,1\nBE,,2,2"}
          parse={parseAllocationsCsv}
          describe={(rows) =>
            `${rows.length} allocation${rows.length === 1 ? "" : "s"}`
          }
          onApply={(rows) => editDraft((d) => ({ ...d, allocations: rows }))}
          busy={status.kind === "saving"}
        />
        <p
          className="text-sm text-muted-foreground"
          data-ui-bridge-id="overview.estimate-editor.allocations.count"
        >
          {draft.allocations.length} allocation
          {draft.allocations.length === 1 ? "" : "s"} in the working copy.
        </p>
      </section>

      <section className="space-y-4">
        <Heading>Days of work per task</Heading>
        <PasteBox
          id="overview.estimate-editor.efforts-paste"
          label="Paste the task effort split"
          help="One line per role on a task: phase, task number, role, days. This is the only place days of work come from — the allocation matrix above is a separate statement of team size and is never used to derive them."
          placeholder={"phase,task,role,days\nA0,1.1,DL,4\nA0,1.1,BE,6.5"}
          parse={parseEffortsCsv}
          describe={(rows) =>
            `${rows.length} line${rows.length === 1 ? "" : "s"}`
          }
          onApply={(rows) => editDraft((d) => ({ ...d, efforts: rows }))}
          busy={status.kind === "saving"}
        />
        <p
          className="text-sm text-muted-foreground"
          data-ui-bridge-id="overview.estimate-editor.efforts.count"
        >
          {sumPersonDays(draft.efforts.map((e) => e.planned_person_days)) ??
            "An unreadable number of"}{" "}
          days across {draft.efforts.length} line
          {draft.efforts.length === 1 ? "" : "s"} in the working copy.
        </p>
      </section>

      {problems.length > 0 && (
        <section
          className="border-l-2 border-destructive pl-4"
          data-ui-bridge-id="overview.estimate-editor.problems"
          role="status"
        >
          <h3 className="text-sm font-medium text-foreground">
            Before this can be saved
          </h3>
          <ul className="mt-2 space-y-1.5">
            {problems.map((problem) => (
              <li
                key={problem.message}
                className={`text-sm leading-relaxed ${
                  problem.severity === "error"
                    ? "text-destructive"
                    : "text-muted-foreground"
                }`}
              >
                {problem.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-wrap items-center gap-4 border-t border-border pt-6">
        <button
          type="button"
          onClick={save}
          disabled={status.kind === "saving" || blocking.length > 0}
          className="inline-flex min-h-9 items-center rounded-md bg-primary px-4 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-ui-bridge-id="overview.estimate-editor.save"
        >
          {status.kind === "saving" ? "Saving…" : "Save the estimate"}
        </button>
        <Link
          href={TEAM_ROUTE}
          className="inline-flex min-h-9 items-center rounded-md text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-ui-bridge-id="overview.estimate-editor.back"
        >
          Back to the Team page
        </Link>
        <p
          role="status"
          className="text-sm"
          data-ui-bridge-id="overview.estimate-editor.status"
        >
          {status.kind === "saved" && (
            <span className="text-muted-foreground">
              Saved as version {status.version}. The Team page now shows this.
            </span>
          )}
          {status.kind === "conflict" && (
            <span className="text-destructive">
              Somebody else saved this project&rsquo;s estimate while you were
              editing
              {status.currentVersion !== null
                ? ` (it is now at version ${status.currentVersion})`
                : ""}
              . Nothing of yours was written. Reload the page to see theirs
              before saving again.
            </span>
          )}
          {status.kind === "failed" && (
            <span className="text-destructive">
              It could not be saved: {status.message}
            </span>
          )}
        </p>
      </section>
    </div>
  );
}

export default function EstimateEditorPage() {
  const { isCoordAdmin } = useAuth();
  const {
    activeTenantId,
    loading: tenantsLoading,
    error: tenantsError,
  } = useTenant();
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "none" }
    | { kind: "ready"; detail: EstimateDetail }
  >({ kind: "loading" });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (tenantsLoading || tenantsError) return;
    let live = true;
    setState({ kind: "loading" });
    fetchEstimates()
      .then(async (listed) => {
        const chosen = pickBaseline(listed.estimates);
        if (!chosen) return { kind: "none" as const };
        return {
          kind: "ready" as const,
          detail: await fetchEstimate(chosen.id),
        };
      })
      .then(
        (loaded) => live && setState(loaded),
        (err) => live && setState({ kind: "error", message: errorText(err) })
      );
    return () => {
      live = false;
    };
  }, [activeTenantId, tenantsLoading, tenantsError, reloadToken]);

  if (tenantsError) {
    return (
      <div
        className="max-w-[42rem]"
        data-ui-bridge-id="overview.estimate-editor.page"
      >
        <LoadFailure
          what="the list of projects"
          message={tenantsError}
          uiBridgeId="overview.estimate-editor.tenants.error"
        />
      </div>
    );
  }

  if (!isCoordAdmin) {
    return (
      <section
        className="max-w-[38rem]"
        data-ui-bridge-id="overview.estimate-editor.forbidden"
      >
        <Heading>Only an administrator can edit the estimate</Heading>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
          You can read everything the estimate produces on the Team page; only
          an administrator of this project can change it.
        </p>
        <Link
          href={TEAM_ROUTE}
          className="mt-4 inline-flex min-h-9 items-center rounded-md text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-ui-bridge-id="overview.estimate-editor.forbidden.back"
        >
          Back to the Team page
        </Link>
      </section>
    );
  }

  return (
    <div
      className="max-w-[52rem]"
      data-ui-bridge-id="overview.estimate-editor.page"
      aria-busy={state.kind === "loading"}
    >
      {state.kind === "loading" && (
        <div className="space-y-4" aria-hidden>
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}
      {state.kind === "error" && (
        <LoadFailure
          what="this project's estimate"
          message={state.message}
          uiBridgeId="overview.estimate-editor.error"
        />
      )}
      {state.kind === "none" && (
        <CreateEstimate onCreated={() => setReloadToken((n) => n + 1)} />
      )}
      {state.kind === "ready" && (
        <EstimateEditor
          detail={state.detail}
          onSaved={(fresh) => setState({ kind: "ready", detail: fresh })}
        />
      )}
    </div>
  );
}
