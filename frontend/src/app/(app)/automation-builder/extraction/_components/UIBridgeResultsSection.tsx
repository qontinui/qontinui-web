"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Loader2,
  Layers,
  Link,
  BookOpen,
  X,
  LinkIcon,
  ChevronRight,
} from "lucide-react";
import type {
  UIBridgeDiscoveryResult,
  UIBridgeElement,
  DiscoveredState,
  DomainKnowledge,
} from "../_types";

export interface UIBridgeResultsSectionProps {
  discoveryResult: UIBridgeDiscoveryResult | null;
  isLoadingConfigs: boolean;
  selectedStateId: string | null;
  setSelectedStateId: (id: string | null) => void;
  selectedState: DiscoveredState | undefined;
  selectedStateElements: UIBridgeElement[] | undefined;
  stateDescriptions: Record<string, string>;
  updateStateDescription: (stateId: string, description: string) => void;
  currentSavedConfigId: string | null;
  projectId: string | null;
  showLinkKnowledgeDialog: boolean;
  setShowLinkKnowledgeDialog: (show: boolean) => void;
  availableKnowledge: DomainKnowledge[];
  linkKnowledgeToState: (knowledgeId: string) => void;
  unlinkKnowledgeFromState: (knowledgeId: string) => void;
}

export function UIBridgeResultsSection({
  discoveryResult,
  isLoadingConfigs,
  selectedStateId,
  setSelectedStateId,
  selectedState,
  selectedStateElements,
  stateDescriptions,
  updateStateDescription,
  currentSavedConfigId,
  projectId,
  showLinkKnowledgeDialog,
  setShowLinkKnowledgeDialog,
  availableKnowledge,
  linkKnowledgeToState,
  unlinkKnowledgeFromState,
}: UIBridgeResultsSectionProps) {
  if (isLoadingConfigs) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
      </div>
    );
  }

  if (!discoveryResult) {
    return (
      <Card className="flex-1 flex items-center justify-center">
        <div className="text-center text-text-muted">
          <Layers className="h-16 w-16 mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-medium mb-2">No States Discovered</h3>
          <p className="text-sm max-w-md">
            Upload render logs or load a saved configuration, then click
            &quot;Discover States&quot; to analyze element co-occurrence
            patterns.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-4 min-h-0">
      {/* State List */}
      <Card className="lg:col-span-1 flex flex-col">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between">
            <span>Discovered States</span>
            <Badge variant="outline">{discoveryResult.states.length}</Badge>
          </CardTitle>
          <CardDescription>
            {discoveryResult.unique_element_count} elements across{" "}
            {discoveryResult.render_count} renders
            {currentSavedConfigId && (
              <span className="text-green-500 ml-2">(Saved)</span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex-1 min-h-0">
          <ScrollArea className="h-full">
            <div className="space-y-2">
              {discoveryResult.states.map((state) => (
                <div
                  key={state.id}
                  className={`
                    p-3 rounded-lg border cursor-pointer transition-colors
                    ${
                      selectedStateId === state.id
                        ? "bg-primary/10 border-primary"
                        : "hover:bg-muted/50"
                    }
                  `}
                  onClick={() => setSelectedStateId(state.id)}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{state.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {state.state_image_ids.length} elements
                    </Badge>
                  </div>
                  <div className="text-xs text-text-muted mt-1">
                    Active in {state.screenshot_ids.length} renders
                  </div>
                  {stateDescriptions[state.id] && (
                    <div className="text-xs text-text-secondary mt-2 line-clamp-2">
                      {stateDescriptions[state.id]}
                    </div>
                  )}
                  {state.domain_knowledge &&
                    state.domain_knowledge.length > 0 && (
                      <div className="flex items-center gap-1 mt-2">
                        <BookOpen className="h-3 w-3 text-text-muted" />
                        <span className="text-xs text-text-muted">
                          {state.domain_knowledge.length} knowledge linked
                        </span>
                      </div>
                    )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* State Details */}
      <Card className="lg:col-span-2 flex flex-col">
        <CardHeader className="pb-3">
          <CardTitle>
            {selectedState ? selectedState.name : "Select a State"}
          </CardTitle>
          <CardDescription>
            {selectedState
              ? `${selectedState.state_image_ids.length} elements that always appear together`
              : "Click a state to view details"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 overflow-auto">
          {selectedState ? (
            <div className="flex flex-col gap-4">
              {/* Description */}
              <div>
                <label className="text-sm font-medium text-text-secondary mb-2 block">
                  Description
                </label>
                <Textarea
                  placeholder="Describe what this state represents..."
                  value={stateDescriptions[selectedState.id] || ""}
                  onChange={(e) =>
                    updateStateDescription(selectedState.id, e.target.value)
                  }
                  className="min-h-[100px]"
                />
              </div>

              {/* Domain Knowledge */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-text-secondary">
                    Domain Knowledge
                  </label>
                  {currentSavedConfigId && projectId && (
                    <Dialog
                      open={showLinkKnowledgeDialog}
                      onOpenChange={setShowLinkKnowledgeDialog}
                    >
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm">
                          <LinkIcon className="h-3 w-3 mr-1" />
                          Link Knowledge
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Link Domain Knowledge</DialogTitle>
                          <DialogDescription>
                            Select knowledge to link to this state.
                          </DialogDescription>
                        </DialogHeader>
                        <ScrollArea className="max-h-[300px]">
                          <div className="space-y-2">
                            {availableKnowledge.length === 0 ? (
                              <p className="text-sm text-text-muted text-center py-4">
                                No available knowledge. Create some first.
                              </p>
                            ) : (
                              availableKnowledge.map((k) => (
                                <div
                                  key={k.id}
                                  className="p-3 border rounded-lg hover:bg-muted/50 cursor-pointer"
                                  onClick={() => linkKnowledgeToState(k.id)}
                                >
                                  <div className="font-medium">{k.title}</div>
                                  <div className="text-xs text-text-muted line-clamp-2">
                                    {k.content}
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </ScrollArea>
                      </DialogContent>
                    </Dialog>
                  )}
                </div>
                {selectedState.domain_knowledge &&
                selectedState.domain_knowledge.length > 0 ? (
                  <div className="space-y-2">
                    {selectedState.domain_knowledge.map((k) => (
                      <div
                        key={k.id}
                        className="p-3 border rounded-lg bg-muted/30"
                      >
                        <div className="flex items-start justify-between">
                          <div className="font-medium text-sm">{k.title}</div>
                          {currentSavedConfigId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => unlinkKnowledgeFromState(k.id)}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                        <div className="text-xs text-text-muted mt-1 whitespace-pre-wrap">
                          {k.content}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-text-muted border rounded-lg p-4 text-center">
                    {currentSavedConfigId
                      ? "No knowledge linked. Click 'Link Knowledge' to add."
                      : "Save the config first to link domain knowledge."}
                  </div>
                )}
              </div>

              {/* Elements */}
              <div>
                <label className="text-sm font-medium text-text-secondary mb-2 block">
                  Elements in this State
                </label>
                {selectedStateElements && selectedStateElements.length > 0 ? (
                  <ScrollArea className="h-[200px] border rounded-lg p-2">
                    <div className="space-y-1">
                      {selectedStateElements.map((element) => (
                        <Collapsible key={element.id}>
                          <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 hover:bg-muted/50 rounded text-left">
                            <ChevronRight className="h-4 w-4 transition-transform ui-expanded:rotate-90" />
                            <Badge
                              variant="outline"
                              className="text-xs font-mono"
                            >
                              {element.type}
                            </Badge>
                            <span className="text-sm font-medium">
                              {element.name}
                            </span>
                          </CollapsibleTrigger>
                          <CollapsibleContent className="pl-8 pr-2 pb-2">
                            <div className="text-xs text-text-muted space-y-1">
                              <div>
                                <span className="font-medium">ID:</span>{" "}
                                {element.id}
                              </div>
                              {element.tag_name && (
                                <div>
                                  <span className="font-medium">Tag:</span>{" "}
                                  {element.tag_name}
                                </div>
                              )}
                              {element.text_content && (
                                <div>
                                  <span className="font-medium">Text:</span>{" "}
                                  {element.text_content}
                                </div>
                              )}
                              <div>
                                <span className="font-medium">
                                  Appears in:
                                </span>{" "}
                                {element.render_ids.length} renders
                              </div>
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="h-[200px] border rounded-lg p-4 flex items-center justify-center text-text-muted text-sm">
                    Element details available after fresh discovery
                  </div>
                )}
              </div>

              {/* Renders */}
              <div>
                <label className="text-sm font-medium text-text-secondary mb-2 block">
                  Active in Renders
                </label>
                <div className="flex flex-wrap gap-1">
                  {selectedState.screenshot_ids.map((renderId) => (
                    <Badge
                      key={renderId}
                      variant="secondary"
                      className="text-xs"
                    >
                      {renderId}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-text-muted">
              <div className="text-center">
                <Link className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Select a state from the list to view details</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
