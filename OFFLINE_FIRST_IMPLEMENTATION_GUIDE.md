# Offline-First Architecture - Implementation Guide

## Overview

Qontinui now supports **offline-first architecture** for screenshot uploads and management. Users can upload screenshots, create patterns, and work productively even without an internet connection. All changes sync automatically when connectivity is restored.

---

## Architecture Components

### 1. **Sync Queue** (`frontend/src/lib/sync-queue.ts`)

IndexedDB-based queue that stores operations pending sync with the server.

**Features**:
- Persistent storage (survives page refresh)
- Priority-based processing
- Automatic retry with exponential backoff
- Status tracking (pending, syncing, completed, failed)
- Real-time statistics

**Usage**:
```typescript
import { syncQueue } from '@/lib/sync-queue';

// Add operation to queue
const item = await syncQueue.enqueue('upload_screenshot', {
  file: screenshotFile,
  projectId: 123,
  name: 'login-screenshot.png'
}, {
  priority: 10, // Higher = more important
  maxRetries: 3
});

// Get all pending items
const pending = await syncQueue.getAll({ status: 'pending' });

// Get queue statistics
const stats = await syncQueue.getStats();
// { total: 5, pending: 3, syncing: 1, completed: 10, failed: 1 }
```

### 2. **Sync Processor** (`frontend/src/lib/sync-processor.ts`)

Processes queue items and syncs with the server.

**Features**:
- Automatic processing on network restore
- Progress tracking
- Error handling
- Batch uploads

**Usage**:
```typescript
import { syncProcessor } from '@/lib/sync-processor';

// Process all pending items
const processed = await syncProcessor.processQueue();

// Track progress
syncProcessor.onProgress(itemId, (itemId, progress) => {
  console.log(`Upload ${Math.round(progress)}% complete`);
});
```

### 3. **Service Worker** (`frontend/public/sw.js`)

Background worker that syncs even when tab is closed.

**Features**:
- Background sync API
- Static asset caching
- Offline fallback page
- Automatic cleanup of old caches

**How it works**:
1. Browser triggers sync event when online
2. Service worker calls main thread to process queue
3. Syncs complete in background
4. User sees results on next page load

### 4. **Offline Screenshot Upload** (`frontend/src/lib/offline-screenshot-upload.ts`)

High-level API for offline-first screenshot uploads.

**Usage**:
```typescript
import { uploadScreenshotOffline } from '@/lib/offline-screenshot-upload';

// Upload immediately returns (works offline)
const result = await uploadScreenshotOffline(file, projectId, {
  name: 'screenshot.png',
  onProgress: (progress, status) => {
    console.log(`${status}: ${progress}%`);
  }
});

// Screenshot available immediately in IndexedDB
console.log('Local screenshot:', result.screenshot);

// Wait for server sync (resolves when uploaded)
const serverData = await result.whenSynced;
console.log('Server ID:', serverData.imageId);
console.log('S3 URL:', serverData.url);
```

### 5. **UI Components**

#### **OfflineIndicator** (`frontend/src/components/offline/OfflineIndicator.tsx`)

Shows connection status and sync queue summary.

**Features**:
- Shows "Offline" banner when disconnected
- Displays pending upload count
- "Sync Now" button
- Auto-hides when everything synced

#### **SyncQueueViewer** (`frontend/src/components/offline/SyncQueueViewer.tsx`)

Detailed view of all queue items.

**Features**:
- List of all uploads (pending, syncing, failed)
- Retry failed uploads
- Cancel pending uploads
- Real-time progress
- Error messages

---

## Integration Guide

### Step 1: Add UI Components to Layout

```typescript
// app/layout.tsx or app/dashboard/layout.tsx

import { OfflineIndicator } from '@/components/offline/OfflineIndicator';
import { SyncQueueViewer } from '@/components/offline/SyncQueueViewer';

export default function Layout({ children }: { children: React.Node }) {
  return (
    <html>
      <body>
        {children}

        {/* Offline indicator (bottom-right) */}
        <OfflineIndicator />

        {/* Sync queue viewer (bottom-right, above indicator) */}
        <SyncQueueViewer />
      </body>
    </html>
  );
}
```

### Step 2: Update Screenshot Upload Component

```typescript
// components/state-discovery/ScreenshotUploader.tsx

import { uploadScreenshotOffline, uploadScreenshotsOffline } from '@/lib/offline-screenshot-upload';

export function ScreenshotUploader() {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleUpload = async (files: File[]) => {
    setUploading(true);

    try {
      // Upload with offline support (returns immediately)
      const results = await uploadScreenshotsOffline(files, projectId, {
        onProgress: (progress, status) => {
          setProgress(progress);
          console.log(`${status}: ${progress}%`);
        }
      });

      // Screenshots available immediately in UI
      for (const result of results) {
        console.log('Screenshot ready:', result.screenshot);
        // Update UI immediately with local screenshot
        addScreenshotToUI(result.screenshot);
      }

      // Optional: wait for all to sync
      await Promise.all(results.map(r => r.whenSynced));

      toast.success('All screenshots uploaded!');
    } catch (error) {
      toast.error('Upload failed: ' + error.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <input
        type="file"
        multiple
        accept="image/*"
        onChange={(e) => handleUpload(Array.from(e.target.files || []))}
      />

      {uploading && (
        <div className="progress-bar">
          <div style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}
```

### Step 3: Service Worker Registration

Service worker auto-registers on page load via `frontend/src/lib/service-worker.ts`.

To manually control registration:

```typescript
import { serviceWorkerManager } from '@/lib/service-worker';

// Check support
if (serviceWorkerManager.isSupported()) {
  // Register service worker
  await serviceWorkerManager.register();

  // Request background sync
  await serviceWorkerManager.requestBackgroundSync();

  // Check status
  const status = serviceWorkerManager.getStatus();
  console.log('Service worker status:', status);
}
```

### Step 4: Handle Offline State in UI

```typescript
import { useState, useEffect } from 'react';

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

// Usage in component
export function ScreenshotManager() {
  const isOnline = useOnlineStatus();

  return (
    <div>
      {!isOnline && (
        <div className="offline-banner">
          Offline - Changes will sync when online
        </div>
      )}
    </div>
  );
}
```

---

## Testing Offline Functionality

### 1. Chrome DevTools Method

1. Open Chrome DevTools (F12)
2. Go to Network tab
3. Select "Offline" from throttling dropdown
4. Try uploading screenshots
5. Verify they appear in UI immediately
6. Go back online
7. Watch uploads sync automatically

### 2. Airplane Mode Method

1. Enable airplane mode on your device
2. Upload screenshots in the app
3. Verify screenshots stored locally
4. Disable airplane mode
5. Watch background sync process queue

### 3. Sync Queue Viewer Method

1. Open Sync Queue Viewer (bottom-right corner)
2. Upload screenshots while online
3. Watch items move from "Pending" → "Syncing" → "Completed"
4. Try again while offline
5. Verify items stay in "Pending" state
6. Go online and watch automatic sync

---

## Advanced Features

### Custom Retry Logic

```typescript
import { syncQueue } from '@/lib/sync-queue';

// Create item with custom retry settings
await syncQueue.enqueue('upload_screenshot', data, {
  maxRetries: 5,  // Try 5 times before giving up
  priority: 100,  // High priority (process first)
});

// Manually retry failed item
const item = await syncQueue.get(itemId);
await syncQueue.update({
  ...item,
  status: 'pending',
  retryCount: 0,
  lastError: undefined,
});
```

### Progress Tracking

```typescript
import { syncProcessor } from '@/lib/sync-processor';

// Track progress for specific item
syncProcessor.onProgress(itemId, (itemId, progress) => {
  updateProgressBar(progress);

  if (progress === 100) {
    showSuccessMessage();
  }
});

// Cleanup when done
syncProcessor.offProgress(itemId);
```

### Conflict Resolution

```typescript
// When uploading screenshots with same name
await syncQueue.enqueue('upload_screenshot', data, {
  conflictResolution: 'server_wins', // Server version wins
  // or 'client_wins' - Keep local version
  // or 'merge' - Merge both (not yet implemented)
});
```

### Periodic Cleanup

```typescript
import { syncQueue } from '@/lib/sync-queue';

// Run cleanup daily
setInterval(async () => {
  // Clear completed items older than 7 days
  const completed = await syncQueue.getAll({ status: 'completed' });

  const sevenDaysAgo = Date.now() - 7 * 86400000;

  for (const item of completed) {
    if (new Date(item.syncedAt).getTime() < sevenDaysAgo) {
      await syncQueue.remove(item.id);
    }
  }
}, 86400000); // 24 hours
```

---

## Troubleshooting

### Problem: Service Worker Not Registering

**Solution**:
- Service workers only work on HTTPS (or localhost)
- Check browser console for errors
- Verify `/sw.js` is accessible
- Clear browser cache and try again

```typescript
// Check registration status
serviceWorkerManager.onStatusChange((status) => {
  if (status === 'error') {
    console.error('Service worker registration failed');
  }
});
```

### Problem: Uploads Not Syncing

**Symptoms**: Items stuck in "pending" state

**Solutions**:
1. **Check online status**:
   ```typescript
   console.log('Online:', navigator.onLine);
   ```

2. **Manually trigger sync**:
   ```typescript
   await syncProcessor.processQueue();
   ```

3. **Check for errors**:
   ```typescript
   const failed = await syncQueue.getAll({ status: 'failed' });
   console.log('Failed items:', failed);
   ```

4. **Retry failed items**:
   ```typescript
   for (const item of failed) {
     await retryScreenshotUpload(item.id);
   }
   ```

### Problem: IndexedDB Quota Exceeded

**Symptoms**: "QuotaExceededError" in console

**Solutions**:
1. **Clear completed items**:
   ```typescript
   await syncQueue.clearCompleted();
   ```

2. **Cleanup IndexedDB**:
   ```typescript
   import { screenshotDB } from '@/lib/screenshot-db';
   await screenshotDB.cleanupExpired();
   ```

3. **Check storage usage**:
   ```typescript
   if ('storage' in navigator && 'estimate' in navigator.storage) {
     const estimate = await navigator.storage.estimate();
     console.log(`Using ${estimate.usage} of ${estimate.quota} bytes`);
   }
   ```

### Problem: Duplicate Uploads

**Symptoms**: Same screenshot uploaded multiple times

**Cause**: Queue item processed multiple times

**Solution**: Queue items are automatically marked as "syncing" during processing, preventing duplicates. If you see duplicates:

1. Check sync processor isn't being called multiple times
2. Verify queue items are properly marked as completed
3. Clear duplicate queue items:
   ```typescript
   const all = await syncQueue.getAll();
   // Remove duplicates based on metadata
   ```

---

## Performance Considerations

### Browser Storage Limits

Different browsers have different limits:

- **Chrome/Edge**: ~60% of available disk space
- **Firefox**: ~50% of available disk space
- **Safari**: ~1GB (may prompt user)

**Best Practices**:
1. Use cleanup strategies to limit storage
2. Monitor quota usage
3. Warn users when approaching limit
4. Compress images before storing

### Battery Impact

Background sync uses battery. Minimize impact by:

1. **Batch uploads** instead of one-by-one:
   ```typescript
   uploadScreenshotsOffline(files, projectId); // Better
   // vs
   files.forEach(f => uploadScreenshotOffline(f, projectId)); // Worse
   ```

2. **Defer non-critical syncs**:
   ```typescript
   await syncQueue.enqueue('upload_screenshot', data, {
     priority: -10, // Low priority (sync later)
   });
   ```

3. **Use exponential backoff** for retries (already implemented)

### Network Usage

Minimize data usage by:

1. **Compress images** before upload
2. **Use progressive JPEG** for photos
3. **Resize large screenshots** client-side
4. **Batch small uploads** together

---

## Migration Guide

### From Online-Only to Offline-First

**Step 1**: Replace direct API calls

```typescript
// Before (online-only)
const result = await apiClient.uploadProjectImage(projectId, file);

// After (offline-first)
const result = await uploadScreenshotOffline(file, projectId);
```

**Step 2**: Handle immediate vs. eventual results

```typescript
// Before
const { imageId, url } = await apiClient.uploadProjectImage(projectId, file);
useScreenshot(imageId, url);

// After
const result = await uploadScreenshotOffline(file, projectId);

// Use immediately (local data)
useScreenshot(result.screenshot.id, result.screenshot.url);

// Optional: update when synced
result.whenSynced.then(({ imageId, url }) => {
  updateScreenshot(imageId, url);
});
```

**Step 3**: Add UI feedback

```typescript
import { OfflineIndicator } from '@/components/offline/OfflineIndicator';

// Add to layout
<OfflineIndicator />
```

**Step 4**: Test offline scenarios

1. Test upload while offline
2. Test sync when coming online
3. Test failed upload retry
4. Test background sync

---

## Future Enhancements

### Planned Features

1. **Conflict Resolution UI**
   - Show merge dialog when conflicts detected
   - Allow user to choose version

2. **Sync Prioritization**
   - User-adjustable priority
   - Critical vs. non-critical operations

3. **Bandwidth Optimization**
   - Compress images before upload
   - Delta sync (only upload changes)

4. **Advanced Caching**
   - Intelligent prefetching
   - Predictive caching based on usage

5. **Multi-Device Sync**
   - Cross-device conflict resolution
   - Sync state across devices

6. **Progress Persistence**
   - Resume interrupted uploads
   - Chunked upload support

---

## Summary

The offline-first architecture provides:

✅ **Instant feedback** - No waiting for uploads
✅ **Works offline** - Full functionality without internet
✅ **Automatic sync** - Background sync when online
✅ **Reliability** - Automatic retry with exponential backoff
✅ **Transparency** - UI shows sync status
✅ **Performance** - Non-blocking uploads

Users can now work productively regardless of network conditions!
