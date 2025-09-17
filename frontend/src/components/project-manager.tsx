'use client';

import { useState, useEffect } from 'react';
import { apiClient, Project } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { Save, FolderOpen, Plus, Trash2, FileText, ChevronDown } from 'lucide-react';

interface ProjectManagerProps {
  currentConfiguration: any;
  onLoadConfiguration: (config: any) => void;
}

export function ProjectManager({ currentConfiguration, onLoadConfiguration }: ProjectManagerProps) {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(false);
  
  // Dialog states
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [loadDialogOpen, setLoadDialogOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');

  useEffect(() => {
    if (user) {
      loadProjects();
    }
  }, [user]);

  const loadProjects = async () => {
    try {
      const userProjects = await apiClient.getProjects();
      setProjects(userProjects);
    } catch (error) {
      console.error('Failed to load projects:', error);
    }
  };

  const handleSaveNew = async () => {
    if (!newProjectName.trim()) {
      toast.error('Please enter a project name');
      return;
    }

    setLoading(true);
    try {
      const project = await apiClient.createProject({
        name: newProjectName,
        description: newProjectDescription,
        configuration: currentConfiguration,
      });
      setProjects([...projects, project]);
      setSelectedProject(project);
      setSaveDialogOpen(false);
      setNewProjectName('');
      setNewProjectDescription('');
      toast.success('Project saved successfully');
    } catch (error: any) {
      toast.error(error.message || 'Failed to save project');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveExisting = async () => {
    if (!selectedProject) return;

    setLoading(true);
    try {
      const updated = await apiClient.updateProject(selectedProject.id, {
        configuration: currentConfiguration,
      });
      setProjects(projects.map(p => p.id === updated.id ? updated : p));
      setSelectedProject(updated);
      toast.success('Project updated successfully');
    } catch (error: any) {
      toast.error(error.message || 'Failed to update project');
    } finally {
      setLoading(false);
    }
  };

  const handleLoad = async (project: Project) => {
    try {
      const fullProject = await apiClient.getProject(project.id);
      onLoadConfiguration(fullProject.configuration);
      setSelectedProject(fullProject);
      setLoadDialogOpen(false);
      toast.success(`Loaded project: ${fullProject.name}`);
    } catch (error: any) {
      toast.error(error.message || 'Failed to load project');
    }
  };

  const handleDelete = async (project: Project) => {
    if (!confirm(`Are you sure you want to delete "${project.name}"?`)) return;

    try {
      await apiClient.deleteProject(project.id);
      setProjects(projects.filter(p => p.id !== project.id));
      if (selectedProject?.id === project.id) {
        setSelectedProject(null);
      }
      toast.success('Project deleted successfully');
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete project');
    }
  };

  if (!user) {
    return null;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="text-gray-700 dark:text-gray-300">
            <FileText className="w-4 h-4 mr-2" />
            Project
            <ChevronDown className="w-4 h-4 ml-2" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setSaveDialogOpen(true)}>
            <Save className="w-4 h-4 mr-2" />
            Save Project
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setLoadDialogOpen(true)}>
            <FolderOpen className="w-4 h-4 mr-2" />
            Load Project
          </DropdownMenuItem>
          {selectedProject && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-xs text-zinc-500">
                Current: {selectedProject.name}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Save Dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Project</DialogTitle>
            <DialogDescription>
              Save your current automation configuration as a project
            </DialogDescription>
          </DialogHeader>
          
          {selectedProject ? (
            <div className="space-y-4">
              <div className="p-3 bg-zinc-100 dark:bg-zinc-800 rounded-md">
                <p className="text-sm font-medium">{selectedProject.name}</p>
                {selectedProject.description && (
                  <p className="text-xs text-zinc-500 mt-1">{selectedProject.description}</p>
                )}
              </div>
              <p className="text-sm text-zinc-500">
                Update the existing project with current configuration?
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="project-name">Project Name</Label>
                <Input
                  id="project-name"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="My Automation"
                  disabled={loading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="project-description">Description (optional)</Label>
                <Textarea
                  id="project-description"
                  value={newProjectDescription}
                  onChange={(e) => setNewProjectDescription(e.target.value)}
                  placeholder="Describe what this automation does..."
                  disabled={loading}
                  rows={3}
                />
              </div>
            </div>
          )}
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
              Cancel
            </Button>
            {selectedProject ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedProject(null);
                    setNewProjectName('');
                    setNewProjectDescription('');
                  }}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Save as New
                </Button>
                <Button onClick={handleSaveExisting} disabled={loading}>
                  {loading ? 'Updating...' : 'Update'}
                </Button>
              </>
            ) : (
              <Button onClick={handleSaveNew} disabled={loading}>
                {loading ? 'Saving...' : 'Save'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Load Dialog */}
      <Dialog open={loadDialogOpen} onOpenChange={setLoadDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Load Project</DialogTitle>
            <DialogDescription>
              Select a project to load its configuration
            </DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="h-[300px] w-full rounded-md border p-4">
            {projects.length === 0 ? (
              <p className="text-sm text-zinc-500 text-center py-8">
                No saved projects yet
              </p>
            ) : (
              <div className="space-y-2">
                {projects.map((project) => (
                  <div
                    key={project.id}
                    className="flex items-center justify-between p-3 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <div className="flex-1">
                      <p className="font-medium text-sm">{project.name}</p>
                      {project.description && (
                        <p className="text-xs text-zinc-500 mt-1">{project.description}</p>
                      )}
                      <p className="text-xs text-zinc-400 mt-1">
                        Updated: {new Date(project.updated_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleLoad(project)}
                      >
                        Load
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDelete(project)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setLoadDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}