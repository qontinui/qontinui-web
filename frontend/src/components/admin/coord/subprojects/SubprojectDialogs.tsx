"use client";

/**
 * The operator's corrections to a subproject (plan
 * `2026-11-08-subprojects-group-sessions-gates-and-plans-and-say-why-one-stalled`
 * D11): rename it, set its goal or next-steps note, merge it into another, and
 * move a session or work unit in or out.
 *
 * Each is one dialog over one coord write, admin-only (the page wraps the
 * buttons in `CoordAdminOnly`; the proxy enforces `require_coord_tenant_admin`
 * either way). Each acknowledges itself (served policy `ux-priorities`
 * `an-action-must-acknowledge-itself`): a success toasts and hands control
 * back so the page re-reads what coord now holds; a refusal stays in the
 * dialog as coord's own reading (`BackendErrorMessage`), with the dialog open
 * so nothing typed is lost.
 *
 * The page MOUNTS each dialog only while it is open, so every open starts
 * from the record as it was read then, and the page's minute re-read never
 * resets a field under an operator who is typing in it.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
import { BackendErrorMessage } from "@/components/console";
import { operationsErrorReading } from "@/lib/api/operations/base";
import type { BackendErrorReading } from "@/lib/errors/backend-error-message";
import {
  changeSubprojectMember,
  fetchSubprojects,
  mergeSubproject,
  updateSubproject,
  type SubprojectMembersRequest,
  type SubprojectPatch,
  type SubprojectSummary,
} from "@/lib/api/operations/coordSubprojects";
import {
  readFailureWords,
  classifySubprojectReadFailure,
} from "./subprojectStatus";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One write's outcome as the dialog shows it. */
function useWrite() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BackendErrorReading | null>(null);
  const run = useCallback(
    async <T,>(write: () => Promise<T>): Promise<T | null> => {
      setBusy(true);
      setError(null);
      try {
        return await write();
      } catch (err) {
        setError(operationsErrorReading(err));
        return null;
      } finally {
        setBusy(false);
      }
    },
    []
  );
  return { busy, error, run };
}

// ─────────────────────────── rename / goal / note ───────────────────────────

export type TextField = "title" | "goal" | "next_steps_note";

const TEXT_FIELD: Record<
  TextField,
  {
    title: string;
    label: string;
    description: string;
    multiline: boolean;
    required: boolean;
  }
> = {
  title: {
    title: "Rename",
    label: "Title",
    description:
      "A title set here is explicit: it stops following the root session's name.",
    multiline: false,
    required: true,
  },
  goal: {
    title: "Set the goal",
    label: "Goal",
    description: "What this subproject is for, in a sentence or two.",
    multiline: true,
    required: false,
  },
  next_steps_note: {
    title: "Write the next-steps note",
    label: "Next steps",
    description:
      "The note heads the subproject's next steps and goes into the brief of the next Continue.",
    multiline: true,
    required: false,
  },
};

export function SubprojectTextDialog({
  open,
  onClose,
  field,
  subprojectId,
  initial,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  field: TextField;
  subprojectId: string;
  initial: string;
  onSaved: () => void;
}) {
  const spec = TEXT_FIELD[field];
  const [value, setValue] = useState(initial);
  const write = useWrite();

  const trimmed = value.trim();
  const save = async () => {
    const patch: SubprojectPatch =
      field === "title"
        ? { title: trimmed }
        : field === "goal"
          ? { goal: trimmed }
          : { next_steps_note: trimmed };
    const saved = await write.run(() => updateSubproject(subprojectId, patch));
    if (saved === null) return;
    toast.success(`${spec.label} saved`);
    onSaved();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="sm:max-w-lg"
        data-testid={`subproject-${field}-dialog`}
      >
        <DialogHeader>
          <DialogTitle>{spec.title}</DialogTitle>
          <DialogDescription>{spec.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={`subproject-${field}`}>{spec.label}</Label>
          {spec.multiline ? (
            <Textarea
              id={`subproject-${field}`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              rows={5}
              disabled={write.busy}
              data-testid={`subproject-${field}-input`}
            />
          ) : (
            <Input
              id={`subproject-${field}`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={write.busy}
              data-testid={`subproject-${field}-input`}
            />
          )}
        </div>
        {write.error && (
          <BackendErrorMessage
            error={write.error}
            data-testid={`subproject-${field}-error`}
          />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={write.busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            disabled={
              write.busy ||
              (spec.required && trimmed === "") ||
              trimmed === initial.trim()
            }
            data-testid={`subproject-${field}-save`}
          >
            {write.busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────── the other subprojects ───────────────────────────

type Choices =
  | { state: "loading" }
  | { state: "read"; items: SubprojectSummary[]; truncated: boolean }
  | { state: "failed"; reason: string };

/** The open subprojects a member or a merge can go to, read when a dialog
 *  opens. A read that failed says so; the id can still be typed. */
function useSubprojectChoices(open: boolean, excludeId: string): Choices {
  const [choices, setChoices] = useState<Choices>({ state: "loading" });
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setChoices({ state: "loading" });
    fetchSubprojects(new URLSearchParams({ status: "open", limit: "200" }))
      .then((page) => {
        if (cancelled) return;
        setChoices({
          state: "read",
          items: (Array.isArray(page.items) ? page.items : []).filter(
            (s) => s.id !== excludeId && !s.merged_into
          ),
          truncated: page.truncated === true || page.next_cursor !== null,
        });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setChoices({
            state: "failed",
            reason: readFailureWords(classifySubprojectReadFailure(err)),
          });
      });
    return () => {
      cancelled = true;
    };
  }, [open, excludeId]);
  return choices;
}

/** A subproject picker: the open ones by title, or a typed id. */
function SubprojectPicker({
  id,
  choices,
  value,
  onChange,
  disabled,
  testId,
}: {
  id: string;
  choices: Choices;
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
  testId: string;
}) {
  const [typed, setTyped] = useState(false);
  if (choices.state === "read" && choices.items.length > 0 && !typed) {
    return (
      <div className="space-y-1">
        <Select value={value} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger id={id} data-testid={testId}>
            <SelectValue placeholder="Choose a subproject" />
          </SelectTrigger>
          <SelectContent>
            {choices.items.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.title || s.slug}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="m-0 text-xs text-muted-foreground">
          {choices.truncated ? "The first 200 open subprojects. " : ""}
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground"
            onClick={() => {
              setTyped(true);
              onChange("");
            }}
          >
            Enter a subproject id instead
          </button>
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value.trim())}
        disabled={disabled}
        placeholder="subproject id (uuid)"
        className="font-mono text-xs"
        spellCheck={false}
        data-testid={`${testId}-input`}
      />
      <p className="m-0 text-xs text-muted-foreground">
        {choices.state === "loading"
          ? "Reading the open subprojects…"
          : choices.state === "failed"
            ? `The open subprojects could not be read (${choices.reason}); type the id.`
            : choices.items.length === 0 && !typed
              ? "No other open subproject was found; type an id to use another."
              : "Type the id of the subproject."}
      </p>
    </div>
  );
}

// ─────────────────────────── merge ───────────────────────────

export function MergeDialog({
  open,
  onClose,
  subproject,
  onMerged,
}: {
  open: boolean;
  onClose: () => void;
  subproject: Pick<SubprojectSummary, "id" | "title">;
  onMerged: (intoId: string) => void;
}) {
  const choices = useSubprojectChoices(open, subproject.id);
  const [target, setTarget] = useState("");
  const write = useWrite();

  const targetTitle =
    choices.state === "read"
      ? choices.items.find((s) => s.id === target)?.title
      : undefined;
  const merge = async () => {
    const answer = await write.run(() =>
      mergeSubproject(subproject.id, target)
    );
    if (answer === null) return;
    toast.success(
      `Merged into ${targetTitle ?? answer.merged_into}: ${answer.moved_members} member${answer.moved_members === 1 ? "" : "s"} moved`
    );
    onMerged(answer.merged_into ?? target);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="sm:max-w-lg"
        data-testid="subproject-merge-dialog"
      >
        <DialogHeader>
          <DialogTitle>Merge “{subproject.title}” into…</DialogTitle>
          <DialogDescription>
            Every member — sessions and work units — moves into the subproject
            you choose, and this one then opens as that one. Use it when two
            subprojects are one piece of work.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="subproject-merge-target">Merge into</Label>
          <SubprojectPicker
            id="subproject-merge-target"
            choices={choices}
            value={target}
            onChange={setTarget}
            disabled={write.busy}
            testId="subproject-merge-target"
          />
        </div>
        {write.error && (
          <BackendErrorMessage
            error={write.error}
            data-testid="subproject-merge-error"
          />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={write.busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void merge()}
            disabled={
              write.busy || !UUID.test(target) || target === subproject.id
            }
            data-testid="subproject-merge-submit"
          >
            {write.busy ? "Merging…" : "Merge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────── members ───────────────────────────

/** A member the dialog was opened on (from a member row), or none (from the
 *  page's Move… button, which brings one in). */
export interface MemberPreset {
  kind: "session" | "work_unit";
  /** A harness session id, or a work unit's id. */
  id: string;
  /** What the row calls it, for the dialog's sentence. */
  label: string;
}

type MemberDirection = "in" | "out" | "remove";

/** The members request for a member, keyed the way coord reads it: a
 *  session by harness id, a work unit by id when it is a uuid, else by slug. */
export function memberRequest(
  action: SubprojectMembersRequest["action"],
  kind: "session" | "work_unit",
  id: string
): SubprojectMembersRequest {
  const value = id.trim();
  if (kind === "session")
    return { action, member_kind: "session", agent_session_id: value };
  return UUID.test(value)
    ? { action, member_kind: "work_unit", work_unit_id: value }
    : { action, member_kind: "work_unit", work_unit_slug: value };
}

export function MoveDialog({
  open,
  onClose,
  subproject,
  preset,
  onMoved,
}: {
  open: boolean;
  onClose: () => void;
  subproject: Pick<SubprojectSummary, "id" | "title">;
  preset: MemberPreset | null;
  onMoved: () => void;
}) {
  const choices = useSubprojectChoices(open && preset !== null, subproject.id);
  const [kind, setKind] = useState<"session" | "work_unit">(
    preset?.kind ?? "session"
  );
  const [memberId, setMemberId] = useState(preset?.id ?? "");
  const [direction, setDirection] = useState<MemberDirection>(
    preset ? "out" : "in"
  );
  const [inAction, setInAction] = useState<"move" | "attach">("move");
  const [target, setTarget] = useState("");
  const write = useWrite();

  const id = memberId.trim();
  const idValid = kind === "session" ? UUID.test(id) : id !== "";
  const ready =
    idValid &&
    (direction !== "out" || (UUID.test(target) && target !== subproject.id));

  const submit = async () => {
    const answer = await write.run(() =>
      direction === "in"
        ? changeSubprojectMember(
            subproject.id,
            memberRequest(inAction, kind, id)
          )
        : direction === "out"
          ? changeSubprojectMember(target, memberRequest("move", kind, id))
          : changeSubprojectMember(
              subproject.id,
              memberRequest("remove", kind, id)
            )
    );
    if (answer === null) return;
    const what =
      preset?.label ?? (kind === "session" ? "The session" : "The work unit");
    toast.success(
      direction === "in"
        ? `${what} is now a member of “${subproject.title}”`
        : direction === "out"
          ? `${what} moved to another subproject`
          : `${what} was removed from “${subproject.title}”`
    );
    onMoved();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="sm:max-w-lg"
        data-testid="subproject-move-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            {preset
              ? `Move “${preset.label}”`
              : `Bring a member into “${subproject.title}”`}
          </DialogTitle>
          <DialogDescription>
            A session is named by its Claude Code session id; a work unit by its
            slug or id. Moving a session moves only the session — its work units
            stay where they are.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {preset === null && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="subproject-move-kind">Member</Label>
                <Select
                  value={kind}
                  onValueChange={(v) =>
                    setKind(v === "work_unit" ? "work_unit" : "session")
                  }
                  disabled={write.busy}
                >
                  <SelectTrigger
                    id="subproject-move-kind"
                    data-testid="subproject-move-kind"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="session">A session</SelectItem>
                    <SelectItem value="work_unit">A work unit</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={memberId}
                  onChange={(e) => setMemberId(e.target.value)}
                  disabled={write.busy}
                  placeholder={
                    kind === "session"
                      ? "session id (uuid)"
                      : "work unit slug or id"
                  }
                  className="font-mono text-xs"
                  spellCheck={false}
                  aria-invalid={id !== "" && !idValid}
                  data-testid="subproject-move-member"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="subproject-move-action">How</Label>
                <Select
                  value={inAction}
                  onValueChange={(v) =>
                    setInAction(v === "attach" ? "attach" : "move")
                  }
                  disabled={write.busy}
                >
                  <SelectTrigger
                    id="subproject-move-action"
                    data-testid="subproject-move-action"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="move">
                      Move it here from wherever it is
                    </SelectItem>
                    <SelectItem value="attach">
                      Attach it only if it belongs to none
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          {preset !== null && (
            <div className="space-y-1.5">
              <Label htmlFor="subproject-move-direction">Where to</Label>
              <Select
                value={direction}
                onValueChange={(v) =>
                  setDirection(v === "remove" ? "remove" : "out")
                }
                disabled={write.busy}
              >
                <SelectTrigger
                  id="subproject-move-direction"
                  data-testid="subproject-move-direction"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="out">
                    Move it to another subproject
                  </SelectItem>
                  <SelectItem value="remove">
                    Remove it from this subproject
                  </SelectItem>
                </SelectContent>
              </Select>
              {direction === "out" && (
                <SubprojectPicker
                  id="subproject-move-target"
                  choices={choices}
                  value={target}
                  onChange={setTarget}
                  disabled={write.busy}
                  testId="subproject-move-target"
                />
              )}
              {direction === "remove" && (
                <p className="m-0 text-xs text-muted-foreground">
                  A removed member belongs to no subproject until coord&apos;s
                  reconciler or an operator attaches it again.
                </p>
              )}
            </div>
          )}
        </div>
        {write.error && (
          <BackendErrorMessage
            error={write.error}
            data-testid="subproject-move-error"
          />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={write.busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={write.busy || !ready}
            data-testid="subproject-move-submit"
          >
            {write.busy
              ? "Saving…"
              : direction === "remove"
                ? "Remove"
                : direction === "out"
                  ? "Move"
                  : inAction === "attach"
                    ? "Attach"
                    : "Move here"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
