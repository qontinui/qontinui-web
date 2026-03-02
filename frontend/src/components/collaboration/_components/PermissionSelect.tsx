import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PermissionLevel } from "../_types/project-sharing";

interface PermissionSelectProps {
  value: PermissionLevel;
  onValueChange: (value: PermissionLevel) => void;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  "data-ui-id"?: string;
  children?: React.ReactNode;
}

export function PermissionSelect({
  value,
  onValueChange,
  disabled,
  triggerClassName,
  "data-ui-id": dataUiId,
  children,
}: PermissionSelectProps) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onValueChange(v as PermissionLevel)}
      disabled={disabled}
    >
      <SelectTrigger className={triggerClassName} data-ui-id={dataUiId}>
        {children ?? <SelectValue />}
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="view">Can View</SelectItem>
        <SelectItem value="comment">Can Comment</SelectItem>
        <SelectItem value="edit">Can Edit</SelectItem>
        <SelectItem value="admin">Admin</SelectItem>
      </SelectContent>
    </Select>
  );
}
