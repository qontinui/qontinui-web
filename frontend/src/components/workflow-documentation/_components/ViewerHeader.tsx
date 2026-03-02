"use client";

import React from "react";
import { WorkflowDocumentation } from "@/services/workflow-documentation-service";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Edit,
  Download,
  Share2,
  Printer,
  Moon,
  Sun,
  Copy,
  Check,
} from "lucide-react";
import { useTheme } from "next-themes";

interface ViewerHeaderProps {
  workflowName: string;
  documentation: WorkflowDocumentation;
  copiedLink: boolean;
  onCopyLink: () => void;
  onExport: (format: "markdown" | "html" | "pdf") => void;
  onPrint: () => void;
  onEdit: () => void;
}

export function ViewerHeader({
  workflowName,
  documentation,
  copiedLink,
  onCopyLink,
  onExport,
  onPrint,
  onEdit,
}: ViewerHeaderProps) {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex items-center justify-between p-4 border-b">
      <div>
        <h1 className="text-2xl font-bold">{workflowName}</h1>
        <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
          <span>Version {documentation.version}</span>
          <span>&bull;</span>
          <span>
            Updated {new Date(documentation.updated).toLocaleDateString()}
          </span>
          {documentation.author && (
            <>
              <span>&bull;</span>
              <span>by {documentation.author}</span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          title="Toggle theme"
        >
          {theme === "dark" ? (
            <Sun className="size-4" />
          ) : (
            <Moon className="size-4" />
          )}
        </Button>

        <Button variant="ghost" size="icon" onClick={onPrint} title="Print">
          <Printer className="size-4" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <Share2 className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onCopyLink}>
              {copiedLink ? (
                <>
                  <Check className="size-4 mr-2" />
                  Link Copied!
                </>
              ) : (
                <>
                  <Copy className="size-4 mr-2" />
                  Copy Link to Section
                </>
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Download className="size-4" />
              Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onExport("markdown")}>
              Export as Markdown
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExport("html")}>
              Export as HTML
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExport("pdf")}>
              Export as PDF
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="h-6" />

        <Button size="sm" onClick={onEdit}>
          <Edit className="size-4" />
          Edit
        </Button>
      </div>
    </div>
  );
}
