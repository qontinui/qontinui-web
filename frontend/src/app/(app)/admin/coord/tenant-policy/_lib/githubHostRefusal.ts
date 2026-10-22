import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";
import { operationsErrorMessage } from "@/lib/api/operations/base";

/** One enrolled repo coord says is registered on a different host. */
export interface RepoOnAnotherHost {
  repo: string;
  github_remote: string;
}

/**
 * Why a GitHub-host write failed, in operator words.
 *
 * Coord's typed refusals (`/coord/tenant/github-host`) reach the console as
 * `{"detail": {"error": <code>, "detail": <text>, …}}` through the web proxy.
 * `repos` is set only for `repos_registered_on_another_host`, the one refusal
 * the operator has to act on elsewhere before retrying.
 */
export interface GithubHostRefusal {
  /** Coord's refusal code, or `null` when the failure carried none. */
  code: string | null;
  message: string;
  repos: RepoOnAnotherHost[] | null;
}

const COPY: Record<string, string> = {
  invalid_github_host:
    "Coord refused the host — both bases must be public https URLs, and the web base an origin with no path",
  admin_required: "Only an admin of this tenant can change its GitHub host",
  repos_registered_on_another_host:
    "Repos enrolled in this tenant are registered on a different GitHub host. Re-register them before changing the tenant's host",
  schema_migration_pending:
    "Coord's database does not have the GitHub host table yet (migration coord_tenant_github_hosts_01 is not applied)",
};

function readRepos(raw: unknown): RepoOnAnotherHost[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.flatMap((entry) =>
    entry &&
    typeof entry === "object" &&
    typeof (entry as RepoOnAnotherHost).repo === "string" &&
    typeof (entry as RepoOnAnotherHost).github_remote === "string"
      ? [entry as RepoOnAnotherHost]
      : []
  );
}

export function githubHostRefusal(err: unknown): GithubHostRefusal {
  const fallback = operationsErrorMessage(err);
  if (httpStatusOf(err) === null) {
    return { code: null, message: fallback, repos: null };
  }
  let detail: unknown = null;
  try {
    detail = (JSON.parse(httpBodyOf(err) ?? "") as { detail?: unknown })
      ?.detail;
  } catch {
    detail = null;
  }
  if (!detail || typeof detail !== "object") {
    return { code: null, message: fallback, repos: null };
  }
  const body = detail as { error?: unknown; detail?: unknown; repos?: unknown };
  const code = typeof body.error === "string" ? body.error : null;
  const coordDetail = typeof body.detail === "string" ? body.detail : null;
  const known = code !== null ? COPY[code] : undefined;
  return {
    code,
    message:
      code === "invalid_github_host" && coordDetail
        ? `${known}: ${coordDetail}`
        : (known ?? coordDetail ?? fallback),
    repos:
      code === "repos_registered_on_another_host"
        ? readRepos(body.repos)
        : null,
  };
}
