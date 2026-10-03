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
}: {
  field: FieldDeclaration<Row>;
  text: RowText;
  onChange: (next: RowText) => void;
  error: string | null;
  /** The id of the element that says `error`, for `aria-describedby`. */
  errorId: string;
  uiBridgeId: string;
}) {
  const border = error ? "border-destructive" : "border-border";
  const described = error
    ? { "aria-invalid": true as const, "aria-describedby": errorId }
    : {};
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
        aria-label={field.label}
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
        aria-label={field.label}
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
          aria-label={`${field.label}, amount`}
          inputMode="decimal"
          value={value(field.field)}
          onChange={(e) => set(field.field, e.target.value)}
          className={`${INPUT} ${border} text-right tabular-nums`}
          data-ui-bridge-id={`${uiBridgeId}.amount`}
          {...described}
        />
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
      </div>
    );
  }

  return (
    <input
      aria-label={field.label}
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
