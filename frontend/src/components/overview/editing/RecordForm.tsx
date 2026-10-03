"use client";

/**
 * A form that creates ONE record of a resource — the single-record twin of
 * `RecordTable`, built from a registry declaration (`RecordFormDeclaration`).
 *
 * Every field goes through `FieldEditor` and is read back by `textToRow`
 * against the create schema the SERVER serves for the resource, then through
 * the declaration's cross-field `rules`, so the form refuses what the API
 * would refuse and names the field. The write itself is the caller's
 * (`onSubmit`), so the call site spells its own route.
 *
 * Accessible by construction: every field has a visible `<label htmlFor>`,
 * its help line and its error are linked with `aria-describedby`, and a
 * refused submit announces how many fields need attention and moves focus to
 * the first of them.
 */

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { JsonSchema } from "./api";
import { FieldEditor } from "./FieldEditor";
import { rowToText, textToRow, type RowText } from "./fields";
import type { RecordFormDeclaration } from "./registry";
import type { SaveResult } from "./useResource";

export function RecordForm<Row extends object>({
  form,
  initial,
  schema,
  onSubmit,
  onDone,
  uiBridgeId,
  intro,
  currencyLocked = false,
}: {
  form: RecordFormDeclaration<Row>;
  /** The values to start from; anything the form does not show is sent as
   *  given (a vendor id fixed by where the form was opened). */
  initial: Row;
  /** The resource's served create schema. */
  schema: JsonSchema | undefined;
  onSubmit: (row: Row) => Promise<SaveResult<unknown>>;
  /** Called after a successful save, and on cancel. */
  onDone: (saved: boolean) => void;
  uiBridgeId: string;
  intro?: React.ReactNode;
  /** Money fields keep the currency `initial` carries; it cannot be edited. */
  currencyLocked?: boolean;
}) {
  const [text, setText] = useState<RowText>(() => rowToText(form, initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Bumped on each refused submit, so focus moves even when the same field
  // is refused twice in a row.
  const [refusals, setRefusals] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const baseId = useId();
  const fieldId = (field: string) => `${baseId}-${field}`;

  const visible = form.fields.filter((f) => !form.hidden?.(text, f.field));

  useEffect(() => {
    if (refusals === 0) return;
    const first = formRef.current?.querySelector<HTMLElement>(
      '[aria-invalid="true"]'
    );
    first?.focus();
  }, [refusals]);

  const refuse = (problems: Record<string, string>) => {
    setErrors(problems);
    setRefusals((n) => n + 1);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const read = textToRow({ fields: visible }, text, schema, initial);
    if ("errors" in read) {
      refuse(read.errors);
      return;
    }
    const crossField = (form.rules?.(read.row) ?? {}) as Record<string, string>;
    if (Object.keys(crossField).length > 0) {
      refuse(crossField);
      return;
    }
    setErrors({});
    setFailure(null);
    setSaving(true);
    let result: SaveResult<unknown>;
    try {
      result = await onSubmit(read.row);
    } catch (err) {
      result = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      setSaving(false);
    }
    if (result.ok) onDone(true);
    else
      setFailure(
        "error" in result
          ? result.error
          : `Somebody else changed this ${form.singular} just now.`
      );
  };

  const problemCount = Object.keys(errors).length;

  return (
    <form
      ref={formRef}
      onSubmit={(e) => void submit(e)}
      className="rounded-md border border-border p-4"
      data-ui-bridge-id={uiBridgeId}
      noValidate
    >
      {intro}
      <p
        aria-live="assertive"
        className={
          problemCount > 0 ? "mb-3 text-sm text-destructive" : "sr-only"
        }
        data-ui-bridge-id={`${uiBridgeId}.summary`}
      >
        {problemCount === 0
          ? ""
          : problemCount === 1
            ? "One field needs attention."
            : `${problemCount} fields need attention.`}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {visible.map((field) => {
          const id = fieldId(field.field);
          const errorId = `${id}-error`;
          const help = form.help?.[field.field as keyof Row & string];
          const helpId = help ? `${id}-help` : undefined;
          const error = errors[field.field] ?? null;
          return (
            <div key={field.field} className="min-w-0">
              <label
                htmlFor={id}
                className="mb-1 block text-sm font-medium text-foreground"
              >
                {field.label}
                {field.required ? "" : " (optional)"}
              </label>
              <FieldEditor
                field={field}
                text={text}
                onChange={setText}
                error={error}
                errorId={errorId}
                inputId={id}
                helpId={helpId}
                currencyLocked={currencyLocked}
                uiBridgeId={`${uiBridgeId}.${field.field}`}
              />
              {help && (
                <p id={helpId} className="mt-1 text-xs text-muted-foreground">
                  {help}
                </p>
              )}
              {error && (
                <p
                  id={errorId}
                  className="mt-1 text-xs text-destructive"
                  data-ui-bridge-id={`${uiBridgeId}.${field.field}.error`}
                >
                  {error}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {failure && (
        <p
          role="alert"
          className="mt-3 text-sm text-destructive"
          data-ui-bridge-id={`${uiBridgeId}.error`}
        >
          {failure}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <Button
          type="submit"
          disabled={saving}
          data-ui-bridge-id={`${uiBridgeId}.save`}
        >
          {saving ? "Saving…" : `Add ${form.singular}`}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={saving}
          onClick={() => onDone(false)}
          data-ui-bridge-id={`${uiBridgeId}.cancel`}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
