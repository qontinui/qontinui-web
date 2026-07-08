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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { BackoffFields } from "./BackoffFields";
import {
  DEFAULT_BACKOFF,
  DEFAULT_SCORING_SURFACE,
  type BackoffConfig,
  type PolicyAction,
  type PolicyCondition,
  type PolicyCreate,
  type PolicyOption,
  type PolicyRow,
  type PolicyUpdate,
  type ResolutionKind,
  type RuleKind,
} from "../types";

interface RuleEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the dialog edits this rule; otherwise it creates a new one. */
  rule: PolicyRow | null;
  saving: boolean;
  onCreate: (data: PolicyCreate) => Promise<boolean>;
  onUpdate: (id: string, data: PolicyUpdate) => Promise<boolean>;
  /** Re-seed the rule's action from its `default_source` code default. */
  onRestore: (id: string) => Promise<boolean>;
}

/**
 * Validate a regex pattern against the RUST `regex` dialect that actually runs
 * the rule (coord validates on CRUD → 422; the runner matches with the same
 * engine). This is a best-effort client hint aligned to Rust rather than raw
 * JS `RegExp`, which is a different dialect in both directions:
 *  - Inline flags like `(?i)` / `(?im)` are VALID in Rust but *throw* in JS
 *    `RegExp` — so we strip a leading bare-flag group before the JS syntax
 *    check to avoid false-rejecting valid patterns (the exact case that tripped
 *    up authoring — use the case-insensitive toggle OR a leading `(?i)`).
 *  - Lookaround (`(?=)`, `(?!)`, `(?<=)`, `(?<!)`) and backreferences (`\1`,
 *    `\k<name>`) are accepted by JS but REJECTED by Rust `regex` — we flag them
 *    up front, since coord would 422 them on save.
 * coord's 422 remains the authority; this just steers authors correctly. See
 * qontinui-web#635.
 */
function regexError(pattern: string): string | null {
  if (!pattern) return null;

  // Constructs JS `RegExp` accepts but the Rust `regex` engine rejects — coord
  // would 422 these, so surface them as errors here rather than passing them.
  if (/\(\?<?[=!]/.test(pattern)) {
    return "Lookaround ((?=), (?!), (?<=), (?<!)) isn't supported by the rule engine (Rust regex).";
  }
  if (/\\[1-9]/.test(pattern) || /\\k<[^>]+>/.test(pattern)) {
    return "Backreferences (\\1, \\k<name>) aren't supported by the rule engine (Rust regex).";
  }

  // Rust accepts a leading inline-flag group (`(?i)`, `(?im)`, …) that JS
  // `RegExp` rejects; strip it before the JS syntax check so valid patterns
  // aren't false-flagged. (Rust flags: i, m, s, x, u, U.)
  const forSyntaxCheck = pattern.replace(/^\(\?[imsxuU]+\)/, "");
  try {
    void new RegExp(forSyntaxCheck);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Invalid regular expression";
  }
}

/** Read the initial form state out of an existing rule row (or blanks). */
function deriveInitial(rule: PolicyRow | null): {
  name: string;
  trigger: RuleKind;
  pattern: string;
  caseInsensitive: boolean;
  backoff: BackoffConfig;
  questionContains: string;
  resolution: ResolutionKind;
  promptText: string;
  metaTemplate: string;
  options: PolicyOption[];
  surface: string;
  autoAnswer: boolean;
} {
  if (!rule) {
    return {
      name: "",
      trigger: "terminal_auto_response",
      pattern: "",
      caseInsensitive: false,
      backoff: DEFAULT_BACKOFF,
      questionContains: "",
      resolution: "fixed",
      promptText: "",
      metaTemplate: "",
      options: [{ id: "", label: "" }],
      surface: DEFAULT_SCORING_SURFACE,
      autoAnswer: false,
    };
  }

  const trigger: RuleKind =
    rule.kind === "question_auto_answer"
      ? "question_auto_answer"
      : "terminal_auto_response";

  const cond = rule.condition as PolicyCondition | Record<string, never>;
  const action = rule.action as PolicyAction | Record<string, never>;

  let pattern = "";
  let caseInsensitive = false;
  let backoff: BackoffConfig = DEFAULT_BACKOFF;
  let questionContains = "";
  if ("type" in cond) {
    if (cond.type === "terminal_regex_match") {
      pattern = cond.pattern;
      caseInsensitive = cond.case_insensitive ?? false;
      backoff = cond.backoff ?? DEFAULT_BACKOFF;
    } else if (cond.type === "question_match") {
      questionContains = (cond.question_contains ?? []).join("\n");
    }
  }

  let resolution: ResolutionKind = "fixed";
  let promptText = "";
  let metaTemplate = "";
  let options: PolicyOption[] = [{ id: "", label: "" }];
  let surface = DEFAULT_SCORING_SURFACE;
  if ("type" in action) {
    if (action.type === "submit_prompt") {
      resolution = "fixed";
      promptText = action.text;
    } else if (action.type === "auto_answer") {
      resolution = "fixed";
      promptText = action.response;
    } else if (action.type === "resolve_by_scoring") {
      resolution = "scoring";
      options =
        action.options.length > 0 ? action.options : [{ id: "", label: "" }];
      surface = action.surface;
    } else if (action.type === "meta_answer") {
      resolution = "meta";
      metaTemplate = action.template;
    }
  }

  return {
    name: rule.name,
    trigger,
    pattern,
    caseInsensitive,
    backoff,
    questionContains,
    resolution,
    promptText,
    metaTemplate,
    options,
    surface,
    autoAnswer: rule.autonomy_level === "auto_decide",
  };
}

export function RuleEditorDialog({
  open,
  onOpenChange,
  rule,
  saving,
  onCreate,
  onUpdate,
  onRestore,
}: RuleEditorDialogProps) {
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<RuleKind>("terminal_auto_response");
  const [pattern, setPattern] = useState("");
  const [caseInsensitive, setCaseInsensitive] = useState(false);
  const [backoff, setBackoff] = useState<BackoffConfig>(DEFAULT_BACKOFF);
  const [questionContains, setQuestionContains] = useState("");
  const [resolution, setResolution] = useState<ResolutionKind>("fixed");
  const [promptText, setPromptText] = useState("");
  const [metaTemplate, setMetaTemplate] = useState("");
  const [options, setOptions] = useState<PolicyOption[]>([
    { id: "", label: "" },
  ]);
  const [surface, setSurface] = useState(DEFAULT_SCORING_SURFACE);
  // Whether a question-scoring rule is graduated to auto-answer (autonomy_level
  // === "auto_decide"). Read from the existing row; settable only on edit (PATCH).
  const [autoAnswer, setAutoAnswer] = useState(false);

  // Reset the whole form whenever the dialog opens (for the active rule, or blank).
  useEffect(() => {
    if (!open) return;
    const init = deriveInitial(rule);
    setName(init.name);
    setTrigger(init.trigger);
    setPattern(init.pattern);
    setCaseInsensitive(init.caseInsensitive);
    setBackoff(init.backoff);
    setQuestionContains(init.questionContains);
    setResolution(init.resolution);
    setPromptText(init.promptText);
    setMetaTemplate(init.metaTemplate);
    setOptions(init.options);
    setSurface(init.surface);
    setAutoAnswer(init.autoAnswer);
  }, [open, rule]);

  const isTerminal = trigger === "terminal_auto_response";
  const patternError = useMemo(
    () => (isTerminal ? regexError(pattern) : null),
    [isTerminal, pattern]
  );

  // The standing decision-delegation meta-answer catch-all. It is coord-seeded
  // (never created from this dialog), matches every agent question, and the
  // operator edits only its token template — so its condition is left untouched.
  const isMeta = resolution === "meta";

  const cleanedOptions = options.filter(
    (o) => o.id.trim().length > 0 && o.label.trim().length > 0
  );

  const canSubmit = (() => {
    if (saving) return false;
    if (name.trim().length === 0) return false;
    if (isMeta) {
      // The catch-all condition is preserved; only the template is validated.
      return metaTemplate.trim().length > 0;
    }
    if (isTerminal) {
      if (pattern.trim().length === 0 || patternError !== null) return false;
    } else {
      if (questionContains.trim().length === 0) return false;
    }
    if (resolution === "fixed") {
      if (promptText.trim().length === 0) return false;
    } else {
      if (cleanedOptions.length === 0 || surface.trim().length === 0)
        return false;
    }
    return true;
  })();

  const buildCondition = (): PolicyCondition => {
    if (isTerminal) {
      return {
        type: "terminal_regex_match",
        pattern,
        case_insensitive: caseInsensitive,
        backoff,
      };
    }
    return {
      type: "question_match",
      question_contains: questionContains
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0),
    };
  };

  const buildAction = (): PolicyAction => {
    if (isMeta) {
      return { type: "meta_answer", template: metaTemplate };
    }
    if (resolution === "fixed") {
      // A terminal rule injects via submit_prompt; an agent-question rule
      // answers via auto_answer. Both carry the operator's fixed text.
      return isTerminal
        ? { type: "submit_prompt", text: promptText }
        : { type: "auto_answer", response: promptText };
    }
    return {
      type: "resolve_by_scoring",
      options: cleanedOptions,
      surface,
    };
  };

  const handleRestore = async () => {
    if (!rule) return;
    if (
      !window.confirm(
        "Restore this rule to its built-in default? Your current edits to it " +
          "will be replaced by the shipped default wording."
      )
    ) {
      return;
    }
    const ok = await onRestore(rule.policy_id);
    if (ok) onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const action = buildAction();
    let ok: boolean;
    if (rule) {
      // Autonomy graduation is only meaningful for a question-scoring rule, and
      // is settable only via PATCH (coord#920). Confirm before turning it ON —
      // it lets coord auto-answer agent questions without operator review.
      const isQuestionScoring = !isTerminal && resolution === "scoring";
      if (
        isQuestionScoring &&
        autoAnswer &&
        rule.autonomy_level !== "auto_decide" &&
        !window.confirm(
          "Enable auto-answer? coord will auto-answer matching agent questions " +
            "with the composed winning option, without operator review. " +
            "Leave off to keep the rule in shadow mode (recorded, not acted)."
        )
      ) {
        return;
      }
      ok = await onUpdate(rule.policy_id, {
        name,
        kind: trigger,
        // The meta-answer catch-all keeps its coord-seeded match-everything
        // condition; every other rule PATCHes the edited condition.
        ...(isMeta ? {} : { condition: buildCondition() }),
        action,
        ...(isQuestionScoring
          ? {
              autonomy_level: autoAnswer ? "auto_decide" : "guidance_only",
            }
          : {}),
      });
    } else {
      ok = await onCreate({
        name,
        kind: trigger,
        condition: buildCondition(),
        action,
      });
    }
    if (ok) onOpenChange(false);
  };

  const updateOption = (index: number, patch: Partial<PolicyOption>) => {
    setOptions((prev) =>
      prev.map((o, i) => (i === index ? { ...o, ...patch } : o))
    );
  };
  const addOption = () =>
    setOptions((prev) => [...prev, { id: "", label: "" }]);
  const removeOption = (index: number) =>
    setOptions((prev) =>
      prev.length > 1 ? prev.filter((_, i) => i !== index) : prev
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{rule ? "Edit Rule" : "New Rule"}</DialogTitle>
          <DialogDescription>
            An automation rule fires when its trigger condition matches and
            applies the chosen resolution. Rules are tenant-scoped and served to
            the fleet by coord.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="rule-name">Name</Label>
            <Input
              id="rule-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Continue on permission prompt"
            />
          </div>

          {isMeta ? (
            /* Meta-answer editor — the standing decision-delegation catch-all.
               The operator edits only the token template; the match-everything
               condition is coord-seeded and left untouched. */
            <div className="space-y-2">
              <Label htmlFor="rule-meta-template">Answer template</Label>
              <p className="text-xs text-muted-foreground">
                The single decision-delegation answer coord gives to an agent
                question when no more-specific rule matches.{" "}
                <code>{"{{twin-catalog}}"}</code> expands to the queryable
                digital-twin surfaces, and <code>{"{{policy:<handle>}}"}</code>{" "}
                expands to that policy document&apos;s body — both resolved per
                tenant at answer time.
              </p>
              <Textarea
                id="rule-meta-template"
                data-testid="rule-meta-template"
                value={metaTemplate}
                onChange={(e) => setMetaTemplate(e.target.value)}
                rows={16}
                className="font-mono text-xs"
                placeholder="Decide it yourself… {{twin-catalog}} … {{policy:engineering-priorities}}"
              />
            </div>
          ) : (
            <>
              {/* Trigger selector */}
              <div className="space-y-2">
                <Label>Trigger</Label>
                <Select
                  value={trigger}
                  onValueChange={(v) => setTrigger(v as RuleKind)}
                  disabled={rule !== null}
                >
                  <SelectTrigger data-testid="rule-trigger">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="terminal_auto_response">
                      Terminal output (regex)
                    </SelectItem>
                    <SelectItem value="question_auto_answer">
                      Agent question
                    </SelectItem>
                  </SelectContent>
                </Select>
                {rule !== null && (
                  <p className="text-xs text-muted-foreground">
                    The trigger type can&apos;t be changed after creation.
                  </p>
                )}
              </div>

              {/* Condition sub-form */}
              {isTerminal ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="rule-pattern">Pattern (regex)</Label>
                    <Input
                      id="rule-pattern"
                      value={pattern}
                      onChange={(e) => setPattern(e.target.value)}
                      placeholder="e.g. Do you want to proceed\?"
                      aria-invalid={patternError !== null}
                      className={
                        patternError !== null
                          ? "border-destructive focus-visible:ring-destructive"
                          : undefined
                      }
                    />
                    {patternError !== null && (
                      <p className="text-xs text-destructive">
                        Invalid regex: {patternError}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="rule-ci">Case-insensitive</Label>
                    <Switch
                      id="rule-ci"
                      checked={caseInsensitive}
                      onCheckedChange={setCaseInsensitive}
                    />
                  </div>
                </>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="rule-question">Question contains</Label>
                  <Textarea
                    id="rule-question"
                    value={questionContains}
                    onChange={(e) => setQuestionContains(e.target.value)}
                    rows={3}
                    placeholder="One phrase per line; the question must contain all of them."
                  />
                  <p className="text-xs text-muted-foreground">
                    One match phrase per line.
                  </p>
                </div>
              )}

              {/* Resolution selector */}
              <div className="space-y-2">
                <Label>Resolution</Label>
                <Select
                  value={resolution}
                  onValueChange={(v) => setResolution(v as ResolutionKind)}
                >
                  <SelectTrigger data-testid="rule-resolution">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">Fixed response</SelectItem>
                    <SelectItem value="scoring">Scored composition</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Action sub-form */}
              {resolution === "fixed" ? (
                <div className="space-y-2">
                  <Label htmlFor="rule-prompt">
                    {isTerminal ? "Prompt" : "Response"}
                  </Label>
                  <Textarea
                    id="rule-prompt"
                    value={promptText}
                    onChange={(e) => setPromptText(e.target.value)}
                    rows={4}
                    placeholder={
                      isTerminal
                        ? "The text to send when the pattern matches"
                        : "The answer to send when the question matches"
                    }
                  />
                </div>
              ) : (
                <div className="space-y-3 rounded-lg border border-border p-4">
                  <div className="space-y-2">
                    <Label htmlFor="rule-surface">Composition surface</Label>
                    <Input
                      id="rule-surface"
                      value={surface}
                      onChange={(e) => setSurface(e.target.value)}
                      placeholder="e.g. agent_question"
                    />
                    <p className="text-xs text-muted-foreground">
                      The priority-set surface whose priorities the option
                      scores are composed against.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Options</Label>
                    {options.map((opt, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <Input
                          value={opt.id}
                          onChange={(e) =>
                            updateOption(index, { id: e.target.value })
                          }
                          placeholder="id"
                          className="w-32 shrink-0"
                        />
                        <Input
                          value={opt.label}
                          onChange={(e) =>
                            updateOption(index, { label: e.target.value })
                          }
                          placeholder="label"
                          className="flex-1"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 shrink-0 p-0"
                          onClick={() => removeOption(index)}
                          disabled={options.length <= 1}
                          title="Remove option"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addOption}
                    >
                      <Plus className="size-4" />
                      Add option
                    </Button>
                  </div>

                  {/* Autonomy graduation — question-scoring rules only. Settable via
                  PATCH (coord#920); create is shadow-default. */}
                  {!isTerminal &&
                    (rule ? (
                      <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="rule-auto-answer">
                            Auto-answer matching questions
                          </Label>
                          <Switch
                            id="rule-auto-answer"
                            checked={autoAnswer}
                            onCheckedChange={setAutoAnswer}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {autoAnswer
                            ? "coord auto-answers matching agent questions with the composed winning option — no operator review."
                            : "Shadow mode: resolutions are recorded but not acted on. Turn on to graduate this rule to auto-answer."}
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        New rules start in{" "}
                        <span className="font-medium">shadow mode</span>. Create
                        the rule first, then edit it to enable auto-answer.
                      </p>
                    ))}
                </div>
              )}

              {/* Backoff editor — terminal rules only */}
              {isTerminal && (
                <BackoffFields value={backoff} onChange={setBackoff} />
              )}
            </>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          {/* Restore-to-default — only for a coord-seeded rule (default_source
              non-null), e.g. the meta-answer catch-all. */}
          {rule?.default_source != null ? (
            <Button
              variant="outline"
              onClick={handleRestore}
              disabled={saving}
              data-testid="rule-restore-default"
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              Restore to default
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {rule ? "Save Changes" : "Create Rule"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
