"use client";

/**
 * The work-unit page's "Evidence" panel — where a person enters the delivery
 * evidence the Project Overview reads: a phase attestation (a phase done
 * off-system, pointing at a finding or a prompt-document version) and a manual
 * PR citation.
 *
 * Plan `2026-11-25-overview-timeline-and-milestones-derive-from-coord`
 * Phase 6. The Overview has no entered value (D5): it calls a phase done only
 * on what coord holds, and shows an attestation's date as "Confirmed done on",
 * never as when the work finished. So the way to correct it is here, in coord.
 *
 * The panel reads the unit WITH its delivery view on its own, so a failed read
 * says "unknown", never "no evidence" (R6), and it re-reads after every write.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CollapsiblePanel } from "@/components/console";
import {
  CoordAdminOnly,
  ReadOnlyNotice,
} from "@/components/admin/coord/CoordAdminOnly";
import {
  addPlanCitation,
  attestPlanPhase,
  fetchPlanDelivery,
  removePlanCitation,
  retractPlanPhaseAttestation,
  type PlanDeliveryResponse,
} from "@/lib/api/operations/coordPlans";
import {
  EMPTY_ATTEST,
  attestationViews,
  buildAttestRequest,
  describeCitation,
  describePhaseEvidence,
  describeResolution,
  isManualCitation,
  phaseEvidenceState,
  validateAttest,
  validateCitation,
  type AttestDraft,
} from "../_lib/evidence";

interface EvidencePanelProps {
  slug: string;
  /** Phase names from the unit's declared phases, by index (display only). */
  phaseNames: Record<number, string>;
}

const SELECT_CLASS =
  "h-8 rounded-md border border-input bg-background px-2 text-xs";

function when(iso: string | null | undefined): string {
  if (!iso) return "date not recorded";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t).toISOString().slice(0, 10);
}

export function EvidencePanel({ slug, phaseNames }: EvidencePanelProps) {
  const [data, setData] = useState<PlanDeliveryResponse | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attest, setAttest] = useState<AttestDraft>(EMPTY_ATTEST);
  const [repo, setRepo] = useState("");
  const [pr, setPr] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await fetchPlanDelivery(slug));
      setReadFailed(false);
    } catch {
      setReadFailed(true);
    }
  }, [slug]);

  useEffect(() => {
    setData(null);
    setReadFailed(false);
    void load();
  }, [load]);

  const delivery = data?.delivery ?? null;
  const declared = delivery?.phases_declared_indices ?? null;
  const rows = useMemo(() => attestationViews(delivery), [delivery]);
  const citations = data?.citations ?? [];
  const live = rows.filter((r) => r.resolution === "resolved").length;

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      toast.success(label);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Failed: ${label}`);
    } finally {
      setBusy(false);
    }
  };

  const attestProblems = validateAttest(attest);
  const citeProblems = validateCitation(repo, pr);

  return (
    <CollapsiblePanel
      titleAs="h2"
      className="p-3"
      defaultOpen={false}
      storageKey="coord-plan-evidence"
      icon={<ClipboardCheck className="h-3.5 w-3.5" />}
      title="Evidence"
      summary={
        <Badge
          variant="outline"
          className="font-mono text-[11px]"
          title="Phase attestations in effect"
        >
          {readFailed ? "unknown" : `${live} attested`}
        </Badge>
      }
      data-testid="coord-plan-evidence"
      data-ui-bridge-id="coord-plan-evidence"
    >
      <p className="mb-2 text-xs text-muted-foreground">
        The Project Overview calls a phase done only on this evidence: a landed
        PR, or an attestation naming a finding or prompt document. An
        attestation&rsquo;s date is shown there as &ldquo;Confirmed done
        on&rdquo;, not as when the work finished.
      </p>

      {readFailed && !data && (
        <p
          className="text-sm italic text-muted-foreground"
          data-testid="coord-plan-evidence-unknown"
        >
          Could not read this unit&rsquo;s evidence — what it holds is unknown,
          not none.
        </p>
      )}

      {readFailed && data && (
        <p
          className="mb-2 text-xs text-destructive"
          data-testid="coord-plan-evidence-stale"
        >
          The last re-read failed, so what is shown below may be out of date.
          Reload the page to read this unit&rsquo;s evidence again.
        </p>
      )}

      {data && (
        <div className="space-y-3">
          {data.delivery_error != null && (
            <p
              className="text-xs text-destructive"
              data-testid="coord-plan-evidence-delivery-error"
            >
              coord could not derive delivery: {String(data.delivery_error)}
            </p>
          )}

          <table
            className="w-full text-xs"
            data-testid="coord-plan-evidence-phases"
          >
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="pr-2 font-normal">Phase</th>
                <th className="font-normal">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {declared === null && (
                <tr>
                  <td
                    colSpan={2}
                    className="py-1 italic text-muted-foreground"
                    data-testid="coord-plan-evidence-undeclared"
                  >
                    This unit declares no phases, so there is nothing to attest.
                    Enter them in the Schedule panel first.
                  </td>
                </tr>
              )}
              {(declared ?? []).map((i) => (
                <tr key={i} data-testid="coord-plan-evidence-phase-row">
                  <td className="pr-2 py-0.5">
                    {i}
                    {phaseNames[i] ? ` · ${phaseNames[i]}` : ""}
                  </td>
                  <td className="py-0.5">
                    {describePhaseEvidence(phaseEvidenceState(delivery, i))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Attestations
            </h3>
            {rows.length === 0 ? (
              <p
                className="text-xs italic text-muted-foreground"
                data-testid="coord-plan-evidence-attestations-empty"
              >
                No phase attestations.
              </p>
            ) : (
              <ul className="space-y-1" data-testid="coord-plan-evidence-attestations">
                {rows.map((r, i) => (
                  <li
                    key={`${r.phase_index}-${r.evidence_kind}-${r.evidence_ref}-${i}`}
                    className="flex flex-wrap items-center gap-2 text-xs"
                    data-testid="coord-plan-evidence-attestation"
                  >
                    <span>Phase {r.phase_index}</span>
                    <Badge variant="outline">{describeResolution(r.resolution)}</Badge>
                    <span className="font-mono text-muted-foreground">
                      {r.evidence_kind} {r.evidence_ref.slice(0, 8)}
                      {r.version != null ? ` v${r.version}` : ""}
                    </span>
                    <span className="text-muted-foreground">
                      {r.detailKnown
                        ? `${r.attested_by ?? "attester not recorded"} · confirmed ${when(r.attested_at)}`
                        : "who and when: this coord does not serve it"}
                    </span>
                    <CoordAdminOnly>
                      {r.resolution === "resolved" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            run("Attestation retracted", () =>
                              retractPlanPhaseAttestation(slug, {
                                phase_index: r.phase_index,
                                evidence_kind: r.evidence_kind,
                                evidence_ref: r.evidence_ref,
                              })
                            )
                          }
                          data-testid="coord-plan-evidence-retract"
                          data-ui-bridge-id={`coord-plan-evidence-retract-${i}`}
                        >
                          Retract
                        </Button>
                      )}
                    </CoordAdminOnly>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Cited PRs
            </h3>
            {citations.length === 0 ? (
              <p
                className="text-xs italic text-muted-foreground"
                data-testid="coord-plan-evidence-citations-empty"
              >
                {data.citations_error != null
                  ? "Could not read citations — unknown, not none."
                  : "No cited PRs."}
              </p>
            ) : (
              <ul className="space-y-1" data-testid="coord-plan-evidence-citations">
                {citations.map((c) => (
                  <li
                    key={`${c.repo}#${c.pr_number}`}
                    className="flex flex-wrap items-center gap-2 text-xs"
                    data-testid="coord-plan-evidence-citation"
                  >
                    <span className="font-mono">
                      {c.repo}#{c.pr_number}
                    </span>
                    <Badge variant="outline">{describeCitation(c)}</Badge>
                    <CoordAdminOnly>
                      {isManualCitation(c) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            run("Citation removed", () =>
                              removePlanCitation(slug, {
                                repo: c.repo,
                                pr_number: c.pr_number,
                              })
                            )
                          }
                          data-testid="coord-plan-evidence-citation-remove"
                          data-ui-bridge-id={`coord-plan-evidence-citation-remove-${c.pr_number}`}
                        >
                          Remove
                        </Button>
                      )}
                    </CoordAdminOnly>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <CoordAdminOnly
            fallback={
              <ReadOnlyNotice label="Evidence can be entered by administrators only." />
            }
          >
            <div className="space-y-2 rounded-md border border-border p-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Attest a phase done
              </h3>
              <div className="flex flex-wrap items-end gap-2">
                <select
                  className={SELECT_CLASS}
                  value={attest.phase}
                  onChange={(e) =>
                    setAttest((a) => ({ ...a, phase: e.target.value }))
                  }
                  aria-label="Phase to attest"
                  data-testid="coord-plan-evidence-attest-phase"
                  data-ui-bridge-id="coord-plan-evidence-attest-phase"
                >
                  <option value="">phase…</option>
                  {(declared ?? []).map((i) => (
                    <option key={i} value={String(i)}>
                      {i}
                      {phaseNames[i] ? ` · ${phaseNames[i]}` : ""}
                    </option>
                  ))}
                </select>
                <select
                  className={SELECT_CLASS}
                  value={attest.kind}
                  onChange={(e) =>
                    setAttest((a) => ({
                      ...a,
                      kind: e.target.value as AttestDraft["kind"],
                    }))
                  }
                  aria-label="Evidence kind"
                  data-testid="coord-plan-evidence-attest-kind"
                  data-ui-bridge-id="coord-plan-evidence-attest-kind"
                >
                  <option value="finding">finding</option>
                  <option value="prompt_document">prompt document</option>
                </select>
                <Input
                  className="h-8 min-w-[260px] font-mono"
                  placeholder="finding or prompt-document id (UUID)"
                  value={attest.ref}
                  onChange={(e) =>
                    setAttest((a) => ({ ...a, ref: e.target.value }))
                  }
                  aria-label="Evidence id"
                  data-testid="coord-plan-evidence-attest-ref"
                  data-ui-bridge-id="coord-plan-evidence-attest-ref"
                />
                {attest.kind === "prompt_document" && (
                  <Input
                    className="h-8 w-28"
                    placeholder="min version"
                    value={attest.minVersion}
                    onChange={(e) =>
                      setAttest((a) => ({ ...a, minVersion: e.target.value }))
                    }
                    aria-label="Minimum document version"
                    data-testid="coord-plan-evidence-attest-version"
                    data-ui-bridge-id="coord-plan-evidence-attest-version"
                  />
                )}
                <Input
                  className="h-8 min-w-[160px] flex-1"
                  placeholder="note (optional)"
                  value={attest.note}
                  onChange={(e) =>
                    setAttest((a) => ({ ...a, note: e.target.value }))
                  }
                  aria-label="Note"
                  data-testid="coord-plan-evidence-attest-note"
                  data-ui-bridge-id="coord-plan-evidence-attest-note"
                />
                <Button
                  size="sm"
                  disabled={busy || attestProblems.length > 0}
                  onClick={() =>
                    run("Phase attested", async () => {
                      await attestPlanPhase(slug, buildAttestRequest(attest));
                      setAttest(EMPTY_ATTEST);
                    })
                  }
                  data-testid="coord-plan-evidence-attest-submit"
                  data-ui-bridge-id="coord-plan-evidence-attest-submit"
                >
                  Record attestation
                </Button>
              </div>
              {attestProblems.length > 0 && attest.ref.trim() !== "" && (
                <ul
                  className="list-disc pl-5 text-xs text-destructive"
                  data-testid="coord-plan-evidence-attest-problems"
                >
                  {attestProblems.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-2 rounded-md border border-border p-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Cite a PR
              </h3>
              <div className="flex flex-wrap items-end gap-2">
                <Input
                  className="h-8 min-w-[200px] font-mono"
                  placeholder="owner/repo"
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                  aria-label="Repository"
                  data-testid="coord-plan-evidence-cite-repo"
                  data-ui-bridge-id="coord-plan-evidence-cite-repo"
                />
                <Input
                  className="h-8 w-24"
                  placeholder="PR #"
                  inputMode="numeric"
                  value={pr}
                  onChange={(e) => setPr(e.target.value)}
                  aria-label="PR number"
                  data-testid="coord-plan-evidence-cite-pr"
                  data-ui-bridge-id="coord-plan-evidence-cite-pr"
                />
                <Button
                  size="sm"
                  disabled={busy || citeProblems.length > 0}
                  onClick={() =>
                    run("PR cited", async () => {
                      await addPlanCitation(slug, {
                        repo: repo.trim(),
                        pr_number: Number(pr.trim()),
                      });
                      setRepo("");
                      setPr("");
                    })
                  }
                  data-testid="coord-plan-evidence-cite-submit"
                  data-ui-bridge-id="coord-plan-evidence-cite-submit"
                >
                  Add citation
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                A citation only feeds coord&rsquo;s delivery check: coord reads
                whether the PR actually landed, so citing one cannot mark a
                unit shipped.
              </p>
            </div>
          </CoordAdminOnly>
        </div>
      )}
    </CollapsiblePanel>
  );
}
