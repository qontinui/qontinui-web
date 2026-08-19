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
import { AlertTriangle, Loader2 } from "lucide-react";
import type { CoordPolicyRow } from "../../_shared/coordPolicies";
import {
  AGENT_NON_AUTHOR_CAVEAT,
  AUTHORITY_DESCRIPTIONS,
  AUTHORITY_LABELS,
  CLEARANCE_AUTHORITIES,
  GATE_CLASS_DESCRIPTIONS,
  nearMissRecommendedClass,
  parseGateClearancePayload,
  rawGateClass,
  RECOMMENDED_GATE_CLASSES,
  resolveEffectiveAuthority,
  resolveWithout,
  type ClearanceAuthority,
} from "../gateClearance";
import type { ClearanceRuleInput } from "../_hooks/useGateClearanceRules";
import { EffectiveAuthorityCell } from "./EffectiveAuthorityMatrix";

const CUSTOM_CLASS = "__custom__";

export interface ClearanceRuleEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing an existing TENANT rule, or `null` to create one. */
  rule: CoordPolicyRow | null;
  /**
   * Seed values for a "override this system default" flow: the dialog opens in
   * create mode with the built-in's class/authority pre-filled.
   */
  seed?: { gateClass: string; authority: ClearanceAuthority } | null;
  /** The full rule set, for the live before/after resolution preview. */
  rules: readonly CoordPolicyRow[];
  saving: boolean;
  onCreate: (input: ClearanceRuleInput) => Promise<boolean>;
  /** Name / priority / rationale only — coord cannot PATCH a rule's payload. */
  onPatch: (
    policyId: string,
    body: { name?: string; priority?: number; rationale?: string }
  ) => Promise<boolean>;
  /** Class or authority changed: replace the row (create → disable → delete). */
  onReplace: (
    previous: CoordPolicyRow,
    input: ClearanceRuleInput
  ) => Promise<boolean>;
}

/**
 * Create / edit one `gate_clearance` rule.
 *
 * Two things this form is deliberately explicit about, because coord is:
 *
 *  - **The class is freeform text and matching is byte-exact.** The three
 *    recommended classes are offered as first-class choices AND a custom value
 *    is allowed, with a near-miss warning — a typo'd class matches no gate and
 *    the whole class silently falls back to the audience default.
 *  - **Changing the class or authority replaces the row.** Coord's
 *    `UpdatePolicyRequest` has no `payload` field, so there is no in-place edit
 *    of either. The dialog says so before the user commits, rather than
 *    presenting a Save that quietly means something else.
 */
export function ClearanceRuleEditorDialog({
  open,
  onOpenChange,
  rule,
  seed,
  rules,
  saving,
  onCreate,
  onPatch,
  onReplace,
}: ClearanceRuleEditorDialogProps) {
  const editing = rule !== null;
  const existing = rule ? parseGateClearancePayload(rule.payload) : null;

  const [name, setName] = useState("");
  const [classChoice, setClassChoice] = useState<string>(
    RECOMMENDED_GATE_CLASSES[0]
  );
  const [customClass, setCustomClass] = useState("");
  const [authority, setAuthority] =
    useState<ClearanceAuthority>("operator_only");
  const [priority, setPriority] = useState("100");
  const [rationale, setRationale] = useState("");

  useEffect(() => {
    if (!open) return;
    const startClass =
      existing?.gate_class ??
      (rule ? (rawGateClass(rule.payload) ?? "") : (seed?.gateClass ?? ""));
    const isRecommended = (
      RECOMMENDED_GATE_CLASSES as readonly string[]
    ).includes(startClass);
    setName(rule?.name ?? defaultName(startClass));
    setClassChoice(
      startClass === ""
        ? RECOMMENDED_GATE_CLASSES[0]
        : isRecommended
          ? startClass
          : CUSTOM_CLASS
    );
    setCustomClass(isRecommended ? "" : startClass);
    setAuthority(existing?.authority ?? seed?.authority ?? "operator_only");
    setPriority(String(rule?.priority ?? 100));
    setRationale(rule?.rationale ?? "");
    // Re-seed only when the dialog opens onto a different subject.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rule?.policy_id, seed?.gateClass, seed?.authority]);

  const gateClass =
    classChoice === CUSTOM_CLASS ? customClass.trim() : classChoice;
  const nearMiss = gateClass ? nearMissRecommendedClass(gateClass) : null;
  const untrimmed = classChoice === CUSTOM_CLASS && customClass !== gateClass;

  // What changes when this rule lands. `existing` is null for a create, and
  // for an edit it tells us whether the payload half moved at all.
  const payloadChanged =
    !editing ||
    existing === null ||
    existing.gate_class !== gateClass ||
    existing.authority !== authority;

  const priorityNum = Number.parseInt(priority, 10);
  const priorityValid = Number.isFinite(priorityNum);

  // The class this rule is MOVING AWAY from, when the edit re-points it.
  // Vacating a class is a real consequence — the class it leaves usually has no
  // other rule and falls to the audience default, which for agent-audience
  // gates is the loosest setting there is — so it gets its own preview.
  const vacatedClass =
    editing && existing && existing.gate_class !== gateClass
      ? existing.gate_class
      : null;

  // Live consequence preview: who decides this class today vs. after the save.
  const { before, after, vacatedAfter } = useMemo(() => {
    const others = rule
      ? rules.filter((r) => r.policy_id !== rule.policy_id)
      : rules;
    const draft: CoordPolicyRow = {
      ...(rule ?? PREVIEW_ROW_TEMPLATE),
      policy_id: rule?.policy_id ?? "__draft__",
      built_in: false,
      enabled: true,
      repo: null,
      expires_at: null,
      priority: priorityValid ? priorityNum : 100,
      decision_domain: "gate_clearance",
      // A payload change is a REPLACE: coord creates a genuinely new row, so
      // the saved rule sorts LAST in the resolver's `created_at ASC` tie-break,
      // not where the row being edited sits today. Using the old timestamp here
      // would show this rule winning a tie the replacement would actually lose.
      created_at: payloadChanged
        ? PREVIEW_ROW_TEMPLATE.created_at
        : (rule?.created_at ?? PREVIEW_ROW_TEMPLATE.created_at),
      payload: { gate_class: gateClass, authority },
    };
    return {
      before: resolveEffectiveAuthority(rules, gateClass),
      after: resolveEffectiveAuthority([...others, draft], gateClass),
      vacatedAfter:
        vacatedClass && rule
          ? resolveWithout(rules, vacatedClass, rule.policy_id)
          : null,
    };
  }, [
    rules,
    rule,
    gateClass,
    authority,
    priorityNum,
    priorityValid,
    payloadChanged,
    vacatedClass,
  ]);

  const canSave =
    gateClass.length > 0 && name.trim().length > 0 && priorityValid && !saving;

  const submit = async () => {
    if (!canSave) return;
    const input: ClearanceRuleInput = {
      name: name.trim(),
      gateClass,
      authority,
      priority: priorityNum,
      rationale,
    };
    let ok: boolean;
    if (!editing || rule === null) {
      ok = await onCreate(input);
    } else if (payloadChanged) {
      ok = await onReplace(rule, input);
    } else {
      ok = await onPatch(rule.policy_id, {
        name: input.name,
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
        data-testid="clearance-rule-editor"
      >
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit clearance rule" : "New clearance rule"}
          </DialogTitle>
          <DialogDescription>
            Decides who may clear a coord gate carrying this class. Rules in
            this workspace outrank the system defaults regardless of priority.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="clearance-name">Name</Label>
            <Input
              id="clearance-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Security-surface gates need an operator"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="clearance-class">Gate class</Label>
            <Select value={classChoice} onValueChange={setClassChoice}>
              <SelectTrigger id="clearance-class" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RECOMMENDED_GATE_CLASSES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM_CLASS}>Custom class…</SelectItem>
              </SelectContent>
            </Select>
            {classChoice === CUSTOM_CLASS && (
              <Input
                value={customClass}
                onChange={(e) => setCustomClass(e.target.value)}
                placeholder="my-own-class"
                className="font-mono"
                data-testid="clearance-custom-class"
                aria-label="Custom gate class"
              />
            )}
            <p className="text-xs text-muted-foreground">
              {GATE_CLASS_DESCRIPTIONS[gateClass] ??
                "Coord stores the class as plain text — there is no fixed list. It matches a gate only when the two strings are identical, character for character."}
            </p>
            {untrimmed && (
              <p className="text-xs text-warning">
                Leading/trailing spaces are trimmed before saving —{" "}
                <code className="font-mono">{gateClass}</code> is what coord
                will match.
              </p>
            )}
            {nearMiss && (
              <p
                className="flex items-start gap-1 text-xs text-warning"
                data-testid="clearance-editor-near-miss"
              >
                <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                <span>
                  This is not the same class as{" "}
                  <code className="font-mono">{nearMiss}</code>. Matching is
                  exact and case-sensitive, so a rule on{" "}
                  <code className="font-mono">{gateClass}</code> will not apply
                  to <code className="font-mono">{nearMiss}</code> gates.
                </span>
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="clearance-authority">Who may clear</Label>
            <Select
              value={authority}
              onValueChange={(v) => setAuthority(v as ClearanceAuthority)}
            >
              <SelectTrigger id="clearance-authority" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLEARANCE_AUTHORITIES.map((a) => (
                  <SelectItem key={a} value={a}>
                    {AUTHORITY_LABELS[a]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {AUTHORITY_DESCRIPTIONS[authority]}
            </p>
            {authority === "agent_non_author" && (
              <p
                className="flex items-start gap-1 text-xs text-warning"
                data-testid="clearance-non-author-caveat"
              >
                <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                <span>{AGENT_NON_AUTHOR_CAVEAT}</span>
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="clearance-priority">Priority</Label>
              <Input
                id="clearance-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                inputMode="numeric"
              />
              <p className="text-xs text-muted-foreground">
                Lower wins, among rules in the same band.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="clearance-rationale">Rationale</Label>
              <Textarea
                id="clearance-rationale"
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                rows={2}
                placeholder="Why this class is decided this way"
              />
            </div>
          </div>

          {/* Consequence preview — the resolution before and after, computed
              from the same function that renders the matrix. */}
          {gateClass && (
            <div
              className="rounded-lg border border-border bg-muted/40 p-3"
              data-testid="clearance-editor-preview"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Effect on <code className="font-mono">{gateClass}</code> gates
              </p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] text-muted-foreground">Now</p>
                  <EffectiveAuthorityCell effective={before} />
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">
                    After saving
                  </p>
                  <EffectiveAuthorityCell effective={after} />
                </div>
              </div>
            </div>
          )}

          {vacatedClass && vacatedAfter && (
            <div
              className="rounded-lg border border-warning/40 bg-warning/5 p-3"
              data-testid="clearance-editor-vacated-preview"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                This rule no longer covers{" "}
                <code className="font-mono">{vacatedClass}</code>
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                After saving, gates in that class will be decided by:
              </p>
              <div className="mt-2">
                <EffectiveAuthorityCell effective={vacatedAfter} />
              </div>
            </div>
          )}

          {editing && payloadChanged && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="clearance-editor-replace-note"
            >
              Coord cannot edit a rule&apos;s class or authority in place, so
              saving replaces this rule: the new one is created first, then the
              old one is deleted. The old rule keeps deciding until that second
              step lands, so the class is never left unguarded — and if the
              delete fails, both rules are listed and the old one still decides.
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
            data-testid="clearance-rule-save"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {editing ? "Save" : "Create rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function defaultName(gateClass: string): string {
  return gateClass ? `${gateClass} clearance` : "";
}

/** Field values for the draft row used only by the preview resolution — never
 *  sent anywhere. Only the fields the resolver reads matter. */
const PREVIEW_ROW_TEMPLATE: CoordPolicyRow = {
  policy_id: "__draft__",
  tenant_id: "",
  repo: null,
  name: "",
  kind: null,
  decision_domain: "gate_clearance",
  mode: "data_driven",
  autonomy_level: "always_escalate",
  payload: null,
  condition: {},
  action: {},
  priority: 100,
  enabled: true,
  rationale: null,
  default_source: null,
  expires_at: null,
  created_at: "9999-12-31T00:00:00Z",
  created_by: "",
  updated_at: "9999-12-31T00:00:00Z",
  updated_by: "",
  built_in: false,
  override_state: null,
  system_rule_id: null,
};
