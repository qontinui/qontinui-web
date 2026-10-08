"use client";

/**
 * What a `/admin/coord/plans` row's detail panel adds to the shipped
 * reconciliation detail: the triage readings in words, and the plan document
 * itself, opened in place.
 *
 * Plan `2026-09-19-plan-library-cannot-answer-what-to-work-on-next` Phase 1
 * (the open-artifact affordance folded in from the retired
 * `/admin/coord/plan-library` list) and Phases 3/6 (class, vet freshness and
 * custody spelled out — the row line carries only the short badge).
 *
 * **The document opens in place, under this row.** `ArtifactDetailPanel` is
 * reused unchanged; following a provenance edge inside it re-points the same
 * panel at the peer, so an edge to an artifact on no page of this list still
 * goes somewhere (the trap the old list's docstring names).
 */

import { useState } from "react";
import { FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { absoluteTime } from "@/components/console";
import { ArtifactDetailPanel } from "../plan-library/_components/ArtifactDetailPanel";
import type {
  WorkArtifactDetail,
  WorkArtifactKind,
} from "../plan-library/types";
import type { ReconciliationRowData } from "@/components/admin/coord/planReconciliationStatus";
import { describeStatusClass, needsVetImp } from "./statusClass";
import { describeCustody } from "./custody";

export interface ArtifactDocumentActions {
  fetchDetail: (id: string) => Promise<WorkArtifactDetail | null>;
  correctKind: (id: string, kind: WorkArtifactKind) => Promise<boolean>;
}

/** The three triage readings, in words. */
export function PlanTriageDetail({ row }: { row: ReconciliationRowData }) {
  const cls = describeStatusClass(row.axis_a);
  const vet = needsVetImp(row.axis_a);
  const custody = describeCustody(row.axis_a);
  const vetState = row.axis_a.vet_state;
  return (
    <div className="text-xs space-y-1" data-testid="coord-plan-triage-detail">
      <div>
        <span className="text-muted-foreground">Status class: </span>
        <span className={cls.unknown ? "italic text-muted-foreground" : ""}>
          {cls.label}
        </span>
        <span className="text-muted-foreground"> — {cls.detail}</span>
      </div>
      <div data-testid="coord-plan-vet-freshness">
        <span className="text-muted-foreground">Vet freshness: </span>
        {vetState === undefined ? (
          <span className="italic text-muted-foreground">
            not reported by this backend — UNKNOWN
          </span>
        ) : vetState === null ? (
          <span className="italic text-muted-foreground">
            UNKNOWN — never checked, or not reported
          </span>
        ) : (
          <span>
            {vetState}
            <span className="text-muted-foreground">
              {" "}
              (checked {absoluteTime(row.axis_a.vet_checked_at)})
            </span>
          </span>
        )}
      </div>
      <div data-testid="coord-plan-vet-imp-why">
        <span className="text-muted-foreground">Needs a /vet-imp: </span>
        <span className={vet.need === "undetermined" ? "italic" : ""}>
          {vet.need}
        </span>
        <span className="text-muted-foreground"> — {vet.why}</span>
      </div>
      <div data-testid="coord-plan-custody-detail">
        <span className="text-muted-foreground">Live custody: </span>
        <span className={custody.unknown ? "italic" : ""}>{custody.label}</span>
        <span className="text-muted-foreground"> — {custody.title}</span>
      </div>
    </div>
  );
}

/**
 * The open-document control and, once opened, the document. A row with no
 * `artifact_id` has no document in the library — said, not hidden.
 */
export function PlanDocumentPanel({
  row,
  actions,
}: {
  row: ReconciliationRowData;
  actions: ArtifactDocumentActions;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const artifactId = row.artifact_id ?? null;

  if (artifactId === null) {
    return (
      <p
        className="text-xs text-muted-foreground"
        data-testid="coord-plan-no-document"
      >
        The plan library holds no document for this stem ({row.document_state}),
        so there is nothing to open.
      </p>
    );
  }

  return (
    <div className="space-y-2" data-testid="coord-plan-document">
      {openId === null ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpenId(artifactId)}
          data-testid="coord-plan-open-document"
        >
          <FileText className="size-3.5" aria-hidden />
          Open document
        </Button>
      ) : (
        <>
          <div className="flex items-center gap-2">
            {openId !== artifactId && (
              <span
                className="text-[11px] text-muted-foreground"
                data-testid="coord-plan-document-followed"
              >
                Following a provenance edge — this is not the stem&apos;s own
                document.
              </span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpenId(null)}
              data-testid="coord-plan-close-document"
            >
              <X className="size-3.5" aria-hidden />
              Close document
            </Button>
          </div>
          <ArtifactDetailPanel
            artifactId={openId}
            fetchDetail={actions.fetchDetail}
            correctKind={actions.correctKind}
            onOpenArtifact={setOpenId}
            onClose={() => setOpenId(null)}
            className="rounded-md border"
          />
        </>
      )}
    </div>
  );
}
