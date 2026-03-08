import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { RefreshCw, Home, Network, Smartphone } from "lucide-react";

interface AdminHeaderProps {
  loading: boolean;
  onRefresh: () => void;
}

export function AdminHeader({ loading, onRefresh }: AdminHeaderProps) {
  const router = useRouter();

  return (
    <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
      <h1 className="text-lg font-semibold">Admin Dashboard</h1>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/admin/architecture")}
          data-testid="admin-page-architecture-btn"
        >
          <Network className="h-3.5 w-3.5 mr-1" />
          Architecture
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/admin/mobile")}
          data-testid="admin-page-mobile-btn"
        >
          <Smartphone className="h-3.5 w-3.5 mr-1" />
          Mobile
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
          />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/build/workflows")}
        >
          <Home className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
