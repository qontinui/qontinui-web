"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  Bold,
  Italic,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Link2,
  Image,
  Table,
  FileCode,
  Search,
  Plus,
  FileText,
  GitBranch,
  Calculator,
} from "lucide-react";

interface EditorToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  toolbarActions: {
    bold: () => void;
    italic: () => void;
    code: () => void;
    h1: () => void;
    h2: () => void;
    h3: () => void;
    unorderedList: () => void;
    orderedList: () => void;
    link: () => void;
    image: () => void;
    table: () => void;
    codeBlock: () => void;
    mermaidDiagram: () => void;
  };
  workflowElementActions: {
    actionsList: () => void;
    variablesTable: () => void;
    dependencies: () => void;
    flowchart: () => void;
    complexityMetrics: () => void;
  };
}

export function EditorToolbar({
  searchQuery,
  onSearchChange,
  toolbarActions,
  workflowElementActions,
}: EditorToolbarProps) {
  return (
    <div className="flex items-center gap-1 p-2 border-b bg-muted/30">
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={toolbarActions.bold}
          title="Bold"
          className="size-8"
        >
          <Bold className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={toolbarActions.italic}
          title="Italic"
          className="size-8"
        >
          <Italic className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={toolbarActions.code}
          title="Inline code"
          className="size-8"
        >
          <Code className="size-4" />
        </Button>
      </div>

      <Separator orientation="vertical" className="h-6" />

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={toolbarActions.h1}
          title="Heading 1"
          className="size-8"
        >
          <Heading1 className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={toolbarActions.h2}
          title="Heading 2"
          className="size-8"
        >
          <Heading2 className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={toolbarActions.h3}
          title="Heading 3"
          className="size-8"
        >
          <Heading3 className="size-4" />
        </Button>
      </div>

      <Separator orientation="vertical" className="h-6" />

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={toolbarActions.unorderedList}
          title="Bullet list"
          className="size-8"
        >
          <List className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={toolbarActions.orderedList}
          title="Numbered list"
          className="size-8"
        >
          <ListOrdered className="size-4" />
        </Button>
      </div>

      <Separator orientation="vertical" className="h-6" />

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={toolbarActions.link}
          title="Insert link"
          className="size-8"
        >
          <Link2 className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={toolbarActions.image}
          title="Insert image"
          className="size-8"
        >
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <Image className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={toolbarActions.table}
          title="Insert table"
          className="size-8"
        >
          <Table className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={toolbarActions.codeBlock}
          title="Code block"
          className="size-8"
        >
          <FileCode className="size-4" />
        </Button>
      </div>

      <Separator orientation="vertical" className="h-6" />

      {/* Insert Workflow Elements */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8">
            <Plus className="size-4" />
            Insert
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={workflowElementActions.actionsList}>
            <FileText className="size-4 mr-2" />
            Actions List
          </DropdownMenuItem>
          <DropdownMenuItem onClick={workflowElementActions.variablesTable}>
            <Table className="size-4 mr-2" />
            Variables Table
          </DropdownMenuItem>
          <DropdownMenuItem onClick={workflowElementActions.dependencies}>
            <GitBranch className="size-4 mr-2" />
            Dependencies
          </DropdownMenuItem>
          <DropdownMenuItem onClick={workflowElementActions.flowchart}>
            <GitBranch className="size-4 mr-2" />
            Flowchart (Mermaid)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={workflowElementActions.complexityMetrics}>
            <Calculator className="size-4 mr-2" />
            Complexity Metrics
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={toolbarActions.mermaidDiagram}>
            <GitBranch className="size-4 mr-2" />
            Custom Mermaid Diagram
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex-1" />

      {/* Search */}
      <div className="relative w-64">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search in documentation..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-8 h-8"
        />
      </div>
    </div>
  );
}
