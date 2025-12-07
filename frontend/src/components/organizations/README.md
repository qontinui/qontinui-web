# Organization Components

Components for managing organization invitations and members.

## Components

### InviteMemberDialog

A dialog component for inviting new members to an organization. Features include:

- Email input field
- Role selector (Admin, Member, Viewer)
- Send invitation button
- List of pending invitations
- Ability to resend or cancel invitations

**Usage:**

```tsx
import { InviteMemberDialog } from "@/components/organizations";

function OrganizationSettingsPage() {
  const [showInviteDialog, setShowInviteDialog] = useState(false);

  return (
    <>
      <Button onClick={() => setShowInviteDialog(true)}>Invite Members</Button>

      <InviteMemberDialog
        open={showInviteDialog}
        organizationId="org-123"
        organizationName="My Organization"
        onClose={() => setShowInviteDialog(false)}
        onInvitationSent={(invitation) => {
          console.log("Invitation sent:", invitation);
        }}
      />
    </>
  );
}
```

**Props:**

- `open` (boolean): Controls dialog visibility
- `organizationId` (string): ID of the organization
- `organizationName` (string): Display name of the organization
- `onClose` (() => void): Callback when dialog is closed
- `onInvitationSent?` ((invitation: Invitation) => void): Optional callback when invitation is sent

## Pages

### Accept Invitation Page

Located at `/app/(app)/invitations/accept/page.tsx`

This page handles accepting organization invitations from email links. It:

- Extracts the invitation token from URL query parameters
- Displays organization details
- Shows the role being offered
- Provides "Accept" and "Decline" buttons
- Handles edge cases (expired, already accepted, invalid tokens)
- Redirects to dashboard after accepting/declining

**URL Format:**

```
/invitations/accept?token=<invitation-token>
```

**Features:**

- Loading states while fetching invitation details
- Error handling for invalid or expired tokens
- Visual feedback for different invitation states
- Automatic redirect after successful acceptance
- Warning for invitations expiring soon

## API Integration

The components use the following API endpoints from `@/lib/api/organizations`:

### Sending Invitations

```typescript
import { inviteMember } from "@/lib/api/organizations";

const invitation = await inviteMember(organizationId, {
  email: "user@example.com",
  role: "member",
});
```

### Getting Pending Invitations

```typescript
import { getInvitations } from "@/lib/api/organizations";

const invitations = await getInvitations(organizationId);
```

### Accepting Invitations

```typescript
import { acceptInvitation } from "@/lib/api/organizations";

const result = await acceptInvitation(token);
```

### Declining Invitations

```typescript
import { declineInvitation } from "@/lib/api/organizations";

await declineInvitation(token);
```

### Canceling Invitations

```typescript
import { cancelInvitation } from "@/lib/api/organizations";

await cancelInvitation(organizationId, invitationId);
```

### Resending Invitations

```typescript
import { resendInvitation } from "@/lib/api/organizations";

const invitation = await resendInvitation(organizationId, invitationId);
```

## Types

All types are imported from `@/types/collaboration`:

```typescript
import type {
  Organization,
  Invitation,
  InvitationCreate,
  MemberRole,
  TeamMember,
} from "@/types/collaboration";
```

### MemberRole

```typescript
type MemberRole = "owner" | "admin" | "member" | "viewer";
```

### Invitation

```typescript
interface Invitation {
  id: string;
  organization_id: string;
  email: string;
  role: MemberRole;
  invited_by: string;
  invited_at: string;
  expires_at: string;
  token: string;
  status: "pending" | "accepted" | "expired" | "revoked";
}
```

## Invitation Flow

1. **Sending Invitations:**
   - Admin opens InviteMemberDialog
   - Enters email and selects role
   - Clicks "Send Invitation"
   - Backend sends email with invitation link
   - Invitation appears in pending list

2. **Accepting Invitations:**
   - User clicks link in email
   - Redirected to `/invitations/accept?token=...`
   - Page shows organization details and role
   - User clicks "Accept Invitation"
   - User is added to organization
   - Redirected to dashboard

3. **Managing Invitations:**
   - View pending invitations in dialog
   - Resend invitation if user didn't receive email
   - Cancel invitation if no longer needed
   - Invitations automatically expire after set time

## Error Handling

All components include comprehensive error handling:

- Network failures show error toasts
- Invalid tokens show error states
- Expired invitations show appropriate messages
- Loading states prevent duplicate submissions
- Form validation for email inputs

## Accessibility

Components follow accessibility best practices:

- Proper ARIA labels and roles
- Keyboard navigation support
- Focus management in dialogs
- Screen reader friendly error messages
- Semantic HTML structure
