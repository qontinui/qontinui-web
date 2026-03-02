import React from "react";
import type { TemplateBrowserProps } from "./TemplateBrowser.types";
import { useTemplateBrowser } from "./_hooks/use-template-browser";
import { TemplateBrowserCard } from "./_components/TemplateBrowserCard";
import { TemplateDetailsDialog } from "./_components/TemplateDetailsDialog";
import { SaveTemplateDialog } from "./_components/SaveTemplateDialog";

export type { TemplateBrowserProps } from "./TemplateBrowser.types";

export function TemplateBrowser({
  onSelectTemplate,
  onClose,
  currentWorkflow,
}: TemplateBrowserProps) {
  const {
    selectedCategory,
    setSelectedCategory,
    searchQuery,
    setSearchQuery,
    selectedTemplate,
    showDetails,
    showSaveDialog,
    templates,
    categoryCounts,
    handleUseTemplate,
    handleSaveAsTemplate,
    handleSaveTemplate,
    handleShowDetails,
    handleCloseDetails,
    handleCloseSaveDialog,
  } = useTemplateBrowser(onSelectTemplate, currentWorkflow);

  return (
    <div className="template-browser">
      <div className="browser-header">
        <h2>Workflow Templates</h2>
        {onClose && (
          <button className="close-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        )}
      </div>

      <div className="browser-toolbar">
        <div className="search-bar">
          <input
            type="text"
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>
        <div className="toolbar-actions">
          {currentWorkflow && (
            <button
              className="save-template-button"
              onClick={handleSaveAsTemplate}
            >
              Save as Template
            </button>
          )}
        </div>
      </div>

      <div className="category-tabs">
        <button
          className={selectedCategory === "all" ? "active" : ""}
          onClick={() => setSelectedCategory("all")}
        >
          All ({categoryCounts.all})
        </button>
        <button
          className={selectedCategory === "basic" ? "active" : ""}
          onClick={() => setSelectedCategory("basic")}
        >
          Basic ({categoryCounts.basic})
        </button>
        <button
          className={selectedCategory === "control-flow" ? "active" : ""}
          onClick={() => setSelectedCategory("control-flow")}
        >
          Control Flow ({categoryCounts["control-flow"]})
        </button>
        <button
          className={selectedCategory === "data-processing" ? "active" : ""}
          onClick={() => setSelectedCategory("data-processing")}
        >
          Data ({categoryCounts["data-processing"]})
        </button>
        <button
          className={selectedCategory === "automation" ? "active" : ""}
          onClick={() => setSelectedCategory("automation")}
        >
          Automation ({categoryCounts.automation})
        </button>
        {categoryCounts.custom > 0 && (
          <button
            className={selectedCategory === "custom" ? "active" : ""}
            onClick={() => setSelectedCategory("custom")}
          >
            Custom ({categoryCounts.custom})
          </button>
        )}
      </div>

      <div className="template-grid">
        {templates.map((template) => (
          <TemplateBrowserCard
            key={template.id}
            template={template}
            onUse={() => handleUseTemplate(template)}
            onShowDetails={() => handleShowDetails(template)}
          />
        ))}
      </div>

      {templates.length === 0 && (
        <div className="no-templates">
          <p>No templates found</p>
          {searchQuery && <p className="hint">Try a different search term</p>}
        </div>
      )}

      {showDetails && selectedTemplate && (
        <TemplateDetailsDialog
          template={selectedTemplate}
          onClose={handleCloseDetails}
          onUse={() => {
            handleUseTemplate(selectedTemplate);
            handleCloseDetails();
          }}
        />
      )}

      {showSaveDialog && (
        <SaveTemplateDialog
          onSave={handleSaveTemplate}
          onClose={handleCloseSaveDialog}
        />
      )}
    </div>
  );
}
