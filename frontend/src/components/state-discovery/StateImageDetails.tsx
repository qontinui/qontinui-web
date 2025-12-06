/**
 * StateImage Details Panel Component
 * Shows details and actions for selected StateImage
 */

import React, { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
// Removed unused Tabs components - not used in current implementation
import { Separator } from "@/components/ui/separator";
import {
  Edit2,
  Trash2,
  GitMerge,
  Scissors,
  Save,
  X,
  CheckCircle,
  XCircle,

} from "lucide-react";
import { StateImage, DiscoveredState } from "@/types/stateDiscovery";
import DeleteConfirmationDialog from "./DeleteConfirmationDialog";

interface StateImageDetailsProps {
  stateImage: StateImage;
  screenshots: File[];
  states?: DiscoveredState[];
  onUpdate: (updates: Partial<StateImage>) => void;
  onDelete: () => void;
  onMerge: () => void;
}

const StateImageDetails: React.FC<StateImageDetailsProps> = ({
  stateImage,
  screenshots,
  states,
  onUpdate,
  onDelete,
  onMerge,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedValues, setEditedValues] = useState({
    name: stateImage.name,
    x: stateImage.x,
    y: stateImage.y,
    x2: stateImage.x2,
    y2: stateImage.y2,
  });
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Handle edit mode
  const startEdit = useCallback(() => {
    setIsEditing(true);
    setEditedValues({
      name: stateImage.name,
      x: stateImage.x,
      y: stateImage.y,
      x2: stateImage.x2,
      y2: stateImage.y2,
    });
  }, [stateImage]);

  const cancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditedValues({
      name: stateImage.name,
      x: stateImage.x,
      y: stateImage.y,
      x2: stateImage.x2,
      y2: stateImage.y2,
    });
  }, [stateImage]);

  const saveEdit = useCallback(() => {
    onUpdate(editedValues);
    setIsEditing(false);
  }, [editedValues, onUpdate]);

  // Handle value changes
  const handleValueChange = useCallback((field: string, value: string) => {
    setEditedValues((prev) => ({
      ...prev,
      [field]: field === "name" ? value : parseInt(value) || 0,
    }));
  }, []);

  // Find which states contain this state image
  const belongsToStates =
    states?.filter((state) => state.stateImageIds?.includes(stateImage.id)) ||
    [];

  return (
    <>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">StateImage Details</h3>
          <div className="flex gap-2">
            {isEditing ? (
              <>
                <Button size="sm" variant="outline" onClick={cancelEdit}>
                  <X className="h-4 w-4" />
                </Button>
                <Button size="sm" onClick={saveEdit}>
                  <Save className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={startEdit}>
                <Edit2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Basic Info */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Properties</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Name */}
            <div>
              <Label htmlFor="name" className="text-xs">
                Name
              </Label>
              {isEditing ? (
                <Input
                  id="name"
                  value={editedValues.name}
                  onChange={(e) => handleValueChange("name", e.target.value)}
                  className="h-8"
                />
              ) : (
                <p className="text-sm font-medium">{stateImage.name}</p>
              )}
            </div>

            {/* Position */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Position</Label>
                {isEditing ? (
                  <div className="flex gap-1">
                    <Input
                      type="number"
                      value={editedValues.x}
                      onChange={(e) => handleValueChange("x", e.target.value)}
                      className="h-8"
                      placeholder="X"
                    />
                    <Input
                      type="number"
                      value={editedValues.y}
                      onChange={(e) => handleValueChange("y", e.target.value)}
                      className="h-8"
                      placeholder="Y"
                    />
                  </div>
                ) : (
                  <p className="text-sm">
                    ({stateImage.x}, {stateImage.y})
                  </p>
                )}
              </div>
              <div>
                <Label className="text-xs">Bottom-Right</Label>
                {isEditing ? (
                  <div className="flex gap-1">
                    <Input
                      type="number"
                      value={editedValues.x2}
                      onChange={(e) => handleValueChange("x2", e.target.value)}
                      className="h-8"
                      placeholder="X2"
                    />
                    <Input
                      type="number"
                      value={editedValues.y2}
                      onChange={(e) => handleValueChange("y2", e.target.value)}
                      className="h-8"
                      placeholder="Y2"
                    />
                  </div>
                ) : (
                  <p className="text-sm">
                    ({stateImage.x2}, {stateImage.y2})
                  </p>
                )}
              </div>
            </div>

            {/* Dimensions */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Width</Label>
                <p className="text-sm">{stateImage.width}px</p>
              </div>
              <div>
                <Label className="text-xs">Height</Label>
                <p className="text-sm">{stateImage.height}px</p>
              </div>
            </div>

            {/* Frequency */}
            <div>
              <Label className="text-xs">Frequency</Label>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-green-500 h-2 rounded-full"
                    style={{ width: `${(stateImage.frequency ?? 0) * 100}%` }}
                  />
                </div>
                <span className="text-sm">
                  {((stateImage.frequency ?? 0) * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* State Membership */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Belongs to States</CardTitle>
          </CardHeader>
          <CardContent>
            {belongsToStates.length > 0 ? (
              <div className="space-y-2">
                {belongsToStates.map((state) => (
                  <div
                    key={state.id}
                    className="flex items-center justify-between p-2 bg-gray-50 rounded"
                  >
                    <div>
                      <p className="text-sm font-medium">{state.name}</p>
                      <p className="text-xs text-gray-600">ID: {state.id}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-500 mb-1">Confidence</p>
                      <Badge
                        variant={
                          state.confidence > 0.8 ? "default" : "secondary"
                        }
                      >
                        {(state.confidence * 100).toFixed(1)}%
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">Not assigned to any state</p>
            )}
          </CardContent>
        </Card>

        {/* Screenshot Presence */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Screenshot Presence</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {screenshots.map((screenshot, index) => {
                const screenshotId = `screenshot_${index.toString().padStart(3, "0")}`;
                const isPresent = stateImage.screenshots.includes(screenshotId);

                return (
                  <div key={index} className="flex items-center gap-2">
                    {isPresent ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-gray-400" />
                    )}
                    <span className="text-sm truncate flex-1">
                      {screenshot.name}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Tags */}
        {stateImage.tags && stateImage.tags.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Tags</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {stateImage.tags.map((tag, index) => (
                  <Badge key={index} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Actions */}
        <Separator />
        <div className="space-y-2">
          <Button
            className="w-full justify-start"
            variant="outline"
            onClick={onMerge}
          >
            <GitMerge className="mr-2 h-4 w-4" />
            Merge with Another
          </Button>

          <Button
            className="w-full justify-start"
            variant="outline"
            onClick={() => {
              /* Split StateImage */
            }}
          >
            <Scissors className="mr-2 h-4 w-4" />
            Split StateImage
          </Button>

          <Button
            className="w-full justify-start"
            variant="destructive"
            onClick={() => setShowDeleteDialog(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete StateImage
          </Button>
        </div>

        {/* Metadata */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Metadata</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-gray-600">
            <div className="flex justify-between">
              <span>ID:</span>
              <span className="font-mono">
                {stateImage.id
                  ? stateImage.id.substring(
                      0,
                      Math.min(12, stateImage.id.length)
                    )
                  : "N/A"}
                {stateImage.id && stateImage.id.length > 12 && "..."}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Pixel Hash:</span>
              <span className="font-mono">
                {stateImage.pixelHash
                  ? stateImage.pixelHash.substring(
                      0,
                      Math.min(8, stateImage.pixelHash.length)
                    )
                  : "N/A"}
                {stateImage.pixelHash &&
                  stateImage.pixelHash.length > 8 &&
                  "..."}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Created:</span>
              <span>
                {stateImage.createdAt
                  ? new Date(stateImage.createdAt).toLocaleDateString()
                  : "Unknown"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && (
        <DeleteConfirmationDialog
          stateImage={stateImage}
          onConfirm={() => {
            onDelete();
            setShowDeleteDialog(false);
          }}
          onCancel={() => setShowDeleteDialog(false)}
        />
      )}
    </>
  );
};

export default StateImageDetails;
