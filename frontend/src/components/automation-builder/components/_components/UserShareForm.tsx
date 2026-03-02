"use client";

import { Share2, Loader2, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PermissionLevel } from "@/types/collaboration";

interface UserShareFormProps {
  emailInput: string;
  onEmailChange: (email: string) => void;
  selectedPermission: PermissionLevel;
  onPermissionChange: (permission: PermissionLevel) => void;
  expirationDate: string;
  onExpirationChange: (date: string) => void;
  loading: boolean;
  onSubmit: () => void;
}

export function UserShareForm({
  emailInput,
  onEmailChange,
  selectedPermission,
  onPermissionChange,
  expirationDate,
  onExpirationChange,
  loading,
  onSubmit,
}: UserShareFormProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="email">Email Address</Label>
        <Input
          id="email"
          type="email"
          placeholder="colleague@example.com"
          value={emailInput}
          onChange={(e) => onEmailChange(e.target.value)}
          disabled={loading}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSubmit();
            }
          }}
          data-ui-id="automation-share-email-input"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-2">
          <Label htmlFor="permission">Permission Level</Label>
          <Select
            value={selectedPermission}
            onValueChange={(value) =>
              onPermissionChange(value as PermissionLevel)
            }
            disabled={loading}
          >
            <SelectTrigger
              id="permission"
              data-ui-id="automation-share-permission-select"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="view">Can View</SelectItem>
              <SelectItem value="comment">Can Comment</SelectItem>
              <SelectItem value="edit">Can Edit</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="expiration">Expires (Optional)</Label>
          <div className="relative">
            <Input
              id="expiration"
              type="date"
              value={expirationDate}
              onChange={(e) => onExpirationChange(e.target.value)}
              disabled={loading}
              min={new Date().toISOString().split("T")[0]}
              className="pr-8"
              data-ui-id="automation-share-expiration-input"
            />
            <Calendar className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted pointer-events-none" />
          </div>
        </div>
      </div>
      <Button
        onClick={onSubmit}
        disabled={loading}
        className="w-full"
        data-ui-id="automation-share-user-btn"
      >
        {loading ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Share2 className="mr-2 h-4 w-4" />
        )}
        Share
      </Button>
    </div>
  );
}
