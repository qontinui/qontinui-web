# Qontinui Web - Manual Testing Plan

## Overview
This document outlines the comprehensive manual testing procedures for Qontinui Web, a visual automation configuration builder. All tests should be performed before deployment to ensure system reliability and user experience quality.

## Test Environment Setup

### Prerequisites
- Backend server running on http://localhost:8000
- Frontend server running on http://localhost:3000
- Database initialized and migrations completed
- Default admin credentials available

### Test Data
- **Admin User**: admin@qontinui.com / admin123
- **Test Project**: Create sample automation projects for testing
- **Test Images**: Prepare sample screenshots for image-based actions

## Test Categories

## 1. Authentication & Security Tests

### 1.1 User Login
**Priority**: Critical
**Steps**:
1. Navigate to http://localhost:3000
2. Click on login/sign in button
3. Enter admin@qontinui.com as email
4. Enter admin123 as password
5. Click submit

**Expected Results**:
- Successful login
- JWT token stored in session
- Redirect to main application
- User menu shows logged-in state

### 1.2 Token Management
**Priority**: Critical
**Steps**:
1. Login successfully
2. Wait 15 minutes (access token expiry)
3. Perform an action requiring authentication
4. Observe automatic token refresh

**Expected Results**:
- Token refreshes automatically
- No disruption to user session
- New token has updated expiry time

### 1.3 Logout Flow
**Priority**: High
**Steps**:
1. While logged in, click logout
2. Try to access protected routes
3. Check browser storage for tokens

**Expected Results**:
- User redirected to login page
- Tokens removed from storage
- Protected routes inaccessible
- Token blacklisted on backend

### 1.4 Rate Limiting
**Priority**: High
**Steps**:
1. Attempt login with incorrect credentials
2. Repeat 60+ times within one minute
3. Observe response after limit exceeded

**Expected Results**:
- Rate limit error after 60 attempts
- Clear error message displayed
- Retry allowed after timeout period

### 1.5 CSRF Protection
**Priority**: High
**Steps**:
1. Open developer tools
2. Perform state-changing operations
3. Check for CSRF tokens in requests

**Expected Results**:
- CSRF token present in headers
- Requests without token rejected
- Token regenerated on session start

## 2. Core Functionality Tests

### 2.1 Project Management

#### 2.1.1 Create New Project
**Priority**: Critical
**Steps**:
1. Click "New Project" button
2. Enter project name
3. Add description (optional)
4. Click "Create"

**Expected Results**:
- Project created successfully
- Appears in project list
- Empty canvas ready for editing
- Project ID generated

#### 2.1.2 Save Project
**Priority**: Critical
**Steps**:
1. Open existing project
2. Make changes to state machine
3. Click "Save" or use Ctrl+S
4. Check for confirmation

**Expected Results**:
- Changes persisted to database
- Success notification displayed
- Timestamp updated
- No data loss on refresh

#### 2.1.3 Load Project
**Priority**: Critical
**Steps**:
1. From project list, select a saved project
2. Click "Open" or double-click
3. Wait for project to load

**Expected Results**:
- All states restored correctly
- Transitions maintain connections
- Action configurations preserved
- Images/assets loaded

#### 2.1.4 Delete Project
**Priority**: Medium
**Steps**:
1. Select project from list
2. Click delete button
3. Confirm deletion dialog
4. Check project list

**Expected Results**:
- Confirmation dialog appears
- Project removed from list
- Database entry deleted
- Cannot be recovered

#### 2.1.5 Export/Import Configuration
**Priority**: High
**Steps**:
1. Open a project
2. Click "Export" button
3. Save JSON file
4. Create new project
5. Click "Import"
6. Select saved file

**Expected Results**:
- Valid JSON exported
- All configurations included
- Import creates identical setup
- No data corruption

### 2.2 State Machine Builder

#### 2.2.1 Add States
**Priority**: Critical
**Steps**:
1. Right-click on canvas
2. Select "Add State"
3. Enter state name
4. Position on canvas

**Expected Results**:
- State node appears
- Draggable to reposition
- Unique ID assigned
- Visible in state list

#### 2.2.2 Create Transitions
**Priority**: Critical
**Steps**:
1. Click on source state
2. Drag to target state
3. Release to create transition
4. Configure transition properties

**Expected Results**:
- Arrow connects states
- Transition labeled
- Properties panel opens
- Can set conditions

#### 2.2.3 Configure State Properties
**Priority**: High
**Steps**:
1. Double-click on state
2. Set state type (initial/final/regular)
3. Add description
4. Configure entry/exit actions

**Expected Results**:
- Properties saved
- Visual indicators updated
- Validation for state types
- Actions list maintained

#### 2.2.4 Delete States/Transitions
**Priority**: Medium
**Steps**:
1. Select state or transition
2. Press Delete key or use context menu
3. Confirm deletion if prompted

**Expected Results**:
- Element removed from canvas
- Connected transitions updated
- Undo available
- No orphaned references

### 2.3 Action Configuration

#### 2.3.1 Add Actions to States
**Priority**: Critical
**Steps**:
1. Select a state
2. Open action editor
3. Choose action type (click, type, wait, etc.)
4. Configure parameters
5. Save action

**Expected Results**:
- Action added to state's action list
- Parameters validated
- Can reorder actions
- Preview available

#### 2.3.2 Image-Based Actions
**Priority**: High
**Steps**:
1. Select image-based action (click on image)
2. Upload or select image
3. Set matching confidence threshold
4. Configure click position

**Expected Results**:
- Image uploaded successfully
- Thumbnail preview shown
- Confidence slider works
- Position markers visible

#### 2.3.3 Keyboard Actions
**Priority**: High
**Steps**:
1. Add keyboard action
2. Enter text to type
3. Add special keys (Ctrl, Alt, etc.)
4. Test key combination builder

**Expected Results**:
- Text input captured
- Special keys properly formatted
- Key combinations valid
- Preview shows correct sequence

#### 2.3.4 Wait/Delay Actions
**Priority**: Medium
**Steps**:
1. Add wait action
2. Set delay in milliseconds
3. Choose wait type (fixed/random range)

**Expected Results**:
- Numeric validation works
- Range validation for random
- Units clearly displayed
- Cannot enter negative values

## 3. User Interface Tests

### 3.1 Responsive Design
**Priority**: High
**Steps**:
1. Test at various resolutions:
   - Desktop (1920x1080, 1366x768)
   - Tablet (768x1024)
   - Mobile (375x667)
2. Check all major components
3. Test touch interactions on tablet/mobile

**Expected Results**:
- Layout adapts properly
- No horizontal scrolling
- Touch targets adequate size
- Menus collapse appropriately

### 3.2 Dark Mode
**Priority**: Low
**Steps**:
1. Toggle dark mode setting
2. Check all pages/components
3. Verify contrast ratios

**Expected Results**:
- Smooth transition
- All text readable
- Images/icons visible
- Preference persisted

### 3.3 Error Handling
**Priority**: High
**Steps**:
1. Trigger various errors:
   - Network disconnection
   - Invalid input
   - Server errors
   - Permission denied
2. Observe error messages

**Expected Results**:
- User-friendly messages
- No technical details exposed
- Recovery actions suggested
- Errors logged properly

### 3.4 Loading States
**Priority**: Medium
**Steps**:
1. Perform actions with network throttling
2. Observe loading indicators
3. Test cancellation of long operations

**Expected Results**:
- Loading spinners/progress bars
- Disabled buttons during operations
- Can cancel when appropriate
- No double submissions

## 4. Integration Tests

### 4.1 API Communication
**Priority**: Critical
**Steps**:
1. Monitor network tab in dev tools
2. Perform CRUD operations
3. Check request/response format
4. Verify error handling

**Expected Results**:
- Proper HTTP methods used
- Auth headers included
- JSON properly formatted
- Status codes appropriate

### 4.2 WebSocket Connections
**Priority**: Medium
**Steps**:
1. Open multiple tabs with same project
2. Make changes in one tab
3. Check for updates in other tabs

**Expected Results**:
- Real-time updates work
- No connection drops
- Reconnection on disconnect
- Conflict resolution works

### 4.3 File Upload/Download
**Priority**: High
**Steps**:
1. Upload images for actions
2. Export project configuration
3. Import configuration file
4. Download logs/reports

**Expected Results**:
- File size limits enforced
- Progress indicators work
- Error handling for invalid files
- Downloads have correct names

## 5. Performance Tests

### 5.1 Load Testing
**Priority**: High
**Steps**:
1. Create project with 50+ states
2. Add 100+ transitions
3. Monitor performance metrics
4. Test with multiple browser tabs

**Expected Results**:
- Canvas remains responsive
- Save operations under 3 seconds
- Memory usage stable
- No browser freezing

### 5.2 Stress Testing
**Priority**: Medium
**Steps**:
1. Rapid creation/deletion of elements
2. Large file uploads (10MB+)
3. Extended usage (1+ hour)
4. Multiple concurrent users

**Expected Results**:
- No memory leaks
- Graceful degradation
- Error recovery works
- Data integrity maintained

## 6. Security Tests

### 6.1 Input Validation
**Priority**: Critical
**Steps**:
1. Test XSS payloads in text fields
2. SQL injection attempts
3. Path traversal in file uploads
4. Script injection in names

**Expected Results**:
- All input sanitized
- Errors for invalid input
- No code execution
- Safe error messages

### 6.2 Authorization
**Priority**: Critical
**Steps**:
1. Try accessing other users' projects
2. Modify requests to change IDs
3. Test permission boundaries

**Expected Results**:
- Access denied appropriately
- Cannot see others' data
- Cannot modify without permission
- Audit logs created

## 7. Browser Compatibility

### 7.1 Cross-Browser Testing
**Priority**: High
**Browsers to test**:
- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

**Steps**:
1. Complete basic workflow in each browser
2. Check for console errors
3. Verify visual consistency
4. Test browser-specific features

**Expected Results**:
- Consistent behavior
- No browser-specific bugs
- Appropriate fallbacks
- Performance acceptable

## 8. Accessibility Tests

### 8.1 Keyboard Navigation
**Priority**: Medium
**Steps**:
1. Navigate without mouse
2. Use Tab key through interface
3. Test keyboard shortcuts
4. Check focus indicators

**Expected Results**:
- All functions keyboard accessible
- Logical tab order
- Focus clearly visible
- Skip links available

### 8.2 Screen Reader Compatibility
**Priority**: Medium
**Steps**:
1. Test with NVDA/JAWS
2. Check ARIA labels
3. Verify form labels
4. Test error announcements

**Expected Results**:
- Content properly announced
- Interactive elements labeled
- State changes announced
- Errors clearly communicated

## Test Execution Checklist

### Pre-Deployment Testing
- [ ] All Critical priority tests passed
- [ ] High priority tests completed
- [ ] Security tests validated
  - [ ] CSRF token handling
  - [ ] Session timeout warnings
  - [ ] Automatic token refresh
  - [ ] Rate limit handling
- [ ] Error handling verified
  - [ ] Error boundary component
  - [ ] Offline indicator
  - [ ] Network error recovery
- [ ] Beta features tested
  - [ ] Beta banner
  - [ ] Onboarding tour
  - [ ] Beta indicators
- [ ] File upload features
  - [ ] Progress tracking
  - [ ] Error handling
- [ ] Security integration
  - [ ] Request timeouts
  - [ ] Retry logic
  - [ ] Concurrent requests
- [ ] Performance benchmarks met
- [ ] Cross-browser testing done
- [ ] Documentation updated

### Regression Testing
After any significant changes:
- [ ] Authentication flow
- [ ] Core CRUD operations
- [ ] State machine builder
- [ ] Action configuration
- [ ] Save/Load functionality
- [ ] Export/Import features

## 9. Newly Implemented Features Tests

### 9.1 Enhanced API Client Security

#### 9.1.1 CSRF Token Handling
**Priority**: High
**Steps**:
1. Open browser developer tools
2. Login to the application
3. Perform a state-changing operation (create/update/delete)
4. Check network requests for CSRF token

**Expected Results**:
- CSRF token present in X-CSRF-Token header
- Token retrieved from cookie or meta tag
- Requests without token for GET operations only

#### 9.1.2 Session Timeout Warning
**Priority**: Critical
**Steps**:
1. Login to the application
2. Wait for 12 minutes (do not interact)
3. Observe the session warning dialog
4. Click "Continue Working" button
5. Verify session extended

**Expected Results**:
- Warning appears at 12 minutes (3 minutes before expiry)
- Countdown timer shows remaining time
- "Continue Working" refreshes the token
- "Logout" ends session cleanly

#### 9.1.3 Automatic Token Refresh
**Priority**: Critical
**Steps**:
1. Login and note the time
2. Keep the application open for 14 minutes
3. At minute 14, perform an API action
4. Check network tab for refresh token call

**Expected Results**:
- Automatic refresh attempt before 15-minute expiry
- No duplicate refresh requests
- Seamless continuation of work
- Original request retried after refresh

#### 9.1.4 Rate Limit Handling
**Priority**: High
**Steps**:
1. Open network throttling to observe requests
2. Trigger multiple rapid API calls (>60 in a minute)
3. Observe rate limit response
4. Check retry behavior

**Expected Results**:
- 429 status code after limit exceeded
- Automatic retry with exponential backoff
- User-friendly error message
- Retry-After header respected

### 9.2 Error Handling Components

#### 9.2.1 Error Boundary
**Priority**: High
**Steps**:
1. Trigger a JavaScript error (can use console to throw error)
2. Observe error boundary UI
3. Click "Try Again" button
4. Click "Reload Page" button
5. Click "Go Home" button

**Expected Results**:
- Error caught without white screen
- User-friendly error message displayed
- Stack trace visible in development mode only
- Recovery options work correctly
- Error logged to console

#### 9.2.2 Offline Indicator
**Priority**: Medium
**Steps**:
1. Open the application
2. Disconnect from network (airplane mode or disable WiFi)
3. Observe offline indicator
4. Reconnect to network
5. Observe reconnection message

**Expected Results**:
- Red offline banner appears at bottom
- "No internet connection" message shown
- Pulsing animation on offline indicator
- Green "Back online" message on reconnection
- Indicator auto-hides after reconnection

#### 9.2.3 Network Error Recovery
**Priority**: High
**Steps**:
1. Start an API operation
2. Disconnect network mid-request
3. Observe error handling
4. Reconnect and retry operation

**Expected Results**:
- Timeout after 30 seconds
- Clear network error message
- No hanging requests
- Retry works after reconnection

### 9.3 Beta Features

#### 9.3.1 Beta Banner
**Priority**: Low
**Steps**:
1. Load application for first time
2. Observe beta banner at top
3. Click "Give Feedback" button
4. Click X to dismiss banner
5. Refresh page

**Expected Results**:
- Banner appears on first visit
- Gradient blue-purple styling
- Feedback button opens correct link
- Banner stays dismissed after refresh
- Dismissal preference saved in localStorage

#### 9.3.2 Onboarding Tour
**Priority**: Medium
**Steps**:
1. Clear localStorage (or use incognito)
2. Load application as new user
3. Wait 2 seconds for tour to start
4. Navigate through all 7 steps
5. Test Previous/Next buttons
6. Test Skip button
7. Complete the tour
8. Click "Start Tour" to replay

**Expected Results**:
- Tour auto-starts for new users
- Highlights correct elements
- Overlay darkens background
- Navigation buttons work
- Progress dots show current step
- Tour completion saved
- Can restart tour manually

#### 9.3.3 Beta Feature Indicators
**Priority**: Low
**Steps**:
1. Look for beta badges on new features
2. Check for beta feature alerts
3. Verify consistent styling

**Expected Results**:
- Beta badges with sparkle icon
- Blue gradient styling
- Consistent placement
- Clear beta feature messaging

### 9.4 File Upload Features

#### 9.4.1 Upload Progress Tracking
**Priority**: Medium
**Steps**:
1. Select a large file (>5MB) for upload
2. Start upload process
3. Observe progress indicator
4. Cancel upload mid-progress (if supported)

**Expected Results**:
- Progress percentage updates
- Visual progress bar
- Smooth updates without freezing
- Upload can be cancelled if needed

#### 9.4.2 Upload Error Handling
**Priority**: High
**Steps**:
1. Try uploading invalid file type
2. Try uploading oversized file
3. Disconnect network during upload
4. Upload with expired session

**Expected Results**:
- Clear error messages for each scenario
- No stuck uploads
- Proper cleanup on failure
- Session expiry triggers refresh

### 9.5 Security Feature Integration

#### 9.5.1 Request Timeout
**Priority**: Medium
**Steps**:
1. Trigger a long-running request
2. Wait for timeout (30 seconds)
3. Observe timeout handling

**Expected Results**:
- Request aborts after 30 seconds
- "Request timeout" error shown
- UI remains responsive
- Can retry after timeout

#### 9.5.2 Retry Logic
**Priority**: Medium
**Steps**:
1. Cause a 500 server error (stop backend temporarily)
2. Make an API request
3. Observe retry attempts
4. Restart backend during retries

**Expected Results**:
- 3 retry attempts maximum
- Exponential backoff (1s, 2s, 4s)
- Success if server recovers
- Final error after all retries fail

#### 9.5.3 Concurrent Request Handling
**Priority**: Medium
**Steps**:
1. Trigger multiple API calls simultaneously
2. Observe token refresh behavior
3. Check for race conditions

**Expected Results**:
- Single token refresh for multiple 401s
- No duplicate refresh requests
- All requests eventually succeed
- No token conflicts

## Issue Reporting

When reporting issues, include:
1. Steps to reproduce
2. Expected behavior
3. Actual behavior
4. Browser/OS information
5. Screenshots if applicable
6. Console errors
7. Network requests (if relevant)

## Sign-off Criteria

The application is ready for deployment when:
- All Critical tests pass
- 95% of High priority tests pass
- No security vulnerabilities found
- Performance meets requirements
- No data loss scenarios
- User experience is consistent

---

**Document Version**: 1.1
**Last Updated**: 2024-09-17 (Added tests for newly implemented security features, error handling, and beta features)
**Next Review**: Before each major release
