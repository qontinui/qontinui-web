# Workflow Documentation Components

Professional documentation UI components for workflows with rich markdown editing, live preview, and action-level commenting.

## Components

### 1. DocumentationEditor

A full-featured markdown editor for workflow documentation with split-pane editing and live preview.

**Features:**

- Split-pane editor with live preview
- Rich markdown toolbar (bold, italic, code, headers, lists, links, images, tables, code blocks)
- Template selector (Standard, API Integration, UI Test, Data Processing, Error Handling)
- Auto-generate documentation button
- Insert workflow elements (actions list, variables table, dependencies, flowchart, complexity metrics)
- Mermaid diagram support
- Table of contents (auto-generated from headers)
- Search in documentation
- Auto-save with indicator
- Export to Markdown/HTML
- Keyboard shortcuts support

**Usage:**

```tsx
import { DocumentationEditor } from "@/components/workflow-documentation";

<DocumentationEditor
  workflow={workflow}
  documentation={existingDoc}
  onSave={(content) => console.log("Save", content)}
  onCancel={() => console.log("Cancel")}
  onGenerateAuto={() => {
    const docService = WorkflowDocumentationService.getInstance();
    const content = docService.generateDocumentation(workflow);
    // Set content
  }}
/>;
```

### 2. DocumentationViewer

A professional viewer for displaying workflow documentation with table of contents and navigation.

**Features:**

- Rendered markdown display
- Sticky table of contents sidebar with hierarchical navigation
- Smooth scrolling to sections
- Collapsible sections
- Active section highlighting
- Search in page
- Share button (copy link to section)
- Export to Markdown/HTML/PDF
- Print support
- Dark mode toggle
- Responsive design

**Usage:**

```tsx
import { DocumentationViewer } from "@/components/workflow-documentation";

<DocumentationViewer
  workflow={workflow}
  documentation={doc}
  onEdit={() => console.log("Edit")}
/>;
```

### 3. ActionCommentsPanel

A panel for adding and managing comments on individual workflow actions.

**Features:**

- View comment for selected action
- Add/edit/delete comments
- Rich text editor for comments
- List all actions with comments
- Click to jump to action
- Search in comments
- Export comments to JSON
- View modes: selected action or all comments
- Comment metadata (author, timestamps)

**Usage:**

```tsx
import { ActionCommentsPanel } from "@/components/workflow-documentation";

<ActionCommentsPanel
  workflow={workflow}
  comments={comments}
  selectedActionId={selectedActionId}
  onAddComment={(actionId, comment) => {
    const docService = WorkflowDocumentationService.getInstance();
    docService.addActionComment(workflow.id, actionId, comment);
  }}
  onUpdateComment={(commentId, comment) => {
    const docService = WorkflowDocumentationService.getInstance();
    docService.updateActionComment(commentId, comment);
  }}
  onDeleteComment={(commentId) => {
    const docService = WorkflowDocumentationService.getInstance();
    docService.deleteActionComment(commentId);
  }}
/>;
```

## Installation

These components require additional dependencies for full markdown and diagram support:

```bash
npm install react-markdown remark-gfm rehype-highlight rehype-raw rehype-sanitize
npm install @mermaid-js/mermaid-react prismjs
npm install @types/prismjs --save-dev
```

### Dependencies

1. **react-markdown**: Render markdown content
2. **remark-gfm**: GitHub Flavored Markdown support (tables, task lists, etc.)
3. **rehype-highlight**: Syntax highlighting for code blocks
4. **rehype-raw**: Support raw HTML in markdown
5. **rehype-sanitize**: Sanitize HTML to prevent XSS
6. **@mermaid-js/mermaid-react**: Render Mermaid diagrams
7. **prismjs**: Syntax highlighting themes

## Enhanced Implementation

To upgrade the components with full markdown rendering, replace the simplified preview/rendering sections:

### DocumentationEditor - Enhanced Preview

Replace the `generatePreview()` function with:

```tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import "prismjs/themes/prism-tomorrow.css"; // Or your preferred theme

const generatePreview = () => {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight, rehypeRaw]}
      components={{
        code({ node, inline, className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || "");
          const language = match ? match[1] : "";

          // Handle mermaid diagrams
          if (language === "mermaid") {
            return (
              <Mermaid
                chart={String(children).replace(/\n$/, "")}
                config={{
                  theme: theme === "dark" ? "dark" : "default",
                }}
              />
            );
          }

          return !inline ? (
            <pre className={className}>
              <code {...props}>{children}</code>
            </pre>
          ) : (
            <code className={className} {...props}>
              {children}
            </code>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
};
```

### DocumentationViewer - Enhanced Rendering

Replace the `renderContent()` function with:

```tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { Mermaid } from "@mermaid-js/mermaid-react";
import "prismjs/themes/prism-tomorrow.css";

const renderContent = (content: string) => {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight, rehypeRaw, rehypeSanitize]}
      components={{
        code({ node, inline, className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || "");
          const language = match ? match[1] : "";

          if (language === "mermaid") {
            return (
              <div className="my-8">
                <Mermaid
                  chart={String(children).replace(/\n$/, "")}
                  config={{
                    theme: theme === "dark" ? "dark" : "default",
                    themeVariables: {
                      primaryColor: "#3b82f6",
                      primaryTextColor: "#fff",
                      primaryBorderColor: "#1e40af",
                      lineColor: "#6b7280",
                      secondaryColor: "#10b981",
                      tertiaryColor: "#f59e0b",
                    },
                  }}
                />
              </div>
            );
          }

          return !inline ? (
            <pre className={className}>
              <code {...props}>{children}</code>
            </pre>
          ) : (
            <code className={className} {...props}>
              {children}
            </code>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
};
```

## Keyboard Shortcuts

The DocumentationEditor supports these keyboard shortcuts:

- `Ctrl/Cmd + B`: Bold
- `Ctrl/Cmd + I`: Italic
- `Ctrl/Cmd + K`: Insert link
- `Ctrl/Cmd + Shift + C`: Insert code block
- `Ctrl/Cmd + S`: Save (when implemented)

To add keyboard shortcuts, add this to DocumentationEditor:

```tsx
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    const isMod = e.ctrlKey || e.metaKey;

    if (isMod && e.key === "b") {
      e.preventDefault();
      toolbarActions.bold();
    } else if (isMod && e.key === "i") {
      e.preventDefault();
      toolbarActions.italic();
    } else if (isMod && e.key === "k") {
      e.preventDefault();
      toolbarActions.link();
    } else if (isMod && e.shiftKey && e.key === "c") {
      e.preventDefault();
      toolbarActions.codeBlock();
    } else if (isMod && e.key === "s") {
      e.preventDefault();
      handleSave();
    }
  };

  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [content]);
```

## Integration with WorkflowCanvas

To show comment indicators on the workflow canvas, add this to your WorkflowCanvas component:

```tsx
// Add a comment badge to actions that have comments
const hasComment = docService.getActionComment(action.id);

{
  hasComment && (
    <div className="absolute -top-2 -right-2 size-5 bg-primary rounded-full flex items-center justify-center">
      <MessageSquare className="size-3 text-primary-foreground" />
    </div>
  );
}
```

## Styling

All components use Tailwind CSS and shadcn/ui components. They support both light and dark modes out of the box.

For syntax highlighting themes, you can choose from:

- `prism-tomorrow.css` (dark theme)
- `prism-okaidia.css` (dark theme)
- `prism-solarizedlight.css` (light theme)
- `prism.css` (default light theme)

Import your preferred theme in your global styles or component.

## Example Integration

Here's a complete example of integrating all three components:

```tsx
"use client";

import { useState } from "react";
import { Workflow } from "@/lib/action-schema/action-types";
import {
  DocumentationEditor,
  DocumentationViewer,
  ActionCommentsPanel,
} from "@/components/workflow-documentation";
import { WorkflowDocumentationService } from "@/services/workflow-documentation-service";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function WorkflowDocumentationPage({
  workflow,
}: {
  workflow: Workflow;
}) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [selectedActionId, setSelectedActionId] = useState<string>();

  const docService = WorkflowDocumentationService.getInstance();
  const documentation = docService.getDocumentation(workflow.id);
  const comments = docService.getAllActionComments(workflow.id);

  return (
    <div className="h-screen flex">
      {/* Main content */}
      <div className="flex-1">
        {mode === "view" && documentation ? (
          <DocumentationViewer
            workflow={workflow}
            documentation={documentation}
            onEdit={() => setMode("edit")}
          />
        ) : (
          <DocumentationEditor
            workflow={workflow}
            documentation={documentation || undefined}
            onSave={(content) => {
              if (documentation) {
                docService.updateDocumentation(workflow.id, content);
              } else {
                docService.createDocumentation(workflow.id, content);
              }
              setMode("view");
            }}
            onCancel={() => setMode("view")}
            onGenerateAuto={() => {
              const content = docService.generateDocumentation(workflow);
              docService.createDocumentation(workflow.id, content);
            }}
          />
        )}
      </div>

      {/* Side panel */}
      <div className="w-96 border-l">
        <ActionCommentsPanel
          workflow={workflow}
          comments={comments}
          selectedActionId={selectedActionId}
          onAddComment={(actionId, comment) => {
            docService.addActionComment(workflow.id, actionId, comment);
          }}
          onUpdateComment={(commentId, comment) => {
            docService.updateActionComment(commentId, comment);
          }}
          onDeleteComment={(commentId) => {
            docService.deleteActionComment(commentId);
          }}
        />
      </div>
    </div>
  );
}
```

## Future Enhancements

Potential improvements for future versions:

1. **Real-time Collaboration**: Add WebSocket support for multiple users editing simultaneously
2. **Version Comparison**: Visual diff view for comparing documentation versions
3. **AI Assistance**: Integration with AI to help write or improve documentation
4. **Templates Management**: UI for creating and managing custom templates
5. **Export to Confluence/Notion**: Integration with popular documentation platforms
6. **Spell Check**: Real-time spell checking in the editor
7. **Image Upload**: Drag-and-drop image upload with hosting
8. **Video Embeds**: Support for embedding YouTube, Vimeo, etc.
9. **PDF Generation**: Better PDF export with proper styling
10. **Comments on Documentation**: Add comment threads on documentation sections

## License

Part of the qontinui-web project.
