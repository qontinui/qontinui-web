/**
 * Organization API Service
 *
 * API calls for organization management including invitations and members.
 *
 * All requests route through `httpClient` (never bare `fetch`) so they carry
 * the `Authorization: Bearer` header and inherit the shared 401-refresh /
 * session-expiry handling. A bare fetch 401s in prod (Cognito bearer auth).
 */

import type {
  Invitation,
  InvitationCreate,
  TeamMember,
  Organization,
} from "@/types/collaboration";
import { httpClient } from "@/services/service-factory";

/**
 * Send an invitation to join an organization
 */
export async function inviteMember(
  organizationId: string,
  data: InvitationCreate
): Promise<Invitation> {
  const response = await httpClient.fetch(
    `/api/v1/organizations/${organizationId}/members/invite`,
    {
      method: "POST",
      body: JSON.stringify(data),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to send invitation");
  }

  return response.json();
}

/**
 * Get all pending invitations for an organization
 */
export async function getInvitations(
  organizationId: string
): Promise<Invitation[]> {
  const response = await httpClient.fetch(
    `/api/v1/organizations/${organizationId}/invitations`
  );

  if (!response.ok) {
    throw new Error("Failed to get invitations");
  }

  return response.json();
}

/**
 * Accept an invitation using the token from email link
 */
export async function acceptInvitation(
  token: string
): Promise<{ organization: Organization }> {
  const response = await httpClient.fetch(
    `/api/v1/organizations/invitations/${token}/accept`,
    {
      method: "POST",
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to accept invitation");
  }

  return response.json();
}

/**
 * Get invitation details from token (to show organization info before accepting)
 */
export async function getInvitationDetails(
  token: string
): Promise<Invitation & { organization: Organization }> {
  const response = await httpClient.fetch(
    `/api/v1/organizations/invitations/${token}`
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to get invitation details");
  }

  return response.json();
}

/**
 * Cancel/delete a pending invitation
 */
export async function cancelInvitation(
  organizationId: string,
  invitationId: string
): Promise<void> {
  const response = await httpClient.fetch(
    `/api/v1/organizations/${organizationId}/invitations/${invitationId}`,
    {
      method: "DELETE",
    }
  );

  if (!response.ok) {
    throw new Error("Failed to cancel invitation");
  }
}

/**
 * Resend an invitation email
 */
export async function resendInvitation(
  organizationId: string,
  invitationId: string
): Promise<Invitation> {
  const response = await httpClient.fetch(
    `/api/v1/organizations/${organizationId}/invitations/${invitationId}/resend`,
    {
      method: "POST",
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to resend invitation");
  }

  return response.json();
}

/**
 * Decline an invitation
 */
export async function declineInvitation(token: string): Promise<void> {
  const response = await httpClient.fetch(
    `/api/v1/organizations/invitations/${token}/decline`,
    {
      method: "POST",
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to decline invitation");
  }
}

/**
 * Get all members of an organization
 */
export async function getOrganizationMembers(
  organizationId: string
): Promise<TeamMember[]> {
  const response = await httpClient.fetch(
    `/api/v1/organizations/${organizationId}/members`
  );

  if (!response.ok) {
    throw new Error("Failed to get organization members");
  }

  return response.json();
}
