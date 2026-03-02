import { useState } from "react";
import { useInstallPackage } from "@/hooks/useCodePackages";
import type { InstallStatus } from "@/types/code-packages";

export function usePackageInstall(packageId: string | undefined) {
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [installStatus, setInstallStatus] = useState<InstallStatus>("idle");
  const installPackageMutation = useInstallPackage();

  const handleInstallClick = () => {
    setInstallDialogOpen(true);
    setInstallStatus("idle");
  };

  const handleInstall = async (projectId: string, versionId?: string) => {
    if (!packageId) return;

    setInstallStatus("installing");

    try {
      await installPackageMutation.mutateAsync({
        package_id: packageId,
        version_id: versionId,
        project_id: projectId,
      });
      setInstallStatus("installed");
      setTimeout(() => {
        setInstallDialogOpen(false);
        setInstallStatus("idle");
      }, 2000);
    } catch (error) {
      console.error("[PackageDetailsPage] Failed to install package:", error);
      setInstallStatus("failed");
    }
  };

  const installProgress =
    installStatus === "installing"
      ? 50
      : installStatus === "installed"
        ? 100
        : 0;

  return {
    installDialogOpen,
    setInstallDialogOpen,
    installStatus,
    installProgress,
    handleInstallClick,
    handleInstall,
  };
}
