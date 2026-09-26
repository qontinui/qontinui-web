/**
 * Documents, wiki pages and uploaded files, as the overview's authoring
 * contract serves them (`/api/v1/overview/pages`, `/files`). Plan
 * `2026-09-20-overview-authoring-layer` Phase 2.
 */

export type PageKind = "document" | "wiki";

export interface PageRecord {
  id: string;
  kind: PageKind;
  slug: string;
  title: string;
  /** The markdown. `null` on a list read, which never sends bodies. */
  body_md: string | null;
  excerpt: string;
  doc_number: string | null;
  doc_status: string | null;
  owner: string | null;
  /** Slugs of the documents this one names as related. */
  related: string[];
  version: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface PageVersionSummary {
  version: number;
  title: string;
  created_at: string;
  created_by: string | null;
}

export interface PageVersionRecord extends PageVersionSummary {
  body_md: string;
  doc_number: string | null;
  doc_status: string | null;
  owner: string | null;
}

export interface PageVersionList {
  versions: PageVersionSummary[];
  current_version: number;
}

export interface PageRef {
  id: string;
  kind: PageKind;
  slug: string;
  title: string;
}

export interface FileRecord {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  page_id: string | null;
  uploaded_by: string | null;
  created_at: string;
  version: number;
  download_path: string;
}

/** The most pages one list read returns (the server's `PageStore.list`
 *  limit). A list this long may have been cut short. */
export const PAGE_LIST_LIMIT = 500;

/** Where a page is read. */
export function pageHref(page: Pick<PageRef, "kind" | "slug" | "id">): string {
  return page.kind === "wiki"
    ? `/overview/wiki/${encodeURIComponent(page.slug)}`
    : `/overview/documents/${encodeURIComponent(page.id)}`;
}

/** "No. DP-001 · Approved · Owner: Dana" — whichever are set. */
export function documentMeta(
  page: Pick<PageRecord, "doc_number" | "doc_status" | "owner">
): string {
  return [
    page.doc_number && `No. ${page.doc_number}`,
    page.doc_status,
    page.owner && `Owner: ${page.owner}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

// ---------------------------------------------------------------------------
// Uploads: what the server accepts, checked here first so a reader is told
// before a 25 MB upload rather than after it.
// ---------------------------------------------------------------------------

/** Extension → what to call it. The server's allowlist (`files.py`
 *  `ALLOWED`); it re-checks every upload against the bytes. */
export const UPLOAD_TYPES: Record<string, string> = {
  pdf: "PDF",
  docx: "Word document",
  xlsx: "Excel workbook",
  pptx: "PowerPoint deck",
  png: "PNG image",
  jpg: "JPEG image",
  jpeg: "JPEG image",
  md: "Markdown",
  csv: "CSV",
};

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** For the file picker's `accept`. */
export const UPLOAD_ACCEPT = Object.keys(UPLOAD_TYPES)
  .map((ext) => `.${ext}`)
  .join(",");

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Why a file cannot be uploaded, before sending it; null when it can. */
export function uploadProblem(file: {
  name: string;
  size: number;
}): string | null {
  const ext = extensionOf(file.name);
  if (!(ext in UPLOAD_TYPES)) {
    return `${file.name}: only PDF, Word, Excel, PowerPoint, PNG, JPEG, Markdown and CSV files can be uploaded.`;
  }
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > MAX_UPLOAD_BYTES) {
    return `${file.name} is ${formatBytes(file.size)}; files can be at most 25 MB.`;
  }
  return null;
}

/** The kind of file, for a reader: from the name, falling back to the type. */
export function fileKindLabel(
  file: Pick<FileRecord, "filename" | "content_type">
): string {
  return UPLOAD_TYPES[extensionOf(file.filename)] ?? file.content_type;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

// ---------------------------------------------------------------------------
// The wiki index
// ---------------------------------------------------------------------------

const collator = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

export interface IndexGroup<T> {
  /** The letter the group is filed under; `#` for titles starting with
   *  anything else. */
  letter: string;
  items: T[];
}

/** Titles A–Z (in the reader's collation), grouped by first letter. */
export function alphabeticalIndex<T extends { title: string }>(
  items: readonly T[]
): IndexGroup<T>[] {
  const sorted = [...items].sort((a, b) => collator.compare(a.title, b.title));
  // Keyed by letter, in first-seen order: the collation can interleave
  // titles that file under one letter (or under `#`).
  const groups = new Map<string, T[]>();
  for (const item of sorted) {
    const first = Array.from(item.title.trim())[0] ?? "";
    const folded = first
      .normalize("NFKD")
      .replace(/\p{Mn}/gu, "")
      .toLocaleUpperCase();
    const letter = /\p{L}/u.test(folded) ? folded : "#";
    const items = groups.get(letter);
    if (items) items.push(item);
    else groups.set(letter, [item]);
  }
  const out = [...groups].map(([letter, items]) => ({ letter, items }));
  // `#` last, wherever the collation put it.
  return [
    ...out.filter((g) => g.letter !== "#"),
    ...out.filter((g) => g.letter === "#"),
  ];
}
