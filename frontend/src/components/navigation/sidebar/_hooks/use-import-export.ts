import { useCallback, useMemo, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useAutomation } from "@/contexts/automation-context";
import { useAutomationStore } from "@/stores/automation";
import { ConfigImporter } from "@/lib/config-importer";
import { toast } from "sonner";

export function useImportExport() {
  const { user } = useAuth();
  const { loadConfiguration } = useAutomation();
  const [showExportDialog, setShowExportDialog] = useState(false);

  const importer = useMemo(() => new ConfigImporter(), []);

  const handleExport = useCallback(() => {
    if (!user) {
      toast.error("Please log in to export your project");
      return;
    }
    setShowExportDialog(true);
  }, [user]);

  const handleImport = useCallback(async () => {
    if (!user) {
      toast.error("Please log in to import a project");
      return;
    }

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const result = await importer.loadFromFile(file);

        if (result.errors.length > 0) {
          toast.error("Import failed", {
            description: result.errors.join(", "),
          });
          return;
        }

        if (result.warnings.length > 0) {
          result.warnings.forEach((warning) => {
            toast.warning("Import warning", { description: warning });
          });
        }

        loadConfiguration(result);

        const zustandStore = useAutomationStore.getState();
        await zustandStore.loadConfiguration({
          name: result.name,
          workflows: result.workflows,
          states: result.states,
          transitions: result.transitions,
          images: result.images,
          categories: result.categories,
          settings: result.settings,
        });

        toast.success("Import successful", {
          description: `Loaded ${result.states.length} states, ${result.workflows?.length || 0} workflows`,
        });
      } catch (error) {
        toast.error("Import failed", {
          description: error instanceof Error ? error.message : "Unknown error",
        });
      }
    };

    input.click();
  }, [user, importer, loadConfiguration]);

  return {
    showExportDialog,
    setShowExportDialog,
    handleExport,
    handleImport,
  };
}
