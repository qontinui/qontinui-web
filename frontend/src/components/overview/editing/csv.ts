/**
 * The CSV paste every overview record table shares: splitting a pasted table
 * into lines and fields, and the shape a parser reports back in.
 *
 * A resource's own parser (which columns, which words mean yes) builds on
 * these; `CsvPasteDialog` shows what it read. A row that cannot be read
 * becomes an {@link CsvIssue} naming its line and what was expected — nothing
 * is guessed and nothing is dropped silently.
 */

export interface CsvIssue {
  /** 1-based line number in the pasted text; 0 when it is about the whole. */
  line: number;
  text: string;
  message: string;
  severity: "error" | "warning";
}

export interface CsvResult<T> {
  rows: T[];
  issues: CsvIssue[];
  /** The pasted line each row was read from (`lines[i]` for `rows[i]`), so a
   *  row the schema then refuses can be named by its line. */
  lines: number[];
}

/**
 * One CSV line into fields, honouring double quotes and `""` escapes, with a
 * comma or a tab as the separator so a spreadsheet paste works. Written out
 * rather than pulled from a library because the whole input is one pasted
 * table and a dependency for 30 lines is not worth the supply chain.
 */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === "," || ch === "\t") {
      fields.push(field.trim());
      field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field.trim());
  return fields;
}

/** The pasted text's non-blank lines, each with its 1-based line number. */
export function nonEmptyLines(text: string): { line: number; text: string }[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line, index) => ({ line: index + 1, text: line }))
    .filter((row) => row.text.trim() !== "");
}
