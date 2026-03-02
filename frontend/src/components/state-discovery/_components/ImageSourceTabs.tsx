import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Upload, X, FolderOpen, Database, Plus, Lightbulb } from "lucide-react";
import { useAvailableStates } from "@/hooks/useAvailableStates";
import { DirectPatternCreation } from "../DirectPatternCreation";
import { AutoPatternExtraction } from "../AutoPatternExtraction";

interface ImageSourceTabsProps {
  onOpenFileDialog: () => void;
  onOpenProjectSelector: () => void;
  onOpenSnapshotSelector: () => void;
  stateFilter: string[];
  onStateFilterChange: (filter: string[]) => void;
}

const ImageSourceTabs: React.FC<ImageSourceTabsProps> = ({
  onOpenFileDialog,
  onOpenProjectSelector,
  onOpenSnapshotSelector,
  stateFilter,
  onStateFilterChange,
}) => {
  const [activeTab, setActiveTab] = useState("upload");
  const { availableStates, loading: statesLoading } = useAvailableStates();

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <TabsList className="grid grid-cols-5 w-full">
        <TabsTrigger value="upload">Upload</TabsTrigger>
        <TabsTrigger value="project">Project</TabsTrigger>
        <TabsTrigger value="snapshots">Snapshots</TabsTrigger>
        <TabsTrigger value="direct" className="relative">
          Direct
          <Badge variant="secondary" className="ml-1 text-xs">
            beta
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="auto" className="relative">
          Auto
          <Badge variant="secondary" className="ml-1 text-xs">
            beta
          </Badge>
        </TabsTrigger>
      </TabsList>

      {/* Upload Tab */}
      <TabsContent value="upload" className="space-y-2 mt-4">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={onOpenFileDialog}
        >
          <Upload className="mr-1 h-4 w-4" />
          Upload Files
        </Button>
      </TabsContent>

      {/* Project Tab */}
      <TabsContent value="project" className="space-y-2 mt-4">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={onOpenProjectSelector}
        >
          <FolderOpen className="mr-1 h-4 w-4" />
          Select from Project
        </Button>
      </TabsContent>

      {/* Snapshots Tab */}
      <TabsContent value="snapshots" className="space-y-2 mt-4">
        {/* State Filter Section */}
        <div className="state-filter-section">
          <Label className="text-xs">Filter by state (optional):</Label>
          <div className="flex flex-wrap gap-2 mt-1">
            {stateFilter.map((state) => (
              <Badge key={state} variant="secondary" className="text-xs">
                {state}
                <X
                  className="ml-1 h-3 w-3 cursor-pointer"
                  onClick={() =>
                    onStateFilterChange(stateFilter.filter((s) => s !== state))
                  }
                />
              </Badge>
            ))}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-xs"
                  disabled={statesLoading || availableStates.length === 0}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Filter
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {availableStates
                  .filter((s) => !stateFilter.includes(s))
                  .map((state) => (
                    <DropdownMenuItem
                      key={state}
                      onClick={() =>
                        onStateFilterChange([...stateFilter, state])
                      }
                    >
                      {state}
                    </DropdownMenuItem>
                  ))}
                {availableStates.filter((s) => !stateFilter.includes(s))
                  .length === 0 && (
                  <DropdownMenuItem disabled>
                    No more states available
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {stateFilter.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                onClick={() => onStateFilterChange([])}
              >
                Clear All
              </Button>
            )}
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={onOpenSnapshotSelector}
        >
          <Database className="mr-1 h-4 w-4" />
          Select from Snapshots
        </Button>
      </TabsContent>

      {/* Direct Creation Tab */}
      <TabsContent value="direct" className="space-y-2 mt-4">
        <Alert className="mb-4">
          <Lightbulb className="h-4 w-4" />
          <AlertTitle>Experimental Feature</AlertTitle>
          <AlertDescription>
            Direct pattern creation from snapshots. This feature is in beta.
          </AlertDescription>
        </Alert>
        <DirectPatternCreation />
      </TabsContent>

      {/* Auto-Extract Tab */}
      <TabsContent value="auto" className="space-y-2 mt-4">
        <Alert className="mb-4">
          <Lightbulb className="h-4 w-4" />
          <AlertTitle>Experimental Feature</AlertTitle>
          <AlertDescription>
            AI-powered pattern extraction. Results may vary.
          </AlertDescription>
        </Alert>
        <AutoPatternExtraction />
      </TabsContent>
    </Tabs>
  );
};

export default ImageSourceTabs;
