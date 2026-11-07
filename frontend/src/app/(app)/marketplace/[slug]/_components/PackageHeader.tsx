import { ArrowLeft, Download, Shield, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import {
  SCAN_STATUS_BRIDGE_ID,
  SCAN_TONE_SURFACE,
  SCAN_TONE_TEXT,
  ScanIcon,
} from "@/components/marketplace/ScanStatus";
import { scanDisplay } from "@/types/code-packages";
import type { CodePackage } from "@/types/code-packages";

interface PackageHeaderProps {
  pkg: CodePackage;
  onBack: () => void;
  onInstallClick: () => void;
}

/**
 * The package page header. It shows the latest version's served scan status
 * but does not gate Install on it: the install dialog's per-version guard
 * does, as the server does per version.
 */
export function PackageHeader({
  pkg,
  onBack,
  onInstallClick,
}: PackageHeaderProps) {
  const latest = pkg.latest_version ?? null;
  const scan = latest ? scanDisplay(latest.security_scan) : null;
  return (
    <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <h1 className="text-lg font-semibold text-foreground">{pkg.name}</h1>
        {pkg.verified && (
          <div title="Verified by staff">
            <Shield className="w-4 h-4 text-primary flex-shrink-0" />
          </div>
        )}
        {pkg.featured && (
          <Badge className="bg-primary text-primary-foreground">Featured</Badge>
        )}
      </div>
      <div className="flex items-center gap-3">
        {pkg.deprecated && (
          <Alert variant="destructive" className="py-1 px-3">
            <AlertDescription className="text-sm">
              <AlertTriangle className="w-3 h-3 inline mr-1" />
              Deprecated
              {pkg.deprecated_reason && `: ${pkg.deprecated_reason}`}
            </AlertDescription>
          </Alert>
        )}
        {scan ? (
          <div
            className={cn(
              "flex items-center gap-1.5 rounded-md border py-1 px-3 text-sm",
              SCAN_TONE_SURFACE[scan.tone]
            )}
            data-ui-bridge-id={SCAN_STATUS_BRIDGE_ID}
            data-scan-status={scan.status}
          >
            <ScanIcon display={scan} className="w-3 h-3" />
            <span className={SCAN_TONE_TEXT[scan.tone]}>{scan.label}</span>
          </div>
        ) : (
          <Badge variant="outline">No published version</Badge>
        )}
        <Button
          onClick={onInstallClick}
          disabled={pkg.deprecated || !latest}
          className="bg-primary"
        >
          <Download className="w-4 h-4 mr-2" />
          Install Package
        </Button>
      </div>
    </div>
  );
}
