import { Badge } from "@/components/ui/badge";
import { ChevronRight } from "lucide-react";
import type { AdminUserData } from "@/hooks/use-admin";

interface UsersTableProps {
  users: AdminUserData[];
  loading: boolean;
}

export function UsersTable({ users, loading }: UsersTableProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        Loading users...
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        No users found
      </div>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
        <tr className="text-left text-xs text-muted-foreground uppercase tracking-wider">
          <th className="px-6 py-2 font-medium">User</th>
          <th className="px-3 py-2 font-medium">Tier</th>
          <th className="px-3 py-2 font-medium">Status</th>
          <th className="px-3 py-2 font-medium text-right">Projects</th>
          <th className="px-3 py-2 font-medium">Joined</th>
          <th className="px-6 py-2 font-medium"></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {users.map((user) => (
          <tr key={user.id} className="hover:bg-muted/30 transition-colors">
            <td className="px-6 py-2.5">
              <div>
                <span
                  className="font-medium"
                  data-content-role="label"
                  data-content-label="username"
                >
                  {user.username}
                </span>
                <div className="text-xs text-muted-foreground">
                  {user.email}
                </div>
              </div>
            </td>
            <td className="px-3 py-2.5">
              <Badge
                variant="outline"
                className="text-xs capitalize"
                data-content-role="badge"
              >
                {user.subscription_tier}
              </Badge>
            </td>
            <td className="px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                <div
                  className={`h-1.5 w-1.5 rounded-full ${
                    user.is_active ? "bg-green-500" : "bg-red-500"
                  }`}
                />
                <span className="text-xs">
                  {user.is_active ? "Active" : "Inactive"}
                </span>
                {!(user.email_verified ?? user.is_verified) && (
                  <span className="text-xs text-yellow-500">(unverified)</span>
                )}
              </div>
            </td>
            <td
              className="px-3 py-2.5 text-right tabular-nums"
              data-content-role="metric"
              data-content-label="project-count"
            >
              {user.project_count}
            </td>
            <td className="px-3 py-2.5 text-xs text-muted-foreground">
              {user.created_at
                ? new Date(user.created_at).toLocaleDateString()
                : "\u2014"}
            </td>
            <td className="px-6 py-2.5">
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
