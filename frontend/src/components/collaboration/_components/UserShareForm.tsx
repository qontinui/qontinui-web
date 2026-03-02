import { Share2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PermissionSelect } from "./PermissionSelect";
import type { PermissionLevel } from "../_types/project-sharing";

interface UserShareFormProps {
  emailInput: string;
  onEmailChange: (value: string) => void;
  selectedPermission: PermissionLevel;
  onPermissionChange: (value: PermissionLevel) => void;
  loading: boolean;
  onSubmit: () => void;
}

export function UserShareForm({
  emailInput,
  onEmailChange,
  selectedPermission,
  onPermissionChange,
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
          data-ui-id="dialog-project-sharing-email-input"
        />
      </div>
      <div className="flex gap-2">
        <PermissionSelect
          value={selectedPermission}
          onValueChange={onPermissionChange}
          disabled={loading}
          triggerClassName="w-[180px]"
          data-ui-id="dialog-project-sharing-user-permission-select"
        />
        <Button
          onClick={onSubmit}
          disabled={loading}
          className="flex-1"
          data-ui-id="dialog-project-sharing-share-user-btn"
        >
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Share2 className="mr-2 h-4 w-4" />
          )}
          Share
        </Button>
      </div>
    </div>
  );
}
