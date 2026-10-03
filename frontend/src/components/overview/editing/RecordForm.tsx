"use client";

/**
 * A form that creates ONE record of a resource — the single-record twin of
 * `RecordTable`, built from a registry declaration (`RecordFormDeclaration`).
 *
 * Every field goes through `FieldEditor` and is read back by `textToRow`
 * against the create schema the SERVER serves for the resource, so the form
 * refuses what the API would refuse and names the field. The write itself is
 * the caller's (`onSubmit`), so the call site spells its own route.
 */

import { useId, useState } from "react";
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
}) {
  const [text, setText] = useState<RowText>(() => rowToText(form, initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const baseId = useId();

  const visible = form.fields.filter((f) => !form.hidden?.(text, f.field));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const read = textToRow({ fields: visible }, text, schema, initial);
    if ("errors" in read) {
      setErrors(read.errors);
      return;
    }
    setErrors({});
    setFailure(null);
    setSaving(true);
    const result = await onSubmit(read.row);
    setSaving(false);
    if (result.ok) onDone(true);
    else
      setFailure(
        "error" in result
          ? result.error
          : `Somebody else changed this ${form.singular} just now.`
      );
  };

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="rounded-md border border-border p-4"
      data-ui-bridge-id={uiBridgeId}
      noValidate
    >
      {intro}
      <div className="grid gap-3 sm:grid-cols-2">
        {visible.map((field) => {
          const errorId = `${baseId}-${field.field}-error`;
          const error = errors[field.field] ?? null;
          return (
            <div key={field.field} className="min-w-0">
              <span className="mb-1 block text-sm font-medium text-foreground">
                {field.label}
                {field.required ? "" : " (optional)"}
              </span>
              <FieldEditor
                field={field}
                text={text}
                onChange={setText}
                error={error}
                errorId={errorId}
                uiBridgeId={`${uiBridgeId}.${field.field}`}
              />
              {form.help?.[field.field] && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {form.help[field.field]}
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
