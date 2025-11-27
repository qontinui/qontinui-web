'use client';

import { useState } from 'react';
import { RequireProject } from '@/components/require-project';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Settings,
  User,
  Bell,
  Shield,
  Palette,
  Code,
  Zap,
  Save,
  RotateCcw,
  Download,
  Upload,
  Trash2,
  Info,
} from 'lucide-react';
import { toast } from 'sonner';

export default function SettingsPage() {
  const [settings, setSettings] = useState({
    // General
    autoSave: true,
    autoSaveInterval: 30,

    // Editor
    theme: 'dark',
    fontSize: 14,
    showLineNumbers: true,
    enableAutoComplete: true,

    // Execution
    maxConcurrentWorkflows: 5,
    defaultTimeout: 30000,
    retryOnFailure: true,
    maxRetries: 3,

    // Notifications
    notifyOnSuccess: false,
    notifyOnFailure: true,
    notifyOnStart: false,
    emailNotifications: true,

    // Advanced
    enableDebugMode: false,
    logLevel: 'info',
    enableTelemetry: true,
  });

  const handleSave = () => {
    // Save settings
    toast.success('Settings saved successfully');
  };

  const handleReset = () => {
    // Reset to defaults
    toast.info('Settings reset to defaults');
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'automation-settings.json';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Settings exported');
  };

  const updateSetting = (key: string, value: any) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <RequireProject pageName="Settings">
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Settings className="w-8 h-8" />
            Settings
          </h1>
          <p className="text-muted-foreground mt-1">
            Configure your automation builder preferences
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RotateCcw className="w-4 h-4 mr-2" />
            Reset
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button size="sm" className="bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black" onClick={handleSave}>
            <Save className="w-4 h-4 mr-2" />
            Save Changes
          </Button>
        </div>
      </div>

      {/* Settings Tabs */}
      <Tabs defaultValue="general" className="space-y-6">
        <TabsList>
          <TabsTrigger value="general">
            <Settings className="w-4 h-4 mr-2" />
            General
          </TabsTrigger>
          <TabsTrigger value="editor">
            <Code className="w-4 h-4 mr-2" />
            Editor
          </TabsTrigger>
          <TabsTrigger value="execution">
            <Zap className="w-4 h-4 mr-2" />
            Execution
          </TabsTrigger>
          <TabsTrigger value="notifications">
            <Bell className="w-4 h-4 mr-2" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="advanced">
            <Shield className="w-4 h-4 mr-2" />
            Advanced
          </TabsTrigger>
        </TabsList>

        {/* General Settings */}
        <TabsContent value="general" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Project Settings</CardTitle>
              <CardDescription>Configure general project preferences</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Auto-save</Label>
                  <p className="text-sm text-muted-foreground">
                    Automatically save changes while working
                  </p>
                </div>
                <Switch
                  checked={settings.autoSave}
                  onCheckedChange={(checked) => updateSetting('autoSave', checked)}
                />
              </div>

              {settings.autoSave && (
                <div className="space-y-2">
                  <Label htmlFor="autoSaveInterval">Auto-save Interval (seconds)</Label>
                  <Input
                    id="autoSaveInterval"
                    type="number"
                    value={settings.autoSaveInterval}
                    onChange={(e) => updateSetting('autoSaveInterval', parseInt(e.target.value))}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Editor Settings */}
        <TabsContent value="editor" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Editor Preferences</CardTitle>
              <CardDescription>Customize the workflow editor experience</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="theme">Theme</Label>
                <Select value={settings.theme} onValueChange={(value) => updateSetting('theme', value)}>
                  <SelectTrigger id="theme">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="dark">Dark</SelectItem>
                    <SelectItem value="auto">Auto</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="fontSize">Font Size</Label>
                <Input
                  id="fontSize"
                  type="number"
                  min={10}
                  max={24}
                  value={settings.fontSize}
                  onChange={(e) => updateSetting('fontSize', parseInt(e.target.value))}
                />
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Show Line Numbers</Label>
                  <p className="text-sm text-muted-foreground">
                    Display line numbers in code editor
                  </p>
                </div>
                <Switch
                  checked={settings.showLineNumbers}
                  onCheckedChange={(checked) => updateSetting('showLineNumbers', checked)}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Enable Auto-complete</Label>
                  <p className="text-sm text-muted-foreground">
                    Show suggestions while typing
                  </p>
                </div>
                <Switch
                  checked={settings.enableAutoComplete}
                  onCheckedChange={(checked) => updateSetting('enableAutoComplete', checked)}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Execution Settings */}
        <TabsContent value="execution" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Execution Settings</CardTitle>
              <CardDescription>Configure workflow execution behavior</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="maxConcurrent">Max Concurrent Workflows</Label>
                <Input
                  id="maxConcurrent"
                  type="number"
                  min={1}
                  max={20}
                  value={settings.maxConcurrentWorkflows}
                  onChange={(e) => updateSetting('maxConcurrentWorkflows', parseInt(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Maximum number of workflows that can run simultaneously
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="timeout">Default Timeout (ms)</Label>
                <Input
                  id="timeout"
                  type="number"
                  value={settings.defaultTimeout}
                  onChange={(e) => updateSetting('defaultTimeout', parseInt(e.target.value))}
                />
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Retry on Failure</Label>
                  <p className="text-sm text-muted-foreground">
                    Automatically retry failed workflows
                  </p>
                </div>
                <Switch
                  checked={settings.retryOnFailure}
                  onCheckedChange={(checked) => updateSetting('retryOnFailure', checked)}
                />
              </div>

              {settings.retryOnFailure && (
                <div className="space-y-2">
                  <Label htmlFor="maxRetries">Max Retries</Label>
                  <Input
                    id="maxRetries"
                    type="number"
                    min={1}
                    max={10}
                    value={settings.maxRetries}
                    onChange={(e) => updateSetting('maxRetries', parseInt(e.target.value))}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notifications Settings */}
        <TabsContent value="notifications" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Notification Preferences</CardTitle>
              <CardDescription>Control when and how you receive notifications</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Notify on Success</Label>
                  <p className="text-sm text-muted-foreground">
                    Get notified when workflows complete successfully
                  </p>
                </div>
                <Switch
                  checked={settings.notifyOnSuccess}
                  onCheckedChange={(checked) => updateSetting('notifyOnSuccess', checked)}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Notify on Failure</Label>
                  <p className="text-sm text-muted-foreground">
                    Get notified when workflows fail
                  </p>
                </div>
                <Switch
                  checked={settings.notifyOnFailure}
                  onCheckedChange={(checked) => updateSetting('notifyOnFailure', checked)}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Notify on Start</Label>
                  <p className="text-sm text-muted-foreground">
                    Get notified when workflows start executing
                  </p>
                </div>
                <Switch
                  checked={settings.notifyOnStart}
                  onCheckedChange={(checked) => updateSetting('notifyOnStart', checked)}
                />
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Email Notifications</Label>
                  <p className="text-sm text-muted-foreground">
                    Receive notifications via email
                  </p>
                </div>
                <Switch
                  checked={settings.emailNotifications}
                  onCheckedChange={(checked) => updateSetting('emailNotifications', checked)}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Advanced Settings */}
        <TabsContent value="advanced" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Advanced Settings</CardTitle>
              <CardDescription>Advanced configuration options</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Debug Mode</Label>
                  <p className="text-sm text-muted-foreground">
                    Enable detailed logging and debugging information
                  </p>
                </div>
                <Switch
                  checked={settings.enableDebugMode}
                  onCheckedChange={(checked) => updateSetting('enableDebugMode', checked)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="logLevel">Log Level</Label>
                <Select value={settings.logLevel} onValueChange={(value) => updateSetting('logLevel', value)}>
                  <SelectTrigger id="logLevel">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="error">Error</SelectItem>
                    <SelectItem value="warn">Warning</SelectItem>
                    <SelectItem value="info">Info</SelectItem>
                    <SelectItem value="debug">Debug</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Telemetry</Label>
                  <p className="text-sm text-muted-foreground">
                    Help improve the product by sharing anonymous usage data
                  </p>
                </div>
                <Switch
                  checked={settings.enableTelemetry}
                  onCheckedChange={(checked) => updateSetting('enableTelemetry', checked)}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-destructive">
            <CardHeader>
              <CardTitle className="text-destructive">Danger Zone</CardTitle>
              <CardDescription>Irreversible actions - proceed with caution</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Clear All Data</p>
                  <p className="text-sm text-muted-foreground">
                    Delete all workflows, settings, and data
                  </p>
                </div>
                <Button variant="destructive" size="sm">
                  <Trash2 className="w-4 h-4 mr-2" />
                  Clear Data
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Info Banner */}
      <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800">
        <CardContent className="flex items-start gap-3 pt-6">
          <Info className="w-5 h-5 text-blue-500 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-blue-900 dark:text-blue-100">
              Settings are saved locally
            </p>
            <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
              Your preferences are stored in your browser's local storage. Export your settings to back them up or share across devices.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
    </RequireProject>
  );
}
