import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { RefreshCw, Home } from "lucide-react";

interface AdminHeaderProps {
  loading: boolean;
  onRefresh: () => void;
}

export function AdminHeader({ loading, onRefresh }: AdminHeaderProps) {
  const router = useRouter();

  return (
    <div
      className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0"
      data-ui-id="admin-header"
    >
      <h1 className="text-lg font-semibold" data-ui-id="admin-title">
        Admin
      </h1>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={loading}
          data-ui-id="admin-refresh-btn"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
          />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/build/workflows")}
          data-ui-id="admin-home-btn"
        >
          <Home className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
