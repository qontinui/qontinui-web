import { Share2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PermissionSelect } from "./PermissionSelect";
import type { PermissionLevel, Organization } from "../_types/project-sharing";

interface OrgShareFormProps {
  organizations: Organization[];
  selectedOrg: string;
  onOrgChange: (value: string) => void;
  selectedPermission: PermissionLevel;
  onPermissionChange: (value: PermissionLevel) => void;
  loading: boolean;
  onSubmit: () => void;
}

export function OrgShareForm({
  organizations,
  selectedOrg,
  onOrgChange,
  selectedPermission,
  onPermissionChange,
  loading,
  onSubmit,
}: OrgShareFormProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="organization">Organization</Label>
        <Select
          value={selectedOrg}
          onValueChange={onOrgChange}
          disabled={loading}
        >
          <SelectTrigger
            id="organization"
            data-ui-id="dialog-project-sharing-organization-select"
          >
            <SelectValue placeholder="Select an organization" />
          </SelectTrigger>
          <SelectContent>
            {organizations.map((org) => (
              <SelectItem key={org.id} value={org.id}>
                {org.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-2">
        <PermissionSelect
          value={selectedPermission}
          onValueChange={onPermissionChange}
          disabled={loading}
          triggerClassName="w-[180px]"
          data-ui-id="dialog-project-sharing-org-permission-select"
        />
        <Button
          onClick={onSubmit}
          disabled={loading}
          className="flex-1"
          data-ui-id="dialog-project-sharing-share-org-btn"
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
