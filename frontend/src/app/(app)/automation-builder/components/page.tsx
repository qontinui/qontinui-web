'use client';

import * as React from 'react';
import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Package,
  Plus,
  Upload,
  Download,
  BookOpen,
  Search,
  Grid3x3,
  List,
  Filter,
  Star,
  Clock,
  TrendingUp,
  FolderTree,
  Tag,
  Settings,
  Eye,
  Edit,
  Copy,
  Trash2,
  BarChart3,
  PieChart,
  AlertCircle,
  CheckCircle2,
  XCircle,
  PlayCircle,
  Code,
  Layers,
  Zap,
  RefreshCw,
  FileJson,
  ChevronRight,
  Info,
  Sparkles,
  Target,
  Users,
} from 'lucide-react';
import { SubflowComponent } from '@/lib/workflow-organization/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
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
import { ComponentLibrary } from '@/components/workflow-components/ComponentLibrary';
import { ComponentEditor } from '@/components/workflow-components/ComponentEditor';
import { ComponentInsertDialog } from '@/components/workflow-components/ComponentInsertDialog';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

type ViewMode = 'grid' | 'list';
type CategoryFilter = 'all' | 'built-in' | 'custom' | 'favorites' | 'recent';
type SortOption = 'name' | 'usage' | 'recent' | 'category';

interface BuiltInComponent {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: React.ComponentType<{ className?: string }>;
  example: string;
  color: string;
}

interface UsageStatistic {
  componentId: string;
  componentName: string;
  usageCount: number;
  category: string;
}

interface CategoryStats {
  category: string;
  count: number;
  color: string;
}

// ============================================================================
// Mock Data
// ============================================================================

const BUILT_IN_COMPONENTS: BuiltInComponent[] = [
  {
    id: 'builtin-error-handler',
    name: 'Error Handler',
    description: 'TRY/CATCH wrapper for robust error handling',
    category: 'Control Flow',
    icon: AlertCircle,
    example: 'Wrap risky operations with automatic error recovery',
    color: '#FF6B6B',
  },
  {
    id: 'builtin-retry-logic',
    name: 'Retry Logic',
    description: 'LOOP with configurable retry attempts',
    category: 'Control Flow',
    icon: RefreshCw,
    example: 'Retry failed actions up to N times with delays',
    color: '#FFD700',
  },
  {
    id: 'builtin-wait-element',
    name: 'Wait for Element',
    description: 'FIND action with intelligent retry',
    category: 'UI',
    icon: Clock,
    example: 'Wait up to 30s for element to appear',
    color: '#00D9FF',
  },
  {
    id: 'builtin-click-wait',
    name: 'Click and Wait',
    description: 'CLICK followed by smart WAIT',
    category: 'UI',
    icon: Target,
    example: 'Click button and wait for page load',
    color: '#BD00FF',
  },
  {
    id: 'builtin-form-fill',
    name: 'Form Fill',
    description: 'Multiple TYPE actions for form completion',
    category: 'Data',
    icon: Edit,
    example: 'Fill entire form with one component',
    color: '#00FF88',
  },
  {
    id: 'builtin-screenshot-verify',
    name: 'Screenshot and Verify',
    description: 'SCREENSHOT + FIND_STATE_IMAGE combination',
    category: 'UI',
    icon: Eye,
    example: 'Capture screenshot and verify state',
    color: '#00D9FF',
  },
  {
    id: 'builtin-safe-click',
    name: 'Safe Click',
    description: 'EXISTS + CLICK + verification chain',
    category: 'UI',
    icon: CheckCircle2,
    example: 'Safely click with existence verification',
    color: '#00FF88',
  },
  {
    id: 'builtin-data-validator',
    name: 'Data Validator',
    description: 'Validation checks for data integrity',
    category: 'Data',
    icon: Sparkles,
    example: 'Validate form inputs or API responses',
    color: '#FFD700',
  },
];

function generateMockComponents(): SubflowComponent[] {
  return [
    {
      id: '1',
      name: 'Login Flow',
      description: 'Complete login workflow with error handling and validation',
      actions: [],
      parameters: [
        { name: 'username', type: 'string', required: true },
        { name: 'password', type: 'string', required: true },
      ],
      tags: ['authentication', 'user', 'login'],
      category: 'Authentication',
      usageCount: 45,
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      version: '1.2.0',
      author: 'John Doe',
    },
    {
      id: '2',
      name: 'Form Validation',
      description: 'Validate form fields with custom rules',
      actions: [],
      parameters: [
        { name: 'formData', type: 'object', required: true },
        { name: 'rules', type: 'array', required: false },
      ],
      tags: ['validation', 'form', 'data'],
      category: 'Data Processing',
      usageCount: 32,
      createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      version: '2.0.1',
      author: 'Jane Smith',
    },
    {
      id: '3',
      name: 'Dashboard Navigation',
      description: 'Navigate through dashboard sections',
      actions: [],
      parameters: [{ name: 'section', type: 'string', required: true }],
      tags: ['navigation', 'ui', 'dashboard'],
      category: 'Navigation',
      usageCount: 28,
      createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      version: '1.0.0',
      author: 'system',
    },
    {
      id: '4',
      name: 'API Call Handler',
      description: 'Make API calls with retry and error handling',
      actions: [],
      parameters: [
        { name: 'endpoint', type: 'string', required: true },
        { name: 'method', type: 'string', required: true },
        { name: 'body', type: 'object', required: false },
      ],
      tags: ['api', 'integration', 'http'],
      category: 'Integration',
      usageCount: 56,
      createdAt: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      version: '1.5.2',
      author: 'John Doe',
    },
    {
      id: '5',
      name: 'Screenshot Capture',
      description: 'Capture and save screenshots with annotations',
      actions: [],
      parameters: [
        { name: 'selector', type: 'string', required: false },
        { name: 'filename', type: 'string', required: true },
      ],
      tags: ['screenshot', 'ui', 'testing'],
      category: 'Testing',
      usageCount: 19,
      createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      version: '1.1.0',
      author: 'Jane Smith',
    },
  ];
}

function generateUsageStats(components: SubflowComponent[]): UsageStatistic[] {
  return components
    .map((comp) => ({
      componentId: comp.id,
      componentName: comp.name,
      usageCount: comp.usageCount,
      category: comp.category || 'Uncategorized',
    }))
    .sort((a, b) => b.usageCount - a.usageCount);
}

function generateCategoryStats(components: SubflowComponent[]): CategoryStats[] {
  const categoryMap = new Map<string, number>();
  const colors = ['#00D9FF', '#BD00FF', '#00FF88', '#FFD700', '#FF6B6B'];

  components.forEach((comp) => {
    const category = comp.category || 'Uncategorized';
    categoryMap.set(category, (categoryMap.get(category) || 0) + 1);
  });

  return Array.from(categoryMap.entries())
    .map(([category, count], index) => ({
      category,
      count,
      color: colors[index % colors.length],
    }))
    .sort((a, b) => b.count - a.count);
}

// ============================================================================
// Main Component
// ============================================================================

export default function ComponentLibraryPage() {
  const router = useRouter();

  // State
  const [components, setComponents] = useState<SubflowComponent[]>(generateMockComponents());
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [sortOption, setSortOption] = useState<SortOption>('name');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedComponent, setSelectedComponent] = useState<SubflowComponent | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingComponent, setEditingComponent] = useState<SubflowComponent | undefined>(undefined);
  const [isInsertDialogOpen, setIsInsertDialogOpen] = useState(false);
  const [insertingComponent, setInsertingComponent] = useState<SubflowComponent | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showStatsPanel, setShowStatsPanel] = useState(false);
  const [activeTab, setActiveTab] = useState<'library' | 'built-in' | 'stats' | 'docs'>('library');

  // Computed values
  const usageStats = useMemo(() => generateUsageStats(components), [components]);
  const categoryStats = useMemo(() => generateCategoryStats(components), [components]);

  // Handlers
  const handleCreateComponent = () => {
    setEditingComponent(undefined);
    setIsEditorOpen(true);
  };

  const handleEditComponent = (component: SubflowComponent) => {
    setEditingComponent(component);
    setIsEditorOpen(true);
  };

  const handleSaveComponent = (component: SubflowComponent) => {
    if (editingComponent) {
      // Update existing
      setComponents((prev) =>
        prev.map((c) => (c.id === component.id ? component : c))
      );
    } else {
      // Create new
      setComponents((prev) => [...prev, component]);
    }
    setIsEditorOpen(false);
    setEditingComponent(undefined);
  };

  const handleDeleteComponent = (id: string) => {
    setComponents((prev) => prev.filter((c) => c.id !== id));
  };

  const handleInsertComponent = (component: SubflowComponent) => {
    setInsertingComponent(component);
    setIsInsertDialogOpen(true);
  };

  const handleInsertWithParameters = (parameters: Record<string, any>) => {
    // In real implementation, this would insert the component into the workflow
    console.log('Inserting component with parameters:', parameters);
    setIsInsertDialogOpen(false);
    setInsertingComponent(null);
  };

  const handleImportComponents = () => {
    setShowImportDialog(true);
  };

  const handleExportLibrary = () => {
    const exportData = JSON.stringify(components, null, 2);
    const blob = new Blob([exportData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'component-library.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDuplicateComponent = (component: SubflowComponent) => {
    const duplicated: SubflowComponent = {
      ...component,
      id: crypto.randomUUID(),
      name: `${component.name} (Copy)`,
      usageCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setComponents((prev) => [...prev, duplicated]);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0A0A0B] via-[#0F0F10] to-[#0A0A0B] text-white">
      <div className="container mx-auto p-6 space-y-6">
        {/* Header Section */}
        <div className="space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-[#00D9FF] to-[#BD00FF] bg-clip-text text-transparent">
                Component Library
              </h1>
              <p className="text-gray-400 text-lg">
                Create and manage reusable workflow components
              </p>
              <div className="flex items-center gap-2 mt-2">
                <Package className="w-4 h-4 text-gray-500" />
                <p className="text-sm text-gray-500">
                  {components.length} custom components • {BUILT_IN_COMPONENTS.length} built-in
                </p>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex items-center gap-3">
              <Button
                onClick={handleCreateComponent}
                className="bg-gradient-to-r from-[#00D9FF] to-[#BD00FF] hover:opacity-90 text-white font-medium"
              >
                <Plus className="w-4 h-4 mr-2" />
                New Component
              </Button>
              <Button
                variant="outline"
                onClick={handleImportComponents}
                className="border-gray-700 hover:border-[#00D9FF] hover:text-[#00D9FF] bg-transparent"
              >
                <Upload className="w-4 h-4 mr-2" />
                Import
              </Button>
              <Button
                variant="outline"
                onClick={handleExportLibrary}
                className="border-gray-700 hover:border-[#BD00FF] hover:text-[#BD00FF] bg-transparent"
              >
                <Download className="w-4 h-4 mr-2" />
                Export Library
              </Button>
              <Button
                variant="outline"
                onClick={() => router.push('/docs/components')}
                className="border-gray-700 hover:border-[#00FF88] hover:text-[#00FF88] bg-transparent"
              >
                <BookOpen className="w-4 h-4 mr-2" />
                Documentation
              </Button>
            </div>
          </div>

          {/* Stats Bar */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-400">Total Components</p>
                    <p className="text-2xl font-bold text-[#00D9FF]">{components.length}</p>
                  </div>
                  <Layers className="w-8 h-8 text-[#00D9FF]/30" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-400">Total Usage</p>
                    <p className="text-2xl font-bold text-[#BD00FF]">
                      {components.reduce((sum, c) => sum + c.usageCount, 0)}
                    </p>
                  </div>
                  <TrendingUp className="w-8 h-8 text-[#BD00FF]/30" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-400">Categories</p>
                    <p className="text-2xl font-bold text-[#00FF88]">{categoryStats.length}</p>
                  </div>
                  <FolderTree className="w-8 h-8 text-[#00FF88]/30" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-400">Avg Usage</p>
                    <p className="text-2xl font-bold text-[#FFD700]">
                      {Math.round(
                        components.reduce((sum, c) => sum + c.usageCount, 0) / components.length || 0
                      )}
                    </p>
                  </div>
                  <BarChart3 className="w-8 h-8 text-[#FFD700]/30" />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Main Content Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
          <TabsList className="bg-[#1A1A1B]/50 border border-gray-800/50">
            <TabsTrigger value="library" className="data-[state=active]:bg-[#00D9FF]/20">
              <Package className="w-4 h-4 mr-2" />
              Component Library
              <Badge variant="secondary" className="ml-2">
                {components.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="built-in" className="data-[state=active]:bg-[#BD00FF]/20">
              <Sparkles className="w-4 h-4 mr-2" />
              Built-in Components
              <Badge variant="secondary" className="ml-2">
                {BUILT_IN_COMPONENTS.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="stats" className="data-[state=active]:bg-[#00FF88]/20">
              <BarChart3 className="w-4 h-4 mr-2" />
              Usage Statistics
            </TabsTrigger>
            <TabsTrigger value="docs" className="data-[state=active]:bg-[#FFD700]/20">
              <BookOpen className="w-4 h-4 mr-2" />
              Documentation
            </TabsTrigger>
          </TabsList>

          {/* Custom Component Library Tab */}
          <TabsContent value="library" className="mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              {/* Left Sidebar - Component Navigator */}
              <div className="lg:col-span-1 space-y-4">
                <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Filter className="w-5 h-5 text-[#00D9FF]" />
                      Navigator
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Search */}
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                      <Input
                        placeholder="Search components..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9 bg-[#0A0A0B] border-gray-800"
                      />
                    </div>

                    {/* View Toggle */}
                    <div className="flex items-center gap-2">
                      <Button
                        variant={viewMode === 'grid' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setViewMode('grid')}
                        className="flex-1"
                      >
                        <Grid3x3 className="w-4 h-4" />
                      </Button>
                      <Button
                        variant={viewMode === 'list' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setViewMode('list')}
                        className="flex-1"
                      >
                        <List className="w-4 h-4" />
                      </Button>
                    </div>

                    <Separator />

                    {/* Category Filter */}
                    <div className="space-y-2">
                      <Label className="text-sm font-medium text-gray-400">Category</Label>
                      <div className="space-y-1">
                        {[
                          { value: 'all', label: 'All Components', icon: Layers, count: components.length },
                          {
                            value: 'built-in',
                            label: 'Built-in',
                            icon: Sparkles,
                            count: components.filter((c) => !c.author || c.author === 'system').length,
                          },
                          {
                            value: 'custom',
                            label: 'Custom',
                            icon: Code,
                            count: components.filter((c) => c.author && c.author !== 'system').length,
                          },
                          { value: 'favorites', label: 'Favorites', icon: Star, count: 0 },
                          { value: 'recent', label: 'Recent', icon: Clock, count: 5 },
                        ].map((cat) => {
                          const Icon = cat.icon;
                          return (
                            <Button
                              key={cat.value}
                              variant={categoryFilter === cat.value ? 'default' : 'ghost'}
                              size="sm"
                              onClick={() => setCategoryFilter(cat.value as CategoryFilter)}
                              className="w-full justify-start gap-2"
                            >
                              <Icon className="w-4 h-4" />
                              {cat.label}
                              <Badge variant="secondary" className="ml-auto">
                                {cat.count}
                              </Badge>
                            </Button>
                          );
                        })}
                      </div>
                    </div>

                    <Separator />

                    {/* Sort Options */}
                    <div className="space-y-2">
                      <Label className="text-sm font-medium text-gray-400">Sort By</Label>
                      <Select value={sortOption} onValueChange={(v) => setSortOption(v as SortOption)}>
                        <SelectTrigger className="bg-[#0A0A0B] border-gray-800">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="name">Name (A-Z)</SelectItem>
                          <SelectItem value="usage">Usage Count</SelectItem>
                          <SelectItem value="recent">Recently Added</SelectItem>
                          <SelectItem value="category">Category</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <Separator />

                    {/* Categories */}
                    <div className="space-y-2">
                      <Label className="text-sm font-medium text-gray-400">By Category</Label>
                      <div className="space-y-1">
                        {categoryStats.map((stat) => (
                          <div
                            key={stat.category}
                            className="flex items-center justify-between p-2 rounded-md hover:bg-gray-800/30 cursor-pointer"
                          >
                            <div className="flex items-center gap-2">
                              <div
                                className="w-3 h-3 rounded-full"
                                style={{ backgroundColor: stat.color }}
                              />
                              <span className="text-sm">{stat.category}</span>
                            </div>
                            <Badge variant="outline" className="text-xs">
                              {stat.count}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>

                    <Separator />

                    {/* Quick Actions */}
                    <Button
                      onClick={handleCreateComponent}
                      className="w-full bg-gradient-to-r from-[#00D9FF] to-[#BD00FF]"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Create Component
                    </Button>
                  </CardContent>
                </Card>
              </div>

              {/* Main Content - Component Display */}
              <div className="lg:col-span-3">
                <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
                  <CardContent className="p-6">
                    {components.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-20 text-center">
                        <Package className="w-20 h-20 text-gray-600 mb-4" />
                        <h3 className="text-xl font-semibold mb-2">No Components Yet</h3>
                        <p className="text-gray-400 mb-6 max-w-md">
                          Get started by creating your first reusable component or import an existing
                          library
                        </p>
                        <div className="flex items-center gap-3">
                          <Button onClick={handleCreateComponent}>
                            <Plus className="w-4 h-4 mr-2" />
                            Create First Component
                          </Button>
                          <Button variant="outline" onClick={handleImportComponents}>
                            <Upload className="w-4 h-4 mr-2" />
                            Import Library
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <ComponentLibrary
                        components={components}
                        onSelectComponent={setSelectedComponent}
                        onInsertComponent={(componentId, parameters) => {
                          const component = components.find((c) => c.id === componentId);
                          if (component) handleInsertComponent(component);
                        }}
                        onCreateComponent={handleCreateComponent}
                        onUpdateComponent={(id, updates) => {
                          const component = components.find((c) => c.id === id);
                          if (component) handleEditComponent({ ...component, ...updates });
                        }}
                        onDeleteComponent={handleDeleteComponent}
                      />
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* Built-in Components Tab */}
          <TabsContent value="built-in" className="mt-6">
            <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-[#BD00FF]" />
                  Built-in Components
                </CardTitle>
                <CardDescription>
                  Pre-built components ready to use in your workflows
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {BUILT_IN_COMPONENTS.map((comp) => {
                    const Icon = comp.icon;
                    return (
                      <Card
                        key={comp.id}
                        className="bg-[#0A0A0B]/50 border-gray-800 hover:border-gray-700 transition-all"
                      >
                        <CardHeader>
                          <div className="flex items-start justify-between gap-2">
                            <div
                              className="w-10 h-10 rounded-lg flex items-center justify-center"
                              style={{ backgroundColor: `${comp.color}20` }}
                            >
                              <Icon className="w-5 h-5" style={{ color: comp.color }} />
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <Settings className="w-4 h-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem>
                                  <Eye className="w-4 h-4 mr-2" />
                                  View Details
                                </DropdownMenuItem>
                                <DropdownMenuItem>
                                  <Copy className="w-4 h-4 mr-2" />
                                  Duplicate to Customize
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                          <CardTitle className="text-lg">{comp.name}</CardTitle>
                          <CardDescription>{comp.description}</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <Badge variant="outline" className="mb-3">
                            {comp.category}
                          </Badge>
                          <div className="text-xs text-gray-400 bg-gray-900/50 p-2 rounded-md font-mono">
                            {comp.example}
                          </div>
                          <Button className="w-full mt-3" variant="outline">
                            <PlayCircle className="w-4 h-4 mr-2" />
                            Use Component
                          </Button>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Usage Statistics Tab */}
          <TabsContent value="stats" className="mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Most Used Components */}
              <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-[#00FF88]" />
                    Most Used Components
                  </CardTitle>
                  <CardDescription>Top 10 components by usage count</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {usageStats.slice(0, 10).map((stat, index) => (
                      <div
                        key={stat.componentId}
                        className="flex items-center gap-3 p-3 rounded-lg bg-[#0A0A0B]/50"
                      >
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-r from-[#00D9FF] to-[#BD00FF] font-bold">
                          {index + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{stat.componentName}</p>
                          <p className="text-xs text-gray-400">{stat.category}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-[#00FF88]">{stat.usageCount}</p>
                          <p className="text-xs text-gray-400">uses</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Components by Category */}
              <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <PieChart className="w-5 h-5 text-[#BD00FF]" />
                    Components by Category
                  </CardTitle>
                  <CardDescription>Distribution across categories</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {categoryStats.map((stat) => {
                      const percentage = Math.round((stat.count / components.length) * 100);
                      return (
                        <div key={stat.category} className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <div
                                className="w-3 h-3 rounded-full"
                                style={{ backgroundColor: stat.color }}
                              />
                              <span>{stat.category}</span>
                            </div>
                            <span className="font-medium">
                              {stat.count} ({percentage}%)
                            </span>
                          </div>
                          <Progress value={percentage} className="h-2" />
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* Recent Activity */}
              <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="w-5 h-5 text-[#FFD700]" />
                    Recent Activity
                  </CardTitle>
                  <CardDescription>Latest component updates</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {components
                      .sort(
                        (a, b) =>
                          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
                      )
                      .slice(0, 5)
                      .map((comp) => (
                        <div
                          key={comp.id}
                          className="flex items-start gap-3 p-3 rounded-lg bg-[#0A0A0B]/50"
                        >
                          <Package className="w-5 h-5 text-[#00D9FF] mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{comp.name}</p>
                            <p className="text-xs text-gray-400">
                              Updated {new Date(comp.updatedAt).toLocaleDateString()}
                            </p>
                          </div>
                          <Badge variant="outline" className="text-xs">
                            v{comp.version}
                          </Badge>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>

              {/* Unused Components */}
              <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-[#FF6B6B]" />
                    Unused Components
                  </CardTitle>
                  <CardDescription>Components with zero usage</CardDescription>
                </CardHeader>
                <CardContent>
                  {components.filter((c) => c.usageCount === 0).length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <CheckCircle2 className="w-12 h-12 text-[#00FF88] mb-2" />
                      <p className="font-medium">All components are in use!</p>
                      <p className="text-sm text-gray-400">Great job keeping things tidy</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {components
                        .filter((c) => c.usageCount === 0)
                        .map((comp) => (
                          <div
                            key={comp.id}
                            className="flex items-center justify-between p-3 rounded-lg bg-[#0A0A0B]/50"
                          >
                            <div className="flex items-center gap-3">
                              <XCircle className="w-5 h-5 text-[#FF6B6B]" />
                              <div>
                                <p className="font-medium">{comp.name}</p>
                                <p className="text-xs text-gray-400">{comp.category}</p>
                              </div>
                            </div>
                            <Button variant="ghost" size="sm">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Documentation Tab */}
          <TabsContent value="docs" className="mt-6">
            <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-[#FFD700]" />
                  Component Library Documentation
                </CardTitle>
                <CardDescription>
                  Learn how to create and use reusable workflow components
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Getting Started */}
                <div>
                  <h3 className="text-xl font-semibold mb-3 flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-[#00D9FF]" />
                    Getting Started
                  </h3>
                  <p className="text-gray-400 mb-4">
                    Components are reusable pieces of workflow logic that can be embedded in multiple
                    workflows, similar to functions in programming. They help you maintain consistency
                    and reduce duplication.
                  </p>
                  <Alert className="bg-[#00D9FF]/10 border-[#00D9FF]/30">
                    <Info className="w-4 h-4 text-[#00D9FF]" />
                    <AlertDescription>
                      Start by creating simple components and gradually build more complex ones as you
                      become familiar with the system.
                    </AlertDescription>
                  </Alert>
                </div>

                <Separator />

                {/* Creating Components */}
                <div>
                  <h3 className="text-xl font-semibold mb-3 flex items-center gap-2">
                    <Code className="w-5 h-5 text-[#BD00FF]" />
                    Creating Components
                  </h3>
                  <div className="space-y-3">
                    {[
                      {
                        step: '1',
                        title: 'Define Basic Info',
                        description: 'Give your component a name, description, and category',
                      },
                      {
                        step: '2',
                        title: 'Define Parameters',
                        description: 'Specify input parameters with types and validation rules',
                      },
                      {
                        step: '3',
                        title: 'Build Workflow',
                        description: 'Add actions and connections that make up the component logic',
                      },
                      {
                        step: '4',
                        title: 'Test Component',
                        description: 'Test with different parameter values to ensure it works',
                      },
                      {
                        step: '5',
                        title: 'Save and Tag',
                        description: 'Save your component and add tags for easy discovery',
                      },
                    ].map((item) => (
                      <div
                        key={item.step}
                        className="flex items-start gap-3 p-3 rounded-lg bg-[#0A0A0B]/50"
                      >
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-[#BD00FF]/20 text-[#BD00FF] font-bold shrink-0">
                          {item.step}
                        </div>
                        <div>
                          <p className="font-medium">{item.title}</p>
                          <p className="text-sm text-gray-400">{item.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <Separator />

                {/* Best Practices */}
                <div>
                  <h3 className="text-xl font-semibold mb-3 flex items-center gap-2">
                    <Target className="w-5 h-5 text-[#00FF88]" />
                    Best Practices
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {[
                      {
                        title: 'Single Responsibility',
                        description: 'Each component should do one thing well',
                        icon: Zap,
                      },
                      {
                        title: 'Clear Naming',
                        description: 'Use descriptive names that explain the purpose',
                        icon: Tag,
                      },
                      {
                        title: 'Good Documentation',
                        description: 'Add descriptions and examples for parameters',
                        icon: BookOpen,
                      },
                      {
                        title: 'Version Control',
                        description: 'Use semantic versioning for tracking changes',
                        icon: Code,
                      },
                      {
                        title: 'Error Handling',
                        description: 'Include proper error handling in components',
                        icon: AlertCircle,
                      },
                      {
                        title: 'Reusability',
                        description: 'Design for reuse across different contexts',
                        icon: RefreshCw,
                      },
                    ].map((practice) => {
                      const Icon = practice.icon;
                      return (
                        <div
                          key={practice.title}
                          className="p-4 rounded-lg bg-[#0A0A0B]/50 border border-gray-800"
                        >
                          <Icon className="w-6 h-6 text-[#00FF88] mb-2" />
                          <h4 className="font-medium mb-1">{practice.title}</h4>
                          <p className="text-sm text-gray-400">{practice.description}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <Separator />

                {/* Parameter Types */}
                <div>
                  <h3 className="text-xl font-semibold mb-3 flex items-center gap-2">
                    <Settings className="w-5 h-5 text-[#FFD700]" />
                    Parameter Types Reference
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {[
                      { type: 'string', description: 'Text values', example: '"Hello World"' },
                      { type: 'number', description: 'Numeric values', example: '42' },
                      { type: 'boolean', description: 'True/false values', example: 'true' },
                      { type: 'array', description: 'List of values', example: '[1, 2, 3]' },
                      { type: 'object', description: 'Key-value pairs', example: '{key: "value"}' },
                      { type: 'any', description: 'Any type allowed', example: 'varies' },
                    ].map((param) => (
                      <div
                        key={param.type}
                        className="p-3 rounded-lg bg-[#0A0A0B]/50 border border-gray-800"
                      >
                        <Badge variant="outline" className="mb-2">
                          {param.type}
                        </Badge>
                        <p className="text-sm mb-1">{param.description}</p>
                        <code className="text-xs text-gray-400 font-mono bg-gray-900/50 px-2 py-1 rounded">
                          {param.example}
                        </code>
                      </div>
                    ))}
                  </div>
                </div>

                <Separator />

                {/* Tips */}
                <Alert className="bg-[#00FF88]/10 border-[#00FF88]/30">
                  <Sparkles className="w-4 h-4 text-[#00FF88]" />
                  <AlertDescription>
                    <strong className="block mb-2">Pro Tips:</strong>
                    <ul className="list-disc list-inside space-y-1 text-sm">
                      <li>Use tags to organize components by feature or use case</li>
                      <li>Export your library regularly for backup and sharing</li>
                      <li>Review usage statistics to identify optimization opportunities</li>
                      <li>Create templates for common patterns to speed up development</li>
                      <li>Document breaking changes when updating component versions</li>
                    </ul>
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Component Editor Dialog */}
      {isEditorOpen && (
        <Dialog open={isEditorOpen} onOpenChange={setIsEditorOpen}>
          <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden">
            <ComponentEditor
              component={editingComponent}
              onSave={handleSaveComponent}
              onCancel={() => {
                setIsEditorOpen(false);
                setEditingComponent(undefined);
              }}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* Component Insert Dialog */}
      {insertingComponent && (
        <ComponentInsertDialog
          component={insertingComponent}
          open={isInsertDialogOpen}
          onClose={() => {
            setIsInsertDialogOpen(false);
            setInsertingComponent(null);
          }}
          onInsert={handleInsertWithParameters}
        />
      )}

      {/* Import Dialog */}
      {showImportDialog && (
        <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Upload className="w-5 h-5" />
                Import Components
              </DialogTitle>
              <DialogDescription>
                Upload a JSON file containing component definitions
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="border-2 border-dashed border-gray-700 rounded-lg p-8 text-center">
                <FileJson className="w-12 h-12 text-gray-500 mx-auto mb-3" />
                <p className="text-sm text-gray-400 mb-2">
                  Drag and drop your JSON file here, or click to browse
                </p>
                <Button variant="outline" size="sm">
                  <Upload className="w-4 h-4 mr-2" />
                  Choose File
                </Button>
              </div>
              <Alert>
                <Info className="w-4 h-4" />
                <AlertDescription className="text-xs">
                  Imported components will be added to your library. Existing components with the same
                  ID will be updated.
                </AlertDescription>
              </Alert>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowImportDialog(false)}>
                Cancel
              </Button>
              <Button onClick={() => setShowImportDialog(false)}>Import</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function Label({ children, className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cn('text-sm font-medium', className)} {...props}>
      {children}
    </label>
  );
}
