"use client";

/**
 * OperatorTouchRow — one operator touch, on one line, with its detail behind a
 * click (R2, R5).
 *
 * Plan `2026-08-27-operator-touch-read-and-surface` Phase C3. The row carries
 * HUMAN words only (R8): the touch kind as a short chip, the reason class as
 * the label, the routing as a status badge, and where the named item stands as
 * the reason. Coord's machine vocabulary — `reason_code`, `policy_authorized`,
 * `disposition`, `source`, the ids — lives in the expanded detail's raw line
 * and nowhere else.
 *
 * No per-row action. This is the operator's STRATEGIC surface; a touch that
 * needs a person is answered on the surface of the item it names, and the
 * detail links there as wayfinding rather than offering a verb here.
 */

import Link from "next/link";
import {
  RecordDetail,
  RecordRow,
  RowTime,
  StatusBadge,
} from "@/components/console";
import {
  TOUCH_STATUS_PALETTE,
  answerViaSentence,
  deriveTouchStatus,
  policySentence,
  reasonLabel,
  touchKindChip,
  touchKindSentence,
  type OperatorTouch,
} from "../_lib/operatorTouchStatus";

const RESOLUTION_WORDS: Record<string, string> = {
  answered: "answered",
  timed_out: "timed out",
  abandoned: "abandoned",
  self_resolved: "resolved on its own",
};

function resolutionWords(value: string | null | undefined): string {
  return value && Object.prototype.hasOwnProperty.call(RESOLUTION_WORDS, value)
    ? (RESOLUTION_WORDS[value] as string)
    : "resolved";
}

export function OperatorTouchRow({
  touch,
  expanded,
  onToggle,
}: {
  touch: OperatorTouch;
  expanded: boolean;
  onToggle: () => void;
}) {
  const status = deriveTouchStatus(touch);
  const reason = reasonLabel(touch.reason_code);
  const where = answerViaSentence(touch.answer_via);
  const via = touch.answer_via ?? null;
  const questionHref =
    via && via.kind === "question" && via.id
      ? `/admin/coord/questions/${encodeURIComponent(via.id)}`
      : null;

  return (
    <RecordRow
      data-testid="operator-touch-row"
      rowKey={touch.touch_id}
      expanded={expanded}
      onToggle={onToggle}
      attention={status.attention}
      identity={touchKindChip(touch.kind)}
      label={<span title={reason}>{reason}</span>}
      status={<StatusBadge status={status} palette={TOUCH_STATUS_PALETTE} />}
      reason={where}
      reasonTestId="operator-touch-where"
      time={<RowTime at={touch.emitted_at ?? null} verb="Raised" />}
    >
      <RecordDetail
        data-testid="operator-touch-detail"
        why={
          <p className="text-[13px] text-foreground/85 m-0">
            {touchKindSentence(touch.kind)} — {reason.toLowerCase()}.{" "}
            {status.reason}
          </p>
        }
        problems={
          <p className="text-xs text-muted-foreground m-0">
            {where}. Judged against policy: {policySentence(touch.policy_authorized)}.
          </p>
        }
        actions={
          questionHref && status.kind === "reached_you" ? (
            <Link
              href={questionHref}
              className="text-xs text-primary hover:underline"
              data-testid="operator-touch-open-question"
            >
              Open the question it names ↗
            </Link>
          ) : status.kind === "agent_can_handle" ? (
            <p className="text-xs text-muted-foreground m-0">
              An agent answers this through its own door; nothing here needs
              you.
            </p>
          ) : null
        }
        history={
          <p className="text-xs text-muted-foreground flex flex-wrap gap-x-3 m-0">
            <span>
              raised{" "}
              <RowTime
                at={touch.emitted_at ?? null}
                verb="Raised"
                className="inline"
              />
            </span>
            {touch.resolved_at ? (
              <span>
                {resolutionWords(touch.resolution)}{" "}
                <RowTime
                  at={touch.resolved_at}
                  verb="Resolved"
                  className="inline"
                />
              </span>
            ) : (
              <span className="italic">
                no resolution recorded — the touch record is not closed by
                anything yet, so read where the item stands above
              </span>
            )}
          </p>
        }
        raw={
          <div
            className="font-mono text-[10px] text-muted-foreground/60 break-all"
            data-testid="operator-touch-raw"
          >
            touch id: {touch.touch_id}
            {touch.kind ? ` · kind: ${touch.kind}` : ""}
            {touch.source ? ` · source: ${touch.source}` : ""}
            {` · reason_code: ${touch.reason_code ?? "–"}`}
            {` · policy_authorized: ${touch.policy_authorized ?? "–"}`}
            {` · disposition: ${touch.disposition ?? "–"}`}
            {via
              ? ` · answer_via: ${via.kind}${via.id ? ` ${via.id}` : ""} (${via.state ?? "–"})`
              : " · answer_via: none"}
            {touch.gate_id ? ` · gate id: ${touch.gate_id}` : ""}
            {touch.work_unit_id ? ` · work unit: ${touch.work_unit_id}` : ""}
          </div>
        }
      />
    </RecordRow>
  );
}
