/**
 * Skill Sharing Service
 *
 * API client for organization skill sharing. Uses the HttpClient from the
 * service factory to handle auth tokens and retries consistently.
 */

import { HttpClient } from "./http-client";

const BASE_URL = "/api/v1/skills";

// =============================================================================
// Types
// =============================================================================

export interface SkillAuthor {
  id: string;
  name: string;
  email?: string;
}

export interface OrgSkill {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  tags: string[];
  icon: string;
  color: string;
  allowed_phases: string[];
  parameters: Record<string, unknown>[];
  template: Record<string, unknown>;
  source: string;
  organization_id: string | null;
  is_shared: boolean;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  version?: string;
  author?: SkillAuthor;
  approval_status?: string;
  usage_count?: number;
  forked_from_id?: string | null;
}

export interface SkillListResponse {
  items: OrgSkill[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
}

// =============================================================================
// Service
// =============================================================================

export class SkillSharingService {
  private httpClient: HttpClient;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
  }

  /**
   * Toggle sharing for a skill with the user's organization.
   */
  async shareSkill(skillId: string, isShared: boolean): Promise<OrgSkill> {
    return this.httpClient.post<OrgSkill>(`${BASE_URL}/${skillId}/share`, {
      is_shared: isShared,
    });
  }

  /**
   * List all skills shared within an organization.
   */
  async listOrgSkills(organizationId: string): Promise<OrgSkill[]> {
    const data = await this.httpClient.get<SkillListResponse>(
      `${BASE_URL}/org/${organizationId}`
    );
    return data.items ?? [];
  }

  /**
   * List the current user's skills (for managing sharing status).
   */
  async listMySkills(): Promise<OrgSkill[]> {
    const data = await this.httpClient.get<SkillListResponse>(BASE_URL);
    return data.items ?? [];
  }

  /**
   * Fork a shared skill into the current user's collection.
   */
  async forkSkill(skillId: string, newName?: string): Promise<OrgSkill> {
    return this.httpClient.post<OrgSkill>(`${BASE_URL}/${skillId}/fork`, {
      new_name: newName,
    });
  }

  /**
   * Approve or reject a shared skill within an organization.
   */
  async approveSkill(skillId: string, status: string): Promise<OrgSkill> {
    return this.httpClient.post<OrgSkill>(`${BASE_URL}/${skillId}/approve`, {
      status,
    });
  }

  /**
   * Browse the community skill marketplace (all shared + approved skills).
   */
  async listMarketplaceSkills(params?: {
    category?: string;
    search?: string;
    offset?: number;
    limit?: number;
  }): Promise<SkillListResponse> {
    const query = new URLSearchParams();
    if (params?.category) query.set("category", params.category);
    if (params?.search) query.set("search", params.search);
    if (params?.offset) query.set("offset", String(params.offset));
    if (params?.limit) query.set("limit", String(params.limit));
    const qs = query.toString();
    return this.httpClient.get<SkillListResponse>(
      `${BASE_URL}/marketplace${qs ? `?${qs}` : ""}`
    );
  }

  /**
   * Increment the usage counter for a skill.
   */
  async incrementUsage(
    skillId: string
  ): Promise<{ id: string; usage_count: number }> {
    return this.httpClient.post<{ id: string; usage_count: number }>(
      `${BASE_URL}/${skillId}/increment-usage`,
      {}
    );
  }
}
