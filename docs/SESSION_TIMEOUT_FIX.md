# Session Timeout Fix - Preventing Early Logout

## Problem

Users were being logged out prematurely, even when active. The intended behavior was to keep users logged in for 1 hour of inactivity, but they were getting logged out much earlier (typically after 15-30 minutes).

### Root Cause

The issue was in the `TokenManager.hasValidToken()` method. It was checking if the JWT access token had expired based on its `exp` claim, which is typically set to 15-30 minutes. This caused the following chain of events:

1. **JWT Access Token Expiry**: Access tokens have a short lifespan (15-30 mins) for security
2. **Token Check Too Strict**: `hasValidToken()` returned `false` when access token expired
3. **Premature Logout**: Auth system treated this as "not authenticated" and logged user out
4. **Ignored Refresh Token**: Even though a valid refresh token existed, it wasn't being considered

### The Architecture

The application has a sophisticated session management system:

1. **Activity Tracker** (`use-activity-tracker.ts`):
   - Monitors user activity (mouse, keyboard, scroll, etc.)
   - Refreshes access token every 5 minutes while user is active
   - Shows warning 3 minutes before 1-hour inactivity timeout
   - Logs user out after 1 hour of actual inactivity

2. **Token Manager** (`token-manager.ts`):
   - Stores access token (short-lived, 15-30 mins)
   - Stores refresh token (long-lived, can refresh access token)
   - Should consider session valid if EITHER token is present

3. **API Client** (`api-client.ts`):
   - Automatically refreshes token on 401 errors
   - Retries failed requests after refresh

## The Fix

### 1. Updated Token Validation Logic

**File**: `/frontend/src/services/token-manager.ts`

**Before**:
```typescript
hasValidToken(): boolean {
  const hasToken = !!this.accessToken;
  const isExpired = this.tokenExpiry ? now >= this.tokenExpiry : false;
  return hasToken && !isExpired;  // ❌ Too strict!
}
```

**After**:
```typescript
hasValidToken(): boolean {
  const hasAccessToken = !!this.accessToken;
  const hasRefreshToken = !!this.refreshToken;
  const isAccessTokenExpired = this.tokenExpiry ? now >= this.tokenExpiry : false;

  // Session is valid if we have EITHER:
  // 1. A valid (non-expired) access token, OR
  // 2. A refresh token (even if access token is expired, we can refresh it)
  const isValid = (hasAccessToken && !isAccessTokenExpired) || hasRefreshToken;

  return isValid;  // ✅ Considers refresh token!
}
```

**Key Change**: The method now returns `true` if a refresh token exists, even if the access token has expired. This prevents premature logout because:
- The refresh token can be used to get a new access token
- The activity tracker handles periodic refreshing
- Only when BOTH tokens are missing/invalid do we log out

### 2. Proactive Token Refresh

**File**: `/frontend/src/lib/api-client.ts`

Added proactive token refresh before API requests:

```typescript
private async fetchWithAuth(url: string, options: RequestInit = {}, attempt = 1): Promise<Response> {
  // Proactively check if token is expired and refresh if needed
  if (authService.isAuthenticated() && attempt === 1) {
    const accessToken = authService.tokenManager.getAccessToken();
    if (accessToken) {
      const payload = JSON.parse(atob(accessToken.split('.')[1]));
      const expiryTime = payload.exp * 1000;
      const timeUntilExpiry = expiryTime - Date.now();

      // If token expires within 1 minute, refresh it proactively
      if (timeUntilExpiry < 60000) {
        console.log('[ApiClient] Access token expiring soon, refreshing proactively...');
        await this.refreshAccessToken();
      }
    }
  }
  // ... rest of request
}
```

**Benefits**:
- Prevents 401 errors by refreshing before token expires
- Smoother user experience (no failed requests)
- Reduces unnecessary retry attempts

## How It Works Now

### Normal Flow (User Active)

1. **Login**: User gets access token (15 min) + refresh token (long-lived)
2. **Activity Tracking**: Activity tracker monitors user actions
3. **Periodic Refresh**: Every 5 minutes, if user is active, access token is refreshed
4. **Proactive Refresh**: Before API requests, if token expires within 1 min, it's refreshed
5. **Session Valid**: `hasValidToken()` returns true because refresh token exists

### Warning Flow (Near Inactivity Timeout)

1. **57 Minutes of Inactivity**: Activity tracker detects no activity
2. **Warning Shown**: Dialog appears: "Session expiring in 3:00"
3. **User Continues**: Clicks "Continue Working"
4. **Token Refreshed**: New access token obtained
5. **Timers Reset**: All timers reset, session continues

### Logout Flow (Actual Inactivity)

1. **60 Minutes of Inactivity**: No user activity for 1 hour
2. **Session Expired Event**: Activity tracker dispatches event
3. **Tokens Cleared**: Both access and refresh tokens removed
4. **User Logged Out**: Redirected to login page

## Testing

To verify the fix works:

1. **Test Active Session**:
   - Log in and use the app normally
   - Wait 20 minutes (longer than access token expiry)
   - Continue using the app
   - ✅ Should remain logged in

2. **Test Inactivity Warning**:
   - Log in and don't interact for 57 minutes
   - ✅ Should see warning dialog at 57 minutes
   - Click "Continue Working"
   - ✅ Should extend session and remain logged in

3. **Test Actual Timeout**:
   - Log in and don't interact for 60 minutes
   - ✅ Should be logged out after 1 hour

## Configuration

The session timeout settings are in `/frontend/src/hooks/use-activity-tracker.ts`:

```typescript
const INACTIVITY_TIMEOUT = 60 * 60 * 1000;     // 1 hour in milliseconds
const REFRESH_INTERVAL = 5 * 60 * 1000;        // Refresh every 5 minutes
const WARN_BEFORE_TIMEOUT = 3 * 60 * 1000;     // Warn 3 minutes before
```

To change the timeout:
- Modify `INACTIVITY_TIMEOUT` (e.g., `2 * 60 * 60 * 1000` for 2 hours)
- Adjust `WARN_BEFORE_TIMEOUT` if needed (warning timing)
- Keep `REFRESH_INTERVAL` less than access token expiry

## Key Takeaways

1. ✅ **Session validity** should consider refresh tokens, not just access tokens
2. ✅ **Proactive refresh** prevents 401 errors and improves UX
3. ✅ **Activity tracking** manages the real inactivity timeout (1 hour)
4. ✅ **Multiple layers** of token refresh ensure reliability:
   - Activity tracker: Every 5 minutes if active
   - API client: Before requests if expiring soon
   - Error handler: After 401 errors as fallback

## Files Modified

1. `/frontend/src/services/token-manager.ts` - Fixed `hasValidToken()` logic
2. `/frontend/src/lib/api-client.ts` - Added proactive token refresh

## Related Files (No Changes Needed)

- `/frontend/src/hooks/use-activity-tracker.ts` - Activity monitoring (already working)
- `/frontend/src/services/auth-service.ts` - Token refresh endpoint (already working)
- `/frontend/src/components/session-timeout-warning.tsx` - Warning dialog (already working)
- `/frontend/src/contexts/auth-context.tsx` - Auth state management (already working)

The fix was surgical - only updating the token validation logic to properly consider refresh tokens, preventing premature logout while maintaining the intended 1-hour inactivity timeout.
