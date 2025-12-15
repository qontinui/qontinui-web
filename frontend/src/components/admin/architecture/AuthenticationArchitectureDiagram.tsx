import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Shield,
  Key,
  Lock,
  Users,
  Database,
  Server,
  Smartphone,
  Mail,
  Clock,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";

/**
 * Comprehensive Authentication & Authorization Architecture Diagram
 *
 * Visualizes the complete auth system including:
 * - JWT-based authentication with token rotation
 * - Role-based access control (RBAC) and permissions
 * - User lifecycle management
 * - Device fingerprinting and session management
 * - Token blacklisting and security features
 * - Frontend/backend auth flow
 */
export default function AuthenticationArchitectureDiagram() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold flex items-center justify-center gap-2">
          <Shield className="w-6 h-6 text-blue-600" />
          Authentication & Authorization Architecture
        </h2>
        <p className="text-sm text-muted-foreground max-w-3xl mx-auto">
          Enterprise-grade security with JWT tokens, RBAC permissions, device
          fingerprinting, and comprehensive session management
        </p>
      </div>

      {/* System Overview */}
      <Card className="border-blue-200 bg-blue-50/50">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="w-5 h-5" />
            System Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <div className="font-semibold text-sm">Authentication</div>
              <ul className="text-xs space-y-1 text-muted-foreground">
                <li>• JWT-based (HS256)</li>
                <li>• Access + Refresh tokens</li>
                <li>• Token rotation on refresh</li>
                <li>• Device fingerprinting</li>
                <li>• Remember me (90 days)</li>
              </ul>
            </div>
            <div className="space-y-2">
              <div className="font-semibold text-sm">Authorization</div>
              <ul className="text-xs space-y-1 text-muted-foreground">
                <li>• Hybrid RBAC + ABAC</li>
                <li>• Project-level permissions</li>
                <li>• Organization team roles</li>
                <li>• Resource ownership</li>
                <li>• Permission hierarchy</li>
              </ul>
            </div>
            <div className="space-y-2">
              <div className="font-semibold text-sm">Security Features</div>
              <ul className="text-xs space-y-1 text-muted-foreground">
                <li>• Token blacklisting (Redis)</li>
                <li>• Sliding window sessions</li>
                <li>• Rate limiting</li>
                <li>• Bcrypt password hashing</li>
                <li>• Email verification</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Authentication Flow */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Frontend Auth Flow */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Smartphone className="w-4 h-4" />
              Frontend Authentication Flow
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Login */}
            <div className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
                  1
                </div>
                <span className="font-semibold text-sm">User Login</span>
              </div>
              <div className="ml-8 text-xs space-y-1">
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground">Component:</span>
                  <code className="text-xs bg-muted px-1 rounded">
                    AuthDialog
                  </code>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground">Validation:</span>
                  <span>react-hook-form + Zod</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground">API Call:</span>
                  <code className="text-xs bg-muted px-1 rounded">
                    POST /api/v1/auth/jwt/login
                  </code>
                </div>
              </div>
            </div>

            {/* Token Storage */}
            <div className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
                  2
                </div>
                <span className="font-semibold text-sm">Token Storage</span>
              </div>
              <div className="ml-8 text-xs space-y-1">
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground">Storage:</span>
                  <code className="text-xs bg-muted px-1 rounded">
                    localStorage
                  </code>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground">Tokens:</span>
                  <span>access_token, refresh_token</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground">Expiry:</span>
                  <span>60 min (access), 30/90 days (refresh)</span>
                </div>
                <div className="flex items-center gap-1 mt-2">
                  <AlertTriangle className="w-3 h-3 text-amber-600" />
                  <span className="text-amber-700">
                    Vulnerable to XSS attacks
                  </span>
                </div>
              </div>
            </div>

            {/* Auth Context */}
            <div className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
                  3
                </div>
                <span className="font-semibold text-sm">
                  Auth State Management
                </span>
              </div>
              <div className="ml-8 text-xs space-y-1">
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground">Pattern:</span>
                  <span>React Context API</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground">Hook:</span>
                  <code className="text-xs bg-muted px-1 rounded">
                    useAuth()
                  </code>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground">Features:</span>
                  <span>Auto-refresh, session events</span>
                </div>
              </div>
            </div>

            {/* Protected Routes */}
            <div className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
                  4
                </div>
                <span className="font-semibold text-sm">Protected Routes</span>
              </div>
              <div className="ml-8 text-xs space-y-1">
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground">Method:</span>
                  <span>Page-level auth checks</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground">Pattern:</span>
                  <code className="text-xs bg-muted px-1 rounded">
                    useEffect + redirect
                  </code>
                </div>
              </div>
            </div>

            {/* API Requests */}
            <div className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
                  5
                </div>
                <span className="font-semibold text-sm">
                  Authenticated Requests
                </span>
              </div>
              <div className="ml-8 text-xs space-y-1">
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground">Header:</span>
                  <code className="text-xs bg-muted px-1 rounded">
                    Authorization: Bearer {"{token}"}
                  </code>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground">Auto-refresh:</span>
                  <span>On 401 response</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground">Retry:</span>
                  <span>3 attempts with backoff</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Backend Auth Flow */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Server className="w-4 h-4" />
              Backend Authentication Flow
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Login Endpoint */}
            <div className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-green-600 text-white flex items-center justify-center text-xs font-bold">
                  1
                </div>
                <span className="font-semibold text-sm">Login Endpoint</span>
              </div>
              <div className="ml-8 text-xs space-y-1">
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground">Route:</span>
                  <code className="text-xs bg-muted px-1 rounded">
                    POST /jwt/login
                  </code>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground">Auth:</span>
                  <span>Username/Email + Password</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground">Verify:</span>
                  <span>Bcrypt hash comparison</span>
                </div>
              </div>
            </div>

            {/* Device Fingerprinting */}
            <div className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-green-600 text-white flex items-center justify-center text-xs font-bold">
                  2
                </div>
                <span className="font-semibold text-sm">
                  Device Fingerprinting
                </span>
              </div>
              <div className="ml-8 text-xs space-y-1">
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground">Method:</span>
                  <span>SHA-256(User-Agent + Accept-Language)</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground">Tracking:</span>
                  <span>IP, geolocation, trusted status</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground">New Device:</span>
                  <span>Email verification (optional)</span>
                </div>
              </div>
            </div>

            {/* Token Generation */}
            <div className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-green-600 text-white flex items-center justify-center text-xs font-bold">
                  3
                </div>
                <span className="font-semibold text-sm">Token Generation</span>
              </div>
              <div className="ml-8 text-xs space-y-1">
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground">Algorithm:</span>
                  <span>HS256 (HMAC SHA-256)</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground">Claims:</span>
                  <span>sub, exp, iat, jti, type, device_fp</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground">Secrets:</span>
                  <span>Separate keys for access/refresh</span>
                </div>
              </div>
            </div>

            {/* Session Tracking */}
            <div className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-green-600 text-white flex items-center justify-center text-xs font-bold">
                  4
                </div>
                <span className="font-semibold text-sm">Session Activity</span>
              </div>
              <div className="ml-8 text-xs space-y-1">
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground">Tracking:</span>
                  <span>first_login, last_activity, absolute_expiry</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground">Max Duration:</span>
                  <span>30 days (configurable)</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground">Extension:</span>
                  <span>Optional session extension</span>
                </div>
              </div>
            </div>

            {/* Analytics */}
            <div className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-green-600 text-white flex items-center justify-center text-xs font-bold">
                  5
                </div>
                <span className="font-semibold text-sm">Analytics & Audit</span>
              </div>
              <div className="ml-8 text-xs space-y-1">
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground">Events:</span>
                  <span>user_login, token_refresh</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground">Properties:</span>
                  <span>IP, user_agent, device_new, remember_me</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground">Purpose:</span>
                  <span>Security monitoring, audit trail</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Token Management */}
      <Card className="border-purple-200 bg-purple-50/50">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Key className="w-5 h-5" />
            Token & Session Management
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Token Refresh */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-purple-600" />
                <span className="font-semibold text-sm">Token Refresh</span>
              </div>
              <ul className="text-xs space-y-1 text-muted-foreground">
                <li>• Endpoint: POST /jwt/refresh</li>
                <li>• Token rotation (old → blacklist)</li>
                <li>• Preserves long_lived flag</li>
                <li>• Optional session extension</li>
                <li>• Analytics tracking</li>
              </ul>
            </div>

            {/* Token Blacklist */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-purple-600" />
                <span className="font-semibold text-sm">Token Blacklist</span>
              </div>
              <ul className="text-xs space-y-1 text-muted-foreground">
                <li>• Redis-backed (with fallback)</li>
                <li>• TTL-based auto-expiry</li>
                <li>• Tracks token JTI</li>
                <li>• Triggers: logout, refresh, revoke</li>
                <li>• O(1) lookup performance</li>
              </ul>
            </div>

            {/* Sliding Window */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-purple-600" />
                <span className="font-semibold text-sm">Sliding Window</span>
              </div>
              <ul className="text-xs space-y-1 text-muted-foreground">
                <li>• Auto-refresh within 5 min</li>
                <li>• Updates last_activity</li>
                <li>• Enforces absolute max (30d)</li>
                <li>• Returns tokens in headers</li>
                <li>• Seamless UX</li>
              </ul>
            </div>

            {/* Logout */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-purple-600" />
                <span className="font-semibold text-sm">Logout</span>
              </div>
              <ul className="text-xs space-y-1 text-muted-foreground">
                <li>• Blacklists access token</li>
                <li>• Blacklists refresh token</li>
                <li>• Deletes session activity</li>
                <li>• Clears frontend storage</li>
                <li>• Immediate effect</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Authorization System */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Permission Model */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Authorization Model (Hybrid RBAC + ABAC)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* User Roles */}
            <div className="border rounded-lg p-3 space-y-2">
              <div className="font-semibold text-sm flex items-center gap-2">
                <Users className="w-4 h-4" />
                User-Level Roles
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex items-center gap-2">
                  <Badge variant="default" className="text-xs">
                    is_superuser
                  </Badge>
                  <span className="text-muted-foreground">
                    Platform admin privileges
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    is_active
                  </Badge>
                  <span className="text-muted-foreground">
                    Account status control
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    is_verified
                  </Badge>
                  <span className="text-muted-foreground">
                    Email verification
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    is_beta
                  </Badge>
                  <span className="text-muted-foreground">
                    Beta feature access
                  </span>
                </div>
              </div>
            </div>

            {/* Organization Roles */}
            <div className="border rounded-lg p-3 space-y-2">
              <div className="font-semibold text-sm">
                Organization Team Roles
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex items-center justify-between">
                  <Badge className="text-xs">OWNER</Badge>
                  <span className="text-muted-foreground">Full control</span>
                </div>
                <div className="flex items-center justify-between">
                  <Badge variant="secondary" className="text-xs">
                    ADMIN
                  </Badge>
                  <span className="text-muted-foreground">
                    Manage members & settings
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-xs">
                    MEMBER
                  </Badge>
                  <span className="text-muted-foreground">
                    Collaborate on projects
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-xs">
                    VIEWER
                  </Badge>
                  <span className="text-muted-foreground">
                    Read-only access
                  </span>
                </div>
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                Hierarchy: VIEWER &lt; MEMBER &lt; ADMIN &lt; OWNER
              </div>
            </div>

            {/* Project Permissions */}
            <div className="border rounded-lg p-3 space-y-2">
              <div className="font-semibold text-sm">
                Project Permission Levels
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-xs">
                    VIEW
                  </Badge>
                  <span className="text-muted-foreground">
                    Can view workflows
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-xs">
                    COMMENT
                  </Badge>
                  <span className="text-muted-foreground">
                    Can add comments
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <Badge variant="secondary" className="text-xs">
                    EDIT
                  </Badge>
                  <span className="text-muted-foreground">
                    Can modify workflows
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <Badge className="text-xs">ADMIN</Badge>
                  <span className="text-muted-foreground">
                    Can manage settings
                  </span>
                </div>
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                Hierarchy: VIEW &lt; COMMENT &lt; EDIT &lt; ADMIN &lt; OWNER
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Permission Checking */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="w-4 h-4" />
              Permission Resolution & Enforcement
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Backend Permission Service */}
            <div className="border rounded-lg p-3 space-y-2">
              <div className="font-semibold text-sm">
                Backend Permission Service
              </div>
              <div className="space-y-2 text-xs">
                <div className="bg-muted p-2 rounded">
                  <code className="text-xs">
                    permission_service.can_user_access_project()
                  </code>
                </div>
                <div className="text-muted-foreground space-y-1">
                  <div className="font-medium">Resolution Order:</div>
                  <ol className="list-decimal list-inside space-y-0.5 ml-2">
                    <li>Check if user is superuser → ALLOW ALL</li>
                    <li>Check if user is project owner → ADMIN</li>
                    <li>Check direct user access → Use permission level</li>
                    <li>Check organization membership → Use org level</li>
                    <li>Verify permission hierarchy</li>
                  </ol>
                </div>
              </div>
            </div>

            {/* API Endpoint Protection */}
            <div className="border rounded-lg p-3 space-y-2">
              <div className="font-semibold text-sm">
                API Endpoint Protection
              </div>
              <div className="space-y-2 text-xs">
                <div className="text-muted-foreground">
                  <div className="font-medium mb-1">Protection Pattern:</div>
                  <div className="bg-muted p-2 rounded font-mono text-xs space-y-1">
                    <div>1. Authenticate user (JWT)</div>
                    <div>2. Get project/resource ID</div>
                    <div>3. Check permission level</div>
                    <div>4. Allow or 403 Forbidden</div>
                  </div>
                </div>
                <div className="mt-2 space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      VIEW
                    </Badge>
                    <span className="text-muted-foreground">GET endpoints</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">
                      EDIT
                    </Badge>
                    <span className="text-muted-foreground">
                      PUT/PATCH endpoints
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className="text-xs">ADMIN</Badge>
                    <span className="text-muted-foreground">
                      DELETE endpoints
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Frontend Permission Checking */}
            <div className="border rounded-lg p-3 space-y-2">
              <div className="font-semibold text-sm">
                Frontend Permission UI
              </div>
              <div className="space-y-2 text-xs">
                <div className="text-muted-foreground space-y-1">
                  <div className="font-medium">Components & Hooks:</div>
                  <ul className="space-y-0.5 ml-2">
                    <li>
                      •{" "}
                      <code className="bg-muted px-1 rounded">
                        PermissionGate
                      </code>{" "}
                      - Conditional rendering
                    </li>
                    <li>
                      •{" "}
                      <code className="bg-muted px-1 rounded">
                        useProjectPermissions()
                      </code>{" "}
                      - Permission state
                    </li>
                    <li>
                      •{" "}
                      <code className="bg-muted px-1 rounded">
                        lib/permissions.ts
                      </code>{" "}
                      - Utility functions
                    </li>
                  </ul>
                </div>
                <div className="bg-amber-50 border border-amber-200 p-2 rounded">
                  <div className="flex items-center gap-1 text-amber-700">
                    <AlertTriangle className="w-3 h-3" />
                    <span className="font-medium">Client-side only for UX</span>
                  </div>
                  <div className="text-amber-600 mt-1">
                    Backend always validates permissions
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Security Features */}
      <Card className="border-red-200 bg-red-50/50">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Lock className="w-5 h-5" />
            Advanced Security Features
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Device Fingerprinting */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-red-600" />
                <span className="font-semibold text-sm">
                  Device Fingerprinting
                </span>
              </div>
              <ul className="text-xs space-y-1 text-muted-foreground">
                <li>• SHA-256 hash of device characteristics</li>
                <li>• Stored in device_fp claim (access token)</li>
                <li>• New device detection & alerts</li>
                <li>• Optional email verification</li>
                <li>• Device trust management</li>
                <li>• Geolocation tracking (IP-based)</li>
              </ul>
            </div>

            {/* Password Security */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-red-600" />
                <span className="font-semibold text-sm">Password Security</span>
              </div>
              <ul className="text-xs space-y-1 text-muted-foreground">
                <li>• Bcrypt hashing (auto-cost upgrade)</li>
                <li>• Strength validation (8+ chars, mixed)</li>
                <li>• Never logged or returned in API</li>
                <li>• Password reset via email token</li>
                <li>• Secure password generation (secrets)</li>
              </ul>
            </div>

            {/* Rate Limiting */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-red-600" />
                <span className="font-semibold text-sm">Rate Limiting</span>
              </div>
              <ul className="text-xs space-y-1 text-muted-foreground">
                <li>• SlowAPI middleware</li>
                <li>• IP-based rate limiting</li>
                <li>• Auth endpoints: 5/min, 20/hour</li>
                <li>• API endpoints: 100/min, 1000/hour</li>
                <li>• Headers: X-RateLimit-*</li>
                <li className="text-amber-600">⚠ In-memory (not scalable)</li>
              </ul>
            </div>

            {/* Email Verification */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-red-600" />
                <span className="font-semibold text-sm">
                  Email Verification
                </span>
              </div>
              <ul className="text-xs space-y-1 text-muted-foreground">
                <li>• JWT-based verification tokens (24h)</li>
                <li>• Sent via background task queue</li>
                <li>• Auto-creates personal organization</li>
                <li>• Optional device verification</li>
                <li>• Resend verification support</li>
              </ul>
            </div>

            {/* CORS Protection */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-red-600" />
                <span className="font-semibold text-sm">CORS Protection</span>
              </div>
              <ul className="text-xs space-y-1 text-muted-foreground">
                <li>• Strict origin whitelist (production)</li>
                <li>• Credentials enabled (for auth)</li>
                <li>• Exposes: X-Total-Count, X-RateLimit-*</li>
                <li>• All methods supported</li>
                <li>• Development: localhost + WSL IPs</li>
              </ul>
            </div>

            {/* Session Security */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-red-600" />
                <span className="font-semibold text-sm">Session Security</span>
              </div>
              <ul className="text-xs space-y-1 text-muted-foreground">
                <li>• Absolute max session: 30 days</li>
                <li>• Sliding window with auto-refresh</li>
                <li>• Session activity tracking</li>
                <li>• IP & user agent logging</li>
                <li>• Optional session extension</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Database Schema */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Database className="w-5 h-5" />
            Database Schema
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Users Table */}
            <div className="border rounded-lg p-3 space-y-2">
              <div className="font-semibold text-sm">users</div>
              <div className="text-xs space-y-1 text-muted-foreground">
                <div>• id (UUID, PK)</div>
                <div>• email (unique, indexed)</div>
                <div>• hashed_password</div>
                <div>• username (unique)</div>
                <div>• is_active, is_superuser, is_verified</div>
                <div>• login_count, last_login_at</div>
                <div>• subscription_tier, avatar_url</div>
              </div>
            </div>

            {/* Organizations */}
            <div className="border rounded-lg p-3 space-y-2">
              <div className="font-semibold text-sm">organizations</div>
              <div className="text-xs space-y-1 text-muted-foreground">
                <div>• id (UUID, PK)</div>
                <div>• name, slug (unique)</div>
                <div>• owner_id → users(id)</div>
                <div>• settings (JSON)</div>
                <div>• is_active</div>
              </div>
            </div>

            {/* Team Members */}
            <div className="border rounded-lg p-3 space-y-2">
              <div className="font-semibold text-sm">team_members</div>
              <div className="text-xs space-y-1 text-muted-foreground">
                <div>• id (UUID, PK)</div>
                <div>• organization_id, user_id</div>
                <div>• role (owner/admin/member/viewer)</div>
                <div>• permissions (JSON)</div>
                <div>• invited_by, joined_at</div>
                <div>• UNIQUE(org_id, user_id)</div>
              </div>
            </div>

            {/* Project Access Control */}
            <div className="border rounded-lg p-3 space-y-2">
              <div className="font-semibold text-sm">
                project_access_control
              </div>
              <div className="text-xs space-y-1 text-muted-foreground">
                <div>• id (UUID, PK)</div>
                <div>• project_id, user_id, org_id</div>
                <div>• permission_level (view/comment/edit/admin)</div>
                <div>• created_by, expires_at</div>
                <div>• CHECK: user_id XOR org_id</div>
              </div>
            </div>

            {/* Device Sessions */}
            <div className="border rounded-lg p-3 space-y-2">
              <div className="font-semibold text-sm">device_sessions</div>
              <div className="text-xs space-y-1 text-muted-foreground">
                <div>• id (UUID, PK)</div>
                <div>• user_id, device_fingerprint</div>
                <div>• ip_address, user_agent</div>
                <div>• is_trusted, email_verified</div>
                <div>• country, city (geolocation)</div>
                <div>• first_seen, last_seen</div>
              </div>
            </div>

            {/* Session Activity */}
            <div className="border rounded-lg p-3 space-y-2">
              <div className="font-semibold text-sm">session_activities</div>
              <div className="text-xs space-y-1 text-muted-foreground">
                <div>• id (UUID, PK)</div>
                <div>• user_id, jti (refresh token ID)</div>
                <div>• first_login_at, last_activity_at</div>
                <div>• absolute_expiry_at</div>
                <div>• UNIQUE(jti)</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Issues & Recommendations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Security Gaps */}
        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              Security Gaps & Concerns
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-xs">
              <div className="border-l-4 border-red-500 pl-3 py-2">
                <div className="font-semibold text-red-700">
                  CRITICAL: localStorage Token Storage
                </div>
                <div className="text-muted-foreground">
                  Tokens vulnerable to XSS attacks. Recommend HttpOnly cookies.
                </div>
              </div>

              <div className="border-l-4 border-amber-500 pl-3 py-2">
                <div className="font-semibold text-amber-700">
                  HIGH: Missing Security Headers
                </div>
                <div className="text-muted-foreground">
                  No CSP, HSTS, X-Frame-Options. Add SecurityHeadersMiddleware.
                </div>
              </div>

              <div className="border-l-4 border-amber-500 pl-3 py-2">
                <div className="font-semibold text-amber-700">
                  HIGH: Rate Limiting Not Scalable
                </div>
                <div className="text-muted-foreground">
                  In-memory storage won&apos;t work across instances. Migrate to
                  Redis.
                </div>
              </div>

              <div className="border-l-4 border-amber-500 pl-3 py-2">
                <div className="font-semibold text-amber-700">
                  HIGH: Missing Permission Checks
                </div>
                <div className="text-muted-foreground">
                  Snapshots endpoint has NO permission validation. Security
                  risk.
                </div>
              </div>

              <div className="border-l-4 border-orange-400 pl-3 py-2">
                <div className="font-semibold text-orange-700">
                  MEDIUM: No MFA/2FA
                </div>
                <div className="text-muted-foreground">
                  Single-factor auth vulnerable to password compromise.
                </div>
              </div>

              <div className="border-l-4 border-orange-400 pl-3 py-2">
                <div className="font-semibold text-orange-700">
                  MEDIUM: No Brute Force Protection
                </div>
                <div className="text-muted-foreground">
                  No account lockout after failed login attempts.
                </div>
              </div>

              <div className="border-l-4 border-orange-400 pl-3 py-2">
                <div className="font-semibold text-orange-700">
                  MEDIUM: Cross-Tab Session Sync
                </div>
                <div className="text-muted-foreground">
                  Logout in one tab doesn&apos;t affect others. Use BroadcastChannel.
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Recommendations */}
        <Card className="border-green-200 bg-green-50/50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-600" />
              Priority Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-xs">
              <div className="border-l-4 border-green-600 pl-3 py-2">
                <div className="font-semibold text-green-700">
                  ✓ Immediate: Move tokens to HttpOnly cookies
                </div>
                <div className="text-muted-foreground">
                  Eliminate XSS token theft vulnerability. Backend sets cookies.
                </div>
              </div>

              <div className="border-l-4 border-green-600 pl-3 py-2">
                <div className="font-semibold text-green-700">
                  ✓ Immediate: Add security headers middleware
                </div>
                <div className="text-muted-foreground">
                  Implement CSP, HSTS, X-Frame-Options, X-Content-Type-Options.
                </div>
              </div>

              <div className="border-l-4 border-green-600 pl-3 py-2">
                <div className="font-semibold text-green-700">
                  ✓ Immediate: Fix snapshots endpoint permissions
                </div>
                <div className="text-muted-foreground">
                  Add project permission validation to prevent unauthorized
                  access.
                </div>
              </div>

              <div className="border-l-4 border-blue-500 pl-3 py-2">
                <div className="font-semibold text-blue-700">
                  Short-term: Implement MFA/2FA
                </div>
                <div className="text-muted-foreground">
                  Add TOTP authenticator support for enhanced security.
                </div>
              </div>

              <div className="border-l-4 border-blue-500 pl-3 py-2">
                <div className="font-semibold text-blue-700">
                  Short-term: Add brute force protection
                </div>
                <div className="text-muted-foreground">
                  Lock account after N failed attempts, require email unlock.
                </div>
              </div>

              <div className="border-l-4 border-blue-500 pl-3 py-2">
                <div className="font-semibold text-blue-700">
                  Short-term: Migrate rate limiter to Redis
                </div>
                <div className="text-muted-foreground">
                  Enable distributed rate limiting across multiple instances.
                </div>
              </div>

              <div className="border-l-4 border-blue-500 pl-3 py-2">
                <div className="font-semibold text-blue-700">
                  Short-term: Enable SessionTimeoutWarning
                </div>
                <div className="text-muted-foreground">
                  Prevent data loss from unexpected logout. Warn 5 min before
                  expiry.
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Architecture Summary */}
      <Card className="border-blue-200 bg-blue-50/50">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <CheckCircle className="w-5 h-5" />
            Architecture Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <div className="font-semibold text-sm">Strengths</div>
              <ul className="text-xs space-y-1 text-muted-foreground">
                <li>✓ Industry-standard JWT with token rotation</li>
                <li>✓ Comprehensive device fingerprinting</li>
                <li>✓ Redis-backed token blacklist with TTL</li>
                <li>✓ Sliding window sessions (UX + security)</li>
                <li>✓ Hybrid RBAC + ABAC authorization</li>
                <li>✓ Centralized permission service</li>
                <li>✓ Bcrypt password hashing</li>
                <li>✓ Email verification workflow</li>
                <li>✓ Extensive audit logging</li>
                <li>✓ Separate secrets for access/refresh tokens</li>
              </ul>
            </div>

            <div className="space-y-3">
              <div className="font-semibold text-sm">Key Metrics</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="border rounded p-2">
                  <div className="text-muted-foreground">Access Token</div>
                  <div className="font-semibold">60 minutes</div>
                </div>
                <div className="border rounded p-2">
                  <div className="text-muted-foreground">Refresh Token</div>
                  <div className="font-semibold">30-90 days</div>
                </div>
                <div className="border rounded p-2">
                  <div className="text-muted-foreground">Max Session</div>
                  <div className="font-semibold">30 days</div>
                </div>
                <div className="border rounded p-2">
                  <div className="text-muted-foreground">Auto-Refresh</div>
                  <div className="font-semibold">5 min threshold</div>
                </div>
                <div className="border rounded p-2">
                  <div className="text-muted-foreground">Permission Levels</div>
                  <div className="font-semibold">5 (VIEW-OWNER)</div>
                </div>
                <div className="border rounded p-2">
                  <div className="text-muted-foreground">Team Roles</div>
                  <div className="font-semibold">4 (VIEWER-OWNER)</div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
