/**
 * Wiki links: `[[Page Title]]` and `[[Page Title|shown text]]` in a page's
 * markdown (plan `2026-09-20-overview-authoring-layer` Phase 2).
 *
 * The server stores every link by the target's SLUG, so a link to a page
 * nobody has written yet still exists and becomes a backlink the moment the
 * page does. To render a link the browser needs that same slug, so
 * {@link slugify} follows the server's rule exactly (`app/overview/pages.py`
 * `slugify`): NFKD; drop nonspacing marks; lowercase; each run of anything but
 * a letter or digit becomes one hyphen; trim hyphens; at most 120 code points.
 */

/**
 * Same pattern as the server's `_WIKI_LINK`. The `u` flag makes `{1,200}`
 * count code points, as Python does, not UTF-16 units.
 *
 * Known limit: inside a GFM table cell the `|` of `[[Title|label]]` splits the
 * cell before this plugin sees the text, so the server records that link but
 * none is drawn. Use `[[Title]]` in tables.
 */
const WIKI_LINK = /\[\[([^[\]|\n]{1,200})(?:\|([^[\]\n]{0,200}))?\]\]/gu;

const MAX_SLUG = 120;

export function slugify(title: string): string {
  const folded = title
    .normalize("NFKD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  // Code points, not UTF-16 units: the server counts characters.
  return Array.from(folded).slice(0, MAX_SLUG).join("").replace(/-+$/g, "");
}

export interface WikiLinkMatch {
  /** The whole `[[…]]` as written. */
  raw: string;
  title: string;
  /** What to show: the text after `|`, else the title. */
  label: string;
  slug: string;
  index: number;
}

/** Every link in `text`, in order. A title with no letter or digit names
 *  nothing, and is left as plain text. */
export function findWikiLinks(text: string): WikiLinkMatch[] {
  const found: WikiLinkMatch[] = [];
  for (const match of text.matchAll(WIKI_LINK)) {
    const title = (match[1] ?? "").trim();
    const slug = slugify(title);
    if (!slug) continue;
    const label = match[2]?.trim() || title;
    found.push({ raw: match[0], title, label, slug, index: match.index ?? 0 });
  }
  return found;
}

/** Where a wiki page is read, and where a missing one is offered for writing. */
export function wikiHref(slug: string, create?: { title: string }): string {
  const base = `/overview/wiki/${encodeURIComponent(slug)}`;
  return create ? `${base}?create=${encodeURIComponent(create.title)}` : base;
}

export interface WikiLinkOptions {
  /** Whether a page with this slug exists. */
  exists: (slug: string) => boolean;
  /** Whether the reader may write a missing page: a missing link is then a
   *  link to write it; otherwise it is plain text, since there is nothing to
   *  open. */
  canCreate: boolean;
}

// The slice of mdast this plugin reads and writes. Declared here rather than
// imported, so the overview does not depend on a transitive package's types.
interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
  data?: { hProperties?: Record<string, string> };
}

/** Nodes whose text is literal and must never become a link. */
const LITERAL = new Set([
  "code",
  "inlineCode",
  "link",
  "linkReference",
  "html",
]);

function splitText(value: string, options: WikiLinkOptions): MdNode[] | null {
  const links = findWikiLinks(value);
  if (links.length === 0) return null;
  const out: MdNode[] = [];
  let at = 0;
  for (const link of links) {
    if (link.index > at)
      out.push({ type: "text", value: value.slice(at, link.index) });
    const exists = options.exists(link.slug);
    if (exists || options.canCreate) {
      out.push({
        type: "link",
        url: exists
          ? wikiHref(link.slug)
          : wikiHref(link.slug, { title: link.title }),
        children: [{ type: "text", value: link.label }],
        data: {
          hProperties: {
            "data-wiki-link": exists ? "present" : "missing",
            ...(exists ? {} : { title: `Write the page “${link.title}”` }),
          },
        },
      });
    } else {
      out.push({
        type: "emphasis",
        children: [{ type: "text", value: link.label }],
        data: {
          hProperties: {
            "data-wiki-link": "missing",
            title: "Nobody has written this page yet",
          },
        },
      });
    }
    at = link.index + link.raw.length;
  }
  if (at < value.length) out.push({ type: "text", value: value.slice(at) });
  return out;
}

function transform(node: MdNode, options: WikiLinkOptions): void {
  if (!node.children || LITERAL.has(node.type)) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && child.value) {
      const replaced = splitText(child.value, options);
      if (replaced) {
        next.push(...replaced);
        continue;
      }
    }
    transform(child, options);
    next.push(child);
  }
  node.children = next;
}

/**
 * A remark plugin: `[[links]]` in text become links (or, for a reader, plain
 * emphasis when the page does not exist). Code spans and blocks, and the text
 * of existing links, are left as written.
 */
export function remarkWikiLinks(options: WikiLinkOptions) {
  return () => (tree: unknown) => {
    transform(tree as MdNode, options);
  };
}
