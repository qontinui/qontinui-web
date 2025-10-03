# Phase 1 Testing Guide

## Overview
This guide walks through testing all Phase 1 features: User profiles, email verification, storage tracking, usage metrics, and analytics.

## Prerequisites

### 1. Database Migration ✅
Already completed - Alembic is at head (8720b6a82cc1)

### 2. Backend Running
```bash
cd /home/jspinak/qontinui_parent_directory/qontinui-web/backend
source venv/bin/activate
python run.py
# or
uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
```

### 3. Frontend Running
```bash
cd /home/jspinak/qontinui_parent_directory/qontinui-web/frontend
npm run dev
```

### 4. Email Testing (Optional - for email verification)

**Option A: MailHog (Recommended for local testing)**
```bash
# Install MailHog
# macOS: brew install mailhog
# Linux: Download from https://github.com/mailhog/MailHog/releases
# Windows: Download exe from releases

# Run MailHog
mailhog

# Configure backend/.env
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_TLS=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM_EMAIL=noreply@qontinui.com

# View emails at: http://localhost:8025
```

**Option B: Skip Email (Test without verification)**
Just skip email verification tests and manually mark users as verified in the database if needed.

---

## Test Plan

### Test 1: User Registration & Email Verification

#### 1.1 Register New User
```bash
curl -X POST http://localhost:8001/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "testuser@example.com",
    "username": "testuser",
    "password": "SecurePass123!",
    "full_name": "Test User"
  }'
```

**Expected:**
- User created with `email_verified: false`
- Verification email sent (check MailHog at http://localhost:8025 if configured)
- Response includes user data

#### 1.2 Check Email (if MailHog configured)
- Open http://localhost:8025
- Should see verification email
- Click verification link or extract token

#### 1.3 Verify Email
```bash
# Extract token from email and use it here
curl -X POST http://localhost:8001/api/v1/auth/verify-email \
  -H "Content-Type: application/json" \
  -d '{"token": "YOUR_TOKEN_HERE"}'
```

**Expected:**
- `email_verified` set to True
- Success message returned

#### 1.4 Resend Verification
```bash
curl -X POST http://localhost:8001/api/v1/auth/send-verification \
  -H "Content-Type: application/json" \
  -d '{"email": "testuser@example.com"}'
```

**Expected:**
- New verification email sent
- Works even if already verified

---

### Test 2: User Profile Management

#### 2.1 Login
```bash
curl -X POST http://localhost:8001/api/v1/auth/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=testuser&password=SecurePass123!"
```

**Save the access_token from response**

```bash
TOKEN="paste_your_access_token_here"
```

#### 2.2 Get User Profile
```bash
curl -X GET http://localhost:8001/api/v1/users/me/profile \
  -H "Authorization: Bearer $TOKEN"
```

**Expected:**
- Full user profile returned
- Shows: id, email, username, full_name, company, phone, avatar_url, email_verified, subscription_tier

#### 2.3 Update Profile
```bash
curl -X PUT http://localhost:8001/api/v1/users/me/profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "Updated Name",
    "company": "Acme Corp",
    "phone": "+1-555-0123"
  }'
```

**Expected:**
- Profile updated successfully
- Audit log created for the update

#### 2.4 Upload Avatar
```bash
# Create a test image first
convert -size 400x400 xc:blue test_avatar.jpg
# or use any existing image

curl -X POST http://localhost:8001/api/v1/users/me/avatar \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@test_avatar.jpg"
```

**Expected:**
- Avatar uploaded and resized to 200x200
- Storage tracked in storage_usage table
- avatar_url returned
- Can view avatar at: http://localhost:8001/uploads/avatars/{filename}

#### 2.5 Delete Avatar
```bash
curl -X DELETE http://localhost:8001/api/v1/users/me/avatar \
  -H "Authorization: Bearer $TOKEN"
```

**Expected:**
- Avatar deleted
- Storage freed in storage_usage table
- avatar_url set to null

#### 2.6 Get Activity Log
```bash
curl -X GET "http://localhost:8001/api/v1/users/me/activity?skip=0&limit=10" \
  -H "Authorization: Bearer $TOKEN"
```

**Expected:**
- Recent activity returned
- Shows profile updates, avatar uploads, etc.

---

### Test 3: Storage Tracking & Quotas

#### 3.1 Check Storage Usage
```bash
curl -X GET http://localhost:8001/api/v1/users/me/storage \
  -H "Authorization: Bearer $TOKEN"
```

**Expected:**
```json
{
  "used_bytes": 12345,
  "quota_bytes": 104857600,
  "percentage_used": 0.01,
  "files_count": 1
}
```

#### 3.2 Test Quota Enforcement
```bash
# Try to upload a file > 100MB (for free tier)
# Create large test file:
dd if=/dev/zero of=large_file.jpg bs=1M count=101

curl -X POST http://localhost:8001/api/v1/users/me/avatar \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@large_file.jpg"
```

**Expected:**
- 413 error: "Storage quota exceeded"
- Upload blocked before processing

#### 3.3 Verify Storage in Database
```bash
sqlite3 /home/jspinak/qontinui_parent_directory/qontinui-web/backend/qontinui.db

SELECT * FROM storage_usage WHERE user_id = (SELECT id FROM users WHERE username='testuser');
```

**Expected:**
- Shows file records with sizes, paths, types

---

### Test 4: Usage Metrics & Analytics

#### 4.1 Get Usage Summary
```bash
curl -X GET http://localhost:8001/api/v1/analytics/usage \
  -H "Authorization: Bearer $TOKEN"
```

**Expected:**
```json
{
  "api_calls_today": 10,
  "projects_count": 0,
  "storage_used": 12345,
  "last_active": "2025-10-01T20:00:00Z"
}
```

#### 4.2 Get Detailed Metrics
```bash
curl -X GET "http://localhost:8001/api/v1/analytics/metrics?days=7" \
  -H "Authorization: Bearer $TOKEN"
```

**Expected:**
- List of metrics with timestamps
- Shows API calls tracked by middleware

#### 4.3 Get Analytics Summary
```bash
curl -X GET "http://localhost:8001/api/v1/analytics/summary?days=30" \
  -H "Authorization: Bearer $TOKEN"
```

**Expected:**
```json
{
  "api_calls": 15,
  "projects_created": 0,
  "states_created": 0,
  "images_uploaded": 1,
  "total_storage_bytes": 12345,
  "average_response_time_ms": 50.5,
  "last_active": "2025-10-01T20:00:00Z"
}
```

#### 4.4 Verify Metrics in Database
```bash
sqlite3 /home/jspinak/qontinui_parent_directory/qontinui-web/backend/qontinui.db

SELECT * FROM usage_metrics WHERE user_id = (SELECT id FROM users WHERE username='testuser');
```

**Expected:**
- Multiple api_call records (one per API request)
- Includes endpoint, response time, status code in metadata

---

### Test 5: Audit Logs

#### 5.1 Check Audit Logs
```bash
sqlite3 /home/jspinak/qontinui_parent_directory/qontinui-web/backend/qontinui.db

SELECT action, resource_type, created_at FROM audit_logs
WHERE user_id = (SELECT id FROM users WHERE username='testuser')
ORDER BY created_at DESC
LIMIT 10;
```

**Expected:**
- login events
- profile_updated events
- avatar_uploaded events
- Each with timestamp and metadata

---

### Test 6: Frontend Profile Page

#### 6.1 Login via Frontend
- Open http://localhost:3001
- Login with: testuser / SecurePass123!

#### 6.2 Access Profile Page
- Click user icon in dashboard header
- Should navigate to /profile

#### 6.3 Test Profile Form
- Edit name, company, phone
- Click Save
- Verify changes persist

#### 6.4 Test Avatar Upload
- Drag and drop an image, or click to browse
- Should see preview
- Upload completes
- Avatar appears in profile

#### 6.5 Test Storage Card
- Should show storage usage
- Progress bar fills based on usage
- Shows percentage

#### 6.6 Test Activity Feed
- Should show recent actions
- Includes timestamps
- Color-coded by action type

---

## Verification Checklist

### Database Schema ✅
- [ ] users table has new fields (company, phone, avatar_url, email_verified, subscription_tier)
- [ ] usage_metrics table exists
- [ ] storage_usage table exists
- [ ] audit_logs table exists

### Backend Endpoints ✅
- [ ] POST /api/v1/auth/register (with email verification)
- [ ] POST /api/v1/auth/send-verification
- [ ] POST /api/v1/auth/verify-email
- [ ] GET /api/v1/users/me/profile
- [ ] PUT /api/v1/users/me/profile
- [ ] POST /api/v1/users/me/avatar
- [ ] DELETE /api/v1/users/me/avatar
- [ ] GET /api/v1/users/me/activity
- [ ] GET /api/v1/users/me/storage
- [ ] GET /api/v1/analytics/usage
- [ ] GET /api/v1/analytics/metrics
- [ ] GET /api/v1/analytics/summary

### Features Working ✅
- [ ] Email verification tokens generated and validated
- [ ] Profile updates save correctly
- [ ] Avatar upload with resize and validation
- [ ] Storage tracking on file upload
- [ ] Storage quota enforcement
- [ ] Metrics middleware tracking all API calls
- [ ] Audit logs created for important actions
- [ ] Analytics endpoints return correct data

### Frontend ✅
- [ ] Profile page accessible from dashboard
- [ ] Profile form edits and saves
- [ ] Avatar upload with drag-drop
- [ ] Storage usage card displays correctly
- [ ] Activity feed shows recent actions
- [ ] Navigation works between pages

---

## Common Issues & Solutions

### Email Not Sending
- Check SMTP configuration in .env
- Verify MailHog is running on port 1025
- Check backend logs for email errors
- Email service fails gracefully - registration still works

### Avatar Upload Fails
- Check uploads/avatars directory exists
- Verify file permissions
- Check file size < 2MB
- Ensure image format is jpg/png/webp

### Metrics Not Appearing
- Metrics middleware batches writes (up to 10 or 30 seconds)
- Force flush by restarting backend
- Check database for usage_metrics entries

### Storage Quota Not Enforced
- Check user subscription_tier field
- Verify storage_usage table has entries
- Ensure StorageService is being called

---

## Next Steps After Testing

Once all tests pass:
1. Mark all testing todos as complete
2. Document any bugs found
3. Proceed to Phase 2: Subscription & Billing (Stripe integration)

---

## Quick Test Script

Here's a bash script to run all API tests:

```bash
#!/bin/bash

# Phase 1 Quick Test Script
BASE_URL="http://localhost:8001"

echo "=== Testing Phase 1 Features ==="

# 1. Register
echo "\n1. Registering new user..."
curl -X POST "$BASE_URL/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","username":"testphase1","password":"Test123!","full_name":"Phase One Tester"}'

# 2. Login
echo "\n\n2. Logging in..."
TOKEN=$(curl -s -X POST "$BASE_URL/api/v1/auth/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=testphase1&password=Test123!" | jq -r '.access_token')

echo "Token: $TOKEN"

# 3. Get Profile
echo "\n\n3. Getting profile..."
curl -X GET "$BASE_URL/api/v1/users/me/profile" \
  -H "Authorization: Bearer $TOKEN"

# 4. Update Profile
echo "\n\n4. Updating profile..."
curl -X PUT "$BASE_URL/api/v1/users/me/profile" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"full_name":"Updated Tester","company":"Test Corp","phone":"+1-555-1234"}'

# 5. Check Storage
echo "\n\n5. Checking storage..."
curl -X GET "$BASE_URL/api/v1/users/me/storage" \
  -H "Authorization: Bearer $TOKEN"

# 6. Get Analytics
echo "\n\n6. Getting analytics..."
curl -X GET "$BASE_URL/api/v1/analytics/usage" \
  -H "Authorization: Bearer $TOKEN"

# 7. Get Activity
echo "\n\n7. Getting activity..."
curl -X GET "$BASE_URL/api/v1/users/me/activity" \
  -H "Authorization: Bearer $TOKEN"

echo "\n\n=== Tests Complete ==="
```

Save as `test_phase1.sh`, make executable with `chmod +x test_phase1.sh`, and run with `./test_phase1.sh`
