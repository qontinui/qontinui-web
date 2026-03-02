import {
  Workflow,
  Box,
  Image as ImageIcon,
  GitBranch,
  Folder,
  Zap,
  FileText,
  TestTube,
} from "lucide-react";
import type { ResourceType } from "@/services/global-search-service";

export interface GlobalSearchProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const RESOURCE_ICONS: Record<ResourceType, typeof Workflow> = {
  workflow: Workflow,
  state: Box,
  image: ImageIcon,
  transition: GitBranch,
  folder: Folder,
  action: Zap,
  component: FileText,
  test: TestTube,
  documentation: FileText,
};

export const RESOURCE_LABELS: Record<ResourceType, string> = {
  workflow: "Workflow",
  state: "State",
  image: "Image",
  transition: "Transition",
  folder: "Folder",
  action: "Action",
  component: "Component",
  test: "Test",
  documentation: "Documentation",
};
