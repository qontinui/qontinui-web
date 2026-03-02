import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "sonner";

export type Section =
  | "users"
  | "projects"
  | "analytics"
  | "health"
  | "system"
  | "notifications"
  | "downloads";

export function useAdminGuard() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const redirected = useRef(false);

  useEffect(() => {
    if (redirected.current) return;
    if (!authLoading && !user) {
      redirected.current = true;
      router.replace("/");
      return;
    }
    if (!authLoading && user && !user.is_superuser) {
      redirected.current = true;
      toast.error("Access denied - Admin privileges required");
      router.replace("/build/workflows");
    }
  }, [user, authLoading, router]);

  return { user, authLoading };
}
