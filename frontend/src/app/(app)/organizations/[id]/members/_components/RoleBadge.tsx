import { Badge } from "@/components/ui/badge";
import { Crown, Shield, User, Eye, HeartHandshake } from "lucide-react";
import type { MemberRole } from "@/types/collaboration";

const ROLE_ICONS: Record<MemberRole, React.ReactNode> = {
  owner: <Crown className="w-3.5 h-3.5" />,
  admin: <Shield className="w-3.5 h-3.5" />,
  member: <User className="w-3.5 h-3.5" />,
  viewer: <Eye className="w-3.5 h-3.5" />,
  helper: <HeartHandshake className="w-3.5 h-3.5" />,
};

const ROLE_COLORS: Record<MemberRole, string> = {
  owner: "bg-primary/10 text-primary",
  admin: "bg-blue-500/10 text-blue-500",
  member: "bg-muted text-muted-foreground",
  viewer: "bg-muted text-muted-foreground",
  helper: "bg-amber-500/10 text-amber-500",
};

export function RoleBadge({ role }: { role: MemberRole }) {
  return (
    <Badge
      className={`${ROLE_COLORS[role]} flex items-center gap-1 w-fit text-xs`}
    >
      {ROLE_ICONS[role]}
      {role}
    </Badge>
  );
}
