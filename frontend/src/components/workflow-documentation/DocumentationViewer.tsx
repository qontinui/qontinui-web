"use client";

import React, { useState, useEffect, useRef } from "react";
import DOMPurify from "dompurify";
import { Workflow } from "@/lib/action-schema/action-types";
import {
  WorkflowDocumentation,
  WorkflowDocumentationService,
} from "@/services/workflow-documentation-service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  Search,
  Printer,
  ChevronDown,
  ChevronRight,
  Moon,
  Sun,
  Copy,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";

// ============================================================================
// Props
// ============================================================================

export interface DocumentationViewerProps {
  workflow: Workflow;
  documentation: WorkflowDocumentation;
  onEdit: () => void;
  className?: string;
}

// ============================================================================
// Types
// ============================================================================

interface TOCItem {
  level: number;
  text: string;
  id: string;
  children: TOCItem[];
}

interface Section {
  id: string;
  title: string;
  content: string;
  level: number;
}

// ============================================================================
// Component
// ============================================================================

export function DocumentationViewer({
  workflow,
  documentation,
  onEdit,
  className,
}: DocumentationViewerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSection, setActiveSection] = useState<string>("");
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    new Set()
  );
  const [copiedLink, setCopiedLink] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const { theme, setTheme } = useTheme();

  const docService = WorkflowDocumentationService.getInstance();

  // Parse content into sections
  const parseSections = (): Section[] => {
    const lines = documentation.content.split("\n");
    const sections: Section[] = [];
    let currentSection: Section | null = null;

    lines.forEach((line) => {
      const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);

      if (headerMatch) {
        // Save previous section
        if (currentSection) {
          sections.push(currentSection);
        }

        const level = headerMatch[1]?.length ?? 1;
        const text = headerMatch[2]?.trim() ?? "";
        const id = text
          .toLowerCase()
          .replace(/[^\w\s-]/g, "")
          .replace(/\s+/g, "-");

        currentSection = {
          id,
          title: text,
          content: "",
          level,
        };
      } else if (currentSection) {
        currentSection.content += line + "\n";
      }
    });

    if (currentSection) {
      sections.push(currentSection);
    }

    return sections;
  };

  const sections = parseSections();

  // Build hierarchical TOC
  const buildTOC = (): TOCItem[] => {
    const toc: TOCItem[] = [];
    const stack: TOCItem[] = [];

    sections.forEach((section) => {
      const item: TOCItem = {
        level: section.level,
        text: section.title,
        id: section.id,
        children: [],
      };

      // Find parent in stack
      while (
        stack.length > 0 &&
        (stack[stack.length - 1]?.level ?? 0) >= item.level
      ) {
        stack.pop();
      }

      if (stack.length === 0) {
        toc.push(item);
      } else {
        const parent = stack[stack.length - 1];
        if (parent) {
          parent.children.push(item);
        }
      }

      stack.push(item);
    });

    return toc;
  };

  const toc = buildTOC();

  // Scroll to section
  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveSection(id);
    }
  };

  // Toggle section collapse
  const toggleSection = (id: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Share/copy link to section
  const copyLinkToSection = (id: string) => {
    const url = `${window.location.origin}${window.location.pathname}#${id}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  // Export functionality
  const handleExport = (format: "markdown" | "html" | "pdf") => {
    const exported = docService.exportDocumentation(workflow.id, {
      format,
      includeTOC: true,
      includeMetadata: true,
      includeDiagrams: true,
      includeComments: true,
    });

    if (exported) {
      const blob = new Blob([exported], {
        type: format === "html" ? "text/html" : "text/markdown",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${workflow.name}-docs.${format === "pdf" ? "pdf" : format === "html" ? "html" : "md"}`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  // Print
  const handlePrint = () => {
    window.print();
  };

  // Render markdown content (simplified - use react-markdown in production)
  const renderContent = (content: string) => {
    const lines = content.split("\n");

    return lines.map((line, idx) => {
      // Code blocks
      if (line.startsWith("```")) {
        const language = line.slice(3).trim();
        return (
          <div
            key={idx}
            className="bg-muted p-4 rounded-lg my-4 font-mono text-sm overflow-x-auto"
          >
            <div className="text-xs text-muted-foreground mb-2">
              {language || "code"}
            </div>
            <pre>{line}</pre>
          </div>
        );
      }

      // Tables
      if (line.includes("|")) {
        return (
          <div key={idx} className="overflow-x-auto my-4">
            <table className="min-w-full border-collapse border border-border">
              <tbody>
                <tr>
                  {line
                    .split("|")
                    .filter(Boolean)
                    .map((cell, cellIdx) => (
                      <td
                        key={cellIdx}
                        className="border border-border px-4 py-2"
                      >
                        {cell.trim()}
                      </td>
                    ))}
                </tr>
              </tbody>
            </table>
          </div>
        );
      }

      // Lists
      if (line.match(/^\d+\.\s/)) {
        return (
          <li key={idx} className="ml-6 mb-2 list-decimal">
            {line.replace(/^\d+\.\s/, "")}
          </li>
        );
      }
      if (line.startsWith("- ")) {
        return (
          <li key={idx} className="ml-6 mb-2 list-disc">
            {line.slice(2)}
          </li>
        );
      }

      // Bold
      const boldText = line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

      // Inline code
      const codeText = boldText.replace(
        /`(.+?)`/g,
        '<code class="bg-muted px-1.5 py-0.5 rounded text-sm">$1</code>'
      );

      // Sanitize HTML to prevent XSS
      const sanitizedHtml = DOMPurify.sanitize(codeText, {
        ALLOWED_TAGS: ["strong", "code"],
        ALLOWED_ATTR: ["class"],
      });

      // Regular paragraph
      if (line.trim()) {
        return (
          <p
            key={idx}
            className="mb-4 leading-7"
            dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
          />
        );
      }

      return <br key={idx} />;
    });
  };

  // Render TOC recursively
  const renderTOCItem = (item: TOCItem, depth: number = 0) => {
    const hasChildren = item.children.length > 0;
    const isActive = activeSection === item.id;

    return (
      <div key={item.id}>
        <button
          onClick={() => {
            if (hasChildren) {
              toggleSection(item.id);
            }
            scrollToSection(item.id);
          }}
          className={cn(
            "w-full flex items-center gap-2 text-left px-2 py-1.5 rounded text-sm transition-colors",
            isActive && "bg-accent font-medium",
            !isActive && "hover:bg-accent/50"
          )}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {hasChildren && (
            <span className="size-4">
              {collapsedSections.has(item.id) ? (
                <ChevronRight className="size-3" />
              ) : (
                <ChevronDown className="size-3" />
              )}
            </span>
          )}
          <span className="flex-1 truncate">{item.text}</span>
        </button>

        {hasChildren && !collapsedSections.has(item.id) && (
          <div>
            {item.children.map((child) => renderTOCItem(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  // Observe sections for active state
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        });
      },
      { rootMargin: "-20% 0px -70% 0px" }
    );

    sections.forEach((section) => {
      const element = document.getElementById(section.id);
      if (element) {
        observer.observe(element);
      }
    });

    return () => observer.disconnect();
  }, [sections]);

  // Filter sections by search
  const filteredSections = searchQuery
    ? sections.filter(
        (section) =>
          section.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          section.content.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : sections;

  return (
    <div className={cn("flex h-full bg-background", className)}>
      {/* Table of Contents Sidebar */}
      <div className="w-64 border-r flex flex-col bg-muted/20">
        <div className="p-4 border-b space-y-3">
          <div>
            <h3 className="font-semibold">Contents</h3>
            <p className="text-xs text-muted-foreground mt-1">
              {workflow.name}
            </p>
          </div>

          {/* Search in TOC */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {toc.map((item) => renderTOCItem(item))}
          </div>
        </ScrollArea>

        {/* TOC Footer Actions */}
        <div className="p-2 border-t space-y-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => scrollToSection(sections[0]?.id ?? "")}
          >
            Back to Top
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h1 className="text-2xl font-bold">{workflow.name}</h1>
            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
              <span>Version {documentation.version}</span>
              <span>•</span>
              <span>
                Updated {new Date(documentation.updated).toLocaleDateString()}
              </span>
              {documentation.author && (
                <>
                  <span>•</span>
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

            <Button
              variant="ghost"
              size="icon"
              onClick={handlePrint}
              title="Print"
            >
              <Printer className="size-4" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Share2 className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() =>
                    copyLinkToSection(activeSection || (sections[0]?.id ?? ""))
                  }
                >
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
                <DropdownMenuItem onClick={() => handleExport("markdown")}>
                  Export as Markdown
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("html")}>
                  Export as HTML
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("pdf")}>
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

        {/* Content */}
        <ScrollArea className="flex-1">
          <div
            ref={contentRef}
            className="max-w-4xl mx-auto p-8 prose prose-sm md:prose-base lg:prose-lg dark:prose-invert"
          >
            {filteredSections.map((section) => (
              <section
                key={section.id}
                id={section.id}
                className="mb-8 scroll-mt-4"
              >
                {/* Section Header */}
                <div className="flex items-center justify-between group">
                  {section.level === 1 && (
                    <h1 className="flex-1">{section.title}</h1>
                  )}
                  {section.level === 2 && (
                    <h2 className="flex-1">{section.title}</h2>
                  )}
                  {section.level === 3 && (
                    <h3 className="flex-1">{section.title}</h3>
                  )}
                  {section.level === 4 && (
                    <h4 className="flex-1">{section.title}</h4>
                  )}
                  {section.level === 5 && (
                    <h5 className="flex-1">{section.title}</h5>
                  )}
                  {section.level === 6 && (
                    <h6 className="flex-1">{section.title}</h6>
                  )}

                  <Button
                    variant="ghost"
                    size="icon"
                    className="opacity-0 group-hover:opacity-100 transition-opacity size-8"
                    onClick={() => copyLinkToSection(section.id)}
                  >
                    <Share2 className="size-4" />
                  </Button>
                </div>

                {/* Section Content */}
                <div
                  className={cn(collapsedSections.has(section.id) && "hidden")}
                >
                  {renderContent(section.content)}
                </div>
              </section>
            ))}

            {filteredSections.length === 0 && searchQuery && (
              <div className="text-center py-12 text-muted-foreground">
                <Search className="size-12 mx-auto mb-4 opacity-50" />
                <p>No results found for &quot;{searchQuery}&quot;</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
