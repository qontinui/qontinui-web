# Comments and Reviews

Complete guide to adding comments, conducting reviews, and managing discussions on automation projects.

## Overview

Qontinui's commenting system enables team collaboration through threaded discussions, code reviews, @mentions, and structured approval processes. Comments can be attached to workflows, states, transitions, and other project resources.

## Table of Contents

- [Adding Comments](#adding-comments)
- [Comment Threading](#comment-threading)
- [Mentions](#mentions)
- [Resolving Discussions](#resolving-discussions)
- [Review Workflow](#review-workflow)
- [Approval Process](#approval-process)
- [Canvas Comments](#canvas-comments)
- [Best Practices](#best-practices)

## Adding Comments

### Basic Comment Creation

```typescript
// Add a comment to a project resource
const addComment = async (
  projectId: number,
  content: string,
  resourceType?: string,
  resourceId?: string
) => {
  const response = await fetch('/api/v1/comments', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      project_id: projectId,
      workflow_id: resourceType === 'workflow' ? resourceId : null,
      action_id: resourceType === 'action' ? resourceId : null,
      content,
      mentions: extractMentions(content)
    })
  });

  return await response.json();
};
```

### Comment Data Model

```typescript
interface ProjectComment {
  id: string;
  project_id: number;
  workflow_id?: string;
  action_id?: string;
  author_id: string;
  content: string;
  position?: { x: number; y: number }; // For canvas positioning
  mentions?: string[]; // User IDs mentioned
  resolved: boolean;
  resolved_by?: string;
  resolved_at?: string;
  parent_comment_id?: string; // For threading
  created_at: string;
  updated_at: string;
  metadata?: {
    attachments?: string[];
    reactions?: Record<string, string[]>; // emoji -> user IDs
    tags?: string[];
  };

  // Populated relations
  author: {
    id: string;
    username: string;
    full_name?: string;
    avatar_url?: string;
  };
  replies?: ProjectComment[];
}
```

### Comment Component

```typescript
import { useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Send } from 'lucide-react';

export function CommentBox({
  projectId,
  resourceType,
  resourceId,
  onCommentAdded
}: {
  projectId: number;
  resourceType?: string;
  resourceId?: string;
  onCommentAdded?: (comment: ProjectComment) => void;
}) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!content.trim()) return;

    setLoading(true);
    try {
      const comment = await addComment(
        projectId,
        content,
        resourceType,
        resourceId
      );

      setContent('');
      onCommentAdded?.(comment);
      toast.success('Comment added');
    } catch (error) {
      toast.error('Failed to add comment');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <Textarea
        placeholder="Add a comment... Use @ to mention someone"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={3}
      />
      <div className="flex justify-end">
        <Button
          onClick={handleSubmit}
          disabled={loading || !content.trim()}
        >
          <Send className="w-4 h-4 mr-2" />
          Comment
        </Button>
      </div>
    </div>
  );
}
```

## Comment Threading

### Creating Reply Threads

```typescript
// Reply to an existing comment
const replyToComment = async (
  parentCommentId: string,
  content: string
) => {
  const response = await fetch('/api/v1/comments', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parent_comment_id: parentCommentId,
      content,
      mentions: extractMentions(content)
    })
  });

  return await response.json();
};
```

### Thread Display Component

```typescript
export function CommentThread({ comment }: { comment: ProjectComment }) {
  const [showReplies, setShowReplies] = useState(true);
  const [replyContent, setReplyContent] = useState('');

  return (
    <div className="space-y-2">
      {/* Main Comment */}
      <CommentCard comment={comment} />

      {/* Replies */}
      {comment.replies && comment.replies.length > 0 && (
        <div className="ml-8 border-l-2 border-border pl-4 space-y-2">
          <button
            className="text-sm text-muted-foreground hover:text-foreground"
            onClick={() => setShowReplies(!showReplies)}
          >
            {showReplies ? 'Hide' : 'Show'} {comment.replies.length} replies
          </button>

          {showReplies && (
            <>
              {comment.replies.map(reply => (
                <CommentCard key={reply.id} comment={reply} />
              ))}
            </>
          )}
        </div>
      )}

      {/* Reply Box */}
      <div className="ml-8">
        <CommentBox
          parentCommentId={comment.id}
          placeholder="Reply to this comment..."
          onCommentAdded={(reply) => {
            comment.replies = [...(comment.replies || []), reply];
          }}
        />
      </div>
    </div>
  );
}
```

## Mentions

### @Mention Syntax

```typescript
// Extract mentions from comment content
function extractMentions(content: string): string[] {
  const mentionRegex = /@(\w+)/g;
  const matches = content.matchAll(mentionRegex);
  return Array.from(matches, m => m[1]);
}

// Resolve usernames to user IDs
async function resolveMentions(usernames: string[]): Promise<string[]> {
  const response = await fetch('/api/v1/users/resolve', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ usernames })
  });

  const users = await response.json();
  return users.map(u => u.id);
}
```

### Mention Autocomplete

```typescript
import { useState, useEffect } from 'react';
import { useDebounce } from '@/hooks/use-debounce';

export function MentionAutocomplete({
  value,
  onChange,
  projectId
}: {
  value: string;
  onChange: (value: string) => void;
  projectId: number;
}) {
  const [suggestions, setSuggestions] = useState<User[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [cursorPosition, setCursorPosition] = useState(0);

  // Extract current mention being typed
  const getCurrentMention = () => {
    const textBeforeCursor = value.substring(0, cursorPosition);
    const lastAt = textBeforeCursor.lastIndexOf('@');
    if (lastAt === -1) return null;

    const mention = textBeforeCursor.substring(lastAt + 1);
    if (/\s/.test(mention)) return null; // Contains whitespace

    return mention;
  };

  const mention = getCurrentMention();
  const debouncedMention = useDebounce(mention, 300);

  useEffect(() => {
    if (!debouncedMention) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    // Fetch users matching mention
    fetchProjectUsers(projectId, debouncedMention).then(users => {
      setSuggestions(users);
      setShowSuggestions(users.length > 0);
    });
  }, [debouncedMention, projectId]);

  const insertMention = (user: User) => {
    const textBeforeCursor = value.substring(0, cursorPosition);
    const textAfterCursor = value.substring(cursorPosition);
    const lastAt = textBeforeCursor.lastIndexOf('@');

    const newValue =
      textBeforeCursor.substring(0, lastAt + 1) +
      user.username +
      ' ' +
      textAfterCursor;

    onChange(newValue);
    setShowSuggestions(false);
  };

  return (
    <div className="relative">
      <Textarea
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setCursorPosition(e.target.selectionStart);
        }}
        onSelect={(e) => {
          setCursorPosition(e.target.selectionStart);
        }}
      />

      {showSuggestions && (
        <div className="absolute bottom-full mb-2 bg-popover border rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {suggestions.map(user => (
            <button
              key={user.id}
              className="w-full px-3 py-2 text-left hover:bg-accent flex items-center gap-2"
              onClick={() => insertMention(user)}
            >
              {user.avatar_url && (
                <img
                  src={user.avatar_url}
                  alt={user.username}
                  className="w-6 h-6 rounded-full"
                />
              )}
              <div>
                <div className="font-medium">{user.username}</div>
                {user.full_name && (
                  <div className="text-xs text-muted-foreground">
                    {user.full_name}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Mention Notifications

```typescript
// Send notifications to mentioned users
async function notifyMentionedUsers(
  comment: ProjectComment,
  mentionedUserIds: string[]
) {
  await fetch('/api/v1/notifications', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'mention',
      recipient_ids: mentionedUserIds,
      data: {
        comment_id: comment.id,
        author: comment.author.username,
        content: comment.content,
        project_id: comment.project_id
      }
    })
  });
}
```

## Resolving Discussions

### Mark Comment as Resolved

```typescript
// Resolve a comment
const resolveComment = async (commentId: string) => {
  const response = await fetch(`/api/v1/comments/${commentId}/resolve`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    }
  });

  return await response.json();
};

// Unresolve a comment
const unresolveComment = async (commentId: string) => {
  const response = await fetch(`/api/v1/comments/${commentId}/unresolve`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    }
  });

  return await response.json();
};
```

### Resolution UI

```typescript
export function CommentResolutionButton({ comment }: { comment: ProjectComment }) {
  const [loading, setLoading] = useState(false);

  const toggleResolution = async () => {
    setLoading(true);
    try {
      if (comment.resolved) {
        await unresolveComment(comment.id);
        toast.success('Discussion reopened');
      } else {
        await resolveComment(comment.id);
        toast.success('Discussion resolved');
      }
    } catch (error) {
      toast.error('Failed to update resolution status');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant={comment.resolved ? 'outline' : 'default'}
      size="sm"
      onClick={toggleResolution}
      disabled={loading}
    >
      {comment.resolved ? (
        <>
          <CheckCircle className="w-4 h-4 mr-2" />
          Resolved
        </>
      ) : (
        <>
          <Circle className="w-4 h-4 mr-2" />
          Resolve
        </>
      )}
    </Button>
  );
}
```

### Filter Resolved Comments

```typescript
// Get comments with filter options
const getComments = async (
  projectId: number,
  options: {
    resolved?: boolean;
    workflowId?: string;
    authorId?: string;
  } = {}
) => {
  const params = new URLSearchParams({
    project_id: projectId.toString(),
    ...options
  });

  const response = await fetch(`/api/v1/comments?${params}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    }
  });

  return await response.json();
};

// Examples
const unresolvedComments = await getComments(projectId, { resolved: false });
const resolvedComments = await getComments(projectId, { resolved: true });
```

## Review Workflow

### Creating a Review Request

```typescript
interface ReviewRequest {
  project_id: number;
  workflow_id?: string;
  reviewers: string[]; // User IDs
  deadline?: string;
  description: string;
  checklist?: string[];
}

const createReviewRequest = async (request: ReviewRequest) => {
  const response = await fetch('/api/v1/reviews', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request)
  });

  return await response.json();
};
```

### Review Status Tracking

```typescript
interface Review {
  id: string;
  project_id: number;
  workflow_id?: string;
  requester_id: string;
  reviewers: Array<{
    user_id: string;
    status: 'pending' | 'approved' | 'changes_requested';
    reviewed_at?: string;
    comments?: string;
  }>;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  deadline?: string;
  created_at: string;
  updated_at: string;
}
```

### Review UI Component

```typescript
export function ReviewPanel({ projectId, workflowId }: {
  projectId: number;
  workflowId?: string;
}) {
  const { data: reviews } = useReviews(projectId, workflowId);
  const [selectedReviewers, setSelectedReviewers] = useState<string[]>([]);

  const requestReview = async () => {
    await createReviewRequest({
      project_id: projectId,
      workflow_id: workflowId,
      reviewers: selectedReviewers,
      description: 'Please review these changes',
      checklist: [
        'Logic is correct',
        'Error handling is proper',
        'Code follows best practices'
      ]
    });

    toast.success('Review requested');
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold mb-2">Request Review</h3>
        <UserSelector
          multiple
          value={selectedReviewers}
          onChange={setSelectedReviewers}
          projectId={projectId}
        />
        <Button onClick={requestReview} disabled={selectedReviewers.length === 0}>
          Request Review
        </Button>
      </div>

      <div>
        <h3 className="font-semibold mb-2">Active Reviews</h3>
        {reviews?.map(review => (
          <ReviewCard key={review.id} review={review} />
        ))}
      </div>
    </div>
  );
}
```

## Approval Process

### Approval Workflow

```typescript
// Approve changes
const approveReview = async (reviewId: string, comments?: string) => {
  const response = await fetch(`/api/v1/reviews/${reviewId}/approve`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ comments })
  });

  return await response.json();
};

// Request changes
const requestChanges = async (reviewId: string, changes: string) => {
  const response = await fetch(`/api/v1/reviews/${reviewId}/request-changes`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ changes })
  });

  return await response.json();
};
```

### Approval Rules

```typescript
interface ApprovalRules {
  required_approvals: number; // Minimum approvals needed
  required_reviewers?: string[]; // Specific reviewers required
  allow_author_approval: boolean;
  block_on_changes_requested: boolean;
}

// Check if review can be merged
function canMerge(review: Review, rules: ApprovalRules): boolean {
  const approvals = review.reviewers.filter(r => r.status === 'approved');
  const changesRequested = review.reviewers.some(
    r => r.status === 'changes_requested'
  );

  if (rules.block_on_changes_requested && changesRequested) {
    return false;
  }

  if (approvals.length < rules.required_approvals) {
    return false;
  }

  if (rules.required_reviewers) {
    const requiredApproved = rules.required_reviewers.every(userId =>
      approvals.some(a => a.user_id === userId)
    );
    if (!requiredApproved) {
      return false;
    }
  }

  return true;
}
```

## Canvas Comments

### Positioned Comments

```typescript
// Add comment at specific canvas position
const addCanvasComment = async (
  projectId: number,
  workflowId: string,
  content: string,
  position: { x: number; y: number }
) => {
  const response = await fetch('/api/v1/comments', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      project_id: projectId,
      workflow_id: workflowId,
      content,
      position
    })
  });

  return await response.json();
};
```

### Canvas Comment Marker

```typescript
export function CanvasCommentMarker({
  comment,
  onClick
}: {
  comment: ProjectComment;
  onClick: () => void;
}) {
  if (!comment.position) return null;

  return (
    <div
      className="absolute w-8 h-8 cursor-pointer"
      style={{
        left: comment.position.x,
        top: comment.position.y,
        transform: 'translate(-50%, -50%)'
      }}
      onClick={onClick}
    >
      <div className="relative">
        <MessageCircle
          className={`w-8 h-8 ${
            comment.resolved
              ? 'text-green-500'
              : 'text-blue-500'
          }`}
        />
        {comment.replies && comment.replies.length > 0 && (
          <div className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 text-white text-xs rounded-full flex items-center justify-center">
            {comment.replies.length}
          </div>
        )}
      </div>
    </div>
  );
}
```

## Best Practices

### Effective Commenting

1. **Be Specific**
   - Reference exact lines or actions
   - Provide context and examples
   - Include screenshots when helpful

2. **Be Constructive**
   - Focus on improvements, not criticism
   - Suggest solutions, not just problems
   - Use positive language

3. **Be Concise**
   - Keep comments focused
   - One topic per comment thread
   - Use threading for related discussions

### Review Guidelines

1. **Timely Reviews**
   - Review within 24-48 hours
   - Set status to "In Review" immediately
   - Communicate if you need more time

2. **Thorough Reviews**
   - Test the changes
   - Check edge cases
   - Verify documentation

3. **Clear Feedback**
   - Distinguish between required and optional changes
   - Use labels: "Must fix", "Suggestion", "Question"
   - Provide examples for complex changes

### Team Collaboration

1. **Use Mentions Wisely**
   - @ specific people for action items
   - Don't overuse @everyone
   - Mention relevant experts

2. **Resolve Discussions**
   - Mark as resolved once addressed
   - Summarize outcome before resolving
   - Reopen if issue persists

3. **Maintain Comment Hygiene**
   - Delete obsolete comments
   - Update comments if context changes
   - Archive old discussions

## Related Documentation

- [Organizations](./organizations.md) - Team collaboration
- [Project Sharing](./project-sharing.md) - Share for review
- [Activity Tracking](./activity-tracking.md) - Track comment activity
- [API Reference](./api-reference.md) - Comments API

---

**Last Updated:** 2025-01-14
