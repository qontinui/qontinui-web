"use client";

import { useState, useEffect, useCallback } from "react";
import {
  useRunnerHealth,
  runnerApi,
  type PlaywrightSettings,
} from "@/lib/runner-api";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, Save, FlaskConical, Eye, EyeOff, Info } from "lucide-react";

export default function PlaywrightSettingsPage() {
  const { isOffline, isLoading: healthLoading } = useRunnerHealth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Form state
  const [testUsername, setTestUsername] = useState("");
  const [testPassword, setTestPassword] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [skipWebServer, setSkipWebServer] = useState(true);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const data = await runnerApi.getPlaywrightSettings();
      setTestUsername(data.test_username ?? "");
      setTestPassword(data.test_password ?? "");
      setBaseUrl(data.base_url ?? "");
      setSkipWebServer(data.skip_web_server ?? true);
    } catch {
      toast.error("Failed to load Playwright settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOffline) {
      setLoading(false);
      return;
    }
    loadSettings();
  }, [isOffline, loadSettings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await runnerApi.savePlaywrightSettings({
        test_username: testUsername || null,
        test_password: testPassword || null,
        base_url: baseUrl || null,
        skip_web_server: skipWebServer,
      } satisfies PlaywrightSettings);
      toast.success("Playwright settings saved");
    } catch (err) {
      toast.error(
        `Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    } finally {
      setSaving(false);
    }
  };

  if (healthLoading || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-text-muted" />
      </div>
    );
  }

  if (isOffline) {
    return <RunnerOfflineState />;
  }

  return (
    <div className="p-6 max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <FlaskConical className="size-5" />
            Playwright
          </h2>
          <p className="text-sm text-text-muted mt-1">
            Test configuration and environment settings
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={saving}
          variant="brand-primary"
          size="sm"
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          Save
        </Button>
      </div>

      {/* Test Authentication */}
      <Card className="bg-surface-raised/30 border-border-subtle/50">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FlaskConical className="size-4" />
            Test Authentication
          </CardTitle>
          <CardDescription>
            Credentials passed as PLAYWRIGHT_TEST_USERNAME and
            PLAYWRIGHT_TEST_PASSWORD environment variables to test scripts
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label
              htmlFor="test-username"
              className="text-sm text-text-primary"
            >
              Username or Email
            </Label>
            <Input
              id="test-username"
              type="text"
              placeholder="user@example.com"
              value={testUsername}
              onChange={(e) => setTestUsername(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label
              htmlFor="test-password"
              className="text-sm text-text-primary"
            >
              Password
            </Label>
            <div className="relative">
              <Input
                id="test-password"
                type={showPassword ? "text" : "password"}
                placeholder="Enter test password"
                value={testPassword}
                onChange={(e) => setTestPassword(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-text-muted hover:text-text-primary transition-colors"
              >
                {showPassword ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Environment */}
      <Card className="bg-surface-raised/30 border-border-subtle/50">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FlaskConical className="size-4" />
            Environment
          </CardTitle>
          <CardDescription>
            Test execution environment configuration
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="base-url" className="text-sm text-text-primary">
              Base URL
            </Label>
            <Input
              id="base-url"
              type="text"
              placeholder="http://localhost:3001"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            <p className="text-xs text-text-muted">
              Optional. Sets the PLAYWRIGHT_BASE_URL environment variable for
              tests.
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label
                htmlFor="skip-web-server"
                className="text-sm text-text-primary"
              >
                Skip Web Server Startup
              </Label>
              <p className="text-xs text-text-muted">
                Sets SKIP_WEB_SERVER=1. Enable when your dev server is already
                running.
              </p>
            </div>
            <Switch
              id="skip-web-server"
              checked={skipWebServer}
              onCheckedChange={setSkipWebServer}
            />
          </div>

          <div className="flex items-start gap-2 p-3 rounded-md bg-blue-500/5 border border-blue-500/10">
            <Info className="size-4 text-blue-400 mt-0.5 shrink-0" />
            <p className="text-xs text-text-muted">
              These settings are injected as environment variables when running
              Playwright tests. The base URL determines where tests navigate,
              and the web server skip flag prevents Playwright from starting its
              own server when one is already running.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
