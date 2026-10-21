"use client";

/**
 * /admin/coord/overlord/label — bare operator form for labelling an overlord
 * intervention. Plan
 * `2026-10-01-overlord-session-supervisor-classifies-stops-and-absorbs-avoidable-escalations`
 * Phase 2b; Phase 5 replaces it with the real review surface.
 *
 * Posts `{intervention_id, label_kind, operator_label}` to
 * `POST /api/v1/admin/coord/overlord/labels`. The backend gates on coord-tenant
 * admin and coord derives who labelled, so nothing identity-shaped is sent.
 * A refusal is shown as the backend sent it — status and typed body — not
 * reworded.
 */

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { httpClient } from "@/services/service-factory";
import { operationsErrorMessage, readJson } from "@/lib/api/operations/base";

type LabelKind = "class" | "false_finish";

export default function OverlordLabelPage() {
  const [interventionId, setInterventionId] = useState("");
  const [labelKind, setLabelKind] = useState<LabelKind>("class");
  const [operatorLabel, setOperatorLabel] = useState("A");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setResult(null);
    setError(null);
    // A false-finish label may omit the class; E is never valid for it, so
    // the picker only offers A/B there and "none" sends no class at all.
    const body: Record<string, string> = {
      intervention_id: interventionId.trim(),
      label_kind: labelKind,
    };
    if (operatorLabel !== "") body.operator_label = operatorLabel;
    try {
      const url = "/api/v1/admin/coord/overlord/labels";
      const res = await httpClient.fetch(url, {
        method: "POST",
        body: JSON.stringify(body),
        idempotent: false,
      });
      setResult(await readJson<unknown>(res, `POST ${url}`));
    } catch (err) {
      setError(operationsErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const classOptions = labelKind === "class" ? ["A", "B", "E"] : ["", "A", "B"];

  return (
    <div className="space-y-4 p-4 sm:p-6" data-testid="overlord-label-page">
      <h1 className="text-lg font-semibold">Label an overlord intervention</h1>
      <form
        onSubmit={onSubmit}
        className="max-w-xl space-y-4"
        data-testid="overlord-label-form"
      >
        <div className="form-group">
          <label className="form-label" htmlFor="overlord-intervention-id">
            Intervention id
          </label>
          <input
            id="overlord-intervention-id"
            className="input"
            value={interventionId}
            onChange={(e) => setInterventionId(e.target.value)}
            placeholder="uuid"
            required
          />
        </div>

        <fieldset className="form-group">
          <legend className="form-label">Label kind</legend>
          {(["class", "false_finish"] as const).map((kind) => (
            <label key={kind} className="mr-4 text-sm">
              <input
                type="radio"
                name="label_kind"
                value={kind}
                checked={labelKind === kind}
                onChange={() => {
                  setLabelKind(kind);
                  // E is invalid for a false finish; "" (no class) is valid there.
                  if (kind === "false_finish" && operatorLabel === "E") {
                    setOperatorLabel("");
                  }
                  if (kind === "class" && operatorLabel === "") {
                    setOperatorLabel("A");
                  }
                }}
              />{" "}
              {kind}
            </label>
          ))}
        </fieldset>

        <div className="form-group">
          <label className="form-label" htmlFor="overlord-operator-label">
            Class
          </label>
          <select
            id="overlord-operator-label"
            className="input"
            value={operatorLabel}
            onChange={(e) => setOperatorLabel(e.target.value)}
          >
            {classOptions.map((c) => (
              <option key={c} value={c}>
                {c === "" ? "(none)" : c}
              </option>
            ))}
          </select>
        </div>

        <Button
          type="submit"
          disabled={submitting || interventionId.trim() === ""}
        >
          Submit label
        </Button>
      </form>

      {error !== null && (
        <pre
          role="alert"
          className="whitespace-pre-wrap rounded border border-border p-3 text-xs text-destructive"
          data-testid="overlord-label-error"
        >
          {error}
        </pre>
      )}
      {result !== null && (
        <pre
          className="whitespace-pre-wrap rounded border border-border p-3 text-xs"
          data-testid="overlord-label-result"
        >
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
