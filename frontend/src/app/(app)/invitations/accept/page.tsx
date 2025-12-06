/**
 * Accept Invitation Page
 *
 * Page for accepting organization invitations from email links.
 * Displays organization details and provides Accept/Decline options.
 * Handles already-accepted and expired invitations.
 */

"use client";

import React, { useEffect, useState, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Building2,
  Mail,
  Shield,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import type {
  Invitation,
  Organization,
  MemberRole,
} from "@/types/collaboration";
import {
  acceptInvitation,
  declineInvitation,
  getInvitationDetails,
} from "@/lib/api/organizations";

// ============================================================================
// Types
// ============================================================================

type InvitationStatus = "loading" | "valid" | "accepted" | "expired" | "error";

interface InvitationData {
  invitation: Invitation;
  organization: Organization;
}

// ============================================================================
// Helper Functions
// ============================================================================

function getRoleDescription(role: MemberRole): string {
  switch (role) {
    case "owner":
      return "Full access to manage the organization, members, and all projects";
    case "admin":
      return "Can manage members, settings, and all projects";
    case "member":
      return "Can create and edit projects and workflows";
    case "viewer":
      return "Can view projects but cannot make changes";
  }
}

function getRoleBadgeVariant(
  role: MemberRole
): "default" | "secondary" | "outline" {
  switch (role) {
    case "owner":
    case "admin":
      return "default";
    case "member":
      return "secondary";
    case "viewer":
      return "outline";
  }
}

// ============================================================================
// Main Component Content
// ============================================================================

function AcceptInvitationContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<InvitationStatus>("loading");
  const [invitationData, setInvitationData] = useState<InvitationData | null>(
    null
  );
  const [isAccepting, setIsAccepting] = useState(false);
  const [isDeclining, setIsDeclining] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>("");

  // Load invitation details
  useEffect(() => {
    if (!token) {
      setStatus("error");
      setErrorMessage("No invitation token provided");
      return;
    }

    loadInvitationDetails();
  }, [token]);

  const loadInvitationDetails = useCallback(async () => {
    if (!token) return;

    setStatus("loading");
    try {
      const data = await getInvitationDetails(token);

      // Check invitation status
      if (data.status === "accepted") {
        setStatus("accepted");
      } else if (data.status === "expired" || data.status === "revoked") {
        setStatus("expired");
      } else {
        setStatus("valid");
        setInvitationData({ invitation: data, organization: data.organization });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load invitation";
      setStatus("error");
      setErrorMessage(message);
      toast.error(message);
    }
  }, [token]);

  // Accept invitation
  const handleAccept = useCallback(async () => {
    if (!token) return;

    setIsAccepting(true);
    try {
      const result = await acceptInvitation(token);
      toast.success(`Successfully joined ${result.organization.name}!`);

      // Redirect to organization dashboard or projects
      setTimeout(() => {
        router.push("/dashboard");
      }, 1500);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to accept invitation";
      toast.error(message);
      setErrorMessage(message);
    } finally {
      setIsAccepting(false);
    }
  }, [token, router]);

  // Decline invitation
  const handleDecline = useCallback(async () => {
    if (!token) return;

    setIsDeclining(true);
    try {
      await declineInvitation(token);
      toast.success("Invitation declined");

      // Redirect to dashboard
      setTimeout(() => {
        router.push("/dashboard");
      }, 1000);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to decline invitation";
      toast.error(message);
    } finally {
      setIsDeclining(false);
    }
  }, [token, router]);

  // Loading state
  if (status === "loading") {
    return (
      <div className="container max-w-2xl mx-auto px-4 py-16">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
            <p className="text-muted-foreground">Loading invitation...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Error state
  if (status === "error") {
    return (
      <div className="container max-w-2xl mx-auto px-4 py-16">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <XCircle className="h-6 w-6 text-destructive" />
              <CardTitle>Invalid Invitation</CardTitle>
            </div>
            <CardDescription>This invitation link is not valid</CardDescription>
          </CardHeader>
          <CardContent>
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>
                {errorMessage || "Invalid invitation token"}
              </AlertDescription>
            </Alert>
          </CardContent>
          <CardFooter>
            <Button
              onClick={() => router.push("/dashboard")}
              variant="outline"
              className="w-full"
            >
              Go to Dashboard
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // Already accepted state
  if (status === "accepted") {
    return (
      <div className="container max-w-2xl mx-auto px-4 py-16">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-6 w-6 text-green-500" />
              <CardTitle>Already Accepted</CardTitle>
            </div>
            <CardDescription>
              You have already accepted this invitation
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Success</AlertTitle>
              <AlertDescription>
                This invitation has already been accepted. You can access the
                organization from your dashboard.
              </AlertDescription>
            </Alert>
          </CardContent>
          <CardFooter>
            <Button
              onClick={() => router.push("/dashboard")}
              className="w-full"
            >
              Go to Dashboard
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // Expired state
  if (status === "expired") {
    return (
      <div className="container max-w-2xl mx-auto px-4 py-16">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Clock className="h-6 w-6 text-yellow-500" />
              <CardTitle>Invitation Expired</CardTitle>
            </div>
            <CardDescription>This invitation link has expired</CardDescription>
          </CardHeader>
          <CardContent>
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Expired</AlertTitle>
              <AlertDescription>
                This invitation is no longer valid. Please contact the
                organization administrator to request a new invitation.
              </AlertDescription>
            </Alert>
          </CardContent>
          <CardFooter>
            <Button
              onClick={() => router.push("/dashboard")}
              variant="outline"
              className="w-full"
            >
              Go to Dashboard
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // Valid invitation - show accept/decline options
  if (!invitationData) {
    return null;
  }

  const { invitation, organization } = invitationData;

  return (
    <div className="container max-w-2xl mx-auto px-4 py-16">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="flex items-center justify-center h-12 w-12 rounded-lg bg-primary/10">
              <Building2 className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle>Organization Invitation</CardTitle>
              <CardDescription>
                You've been invited to join an organization
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Organization Details */}
          <div className="space-y-4">
            <div className="p-4 rounded-lg border bg-card">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="flex-1">
                  <h3 className="font-semibold text-lg">{organization.name}</h3>
                  {organization.description && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {organization.description}
                    </p>
                  )}
                </div>
                <Badge
                  variant={getRoleBadgeVariant(invitation.role)}
                  className="text-xs"
                >
                  {invitation.role}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Building2 className="h-4 w-4" />
                  <span>{organization.member_count} members</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Mail className="h-4 w-4" />
                  <span>{invitation.email}</span>
                </div>
              </div>
            </div>

            {/* Role Information */}
            <div className="p-4 rounded-lg border bg-muted/50">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium text-sm">
                  Your Role: {invitation.role}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {getRoleDescription(invitation.role)}
              </p>
            </div>
          </div>

          {/* Warning if expiring soon */}
          {(() => {
            const expiresAt = new Date(invitation.expires_at);
            const now = new Date();
            const hoursUntilExpiry =
              (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);

            if (hoursUntilExpiry < 24 && hoursUntilExpiry > 0) {
              return (
                <Alert>
                  <Clock className="h-4 w-4" />
                  <AlertTitle>Expires Soon</AlertTitle>
                  <AlertDescription>
                    This invitation will expire on{" "}
                    {expiresAt.toLocaleDateString()} at{" "}
                    {expiresAt.toLocaleTimeString()}
                  </AlertDescription>
                </Alert>
              );
            }
            return null;
          })()}
        </CardContent>

        <CardFooter className="flex gap-3">
          <Button
            variant="outline"
            onClick={handleDecline}
            disabled={isAccepting || isDeclining}
            className="flex-1"
          >
            {isDeclining ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Declining...
              </>
            ) : (
              "Decline"
            )}
          </Button>
          <Button
            onClick={handleAccept}
            disabled={isAccepting || isDeclining}
            className="flex-1"
          >
            {isAccepting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Accepting...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Accept Invitation
              </>
            )}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

// ============================================================================
// Main Page Component with Suspense
// ============================================================================

export default function AcceptInvitationPage() {
  return (
    <Suspense
      fallback={
        <div className="container max-w-2xl mx-auto px-4 py-16">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
              <p className="text-muted-foreground">Loading invitation...</p>
            </CardContent>
          </Card>
        </div>
      }
    >
      <AcceptInvitationContent />
    </Suspense>
  );
}
