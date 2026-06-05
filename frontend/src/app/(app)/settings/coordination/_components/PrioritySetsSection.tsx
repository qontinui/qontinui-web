"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Loader2,
  Lock,
  Plus,
  Pencil,
  Trash2,
  X,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { usePrioritySets } from "../_hooks/usePrioritySets";
import {
  type PrioritySetRow,
  type SetDelivery,
  type CompositionRuleRow,
  classifySetOrigin,
  friendlyCoordError,
  orderingNames,
  slugifySetName,
} from "../_hooks/priority-set-delivery";
import type { UpdatePrioritySetInput } from "../_hooks/usePrioritySets";

// ---- a minimal add/remove/reorder list editor for bare strings -------------

interface ListEditorProps {
  label: string;
  placeholder: string;
  items: string[];
  ordered: boolean;
  onChange: (next: string[]) => void;
}

function ListEditor({
  label,
  placeholder,
  items,
  ordered,
  onChange,
}: ListEditorProps) {
  const [entry, setEntry] = useState("");

  const add = () => {
    const v = entry.trim();
    if (!v || items.includes(v)) {
      setEntry("");
      return;
    }
    onChange([...items, v]);
    setEntry("");
  };

  const removeAt = (idx: number) =>
    onChange(items.filter((_, i) => i !== idx));

  const move = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const a = next[idx];
    const b = next[target];
    if (a === undefined || b === undefined) return;
    next[idx] = b;
    next[target] = a;
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium">{label}</Label>
      <div className="flex gap-2">
        <Input
          value={entry}
          placeholder={placeholder}
          onChange={(e) => setEntry(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          className="h-8 text-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={add}
          className="h-8 border-border shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">None yet.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item, idx) => (
            <li
              key={`${item}-${idx}`}
              className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs"
            >
              {ordered && (
                <span className="text-muted-foreground tabular-nums w-4 text-right">
                  {idx + 1}.
                </span>
              )}
              <span className="flex-1 truncate font-mono">{item}</span>
              {ordered && (
                <div className="flex items-center">
                  <button
                    type="button"
                    title="Move up"
                    onClick={() => move(idx, -1)}
                    disabled={idx === 0}
                    className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Move down"
                    onClick={() => move(idx, 1)}
                    disabled={idx === items.length - 1}
                    className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <button
                type="button"
                title="Remove"
                onClick={() => removeAt(idx)}
                className="p-0.5 text-muted-foreground hover:text-destructive"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- delivery badge (the honesty gate, surfaced per set) -------------------

function DeliveryState({ delivery }: { delivery: SetDelivery | undefined }) {
  if (!delivery || !delivery.delivered) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/5 px-2.5 py-1.5">
        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-yellow-500 shrink-0" />
        <p className="text-xs text-yellow-600 dark:text-yellow-400">
          Not delivered to agents — no composition rule references this set.
        </p>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
      <span>
        Delivered via:{" "}
        <span className="font-medium">{delivery.surfaces.join(", ")}</span>
      </span>
    </div>
  );
}

// ---- shared set form (create + edit) ---------------------------------------

/** The four user-editable fields, normalized to v1 bare-string form. */
interface SetFormValues {
  /** Raw name text. For create this is slugified on submit; for edit it is the
   *  current slug (already valid) and re-slugified on submit defensively. */
  name: string;
  repo: string;
  ordering: string[];
  nonFactors: string[];
}

interface SetFormBodyProps {
  initial: SetFormValues;
  submitLabel: string;
  submitBusyLabel: string;
  busy: boolean;
  /** Returns true on success (so the form can reset/close). */
  onSubmit: (values: {
    set_name: string;
    repo: string | null;
    ordering: string[];
    non_factors: string[];
  }) => Promise<boolean>;
  onCancel: () => void;
  /** Stable id prefix to keep label htmlFor unique across rows + create. */
  idPrefix: string;
}

/**
 * The shared form fields + actions, with no surrounding chrome. Owns its own
 * field state seeded from `initial`; the parent supplies create- vs edit-
 * specific behavior via `onSubmit`/`onCancel` and the busy flag. Reused by both
 * the create flow (inside a Collapsible) and inline editing of a row.
 *
 * Predictability gate: the "Will be saved as" hint + the field values are
 * exactly what the submit payload carries (bare-string ordering, trimmed repo,
 * slugified name).
 */
function SetFormBody({
  initial,
  submitLabel,
  submitBusyLabel,
  busy,
  onSubmit,
  onCancel,
  idPrefix,
}: SetFormBodyProps) {
  const [name, setName] = useState(initial.name);
  const [repo, setRepo] = useState(initial.repo);
  const [ordering, setOrdering] = useState<string[]>(initial.ordering);
  const [nonFactors, setNonFactors] = useState<string[]>(initial.nonFactors);
  const [error, setError] = useState<string | null>(null);

  const slug = slugifySetName(name);
  const canSubmit = slug.length > 0 && !busy;

  const submit = async () => {
    setError(null);
    try {
      const ok = await onSubmit({
        set_name: slug,
        repo: repo.trim() === "" ? null : repo.trim(),
        ordering,
        non_factors: nonFactors,
      });
      if (!ok) {
        // create flow reports via its own error channel; nothing to do here.
        return;
      }
    } catch (err) {
      setError(friendlyCoordError(err));
    }
  };

  return (
    <div className="rounded-lg border border-border px-4 py-4 space-y-4">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-name`} className="text-xs font-medium">
          Name
        </Label>
        <Input
          id={`${idPrefix}-name`}
          value={name}
          placeholder="e.g. infra_first"
          onChange={(e) => setName(e.target.value)}
          className="h-8 text-xs"
        />
        {slug && slug !== name.trim() && (
          <p className="text-xs text-muted-foreground">
            Will be saved as{" "}
            <span className="font-mono text-foreground">{slug}</span>
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-repo`} className="text-xs font-medium">
          Repo{" "}
          <span className="font-normal text-muted-foreground">
            (blank = tenant-wide)
          </span>
        </Label>
        <Input
          id={`${idPrefix}-repo`}
          value={repo}
          placeholder="leave blank to apply tenant-wide"
          onChange={(e) => setRepo(e.target.value)}
          className="h-8 text-xs"
        />
      </div>

      <ListEditor
        label="Ordered priorities"
        placeholder="add a priority name, then Enter"
        items={ordering}
        ordered
        onChange={setOrdering}
      />

      <ListEditor
        label="Non-factors"
        placeholder="add a non-factor name, then Enter"
        items={nonFactors}
        ordered={false}
        onChange={setNonFactors}
      />

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-destructive shrink-0" />
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setError(null);
            onCancel();
          }}
          disabled={busy}
          className="h-8 text-xs border-border"
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={submit}
          disabled={!canSubmit}
          className="h-8 text-xs bg-primary text-primary-foreground"
        >
          {busy ? (
            <>
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              {submitBusyLabel}
            </>
          ) : (
            submitLabel
          )}
        </Button>
      </div>
    </div>
  );
}

// ---- origin badge ----------------------------------------------------------

function OriginBadge({ set }: { set: PrioritySetRow }) {
  const origin = classifySetOrigin(set);
  if (origin === "system") {
    return (
      <Badge variant="secondary" className="gap-1">
        <Lock className="w-3 h-3" />
        System default
      </Badge>
    );
  }
  if (origin === "seeded") {
    return <Badge variant="secondary">Seeded default</Badge>;
  }
  return <Badge variant="outline">Custom</Badge>;
}

// ---- a single existing set row ---------------------------------------------

interface SetRowProps {
  set: PrioritySetRow;
  delivery: SetDelivery | undefined;
  deleting: boolean;
  updating: boolean;
  onSoftDelete: (id: string) => void;
  onUpdate: (id: string, partial: UpdatePrioritySetInput) => Promise<boolean>;
}

function SetRow({
  set,
  delivery,
  deleting,
  updating,
  onSoftDelete,
  onUpdate,
}: SetRowProps) {
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const order = useMemo(() => orderingNames(set.ordering), [set.ordering]);

  // `is_system` rows are true cross-tenant inherited rows: read-only. Seeded
  // and custom own-tenant rows are both editable + deletable.
  const editable = !set.is_system;

  const handleEditSubmit = async (values: {
    set_name: string;
    repo: string | null;
    ordering: string[];
    non_factors: string[];
  }): Promise<boolean> => {
    // Minimal diff — send only the fields that actually changed. `ordering` is
    // compared by its bare-name projection (v1 writes back bare strings even if
    // the wire row carried object-shaped {name, weight} entries — same
    // simplification as create).
    const partial: UpdatePrioritySetInput = {};
    if (values.set_name !== set.set_name) partial.set_name = values.set_name;
    if (values.repo !== (set.repo ?? null)) partial.repo = values.repo;
    const currentOrder = orderingNames(set.ordering);
    if (
      values.ordering.length !== currentOrder.length ||
      values.ordering.some((v, i) => v !== currentOrder[i])
    ) {
      partial.ordering = values.ordering;
    }
    if (
      values.non_factors.length !== set.non_factors.length ||
      values.non_factors.some((v, i) => v !== set.non_factors[i])
    ) {
      partial.non_factors = values.non_factors;
    }
    const ok = await onUpdate(set.priority_set_id, partial);
    if (ok) setEditing(false);
    return ok;
  };

  if (editing) {
    return (
      <div className="px-4 py-3 space-y-2">
        <SetFormBody
          idPrefix={`ps-edit-${set.priority_set_id}`}
          initial={{
            name: set.set_name,
            repo: set.repo ?? "",
            ordering: orderingNames(set.ordering),
            nonFactors: set.non_factors,
          }}
          submitLabel="Save changes"
          submitBusyLabel="Saving..."
          busy={updating}
          onSubmit={handleEditSubmit}
          onCancel={() => setEditing(false)}
        />
        {/* Honesty gate stays visible while editing. */}
        <DeliveryState delivery={delivery} />
      </div>
    );
  }

  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium font-mono">
              {set.set_name}
            </span>
            <OriginBadge set={set} />
            <Badge variant="outline">
              {set.repo ? `repo: ${set.repo}` : "tenant-wide"}
            </Badge>
          </div>
          {order.length > 0 && (
            <p className="text-xs text-muted-foreground">
              <span className="text-foreground/70">Order:</span>{" "}
              <span className="font-mono">{order.join(" › ")}</span>
            </p>
          )}
          {set.non_factors.length > 0 && (
            <p className="text-xs text-muted-foreground">
              <span className="text-foreground/70">Non-factors:</span>{" "}
              <span className="font-mono">{set.non_factors.join(", ")}</span>
            </p>
          )}
        </div>

        {editable && (
          <div className="shrink-0">
            {confirming ? (
              <div className="flex items-center gap-1.5">
                <DestructiveButton
                  type="button"
                  size="sm"
                  onClick={() => onSoftDelete(set.priority_set_id)}
                  disabled={deleting}
                  className="h-7 text-xs"
                >
                  {deleting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    "Disable"
                  )}
                </DestructiveButton>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirming(false)}
                  disabled={deleting}
                  className="h-7 text-xs border-border"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex items-center">
                <button
                  type="button"
                  title="Edit"
                  onClick={() => setEditing(true)}
                  className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  title="Disable (soft-delete, restorable)"
                  onClick={() => setConfirming(true)}
                  className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <DeliveryState delivery={delivery} />
      {confirming && (
        <p className="text-xs text-muted-foreground">
          Disabling sets <span className="font-mono">enabled=false</span>; the
          set is kept and can be restored later. No data is destroyed.
        </p>
      )}
    </div>
  );
}

// ---- create form -----------------------------------------------------------

interface CreateFormProps {
  creating: boolean;
  createError: string | null;
  onSubmit: (input: {
    set_name: string;
    repo: string | null;
    ordering: string[];
    non_factors: string[];
  }) => Promise<boolean>;
  onClearError: () => void;
}

function CreateForm({
  creating,
  createError,
  onSubmit,
  onClearError,
}: CreateFormProps) {
  const [open, setOpen] = useState(false);
  // Remount the form body on each open so its internal state resets cleanly
  // (reversibility: Cancel/close always discards).
  const [formKey, setFormKey] = useState(0);

  const close = () => {
    setOpen(false);
    onClearError();
  };

  const submit = async (values: {
    set_name: string;
    repo: string | null;
    ordering: string[];
    non_factors: string[];
  }): Promise<boolean> => {
    onClearError();
    const ok = await onSubmit(values);
    if (ok) {
      setFormKey((k) => k + 1);
      setOpen(false);
    }
    return ok;
  };

  return (
    <Collapsible
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) onClearError();
        else setFormKey((k) => k + 1);
      }}
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
        >
          <Plus className="w-3.5 h-3.5" />
          New priority set
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3">
        <SetFormBody
          key={formKey}
          idPrefix="ps-create"
          initial={{ name: "", repo: "", ordering: [], nonFactors: [] }}
          submitLabel="Create set"
          submitBusyLabel="Creating..."
          busy={creating}
          onSubmit={submit}
          onCancel={close}
        />
        {createError && (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-destructive shrink-0" />
            <p className="text-xs text-destructive">{createError}</p>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---- optional read-only composition wiring summary -------------------------

function WiringSummary({ rules }: { rules: CompositionRuleRow[] }) {
  const [open, setOpen] = useState(false);
  const bySurface = useMemo(() => {
    const map = new Map<
      string,
      { set: string; role: string }[]
    >();
    for (const rule of rules) {
      if (!rule.enabled) continue;
      const existing = map.get(rule.surface) ?? [];
      for (const layer of rule.layers) {
        existing.push({ set: layer.set, role: layer.role });
      }
      map.set(rule.surface, existing);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [rules]);

  if (bySurface.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <span>What reaches agents (composition wiring)</span>
          {open ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        <div className="rounded-lg border border-border divide-y divide-border">
          {bySurface.map(([surface, layers]) => (
            <div key={surface} className="px-4 py-2.5 space-y-1.5">
              <p className="text-xs font-medium">{surface}</p>
              <div className="flex flex-wrap gap-1.5">
                {layers.map((l, i) => (
                  <Badge
                    key={`${l.set}-${l.role}-${i}`}
                    variant="outline"
                    className="font-mono"
                  >
                    {l.set} ({l.role})
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---- section ----------------------------------------------------------------

export function PrioritySetsSection({ canEdit }: { canEdit: boolean }) {
  const {
    sets,
    rules,
    delivery,
    loading,
    creating,
    createError,
    deletingId,
    updatingId,
    createSet,
    updateSet,
    softDeleteSet,
    clearCreateError,
  } = usePrioritySets();

  // Discoverability gate: keep quiet when a tenant has no custom sets and
  // there's nothing to wire — only the create affordance shows.
  const enabledSets = sets.filter((s) => s.enabled);
  // "Custom" here means operator-created (not seeded/system) — drives the
  // "no custom sets yet" hint. Seeded defaults are own-tenant but not custom.
  const hasCustom = enabledSets.some(
    (s) => classifySetOrigin(s) === "custom"
  );

  if (loading) {
    return (
      <section className="space-y-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-xs">Loading priority sets...</span>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">Priority sets</h3>
        <p className="text-xs text-muted-foreground">
          Ordered priorities agents weigh when deciding. A set only takes effect
          once a composition rule delivers it — undelivered sets are flagged
          below.
        </p>
      </div>

      {enabledSets.length > 0 && (
        <div className="rounded-lg border border-border divide-y divide-border">
          {enabledSets.map((set) => (
            <SetRow
              key={set.priority_set_id}
              set={set}
              delivery={delivery[set.set_name]}
              deleting={deletingId === set.priority_set_id}
              updating={updatingId === set.priority_set_id}
              onSoftDelete={softDeleteSet}
              onUpdate={updateSet}
            />
          ))}
        </div>
      )}

      {!hasCustom && (
        <p className="text-xs text-muted-foreground">
          No custom priority sets yet — agents use the system defaults above.
        </p>
      )}

      {canEdit ? (
        <CreateForm
          creating={creating}
          createError={createError}
          onSubmit={createSet}
          onClearError={clearCreateError}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          A coord-tenant admin is required to add or change priority sets.
        </p>
      )}

      <WiringSummary rules={rules} />
    </section>
  );
}
