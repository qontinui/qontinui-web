# Offline-First Integration Plan

## 📋 Complete Checklist

This document provides step-by-step integration instructions for the offline-first architecture.

---

## Phase 1: Add UI Components to Layout ✅ (5 minutes)

### Step 1.1: Update App Layout

**File**: `frontend/src/app/(app)/layout.tsx`

**Current status**: Already has an `<OfflineIndicator />` at line 28, but it's likely a different component.

**Action**: Add the new offline-first components.

```typescript
// frontend/src/app/(app)/layout.tsx

import { OfflineIndicator } from "@/components/offline/OfflineIndicator";  // NEW
import { SyncQueueViewer } from "@/components/offline/SyncQueueViewer";    // NEW

function AppLayoutContent({ children }: { children: React.ReactNode }) {
  const { isCollapsed } = useSidebar()

  return (
    <div className="flex min-h-screen bg-background">
      <UnifiedSidebar />
      <main className={cn(
        "flex-1 transition-all duration-300",
        isCollapsed ? "ml-16" : "ml-64"
      )}>
        {children}
      </main>

      {/* Existing offline indicator - may want to replace or keep both */}
      <OfflineIndicator />  {/* OLD - line 28 */}

      {/* NEW: Offline-first components */}
      <OfflineIndicator />      {/* Shows connection status */}
      <SyncQueueViewer />       {/* Shows sync queue details */}

      <OnboardingTour />
      <SessionTimeoutWarning />
    </div>
  )
}
```

**Note**: Check if the existing `<OfflineIndicator />` (line 28) is the same component or different. If different, you can:
- Option A: Replace it with the new one
- Option B: Rename the new one to `<OfflineSyncIndicator />`
- Option C: Keep both (old shows connection, new shows sync)

**Decision needed**: Which option do you prefer?

---

## Phase 2: Update Screenshot Upload Components (30 minutes)

### Components to Update:

1. ✅ **ScreenshotUploadTab.tsx** - Main upload tab
2. ✅ **ScreenshotUploader.tsx** - State discovery uploader
3. ✅ **EnhancedImageLibrary.tsx** - Image library uploads
4. ✅ **images-manager.tsx** - Image manager component

### Step 2.1: Update ScreenshotUploadTab

**File**: `frontend/src/components/ScreenshotTab/ScreenshotUploadTab.tsx`

**Current code** (likely):
```typescript
import { apiClient } from '@/lib/api-client';

const handleUpload = async (file: File) => {
  setUploading(true);
  try {
    const result = await apiClient.uploadProjectImage(projectId, file, (progress) => {
      setProgress(progress);
    });
    // Update UI with result
  } catch (error) {
    toast.error('Upload failed');
  } finally {
    setUploading(false);
  }
};
```

**New code** (offline-first):
```typescript
import { uploadScreenshotOffline } from '@/lib/offline-screenshot-upload';

const handleUpload = async (file: File) => {
  setUploading(true);
  try {
    // Upload immediately returns (works offline)
    const result = await uploadScreenshotOffline(file, projectId, {
      name: file.name,
      onProgress: (progress, status) => {
        setProgress(progress);
        setStatus(status); // "Queued", "Uploading", "Uploaded"
      }
    });

    // Screenshot available immediately in UI
    addScreenshotToUI(result.screenshot);
    setUploading(false);

    // Optional: wait for server sync
    result.whenSynced
      .then(({ imageId, url, s3Key }) => {
        // Update UI with server data
        updateScreenshotInUI(result.screenshot.id, { imageId, url, s3Key });
        toast.success('Screenshot uploaded!');
      })
      .catch((error) => {
        // Sync failed, but screenshot is still in queue for retry
        console.error('Sync failed:', error);
        toast.warning('Screenshot saved locally, will sync when online');
      });

  } catch (error) {
    toast.error('Failed to save screenshot: ' + error.message);
    setUploading(false);
  }
};
```

**Key changes**:
1. Import `uploadScreenshotOffline` instead of `apiClient`
2. Screenshot available immediately (don't wait for sync)
3. Update UI twice: once with local data, once with server data
4. Handle sync errors gracefully (screenshot still in queue)

### Step 2.2: Update State Discovery ScreenshotUploader

**File**: `frontend/src/components/state-discovery/ScreenshotUploader.tsx`

**Similar changes** to ScreenshotUploadTab, but for state discovery workflow.

**Example for batch uploads**:
```typescript
import { uploadScreenshotsOffline } from '@/lib/offline-screenshot-upload';

const handleBulkUpload = async (files: File[]) => {
  setUploading(true);

  try {
    // Upload all files (works offline)
    const results = await uploadScreenshotsOffline(files, projectId, {
      onProgress: (progress, status) => {
        setProgress(progress);
        setStatus(`${status} (${Math.round(progress)}%)`);
      }
    });

    // All screenshots available immediately
    for (const result of results) {
      addScreenshotToUI(result.screenshot);
    }

    setUploading(false);
    toast.success(`${files.length} screenshots uploaded!`);

    // Optional: wait for all to sync
    Promise.all(results.map(r => r.whenSynced))
      .then(() => {
        console.log('All screenshots synced');
      })
      .catch((error) => {
        console.error('Some syncs failed:', error);
      });

  } catch (error) {
    toast.error('Bulk upload failed: ' + error.message);
    setUploading(false);
  }
};
```

### Step 2.3: Update EnhancedImageLibrary

**File**: `frontend/src/components/image-library/EnhancedImageLibrary.tsx`

**Find and replace**:
```typescript
// Before
await apiClient.uploadProjectImage(projectId, file, onProgress)

// After
await uploadScreenshotOffline(file, projectId, { onProgress })
```

### Step 2.4: Update images-manager

**File**: `frontend/src/components/images-manager.tsx`

**Same pattern** as above.

---

## Phase 3: Initialize Service Worker (5 minutes)

### Step 3.1: Add Service Worker Registration to App Entry

The service worker auto-registers on page load via the import in `frontend/src/lib/service-worker.ts`.

**Verify it's working**:

```typescript
// Add to a root component or app initialization
import { serviceWorkerManager } from '@/lib/service-worker';

useEffect(() => {
  // Check service worker status
  serviceWorkerManager.onStatusChange((status) => {
    console.log('[App] Service worker status:', status);
  });
}, []);
```

### Step 3.2: Add Cleanup on App Initialization

**File**: Create `frontend/src/app/providers.tsx` or add to existing provider

```typescript
'use client';

import { useEffect } from 'react';
import { syncQueue } from '@/lib/sync-queue';
import { screenshotDB } from '@/lib/screenshot-db';
import { syncProcessor } from '@/lib/sync-processor';

export function AppInitializer({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Run cleanup on app start
    const initializeApp = async () => {
      console.log('[App] Initializing offline-first features...');

      // 1. Cleanup expired screenshots from IndexedDB
      const deletedScreenshots = await screenshotDB.cleanupExpired();
      console.log(`[App] Cleaned up ${deletedScreenshots} expired screenshots`);

      // 2. Cleanup old completed sync items
      const deletedSyncItems = await syncQueue.clearCompleted();
      console.log(`[App] Cleaned up ${deletedSyncItems} completed sync items`);

      // 3. Process any pending items from last session
      if (navigator.onLine) {
        const processed = await syncProcessor.processQueue();
        console.log(`[App] Processed ${processed} pending items`);
      }

      console.log('[App] Initialization complete');
    };

    initializeApp().catch(console.error);

    // Schedule daily cleanup
    const cleanupInterval = setInterval(async () => {
      await screenshotDB.cleanupExpired();
      await syncQueue.clearCompleted();
    }, 86400000); // 24 hours

    return () => {
      clearInterval(cleanupInterval);
    };
  }, []);

  return <>{children}</>;
}
```

**Then wrap your app**:
```typescript
// frontend/src/app/(app)/layout.tsx
import { AppInitializer } from './providers';

export default function AppLayout({ children }) {
  return (
    <AuthProvider>
      <OrganizationProvider>
        <AppInitializer>
          {/* ... existing content ... */}
        </AppInitializer>
      </OrganizationProvider>
    </AuthProvider>
  );
}
```

---

## Phase 4: Testing (30 minutes)

### Step 4.1: Local Testing

1. **Start development server**:
   ```bash
   cd frontend
   npm run dev
   ```

2. **Open browser**: http://localhost:3000

3. **Open DevTools**: F12 → Console

4. **Verify service worker**:
   - Go to Application tab → Service Workers
   - Should see `/sw.js` registered
   - Status should be "activated and running"

5. **Test online upload**:
   - Upload a screenshot
   - Should appear immediately
   - Check console for sync messages
   - Should complete within seconds

6. **Test offline upload**:
   - DevTools → Network → Select "Offline"
   - Upload a screenshot
   - Should appear immediately with "Offline" banner
   - Open SyncQueueViewer → should show pending item
   - Go back online
   - Watch item sync automatically

7. **Test sync queue viewer**:
   - Click "Sync Queue" button (bottom-right)
   - Should show all queue items
   - Try retry/cancel buttons
   - Verify statistics update

### Step 4.2: Error Testing

1. **Test upload failure**:
   - Go to DevTools → Network → Add throttling (Slow 3G)
   - Upload large file
   - Should queue and retry

2. **Test retry logic**:
   - Kill backend server
   - Upload screenshot → should fail
   - Start backend server
   - Wait for automatic retry → should succeed

3. **Test quota exceeded**:
   - Upload many large screenshots
   - Should show error when quota exceeded
   - Cleanup should free space

### Step 4.3: Performance Testing

1. **Bulk upload**:
   - Upload 20+ screenshots at once
   - Should not block UI
   - Progress should update smoothly

2. **Background sync**:
   - Upload while offline
   - Close browser tab
   - Reopen after going online
   - Syncs should complete

---

## Phase 5: Production Deployment (varies)

### Step 5.1: Build for Production

```bash
cd frontend
npm run build
```

**Verify**:
- No TypeScript errors
- Service worker file generated at `public/sw.js`
- Offline page generated at `public/offline.html`

### Step 5.2: Deploy to Staging

1. Deploy to staging environment
2. Test HTTPS (service workers require HTTPS)
3. Verify service worker registers
4. Test offline functionality
5. Monitor sync queue

### Step 5.3: Monitor After Deployment

**Key metrics to watch**:
```typescript
// Add to your analytics
import { syncQueue } from '@/lib/sync-queue';

// Track sync success rate
syncQueue.subscribe(async (stats) => {
  analytics.track('sync_queue_stats', {
    total: stats.total,
    pending: stats.pending,
    failed: stats.failed,
    success_rate: (stats.completed / stats.total) * 100
  });
});
```

**Monitor**:
- Sync queue size (should stay small)
- Failed upload rate (should be <2%)
- Average sync time (should be <30 seconds)
- User complaints about uploads

### Step 5.4: Rollback Plan

If issues arise:

1. **Disable service worker**:
   ```typescript
   // In service-worker.ts, comment out registration
   // serviceWorkerManager.register();
   ```

2. **Revert upload code**:
   ```typescript
   // Switch back to apiClient.uploadProjectImage()
   ```

3. **Clear user data** (if needed):
   ```typescript
   // Add to admin panel
   await syncQueue.clearAll();
   await screenshotDB.clear();
   ```

---

## Common Issues & Solutions

### Issue 1: Service Worker Not Registering

**Symptoms**: Console error "Failed to register service worker"

**Causes**:
- Not using HTTPS (except localhost)
- Service worker file not found
- Browser doesn't support service workers

**Solutions**:
1. Check HTTPS is enabled in production
2. Verify `/sw.js` is accessible (try navigating to it)
3. Check browser console for specific errors
4. Test in supported browser (Chrome, Firefox, Edge)

### Issue 2: Uploads Not Syncing

**Symptoms**: Items stuck in "pending" forever

**Debug**:
```typescript
// In browser console
import { syncQueue, syncProcessor } from '@/lib/sync-queue';

// Check queue
const pending = await syncQueue.getAll({ status: 'pending' });
console.log('Pending:', pending);

// Manually trigger sync
await syncProcessor.processQueue();

// Check for errors
const failed = await syncQueue.getAll({ status: 'failed' });
console.log('Failed:', failed);
```

**Solutions**:
1. Verify you're online: `console.log(navigator.onLine)`
2. Check backend is running and accessible
3. Look for CORS errors in console
4. Verify API endpoints are correct

### Issue 3: Duplicate Uploads

**Symptoms**: Same screenshot uploaded multiple times

**Cause**: Queue item processed multiple times

**Solution**:
```typescript
// The queue automatically prevents this, but if you see it:
const all = await syncQueue.getAll();
const duplicates = all.filter((item, index, self) =>
  self.findIndex(i => i.metadata.screenshotId === item.metadata.screenshotId) !== index
);

// Remove duplicates
for (const dup of duplicates) {
  await syncQueue.remove(dup.id);
}
```

### Issue 4: IndexedDB Quota Exceeded

**Symptoms**: "QuotaExceededError" in console

**Solutions**:
```typescript
// 1. Check quota
const estimate = await navigator.storage.estimate();
console.log(`Using ${estimate.usage} of ${estimate.quota} bytes`);

// 2. Run cleanup
await syncQueue.clearCompleted();
await screenshotDB.cleanupExpired();

// 3. Request persistent storage (optional)
const persisted = await navigator.storage.persist();
console.log('Persistent storage:', persisted);
```

---

## Integration Timeline

### Minimal Integration (1 hour)
- ✅ Add UI components to layout (5 min)
- ✅ Update one upload component (30 min)
- ✅ Test basic functionality (25 min)

### Full Integration (4 hours)
- ✅ Add UI components (5 min)
- ✅ Update all upload components (2 hours)
- ✅ Add app initialization (30 min)
- ✅ Full testing (1 hour)
- ✅ Documentation review (30 min)

### Production Ready (8 hours)
- ✅ Full integration (4 hours)
- ✅ Comprehensive testing (2 hours)
- ✅ Performance testing (1 hour)
- ✅ Deploy to staging (1 hour)

---

## Quick Start (Do This First)

**5-Minute Quick Start**:

1. Add to layout:
   ```typescript
   // frontend/src/app/(app)/layout.tsx
   import { OfflineIndicator } from "@/components/offline/OfflineIndicator";
   import { SyncQueueViewer } from "@/components/offline/SyncQueueViewer";

   // Add before closing </div>
   <OfflineIndicator />
   <SyncQueueViewer />
   ```

2. Test it works:
   ```bash
   npm run dev
   # Open http://localhost:3000
   # Go to DevTools → Network → Offline
   # Should see "Offline" indicator
   ```

3. Update ONE component:
   ```typescript
   // Pick ScreenshotUploadTab.tsx
   import { uploadScreenshotOffline } from '@/lib/offline-screenshot-upload';

   // Replace apiClient.uploadProjectImage with uploadScreenshotOffline
   ```

4. Test offline upload:
   - Go offline
   - Upload screenshot
   - Should work!

That's it! You now have basic offline-first working. Then gradually update other components.

---

## Summary

**What's ready**:
- ✅ All offline-first code written (10 files, ~3,141 lines)
- ✅ Comprehensive documentation
- ✅ UI components ready
- ✅ Service worker ready

**What needs integration**:
- 🔄 Add UI components to layout
- 🔄 Update 4 upload components
- 🔄 Add app initialization
- 🔄 Test and deploy

**Estimated time**: 4-8 hours for full integration

**Priority**:
1. **High**: Update ScreenshotUploadTab (main upload)
2. **High**: Add UI components to layout
3. **Medium**: Update other upload components
4. **Low**: Add advanced monitoring

Start with the 5-minute quick start, verify it works, then gradually update the rest!
