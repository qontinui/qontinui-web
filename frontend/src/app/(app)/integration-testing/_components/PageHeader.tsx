import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  RefreshCw,
  Loader2,
  CheckCircle2,
  Eye,
  FileText,
  AlertCircle,
} from "lucide-react";
import type { ViewMode } from "../_types";
import type { IntegrationTestResponse } from "@/types/integration-testing";

interface PageHeaderProps {
  viewMode: ViewMode;
  selectedRun: IntegrationTestResponse | null;
  apiHealthy: boolean | null;
  loading: boolean;
  projectId: string | null;
  onGoBack: () => void;
  onToggleViewMode: () => void;
  onRefresh: () => void;
}

export function PageHeader({
  viewMode,
  selectedRun,
  apiHealthy,
  loading,
  projectId,
  onGoBack,
  onToggleViewMode,
  onRefresh,
}: PageHeaderProps) {
  return (
    <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
      <div className="flex items-center gap-3">
        {viewMode !== "list" && selectedRun && (
          <Button variant="ghost" size="sm" onClick={onGoBack}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to List
          </Button>
        )}
        <h1 className="text-lg font-semibold text-foreground">
          Integration Testing
        </h1>
        <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
          Mock Mode
        </Badge>
      </div>
      <div className="flex items-center gap-3">
        <ApiStatusBadge apiHealthy={apiHealthy} />

        {selectedRun && (
          <Button variant="outline" size="sm" onClick={onToggleViewMode}>
            {viewMode === "visual" ? (
              <>
                <FileText className="w-4 h-4 mr-2" />
                Details View
              </>
            ) : (
              <>
                <Eye className="w-4 h-4 mr-2" />
                Visual View
              </>
            )}
          </Button>
        )}

        {viewMode === "list" && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={loading || !projectId}
            title={!projectId ? "Select a project to view runs" : undefined}
          >
            <RefreshCw
              className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        )}
      </div>
    </header>
  );
}

function ApiStatusBadge({ apiHealthy }: { apiHealthy: boolean | null }) {
  if (apiHealthy === null) {
    return (
      <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
        Checking API...
      </Badge>
    );
  }

  if (apiHealthy) {
    return (
      <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
        <CheckCircle2 className="w-3 h-3 mr-1" />
        API Connected
      </Badge>
    );
  }

  return (
    <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
      <AlertCircle className="w-3 h-3 mr-1" />
      API Offline
    </Badge>
  );
}
