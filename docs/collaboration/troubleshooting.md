# Troubleshooting Guide

Solutions to common issues with Qontinui's collaboration features.

## Table of Contents

- [Organizations](#organizations)
- [Project Sharing](#project-sharing)
- [Real-Time Sync](#real-time-sync)
- [Comments](#comments)
- [Permissions](#permissions)
- [WebSocket Connection](#websocket-connection)
- [Performance Issues](#performance-issues)

## Organizations

### Cannot Create Organization

**Symptoms:**
- "Organization already exists" error
- Slug validation errors
- Permission denied errors

**Solutions:**

1. **Slug Already Taken**
   ```
   Error: Organization with slug 'my-org' already exists
   ```
   - Choose a different slug
   - Check if you already have an organization with that name
   - Slugs must be globally unique

2. **Invalid Slug Format**
   ```
   Error: Slug must contain only lowercase letters, numbers, and hyphens
   ```
   - Remove special characters
   - Use hyphens instead of spaces
   - Example: "My Team" → "my-team"

3. **Permission Issues**
   ```
   Error: You have reached the maximum number of organizations
   ```
   - Check your subscription tier limits
   - Delete unused organizations
   - Upgrade subscription if needed

### Cannot Remove Organization Member

**Symptoms:**
- "Cannot remove member" error
- Member still appears after deletion

**Solutions:**

1. **Trying to Remove Owner**
   ```
   Error: Cannot remove organization owner
   ```
   - Transfer ownership first
   - Then remove the former owner

2. **Insufficient Permissions**
   ```
   Error: Insufficient permissions to remove member
   ```
   - Only owners and admins can remove members
   - Admins cannot remove other admins
   - Contact organization owner

3. **Member Has Active Locks**
   ```
   Error: Member has active resource locks
   ```
   - Wait for locks to expire
   - Or manually release locks
   - Then try removing again

## Project Sharing

### Cannot Share Project

**Symptoms:**
- Share button disabled
- "Permission denied" errors
- Email not found errors

**Solutions:**

1. **Insufficient Permissions**
   ```
   Error: You don't have permission to share this project
   ```
   - Only project owner and admins can share
   - Request admin access from project owner
   - Or ask owner to share on your behalf

2. **User Not Found**
   ```
   Error: User with email 'user@example.com' not found
   ```
   - Verify email address is correct
   - User must have a Qontinui account
   - Invite user to create account first

3. **Already Shared**
   ```
   Error: Project already shared with this user
   ```
   - Update existing permission instead
   - Or revoke and reshare with new permissions

### Shared Project Not Visible

**Symptoms:**
- User doesn't see shared project
- Project list is empty
- Access denied when opening link

**Solutions:**

1. **Check Email Notification**
   - Verify user received share notification
   - Check spam folder
   - Resend invitation if needed

2. **Verify User Account**
   - User must be logged in
   - Using correct account (check email)
   - Account is active and verified

3. **Check Permission Expiration**
   ```sql
   SELECT expires_at FROM project_access_control
   WHERE user_id = 'uuid' AND project_id = 123;
   ```
   - Access may have expired
   - Extend or remove expiration date

4. **Organization Membership**
   - If shared with organization, user must be member
   - Check user's organization memberships
   - Re-invite to organization if needed

## Real-Time Sync

### Lock Timeout Issues

**Symptoms:**
- "Lock expired" warnings
- Cannot acquire lock
- Lock taken by another user

**Solutions:**

1. **Lock Expired While Editing**
   ```
   Warning: Your lock has expired
   ```
   - Save your changes immediately
   - Acquire new lock before continuing
   - Increase lock duration in settings

2. **Cannot Acquire Lock**
   ```
   Error: Resource is locked by another user
   ```
   - Wait for lock to expire (default: 5 minutes)
   - Contact the user to release lock
   - Admin can force-release locks

3. **Lock Auto-Release Not Working**
   - Check WebSocket connection is active
   - Verify heartbeat mechanism is running
   - Check server-side lock cleanup job

### Presence Not Updating

**Symptoms:**
- User avatars not showing
- Activity indicators stuck
- Can't see who's online

**Solutions:**

1. **WebSocket Disconnected**
   - Check connection status indicator
   - Refresh page to reconnect
   - Check network connectivity

2. **Old Presence Data**
   - Clear browser cache
   - Force refresh (Ctrl+Shift+R)
   - Restart application

3. **Server Issues**
   ```bash
   # Check WebSocket server
   curl -i -N -H "Connection: Upgrade" \
     -H "Upgrade: websocket" \
     http://localhost:8000/ws/projects/123
   ```

### Changes Not Syncing

**Symptoms:**
- Updates not appearing for other users
- Delay in seeing changes
- Inconsistent state across clients

**Solutions:**

1. **Check WebSocket Connection**
   ```typescript
   const ws = useWebSocket();
   console.log('Connection state:', ws.getState());
   // Should be 'connected'
   ```

2. **Network Issues**
   - Check internet connection
   - Test with browser console:
     ```javascript
     navigator.onLine // Should be true
     ```

3. **Firewall/Proxy Blocking WebSocket**
   - WebSocket connections may be blocked
   - Try different network
   - Contact IT to allow WebSocket traffic

4. **Message Queue Full**
   - Too many pending updates
   - Disconnect and reconnect
   - Clear offline queue

## Comments

### Cannot Add Comment

**Symptoms:**
- Comment button disabled
- "Permission denied" errors
- Comment not saving

**Solutions:**

1. **No Comment Permission**
   ```
   Error: You need at least Comment permission
   ```
   - Check your permission level
   - Request higher permissions
   - Owner/admin can grant comment access

2. **Invalid @Mention**
   ```
   Error: User '@username' not found
   ```
   - Verify username is correct
   - User must have access to project
   - Use autocomplete to select users

3. **Comment Too Long**
   ```
   Error: Comment exceeds maximum length
   ```
   - Limit is 10,000 characters
   - Split into multiple comments
   - Or use external document and link

### Comments Not Loading

**Symptoms:**
- Comment section empty
- Loading spinner stuck
- Old comments not visible

**Solutions:**

1. **API Request Failed**
   - Check browser console for errors
   - Verify authentication token
   - Try refreshing page

2. **Filter Too Restrictive**
   - Check comment filters (resolved, author, date)
   - Reset filters to defaults
   - Clear search query

3. **Database Query Timeout**
   - Too many comments in project
   - Use pagination
   - Filter by date range

## Permissions

### Permission Errors

**Symptoms:**
- "Access denied" errors
- Features disabled unexpectedly
- Cannot perform allowed actions

**Solutions:**

1. **Cached Permissions Stale**
   ```typescript
   // Force permission refresh
   await refetchPermissions();
   ```
   - Logout and login again
   - Clear browser cache
   - Wait for token refresh

2. **Mixed Permission Sources**
   - Check both user and organization permissions
   - User permissions override organization
   - Verify which takes precedence

3. **Permission Not Inherited**
   ```
   Expected: Organization member should have Edit access
   Actual: User only has View access
   ```
   - Check organization role
   - Viewers have max Comment permission
   - Grant individual user permission

### Cannot Change User Permission

**Symptoms:**
- Permission dropdown disabled
- Changes not saving
- "Not authorized" errors

**Solutions:**

1. **Insufficient Privileges**
   ```
   Error: Only admins can change permissions
   ```
   - Must have Admin permission level
   - Or be project owner
   - Contact project owner

2. **Cannot Downgrade Owner**
   ```
   Error: Cannot change owner permissions
   ```
   - Transfer ownership first
   - Then modify permissions

3. **Organization Override**
   ```
   Warning: This user's permissions are set by organization
   ```
   - Individual permissions override org
   - Set user permission explicitly
   - Or change organization permission

## WebSocket Connection

### Connection Keeps Dropping

**Symptoms:**
- Frequent reconnection messages
- "Disconnected" warnings
- Unstable real-time features

**Solutions:**

1. **Network Issues**
   - Check internet stability
   - Disable VPN temporarily
   - Try different network

2. **Server Restarts**
   - Check if server is being updated
   - Wait for deployment to complete
   - Connection will auto-reconnect

3. **Increase Timeout**
   ```typescript
   const ws = new ExecutionWebSocket({
     url: wsUrl,
     heartbeatInterval: 60000, // 1 minute
     heartbeatTimeout: 10000   // 10 seconds
   });
   ```

### Cannot Connect to WebSocket

**Symptoms:**
- "Connection failed" error
- WebSocket state stuck at "connecting"
- Real-time features not working

**Solutions:**

1. **Check WebSocket URL**
   ```typescript
   console.log(process.env.NEXT_PUBLIC_WS_URL);
   // Should be: ws://localhost:8000 or wss://api.qontinui.com
   ```

2. **CORS/Security Issues**
   - Check browser console for CORS errors
   - Verify WebSocket allowed in CSP
   - Add WebSocket origin to allowed list

3. **Invalid Token**
   ```
   Error: WebSocket authentication failed
   ```
   - Token expired or invalid
   - Refresh authentication
   - Get new access token

4. **Port Blocked**
   - Default WebSocket port: 8000
   - Check firewall rules
   - Try different port

### High Memory Usage

**Symptoms:**
- Browser tab using excessive memory
- Application slowing down
- Crashes after extended use

**Solutions:**

1. **WebSocket Message Queue Growing**
   ```typescript
   // Limit queue size
   ws.updateConfig({
     maxQueueSize: 100 // Reduce from default
   });
   ```

2. **Event Listeners Not Cleaned Up**
   ```typescript
   useEffect(() => {
     const handler = (event) => {...};
     ws.on('message', handler);

     return () => {
       ws.off('message', handler); // Always cleanup!
     };
   }, []);
   ```

3. **Memory Leak in Activity Log**
   - Use pagination
   - Implement virtual scrolling
   - Clear old activities periodically

## Performance Issues

### Slow Project Loading

**Symptoms:**
- Long load times
- Timeout errors
- Blank screen during load

**Solutions:**

1. **Too Many Collaborators**
   - Paginate collaborator list
   - Lazy load user data
   - Cache user information

2. **Large Activity Log**
   ```typescript
   // Load recent activity only
   const activities = await getProjectActivity(projectId, {
     limit: 50,
     startDate: last30Days
   });
   ```

3. **Database Query Optimization**
   ```sql
   -- Add indexes
   CREATE INDEX idx_activity_project_date
   ON activity_logs(project_id, created_at DESC);
   ```

### Slow Comment Loading

**Symptoms:**
- Comments take long to load
- Pagination slow
- UI freezes when loading comments

**Solutions:**

1. **Load Comments on Demand**
   ```typescript
   // Don't load all comments upfront
   const { data: comments } = useInfiniteQuery({
     queryKey: ['comments', resourceId],
     queryFn: ({ pageParam = 0 }) => fetchComments(resourceId, pageParam)
   });
   ```

2. **Filter Resolved Comments**
   ```typescript
   // Only load unresolved by default
   const comments = await getComments(projectId, {
     resolved: false
   });
   ```

3. **Optimize Comment Queries**
   - Add database indexes
   - Use query result caching
   - Implement CDN for static content

## Getting Additional Help

### Check System Status

1. Visit status page: `https://status.qontinui.com`
2. Check for ongoing incidents
3. Subscribe to status updates

### Gather Debug Information

Before contacting support, collect:

```bash
# Browser info
navigator.userAgent

# Console errors
console.error logs

# Network requests
Browser DevTools → Network tab

# WebSocket messages
WebSocket frame inspection

# Environment
process.env.NEXT_PUBLIC_API_URL
process.env.NEXT_PUBLIC_WS_URL
```

### Contact Support

- **Email**: support@qontinui.com
- **Documentation**: https://docs.qontinui.com
- **Community Forum**: https://community.qontinui.com

Include in your support request:
- Detailed error messages
- Steps to reproduce
- Expected vs actual behavior
- Screenshots/videos
- Debug information above

## Related Documentation

- [API Reference](./api-reference.md) - API error codes
- [Developer Guide](./developer-guide.md) - Debugging techniques
- [Real-Time Sync](./real-time-sync.md) - WebSocket details

---

**Last Updated:** 2025-01-14
