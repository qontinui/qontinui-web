"use client";

/**
 * One field of a record, as an input — the editor primitive `RecordTable`
 * builds its rows from. The kind comes from the registry declaration, so a
 * money field is always an amount beside its currency, a decimal is always
 * typed as exact text, and a flag is always a checkbox with the reader's
 * words for yes and no.
 */

import type { RowText } from "./fields";
import type { FieldDeclaration } from "./registry";

const INPUT =
  "w-full min-w-0 rounded-md border bg-background px-2 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function FieldEditor<Row>({
  field,
  text,
  onChange,
  error,
  errorId,
  uiBridgeId,
  inputId,
  helpId,
  currencyLocked = false,
}: {
  field: FieldDeclaration<Row>;
  text: RowText;
  onChange: (next: RowText) => void;
  error: string | null;
  /** The id of the element that says `error`, for `aria-describedby`. */
  errorId: string;
  uiBridgeId: string;
  /** The primary input's id, for a visible `<label htmlFor>`. Without it the
   *  input is named by `aria-label` (a table cell has no room for a label). */
  inputId?: string;
  /** The id of a help line under the field, for `aria-describedby`. */
  helpId?: string;
  /** Show a money field's currency as fixed text instead of an input — for a
   *  record whose currency the server decides. */
  currencyLocked?: boolean;
}) {
  const border = error ? "border-destructive" : "border-border";
  const describedBy = [error ? errorId : null, helpId ?? null]
    .filter(Boolean)
    .join(" ");
  const described = {
    ...(error ? { "aria-invalid": true as const } : {}),
    ...(describedBy ? { "aria-describedby": describedBy } : {}),
  };
  /** Name the primary input by its label when it has one. */
  const named = (ariaLabel: string) =>
    inputId ? { id: inputId } : { "aria-label": ariaLabel };
  const value = (key: string) => {
    const v = text[key];
    return typeof v === "string" ? v : "";
  };
  const set = (key: string, v: string | boolean) =>
    onChange({ ...text, [key]: v });

  if (field.kind === "flag") {
    return (
      <label className="inline-flex min-h-9 items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          id={inputId}
          checked={text[field.field] === true}
          onChange={(e) => set(field.field, e.target.checked)}
          data-ui-bridge-id={uiBridgeId}
          {...described}
        />
        {field.yes}
      </label>
    );
  }

  if (field.kind === "choice") {
    return (
      <select
        {...named(field.label)}
        value={value(field.field)}
        onChange={(e) => set(field.field, e.target.value)}
        className={`${INPUT} ${border}`}
        data-ui-bridge-id={uiBridgeId}
        {...described}
      >
        {!field.required && <option value="">—</option>}
        {field.required && value(field.field) === "" && (
          <option value="" disabled>
            Choose…
          </option>
        )}
        {field.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  if (field.kind === "date") {
    return (
      <input
        type="date"
        {...named(field.label)}
        value={value(field.field)}
        onChange={(e) => set(field.field, e.target.value)}
        className={`${INPUT} ${border}`}
        data-ui-bridge-id={uiBridgeId}
        {...described}
      />
    );
  }

  if (field.kind === "money") {
    return (
      <div className="flex gap-1">
        <input
          {...named(`${field.label}, amount`)}
          inputMode="decimal"
          value={value(field.field)}
          onChange={(e) => set(field.field, e.target.value)}
          className={`${INPUT} ${border} text-right tabular-nums`}
          data-ui-bridge-id={`${uiBridgeId}.amount`}
          {...described}
        />
        {currencyLocked ? (
          <span
            className="inline-flex shrink-0 items-center px-2 text-sm text-muted-foreground"
            title="Recorded in the project's currency"
            data-ui-bridge-id={`${uiBridgeId}.currency`}
          >
            <span className="sr-only">Currency: </span>
            {value(field.currencyField)}
          </span>
        ) : (
          <input
            aria-label={`${field.label}, currency`}
            value={value(field.currencyField)}
            maxLength={3}
            placeholder="EUR"
            onChange={(e) =>
              set(field.currencyField, e.target.value.toUpperCase())
            }
            className={`${INPUT} ${border} w-16 shrink-0 uppercase`}
            data-ui-bridge-id={`${uiBridgeId}.currency`}
            {...described}
          />
        )}
      </div>
    );
  }

  return (
    <input
      {...named(field.label)}
      inputMode={field.kind === "decimal" ? "decimal" : undefined}
      value={value(field.field)}
      onChange={(e) => set(field.field, e.target.value)}
      className={`${INPUT} ${border} ${
        field.kind === "decimal" ? "text-right tabular-nums" : ""
      } ${field.kind === "code" ? "font-mono text-xs" : ""}`}
      data-ui-bridge-id={uiBridgeId}
      {...described}
    />
  );
}
