/**
 * API client for the wrapper marketplace endpoints.
 *
 * Backed by FastAPI under /api/wrappers. Uses the shared HttpClient via the
 * service factory (which handles auth, CSRF, and retries) so the same auth
 * cookie flow as the rest of the app applies.
 *
 * Field naming: the backend may return either snake_case or camelCase fields.
 * We normalize to camelCase at this boundary so the rest of the frontend
 * matches the WrapperEntry / WrapperComment shapes documented in the
 * integration plan.
 */

import { httpClient } from "@/services/service-factory";
import { ApiConfig } from "@/services/api-config";

export type WrapperTransport = "api" | "headless" | "headed" | "live";
export type WrapperSort = "installs" | "rating" | "recent";

export interface WrapperAuthor {
  name: string;
  url?: string;
  email?: string;
}

export interface WrapperEntry {
  id: string;
  package: string;
  latestVersion: string;
  displayName: string;
  description: string | null;
  categories: string[];
  transport: WrapperTransport;
  author: WrapperAuthor;
  repo: string | null;
  license: string | null;
  verified: boolean;
  avgRating: number | null;
  ratingCount: number;
  installCount: number;
  registrySyncedAt: string;
}

export interface WrapperComment {
  id: number;
  body: string;
  parentId: number | null;
  user: { id: string; name: string };
  createdAt: string;
}

export interface WrapperEntryWithComments extends WrapperEntry {
  comments: WrapperComment[];
}

export interface WrapperListResponse {
  wrappers: WrapperEntry[];
  total: number;
}

export interface WrapperRatingResponse {
  avgRating: number | null;
  ratingCount: number;
}

export interface ListWrappersParams {
  q?: string;
  category?: string;
  verified?: boolean;
  sort?: WrapperSort;
  limit?: number;
  offset?: number;
}

// ---- normalization helpers ----------------------------------------------

type RawAuthor =
  | string
  | {
      name?: string;
      url?: string;
      email?: string;
    }
  | null
  | undefined;

interface RawWrapperEntry {
  id?: string;
  package?: string;
  package_name?: string;
  latestVersion?: string;
  latest_version?: string;
  displayName?: string;
  display_name?: string;
  description?: string | null;
  categories?: string[] | null;
  transport?: WrapperTransport;
  author?: RawAuthor;
  repo?: string | null;
  license?: string | null;
  verified?: boolean;
  avgRating?: number | null;
  avg_rating?: number | null;
  ratingCount?: number;
  rating_count?: number;
  installCount?: number;
  install_count?: number;
  registrySyncedAt?: string;
  registry_synced_at?: string;
}

interface RawWrapperComment {
  id?: number;
  body?: string;
  parentId?: number | null;
  parent_id?: number | null;
  user?: { id?: string; name?: string; username?: string } | null;
  user_id?: string;
  user_name?: string;
  username?: string;
  createdAt?: string;
  created_at?: string;
}

function normalizeAuthor(raw: RawAuthor): WrapperAuthor {
  if (!raw) return { name: "Unknown" };
  if (typeof raw === "string") return { name: raw };
  const author: WrapperAuthor = { name: raw.name || "Unknown" };
  if (raw.url) author.url = raw.url;
  if (raw.email) author.email = raw.email;
  return author;
}

function normalizeWrapper(raw: RawWrapperEntry): WrapperEntry {
  const avgRatingRaw = raw.avgRating ?? raw.avg_rating ?? null;
  return {
    id: raw.id ?? "",
    package: raw.package ?? raw.package_name ?? "",
    latestVersion: raw.latestVersion ?? raw.latest_version ?? "",
    displayName: raw.displayName ?? raw.display_name ?? raw.id ?? "",
    description: raw.description ?? null,
    categories: raw.categories ?? [],
    transport: (raw.transport as WrapperTransport) ?? "api",
    author: normalizeAuthor(raw.author),
    repo: raw.repo ?? null,
    license: raw.license ?? null,
    verified: !!raw.verified,
    avgRating: avgRatingRaw,
    ratingCount: raw.ratingCount ?? raw.rating_count ?? 0,
    installCount: raw.installCount ?? raw.install_count ?? 0,
    registrySyncedAt:
      raw.registrySyncedAt ??
      raw.registry_synced_at ??
      new Date(0).toISOString(),
  };
}

function normalizeComment(raw: RawWrapperComment): WrapperComment {
  const userObj = raw.user ?? null;
  const userName =
    userObj?.name ??
    userObj?.username ??
    raw.user_name ??
    raw.username ??
    "User";
  const userId = userObj?.id ?? raw.user_id ?? "";
  return {
    id: raw.id ?? 0,
    body: raw.body ?? "",
    parentId: raw.parentId ?? raw.parent_id ?? null,
    user: { id: userId, name: userName },
    createdAt: raw.createdAt ?? raw.created_at ?? new Date(0).toISOString(),
  };
}

function buildQuery(params: ListWrappersParams): string {
  const usp = new URLSearchParams();
  if (params.q) usp.append("q", params.q);
  if (params.category) usp.append("category", params.category);
  if (params.verified) usp.append("verified", "true");
  if (params.sort) usp.append("sort", params.sort);
  if (params.limit !== undefined) usp.append("limit", String(params.limit));
  if (params.offset !== undefined) usp.append("offset", String(params.offset));
  return usp.toString();
}

function url(path: string): string {
  return `${ApiConfig.API_BASE_URL}${path}`;
}

// ---- public API ---------------------------------------------------------

export async function fetchWrappers(
  params: ListWrappersParams = {}
): Promise<WrapperListResponse> {
  const qs = buildQuery(params);
  const response = await httpClient.fetch(
    url(`/api/wrappers${qs ? `?${qs}` : ""}`)
  );
  if (!response.ok) {
    throw new Error(`Failed to load wrappers (status ${response.status})`);
  }
  const data = (await response.json()) as {
    wrappers?: RawWrapperEntry[];
    total?: number;
  };
  return {
    wrappers: (data.wrappers ?? []).map(normalizeWrapper),
    total: data.total ?? 0,
  };
}

export async function fetchWrapper(
  id: string
): Promise<WrapperEntryWithComments> {
  const response = await httpClient.fetch(
    url(`/api/wrappers/${encodeURIComponent(id)}`)
  );
  if (!response.ok) {
    throw new Error(`Failed to load wrapper ${id} (status ${response.status})`);
  }
  const raw = (await response.json()) as RawWrapperEntry & {
    comments?: RawWrapperComment[];
  };
  const base = normalizeWrapper(raw);
  return {
    ...base,
    comments: (raw.comments ?? []).map(normalizeComment),
  };
}

export async function submitRating(
  id: string,
  stars: number
): Promise<WrapperRatingResponse> {
  const response = await httpClient.fetch(
    url(`/api/wrappers/${encodeURIComponent(id)}/ratings`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stars }),
    }
  );
  if (!response.ok) {
    throw new Error(`Failed to submit rating (status ${response.status})`);
  }
  const data = (await response.json()) as {
    avgRating?: number | null;
    avg_rating?: number | null;
    ratingCount?: number;
    rating_count?: number;
  };
  return {
    avgRating: data.avgRating ?? data.avg_rating ?? null,
    ratingCount: data.ratingCount ?? data.rating_count ?? 0,
  };
}

export async function deleteRating(id: string): Promise<void> {
  const response = await httpClient.fetch(
    url(`/api/wrappers/${encodeURIComponent(id)}/ratings`),
    { method: "DELETE" }
  );
  if (!response.ok) {
    throw new Error(`Failed to remove rating (status ${response.status})`);
  }
}

export async function submitComment(
  id: string,
  body: string,
  parentId?: number
): Promise<WrapperComment> {
  const payload: { body: string; parent_id?: number } = { body };
  if (parentId !== undefined) payload.parent_id = parentId;
  const response = await httpClient.fetch(
    url(`/api/wrappers/${encodeURIComponent(id)}/comments`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  if (!response.ok) {
    throw new Error(`Failed to submit comment (status ${response.status})`);
  }
  const raw = (await response.json()) as RawWrapperComment;
  return normalizeComment(raw);
}
