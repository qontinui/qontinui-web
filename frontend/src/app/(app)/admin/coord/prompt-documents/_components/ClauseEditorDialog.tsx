"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { AlertTriangle, Loader2, Plus, Trash2 } from "lucide-react";
import {
  CLAUSE_STATUSES,
  CLAUSE_TIERS,
  TIER_INHERIT,
  type Clause,
  type ClauseCreate,
  type ClauseStatus,
  type ClauseTier,
  type ClauseUpdate,
} from "../types";
import { lintClause, type ClauseLintWarning } from "../_lib/clauseLint";

/** kebab-case validator (coord validates the same on CRUD → 400). */
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function clauseIdError(id: string): string | null {
  if (id.trim().length === 0) return "A clause id is required.";
  if (!KEBAB.test(id.trim()))
    return "Must be kebab-case: lowercase letters, digits, and single hyphens.";
  return null;
}

interface ClauseEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the dialog edits this clause; otherwise it creates a new one. */
  clause: Clause | null;
  /** The policy document name — used as the clause `category`. */
  category: string;
  /** The category default tier (from `attrs.default_tier`) an inheriting clause takes. */
  defaultTier: ClauseTier | null;
  /** Existing clause ids in this document (for `depends_on` validation + dup id check). */
  existingClauseIds: string[];
  saving: boolean;
  onCreate: (data: ClauseCreate) => Promise<boolean>;
  onUpdate: (clauseId: string, data: ClauseUpdate) => Promise<boolean>;
}

interface FormState {
  clauseId: string;
  status: ClauseStatus;
  tier: ClauseTier | null;
  trigger: string;
  action: string;
  bounds: string;
  /** CLOSED list of discrete escalation conditions (joined to a string on save). */
  escalateIf: string[];
  antiTriggers: string[];
  dependsOn: string[];
  links: string[];
}

function deriveInitial(clause: Clause | null): FormState {
  if (!clause) {
    return {
      clauseId: "",
      status: "proposed",
      tier: null,
      trigger: "",
      action: "",
      bounds: "",
      escalateIf: [],
      antiTriggers: [],
      dependsOn: [],
      links: [],
    };
  }
  return {
    clauseId: clause.clause_id,
    status: clause.status,
    tier: clause.tier,
    trigger: clause.trigger,
    action: clause.action,
    bounds: clause.bounds,
    escalateIf: splitConditions(clause.escalate_if),
    antiTriggers: clause.anti_triggers ?? [],
    dependsOn: clause.depends_on ?? [],
    links: clause.links ?? [],
  };
}

/** Split a stored `escalate_if` string into discrete conditions (newline-list). */
function splitConditions(s: string): string[] {
  return s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** A minimal add/remove list editor for string fields. */
function StringListEditor({
  label,
  hint,
  placeholder,
  values,
  onChange,
  itemWarning,
  testid,
}: {
  label: string;
  hint?: string;
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => void;
  /** Optional per-item warning (e.g. unknown depends_on target). */
  itemWarning?: (value: string) => string | null;
  testid: string;
}) {
  const update = (i: number, v: string) =>
    onChange(values.map((x, idx) => (idx === i ? v : x)));
  const remove = (i: number) => onChange(values.filter((_, idx) => idx !== i));
  const add = () => onChange([...values, ""]);
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {values.map((v, i) => {
        const warn = itemWarning?.(v) ?? null;
        return (
          <div key={i} className="space-y-1">
            <div className="flex items-center gap-2">
              <Input
                value={v}
                onChange={(e) => update(i, e.target.value)}
                placeholder={placeholder}
                className="flex-1"
                data-testid={`${testid}-${i}`}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 shrink-0 p-0"
                onClick={() => remove(i)}
                title="Remove"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
            {warn && (
              <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle className="size-3 shrink-0" />
                {warn}
              </p>
            )}
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        data-testid={`${testid}-add`}
      >
        <Plus className="size-4" />
        Add
      </Button>
    </div>
  );
}

/** Inline non-blocking authoring-lint warnings for a field. */
function LintNote({
  warnings,
  field,
}: {
  warnings: ClauseLintWarning[];
  field: ClauseLintWarning["field"];
}) {
  const forField = warnings.filter((w) => w.field === field);
  if (forField.length === 0) return null;
  return (
    <>
      {forField.map((w, i) => (
        <p
          key={i}
          className="flex items-start gap-1 text-xs text-amber-600 dark:text-amber-400"
          data-testid={`clause-lint-${field}`}
        >
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          {w.message}
        </p>
      ))}
    </>
  );
}

export function ClauseEditorDialog({
  open,
  onOpenChange,
  clause,
  category,
  defaultTier,
  existingClauseIds,
  saving,
  onCreate,
  onUpdate,
}: ClauseEditorDialogProps) {
  const [form, setForm] = useState<FormState>(deriveInitial(null));
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    if (!open) return;
    setForm(deriveInitial(clause));
  }, [open, clause]);

  const isEdit = clause !== null;

  const idError = useMemo(
    () => (isEdit ? null : clauseIdError(form.clauseId)),
    [isEdit, form.clauseId]
  );
  // A create with an id already present in the document would 409 at coord —
  // flag it up front so the author fixes it before submitting.
  const dupId =
    !isEdit &&
    idError === null &&
    existingClauseIds.includes(form.clauseId.trim());

  const escalateJoined = form.escalateIf
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n");

  const lintWarnings = useMemo(
    () =>
      lintClause({
        action: form.action,
        escalate_if: escalateJoined,
        bounds: form.bounds,
      }),
    [form.action, escalateJoined, form.bounds]
  );

  // depends_on entries that don't resolve to an existing clause in this doc.
  const knownIds = useMemo(
    () => new Set(existingClauseIds),
    [existingClauseIds]
  );
  const dependsWarning = (value: string): string | null => {
    const v = value.trim();
    if (v.length === 0) return null;
    if (v === form.clauseId.trim()) return "A clause can't depend on itself.";
    return knownIds.has(v) ? null : `No clause "${v}" in this document.`;
  };

  const canSubmit = (() => {
    if (saving) return false;
    if (!isEdit && (idError !== null || dupId)) return false;
    if (form.trigger.trim().length === 0) return false;
    if (form.action.trim().length === 0) return false;
    return true;
  })();

  const buildBody = (): ClauseCreate => ({
    clause_id: form.clauseId.trim(),
    category,
    status: form.status,
    tier: form.tier,
    trigger: form.trigger.trim(),
    action: form.action.trim(),
    bounds: form.bounds.trim(),
    escalate_if: escalateJoined,
    anti_triggers: form.antiTriggers
      .map((x) => x.trim())
      .filter((x) => x.length > 0),
    depends_on: form.dependsOn.map((x) => x.trim()).filter((x) => x.length > 0),
    links: form.links.map((x) => x.trim()).filter((x) => x.length > 0),
  });

  const submitInFlight = useRef(false);
  const handleSubmit = async () => {
    if (!canSubmit || submitInFlight.current) return;
    submitInFlight.current = true;
    try {
      const body = buildBody();
      let ok: boolean;
      if (isEdit && clause) {
        // clause_id is immutable — PATCH the mutable fields only.
        const { clause_id: _omit, ...rest } = body;
        void _omit;
        ok = await onUpdate(clause.clause_id, rest);
      } else {
        ok = await onCreate(body);
      }
      if (ok) onOpenChange(false);
    } finally {
      submitInFlight.current = false;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] max-w-lg overflow-y-auto"
        data-testid="clause-editor"
      >
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit clause" : "New clause"}</DialogTitle>
          <DialogDescription>
            A structured clause of the <code>{category}</code> policy — a
            trigger, the action to take, its bounds, and a CLOSED list of
            escalation conditions. Served to the fleet by coord.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* clause_id */}
          <div className="space-y-2">
            <Label htmlFor="clause-id">Clause id</Label>
            <Input
              id="clause-id"
              value={form.clauseId}
              onChange={(e) => set("clauseId", e.target.value)}
              placeholder="e.g. reads-are-free"
              disabled={isEdit}
              aria-invalid={idError !== null || dupId}
              className={
                idError !== null || dupId
                  ? "border-destructive focus-visible:ring-destructive"
                  : undefined
              }
              data-testid="clause-id"
            />
            {isEdit ? (
              <p className="text-xs text-muted-foreground">
                The clause id can&apos;t be changed after creation.
              </p>
            ) : idError !== null ? (
              <p className="text-xs text-destructive">{idError}</p>
            ) : dupId ? (
              <p className="text-xs text-destructive">
                A clause with this id already exists in this document.
              </p>
            ) : null}
          </div>

          {/* status + tier */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => set("status", v as ClauseStatus)}
              >
                <SelectTrigger data-testid="clause-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLAUSE_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tier</Label>
              <Select
                value={form.tier ?? TIER_INHERIT}
                onValueChange={(v) =>
                  set("tier", v === TIER_INHERIT ? null : (v as ClauseTier))
                }
              >
                <SelectTrigger data-testid="clause-tier">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TIER_INHERIT}>
                    Inherit{defaultTier ? ` (${defaultTier})` : " / none"}
                  </SelectItem>
                  {CLAUSE_TIERS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* trigger */}
          <div className="space-y-2">
            <Label htmlFor="clause-trigger">Trigger</Label>
            <Textarea
              id="clause-trigger"
              value={form.trigger}
              onChange={(e) => set("trigger", e.target.value)}
              rows={2}
              placeholder="When does this clause apply?"
              data-testid="clause-trigger"
            />
          </div>

          {/* action */}
          <div className="space-y-2">
            <Label htmlFor="clause-action">Action</Label>
            <Textarea
              id="clause-action"
              value={form.action}
              onChange={(e) => set("action", e.target.value)}
              rows={3}
              placeholder="What to do — an imperative instruction, e.g. 'Delete the stale rows'"
              data-testid="clause-action"
            />
            <LintNote warnings={lintWarnings} field="action" />
          </div>

          {/* bounds */}
          <div className="space-y-2">
            <Label htmlFor="clause-bounds">Bounds</Label>
            <Textarea
              id="clause-bounds"
              value={form.bounds}
              onChange={(e) => set("bounds", e.target.value)}
              rows={2}
              placeholder="Scope limits — how far this clause reaches, and where it stops"
              data-testid="clause-bounds"
            />
            <LintNote warnings={lintWarnings} field="bounds" />
          </div>

          {/* escalate_if — CLOSED list */}
          <div className="space-y-2 rounded-lg border border-border p-3">
            <StringListEditor
              label="Escalate if (closed list)"
              hint="Discrete conditions that force an escalation. Keep it a closed list — no open-ended catch-alls."
              placeholder="e.g. the change touches credentials"
              values={form.escalateIf}
              onChange={(next) => set("escalateIf", next)}
              testid="clause-escalate"
            />
            <LintNote warnings={lintWarnings} field="escalate_if" />
          </div>

          {/* anti_triggers */}
          <StringListEditor
            label="Anti-triggers"
            hint="Conditions that explicitly do NOT trigger this clause."
            placeholder="e.g. high blast radius alone"
            values={form.antiTriggers}
            onChange={(next) => set("antiTriggers", next)}
            testid="clause-anti"
          />

          {/* depends_on — validated against existing clause ids */}
          <StringListEditor
            label="Depends on"
            hint="Other clause ids in this document this clause depends on."
            placeholder="e.g. reads-are-free"
            values={form.dependsOn}
            onChange={(next) => set("dependsOn", next)}
            itemWarning={dependsWarning}
            testid="clause-depends"
          />

          {/* links */}
          <StringListEditor
            label="Links"
            placeholder="e.g. https://… or a doc handle"
            values={form.links}
            onChange={(next) => set("links", next)}
            testid="clause-links"
          />
        </div>

        <DialogFooter>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit}
              data-testid="clause-save"
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {isEdit ? "Save changes" : "Create clause"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
