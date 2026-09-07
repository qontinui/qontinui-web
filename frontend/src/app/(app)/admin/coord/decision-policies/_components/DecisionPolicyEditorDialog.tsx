"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Info, Loader2 } from "lucide-react";
import type { CoordPolicyRow } from "../../_shared/coordPolicies";
import {
  canonicalPayload,
  CREATE_IS_INERT,
  DECISION_POLICY_DOMAINS,
  DECISION_POLICY_MODES,
  DEFAULT_DECISION_DOMAIN,
  domainSpec,
  MODE_DESCRIPTIONS,
  MODE_LABELS,
  payloadToText,
  UNVALIDATED_NOTE,
  validateDecisionPayload,
  type DecisionPolicyInput,
  type DecisionPolicyMode,
  type DecisionPolicyUpdate,
} from "../decisionPolicies";

const STARTER_PAYLOAD = `{
  "constraints": [
    {
      "severity": "hard",
      "check": "",
      "rationale": ""
    }
  ],
  "rubric": {
    "instructions": "",
    "score_on": ["powerful", "scalable", "robust", "clean"]
  },
  "notes": ""
}`;

export interface DecisionPolicyEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing an existing row, or `null` to create one. */
  rule: CoordPolicyRow | null;
  saving: boolean;
  onCreate: (input: DecisionPolicyInput) => Promise<boolean>;
  /** Name / repo / priority / rationale only — coord cannot PATCH a payload,
   *  and `autonomy_level` is not edited here at all (see the module note). */
  onPatch: (policyId: string, body: DecisionPolicyUpdate) => Promise<boolean>;
  /** Domain, mode or payload changed: replace the row (create → delete). */
  onReplace: (
    previous: CoordPolicyRow,
    input: DecisionPolicyInput
  ) => Promise<boolean>;
}

/**
 * Create / edit one decision-domain policy row.
 *
 * Three things this form is deliberately explicit about, because coord is:
 *
 *  - **Creating a row arms nothing.** Coord's `CreatePolicyRequest` has no
 *    `autonomy_level` field, so the row lands at `always_escalate`, which
 *    `decide.rs` short-circuits to Escalate regardless of mode. The create
 *    dialog says so, and offers no autonomy control at all — offering one
 *    would be offering a field the server silently ignores.
 *  - **Changing the payload, domain or mode replaces the row.** Coord's
 *    `UpdatePolicyRequest` carries none of the three, so there is no in-place
 *    edit. Saying so before the user commits is the whole difference between
 *    a Save that means what it says and one that quietly means something else.
 *  - **A malformed payload field is ACCEPTED and then silently dropped.**
 *    `parse_guidance_payload` skips what it cannot read, so coord answers 201
 *    and never serves the rubric. The form is the only place that can say so.
 *
 * **The graduation control is NOT here, on purpose.** It lives on the row's own
 * detail panel in `DecisionPolicyList`. Save on this dialog already means three
 * different writes depending on what changed (create / replace / patch), and a
 * payload edit takes the replace path, which resets `autonomy_level` to the
 * column default — so a graduation set in this dialog and saved alongside a
 * payload change would be silently discarded. Graduation is one field, one
 * PATCH, one confirm, on the live row.
 */
export function DecisionPolicyEditorDialog({
  open,
  onOpenChange,
  rule,
  saving,
  onCreate,
  onPatch,
  onReplace,
}: DecisionPolicyEditorDialogProps) {
  const editing = rule !== null;

  const [name, setName] = useState("");
  const [decisionDomain, setDecisionDomain] = useState<string>(
    DEFAULT_DECISION_DOMAIN
  );
  const [mode, setMode] = useState<DecisionPolicyMode>("guidance");
  const [repo, setRepo] = useState("");
  const [priority, setPriority] = useState("100");
  const [rationale, setRationale] = useState("");
  const [payloadText, setPayloadText] = useState(STARTER_PAYLOAD);

  useEffect(() => {
    if (!open) return;
    const startDomain = rule?.decision_domain ?? DEFAULT_DECISION_DOMAIN;
    const spec = domainSpec(startDomain);
    setName(rule?.name ?? "");
    setDecisionDomain(startDomain);
    setMode(
      (DECISION_POLICY_MODES as readonly string[]).includes(rule?.mode ?? "")
        ? (rule!.mode as DecisionPolicyMode)
        : (spec?.canonicalMode ?? "guidance")
    );
    setRepo(rule?.repo ?? "");
    setPriority(String(rule?.priority ?? 100));
    setRationale(rule?.rationale ?? "");
    setPayloadText(rule ? payloadToText(rule.payload) : STARTER_PAYLOAD);
    // Re-seed only when the dialog opens onto a different subject.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rule?.policy_id]);

  const validation = useMemo(
    () => validateDecisionPayload(payloadText, mode),
    [payloadText, mode]
  );

  const priorityNum = Number.parseInt(priority, 10);
  const priorityValid = Number.isFinite(priorityNum);

  // What forces a REPLACE rather than a PATCH: none of these three columns is
  // on coord's `UpdatePolicyRequest`. A whitespace-only reformat of the payload
  // is NOT a change — comparing canonical forms keeps a reindent from taking
  // the destructive path for nothing.
  const replaceRequired =
    editing &&
    rule !== null &&
    (rule.decision_domain !== decisionDomain ||
      rule.mode !== mode ||
      (validation.ok &&
        canonicalPayload(rule.payload ?? {}) !==
          canonicalPayload(validation.value)));

  const spec = domainSpec(decisionDomain);
  const unvalidated = UNVALIDATED_NOTE[mode];

  const canSave =
    name.trim().length > 0 && priorityValid && validation.ok && !saving;

  const submit = async () => {
    if (!canSave || !validation.ok) return;
    const input: DecisionPolicyInput = {
      name: name.trim(),
      decisionDomain,
      mode,
      payload: validation.value,
      repo,
      priority: priorityNum,
      rationale,
    };
    let ok: boolean;
    if (!editing || rule === null) {
      ok = await onCreate(input);
    } else if (replaceRequired) {
      ok = await onReplace(rule, input);
    } else {
      ok = await onPatch(rule.policy_id, {
        name: input.name,
        repo: repo.trim() === "" ? null : repo.trim(),
        priority: priorityNum,
        rationale,
      });
    }
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
        data-testid="decision-policy-editor"
      >
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit decision policy" : "New decision policy"}
          </DialogTitle>
          <DialogDescription>
            The frame coord serves when a session consults this decision domain.
            Workspace rows outrank coord&apos;s system defaults.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="decision-policy-name">Name</Label>
            <Input
              id="decision-policy-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="pr_fix autonomous repair frame"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="decision-policy-domain">Decision domain</Label>
              <Select value={decisionDomain} onValueChange={setDecisionDomain}>
                <SelectTrigger id="decision-policy-domain" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DECISION_POLICY_DOMAINS.map((d) => (
                    <SelectItem key={d.domain} value={d.domain}>
                      {d.domain}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {spec?.description}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="decision-policy-mode">Mode</Label>
              <Select
                value={mode}
                onValueChange={(v) => setMode(v as DecisionPolicyMode)}
              >
                <SelectTrigger id="decision-policy-mode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DECISION_POLICY_MODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {MODE_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {MODE_DESCRIPTIONS[mode]}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="decision-policy-repo">Repo scope</Label>
              <Input
                id="decision-policy-repo"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="owner/repo — leave blank for the whole workspace"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                A repo-scoped row outranks a workspace-wide one for that repo
                and never matches any other.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="decision-policy-priority">Priority</Label>
              <Input
                id="decision-policy-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                inputMode="numeric"
              />
              <p className="text-xs text-muted-foreground">
                Lower wins, among rows in the same band.
              </p>
              {!priorityValid && (
                <p
                  className="text-xs text-destructive"
                  data-testid="decision-policy-priority-error"
                >
                  Priority must be a whole number.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="decision-policy-rationale">Rationale</Label>
            <Textarea
              id="decision-policy-rationale"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              rows={2}
              placeholder="Why this domain is framed this way, and what evidence says so"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="decision-policy-payload">Payload (JSON)</Label>
            <Textarea
              id="decision-policy-payload"
              value={payloadText}
              onChange={(e) => setPayloadText(e.target.value)}
              rows={12}
              spellCheck={false}
              className="font-mono text-xs"
              data-testid="decision-policy-payload"
            />
            {!validation.ok ? (
              <p
                className="flex items-start gap-1 text-xs text-destructive"
                data-testid="decision-policy-payload-error"
                role="alert"
              >
                <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                <span>{validation.error}</span>
              </p>
            ) : (
              <>
                {validation.warnings.length > 0 && (
                  <div
                    className="space-y-1 rounded-md border border-warning/40 bg-warning/5 p-2"
                    data-testid="decision-policy-payload-warnings"
                  >
                    <p className="text-xs font-medium">
                      Coord will accept this write and then silently drop{" "}
                      {validation.warnings.length === 1
                        ? "this field"
                        : "these fields"}
                      :
                    </p>
                    <ul className="space-y-1">
                      {validation.warnings.map((w) => (
                        <li
                          key={`${w.path}:${w.message}`}
                          className="text-xs text-muted-foreground"
                        >
                          <code className="font-mono">{w.path}</code> —{" "}
                          {w.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {validation.unread.length > 0 && (
                  <p
                    className="text-xs text-muted-foreground"
                    data-testid="decision-policy-payload-unread"
                  >
                    Stored but not read in <code>{mode}</code> mode:{" "}
                    <code className="font-mono">
                      {validation.unread.join(", ")}
                    </code>
                    . Coord reads constraints, rubric and notes
                    {mode === "data_driven" ? ", and query" : ""}.
                  </p>
                )}
              </>
            )}
            {unvalidated && (
              <p
                className="flex items-start gap-1 text-xs text-muted-foreground"
                data-testid="decision-policy-unvalidated-note"
              >
                <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
                <span>{unvalidated}</span>
              </p>
            )}
          </div>

          {!editing && (
            <p
              className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground"
              data-testid="decision-policy-inert-note"
            >
              {CREATE_IS_INERT}
            </p>
          )}

          {replaceRequired && (
            <p
              className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs"
              data-testid="decision-policy-replace-note"
            >
              Coord cannot edit a row&apos;s domain, mode or payload in place,
              so saving <strong>replaces</strong> this row: the new one is
              created first, then the old one is deleted. The old row keeps
              deciding until that second step lands, so the domain is never left
              with no policy — and if the delete fails, both are listed and the
              old one still decides.
              {rule && rule.autonomy_level !== "always_escalate" && (
                <>
                  {" "}
                  The replacement lands at{" "}
                  <code className="font-mono">always_escalate</code>, because
                  coord has no autonomy field on create — so this row stops
                  being <code className="font-mono">{rule.autonomy_level}</code>{" "}
                  and consults escalate again until you graduate it.
                </>
              )}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!canSave}
            data-testid="decision-policy-save"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {editing ? "Save" : "Create policy"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
