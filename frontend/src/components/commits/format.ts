// Small pure helpers shared across the commit-lineage components.

export const GITHUB = "https://github.com";

/** Short 7-char form of a commit SHA. */
export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/** Human label for a session: its name, else the first 8 of the uuid. */
export function sessionLabel(
  name: string | null | undefined,
  id: string | null | undefined
): string {
  if (name && name.trim()) return name.trim();
  if (id && id.trim()) return id.trim().slice(0, 8);
  return "unattributed";
}

/** Locale timestamp, or an em-dash for null/unparseable input. */
export function formatTs(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** GitHub commit URL for a row. */
export function commitUrl(repo: string, sha: string): string {
  return `${GITHUB}/${repo}/commit/${sha}`;
}
