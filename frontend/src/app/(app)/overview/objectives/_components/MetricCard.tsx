"use client";

/**
 * One measure of success (plan `2026-10-06-overview-objectives-view` D2–D8):
 * its title, target and baseline with units, and — when it declares
 * checkpoints — each checkpoint's verdict triple and report; otherwise its
 * current value, honestly "not measured yet" with the reason. Mechanics (method
 * ids, tool names, gate ids, the agent instructions in the body) sit one
 * disclosure down.
 *
 * Two controls, both only for whoever the server says may edit this
 * project's intent documents: "Edit text" (the Summary's own editor and save
 * path, moved here with the prose) and a link to the coord console for the
 * measure's definition, which is never edited on this page.
 */

import Link from "next/link";
import { Fragment, useState } from "react";
import { MarkdownView } from "@/components/overview/MarkdownView";
import {
  EditableSection,
  type EditableText,
} from "@/components/overview/editing/EditableSection";
import type { SaveResult } from "@/components/overview/editing/useResource";
import { bodyWithoutLeadHeading, type IntentDocument } from "../../_lib/intent";
import { saveMetricText } from "../../_lib/metric-text-api";
import {
  baselineLine,
  checkpointResultsNotice,
  currentValueText,
  definitionHref,
  metricAnchor,
  shortDay,
  targetLines,
  unresolvedResultText,
  type FigureLine,
} from "../../_lib/objectives";
import type { MetricRead } from "../../_lib/objectives-api";
import { CheckpointResults } from "./CheckpointResults";
import { CriterionList } from "./CriterionRows";
import { TallyMarks } from "./VerdictMark";
import { DISCLOSURE, MUTED, NOTICE, SERIF, TEXT_LINK } from "./ui";

export interface CardEditing {
  canEdit: boolean;
  projectId: string | null;
  viewerId: string | null;
}

function Figure({ line }: { line: FigureLine }) {
  return (
    <>
      <dt className="text-muted-foreground">{line.label}</dt>
      <dd className="text-foreground">
        {line.text}
        {line.asWritten && (
          <span className="text-muted-foreground">
            {" "}
            (as written, not a number)
          </span>
        )}
      </dd>
    </>
  );
}

function editable(doc: IntentDocument): EditableText {
  return {
    text: doc.body,
    version: doc.version,
    updatedBy: doc.updated_by,
    updatedAt: doc.updated_at,
  };
}

function asEditable(
  result: SaveResult<IntentDocument>
): SaveResult<EditableText> {
  if (result.ok) return { ok: true, item: editable(result.item) };
  if ("conflict" in result)
    return { ok: false, conflict: editable(result.conflict) };
  return result;
}

const requireText = (text: string) =>
  text.trim() ? null : "Write something before saving.";

function MeasureMechanics({
  metric,
  uiBridgeId,
}: {
  metric: MetricRead;
  uiBridgeId: string;
}) {
  const lines: [string, string][] = [
    ["Source of the reading", metric.source_query_type],
  ];
  if (metric.metric) lines.push(["Metric", metric.metric]);
  if (metric.direction) lines.push(["Direction", metric.direction]);
  else if (metric.direction_text)
    lines.push(["Direction (as written)", metric.direction_text]);
  if (metric.report_topic) lines.push(["Report topic", metric.report_topic]);
  if (metric.checkpoints_text)
    lines.push(["Checkpoints (as written)", metric.checkpoints_text]);
  for (const extra of metric.extra_fields) lines.push([extra.key, extra.text]);
  for (const [field, error] of Object.entries(metric.field_errors))
    lines.push([`${field} could not be read`, error]);
  for (const warning of metric.frontmatter_warnings)
    lines.push(["Note", warning]);
  return (
    <details data-ui-bridge-id={uiBridgeId}>
      <summary className={DISCLOSURE}>How this is measured</summary>
      <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {lines.map(([k, v], i) => (
          <Fragment key={`${k}-${i}`}>
            <dt>{k}</dt>
            <dd className="break-words font-mono">{v}</dd>
          </Fragment>
        ))}
      </dl>
    </details>
  );
}

function RelatedNotes({
  metric,
  uiBridgeId,
}: {
  metric: MetricRead;
  uiBridgeId: string;
}) {
  const notes = metric.related_notes;
  const unreadable = metric.findings_read === "unavailable";
  const partial =
    metric.findings_read === "truncated" || metric.findings_read === "not_read";
  if (!unreadable && !partial && notes.length === 0) return null;
  const label = unreadable
    ? "Related notes (can't be read)"
    : partial
      ? `Related notes (${notes.length} shown; more may exist)`
      : `Related notes (${notes.length})`;
  return (
    <details data-ui-bridge-id={uiBridgeId} data-read={metric.findings_read}>
      <summary className={DISCLOSURE}>{label}</summary>
      {unreadable ? (
        <p
          className={`mt-1 ${MUTED}`}
          data-ui-bridge-id={`${uiBridgeId}.unreadable`}
        >
          The notes filed against this measure couldn&rsquo;t be read, so
          whether there are any is unknown.
        </p>
      ) : (
        <ul className="mt-1 space-y-1">
          {notes.map((n) => (
            <li key={n.finding_id} className={MUTED}>
              <span className="text-foreground">
                {n.title ?? "Untitled note"}
              </span>
              {shortDay(n.created_at) ? ` · ${shortDay(n.created_at)}` : ""}
              {n.possible_report_for && (
                <span className="block text-xs">
                  A possible report for{" "}
                  {n.possible_report_for.replace(/-/g, " ")}; not yet recorded.
                </span>
              )}
              {n.note && <span className="block text-xs">{n.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

export function MetricCard({
  metric,
  editing,
  headingLevel = 3,
}: {
  metric: MetricRead;
  editing: CardEditing;
  /** The card's title level under the group it sits in. */
  headingLevel?: 3 | 4;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h4";
  const base = `overview.objectives.metric.${metric.name}`;
  // The prose as last saved from this card; the server's copy otherwise.
  const [record, setRecord] = useState<EditableText>({
    text: metric.body,
    version: metric.version,
    updatedBy: metric.updated_by,
    updatedAt: metric.updated_at,
  });
  const hasCheckpoints = metric.checkpoint_results.length > 0;
  const current = currentValueText(metric);
  const resultsNotice = checkpointResultsNotice(metric);

  return (
    <article
      id={metricAnchor(metric.name)}
      tabIndex={-1}
      className="scroll-mt-6 rounded-md border border-border p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-ui-bridge-id={base}
    >
      <Heading className={`${SERIF} text-xl leading-snug text-foreground`}>
        {metric.title}
      </Heading>

      {metric.state === "unreadable" ? (
        <p
          className={`mt-2 ${NOTICE} ${MUTED}`}
          role="status"
          data-ui-bridge-id={`${base}.unreadable`}
        >
          This measure can&rsquo;t be read right now
          {metric.error ? `: ${metric.error}` : "."}
        </p>
      ) : (
        <>
          {metric.frontmatter_error && (
            <p
              className={`mt-2 ${NOTICE} ${MUTED}`}
              role="status"
              data-ui-bridge-id={`${base}.definition-unreadable`}
            >
              The measure&rsquo;s definition can&rsquo;t be read, so its target
              and checkpoints are unknown: {metric.frontmatter_error}
            </p>
          )}
          <dl
            className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm"
            data-ui-bridge-id={`${base}.figures`}
          >
            {targetLines(metric).map((line) => (
              <Figure key={line.label} line={line} />
            ))}
            <Figure line={baselineLine(metric)} />
          </dl>
          {metric.serves_unknown.length > 0 && (
            <p
              className={`mt-2 ${MUTED}`}
              data-ui-bridge-id={`${base}.serves-unknown`}
            >
              It says it serves {metric.serves_unknown.join(", ")}, which no
              initiative declares.
            </p>
          )}

          {resultsNotice && (
            <p
              className={`mt-3 ${NOTICE} ${MUTED}`}
              role="status"
              data-ui-bridge-id={`${base}.checkpoint-results-read`}
              data-read={metric.checkpoint_results_read}
            >
              <span aria-hidden>? </span>
              {resultsNotice}
            </p>
          )}
          {hasCheckpoints ? (
            <div className="mt-4">
              <p className="text-sm font-medium text-foreground">Checkpoints</p>
              <CheckpointResults
                metric={metric}
                uiBridgeId={`${base}.checkpoints`}
              />
              {metric.criteria_latest.length > 0 && (
                <details data-ui-bridge-id={`${base}.latest`}>
                  <summary className={DISCLOSURE}>
                    Where each criterion stands now (latest report wins)
                  </summary>
                  <div className="mt-1">
                    <TallyMarks
                      tally={metric.tally_latest}
                      uiBridgeId={`${base}.latest.tally`}
                    />
                    <CriterionList
                      metric={metric}
                      items={metric.criteria_latest}
                      uiBridgeId={`${base}.latest.rows`}
                    />
                  </div>
                </details>
              )}
            </div>
          ) : (
            <p
              className={`mt-3 ${NOTICE} ${MUTED}`}
              role="status"
              data-ui-bridge-id={`${base}.current-value`}
            >
              <span aria-hidden>? </span>
              <span className="text-foreground">{current.text}</span> —{" "}
              {current.reason}
            </p>
          )}
        </>
      )}

      {metric.unresolved_results.length > 0 && (
        <ul
          className={`mt-3 ${NOTICE} ${MUTED}`}
          role="status"
          data-ui-bridge-id={`${base}.unresolved-results`}
        >
          {metric.unresolved_results.map((u, i) => (
            <li key={`${u.finding_id ?? "none"}-${i}`}>
              {unresolvedResultText(u)}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-col items-start">
        {metric.state !== "unreadable" && (
          <MeasureMechanics metric={metric} uiBridgeId={`${base}.mechanics`} />
        )}
        <RelatedNotes metric={metric} uiBridgeId={`${base}.related`} />
        <EditableSection
          projectId={editing.projectId}
          resource="intent_documents"
          recordId={`success_metric:${metric.name}`}
          viewerId={editing.viewerId}
          record={record}
          canEdit={editing.canEdit && metric.state !== "unreadable"}
          label={metric.title}
          editLabel="Edit text"
          validate={requireText}
          onSave={async (text, version) => {
            const result = asEditable(
              await saveMetricText(metric.name, text, version)
            );
            if (result.ok) setRecord(result.item);
            return result;
          }}
          uiBridgeId={`${base}.text`}
        >
          <details data-ui-bridge-id={`${base}.document`}>
            <summary className={DISCLOSURE}>Full document</summary>
            <div className="mt-2">
              <MarkdownView headingOffset={3}>
                {bodyWithoutLeadHeading(record.text)}
              </MarkdownView>
            </div>
          </details>
        </EditableSection>
        {editing.canEdit && (
          <Link
            href={definitionHref(metric.name)}
            className={TEXT_LINK}
            data-ui-bridge-id={`${base}.edit-definition`}
          >
            Edit the measure&rsquo;s definition
          </Link>
        )}
      </div>
    </article>
  );
}
