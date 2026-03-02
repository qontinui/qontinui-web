import { ArrowLeft, Download, Shield, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { CodePackage } from "@/types/code-packages";

interface PackageHeaderProps {
  pkg: CodePackage;
  hasSecurityIssues: boolean;
  onBack: () => void;
  onInstallClick: () => void;
}

export function PackageHeader({
  pkg,
  hasSecurityIssues,
  onBack,
  onInstallClick,
}: PackageHeaderProps) {
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
        {hasSecurityIssues && (
          <Alert variant="destructive" className="py-1 px-3">
            <AlertDescription className="text-sm">
              <AlertTriangle className="w-3 h-3 inline mr-1" />
              Security issues detected
            </AlertDescription>
          </Alert>
        )}
        <Button
          onClick={onInstallClick}
          disabled={pkg.deprecated || hasSecurityIssues}
          className="bg-primary"
        >
          <Download className="w-4 h-4 mr-2" />
          Install Package
        </Button>
      </div>
    </div>
  );
}
