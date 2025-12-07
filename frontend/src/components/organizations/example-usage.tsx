/**
 * Example Usage of Organization Invitation Components
 *
 * This file demonstrates how to integrate the InviteMemberDialog
 * component into an organization settings or members page.
 */

"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { UserPlus, Users } from "lucide-react";
import { InviteMemberDialog } from "./InviteMemberDialog";
import type { Invitation } from "@/types/collaboration";

// ============================================================================
// Example: Organization Settings Page
// ============================================================================

export function OrganizationMembersExample() {
  const [showInviteDialog, setShowInviteDialog] = useState(false);

  // Replace with actual organization data from your state/context
  const organization = {
    id: "org-123",
    name: "My Organization",
  };

  const handleInvitationSent = (invitation: Invitation) => {
    console.log("Invitation sent successfully:", invitation);
    // You can update your local state, show a notification, etc.
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Members</h1>
            <p className="text-muted-foreground mt-1">
              Manage your organization members and invitations
            </p>
          </div>
          <Button onClick={() => setShowInviteDialog(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            Invite Members
          </Button>
        </div>

        {/* Members List (placeholder) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Team Members
            </CardTitle>
            <CardDescription>
              People who are part of your organization
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center py-8 text-muted-foreground">
              <p>Your team members would be listed here</p>
            </div>
          </CardContent>
        </Card>

        {/* Invite Dialog */}
        <InviteMemberDialog
          open={showInviteDialog}
          organizationId={organization.id}
          organizationName={organization.name}
          onClose={() => setShowInviteDialog(false)}
          onInvitationSent={handleInvitationSent}
        />
      </div>
    </div>
  );
}

// ============================================================================
// Example: Organization Context Integration
// ============================================================================

/**
 * If you have an organization context, you can use it like this:
 */

/*
import { useOrganization } from '@/contexts/organization-context';

export function OrganizationMembersWithContext() {
  const { currentOrganization } = useOrganization();
  const [showInviteDialog, setShowInviteDialog] = useState(false);

  if (!currentOrganization) {
    return <div>No organization selected</div>;
  }

  return (
    <>
      <Button onClick={() => setShowInviteDialog(true)}>
        Invite Members
      </Button>

      <InviteMemberDialog
        open={showInviteDialog}
        organizationId={currentOrganization.id}
        organizationName={currentOrganization.name}
        onClose={() => setShowInviteDialog(false)}
      />
    </>
  );
}
*/

// ============================================================================
// Example: Inline Usage in Settings Page
// ============================================================================

export function OrganizationSettingsInlineExample() {
  const [showInviteDialog, setShowInviteDialog] = useState(false);

  return (
    <div className="space-y-6">
      {/* Other settings sections... */}

      <Card>
        <CardHeader>
          <CardTitle>Team Management</CardTitle>
          <CardDescription>
            Invite team members and manage access to your organization
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => setShowInviteDialog(true)}
            variant="outline"
            className="w-full sm:w-auto"
          >
            <UserPlus className="h-4 w-4 mr-2" />
            Invite Team Members
          </Button>
        </CardContent>
      </Card>

      <InviteMemberDialog
        open={showInviteDialog}
        organizationId="org-123"
        organizationName="My Organization"
        onClose={() => setShowInviteDialog(false)}
        onInvitationSent={(invitation) => {
          console.log("New invitation:", invitation);
        }}
      />
    </div>
  );
}
