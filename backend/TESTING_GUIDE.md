# Security Testing Guide

## 🧪 Automated Tests

### Run Unit Tests
```bash
cd backend

# Install test dependencies if needed
pip install pytest pytest-asyncio httpx

# Run all tests
pytest tests/test_security.py -v

# Run with coverage
pytest tests/test_security.py --cov=app --cov-report=html
```

## 🔍 Manual Testing

### Quick Test Script
```bash
cd backend/tests
chmod +x manual_test_security.sh
./manual_test_security.sh
```

This script tests:
- Health endpoint
- Rate limiting
- Error handling
- CORS headers
- Authentication flow
- Token refresh
- Logout with blacklisting

### Manual Test Steps

#### 1. **Test Rate Limiting** 🚦
```bash
# Make rapid requests (should see rate limit headers or 429 status)
for i in {1..70}; do curl -I http://localhost:8000/health; done
```

Expected: After 60 requests/minute, you should get `429 Too Many Requests`

#### 2. **Test JWT Security** 🔐

**Register a user:**
```bash
curl -X POST http://localhost:8000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "email": "test@example.com",
    "password": "SecurePass123!"
  }'
```

**Login:**
```bash
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=testuser&password=SecurePass123!"
```

Save the tokens from response!

**Test token expiry (wait 15+ minutes):**
```bash
# Use access token after 15 minutes
curl -H "Authorization: Bearer YOUR_OLD_TOKEN" \
  http://localhost:8000/api/v1/users/me
```

Expected: `401 Unauthorized`

**Refresh token:**
```bash
curl -X POST http://localhost:8000/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token": "YOUR_REFRESH_TOKEN"}'
```

**Logout (blacklist tokens):**
```bash
curl -X POST http://localhost:8000/api/v1/auth/logout \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{"refresh_token": "YOUR_REFRESH_TOKEN"}'
```

**Try using blacklisted token:**
```bash
curl -H "Authorization: Bearer YOUR_BLACKLISTED_TOKEN" \
  http://localhost:8000/api/v1/users/me
```

Expected: `401 Unauthorized`

#### 3. **Test Error Handling** ⚠️

**404 Error:**
```bash
curl http://localhost:8000/nonexistent | jq
```

Expected:
```json
{
  "error": "HTTP_ERROR",
  "message": "Not Found",
  "timestamp": 1234567890,
  "path": "http://localhost:8000/nonexistent"
}
```

**Validation Error:**
```bash
curl -X POST http://localhost:8000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"wrong": "data"}' | jq
```

Expected: Detailed validation errors with field names

#### 4. **Test CORS** 🌐

```bash
curl -I -X OPTIONS http://localhost:8000/health \
  -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: GET"
```

Expected headers:
- `Access-Control-Allow-Origin: http://localhost:3000`
- `Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS`
- `Access-Control-Allow-Headers: *`

#### 5. **Test Environment Security** 🔒

**Check health endpoint:**
```bash
curl http://localhost:8000/health | jq
```

Expected:
```json
{
  "status": "healthy",
  "timestamp": 1234567890,
  "version": "1.0.0",
  "environment": "development",
  "database": "connected"
}
```

**Check if debug endpoints are disabled in production:**
```bash
# Should return 404 in production
curl http://localhost:8000/docs
```

## 🔨 Load Testing

### Using Apache Bench
```bash
# Install
sudo apt-get install apache2-utils  # Ubuntu/Debian
brew install ab                      # macOS

# Test rate limiting (100 requests, 10 concurrent)
ab -n 100 -c 10 http://localhost:8000/health
```

### Using Locust
```bash
# Install
pip install locust

# Create locustfile.py
cat > locustfile.py << 'EOF'
from locust import HttpUser, task, between

class QuickstartUser(HttpUser):
    wait_time = between(1, 3)

    @task
    def health_check(self):
        self.client.get("/health")

    @task(3)
    def view_api(self):
        self.client.get("/api/v1/projects")
EOF

# Run
locust -f locustfile.py --host=http://localhost:8000
```

Open http://localhost:8089 and test with 100 users

## 🛡️ Security Scanning

### Using OWASP ZAP
```bash
# Quick scan
docker run -t owasp/zap2docker-stable zap-baseline.py \
  -t http://localhost:8000
```

### Using Nikto
```bash
# Install
sudo apt-get install nikto  # Ubuntu/Debian
brew install nikto          # macOS

# Scan
nikto -h http://localhost:8000
```

## ✅ Testing Checklist

- [ ] **Rate Limiting**
  - [ ] Returns 429 after limit exceeded
  - [ ] Headers show limit info
  - [ ] Different limits for auth endpoints

- [ ] **JWT Security**
  - [ ] Access tokens expire in 15 minutes
  - [ ] Refresh tokens work for 7 days
  - [ ] Logout blacklists tokens
  - [ ] Blacklisted tokens are rejected

- [ ] **Error Handling**
  - [ ] No stack traces in production
  - [ ] User-friendly error messages
  - [ ] Proper HTTP status codes
  - [ ] Structured error responses

- [ ] **CORS**
  - [ ] Correct origins allowed
  - [ ] Preflight requests work
  - [ ] Credentials supported

- [ ] **Environment Security**
  - [ ] Debug endpoints disabled in production
  - [ ] Secret key validation works
  - [ ] Database connection checked

## 🐛 Troubleshooting

### Backend won't start
```bash
# Check environment variables
cat .env

# Ensure DATABASE_URL is set
export DATABASE_URL="postgresql://user:password@localhost/dbname"

# Check for port conflicts
lsof -i :8000
```

### Rate limiting not working
```bash
# Check if enabled in config
grep RATE_LIMIT .env

# Should be: RATE_LIMIT_ENABLED=true
```

### JWT tokens not working
```bash
# Decode token to check expiration
echo "YOUR_TOKEN" | cut -d. -f2 | base64 -d | jq

# Check SECRET_KEY length (must be 32+ chars)
python -c "from app.core.config import settings; print(len(settings.SECRET_KEY))"
```

## 📊 Expected Test Results

| Test | Expected Result |
|------|----------------|
| Health Check | 200 OK with status info |
| Rate Limit (61st request) | 429 Too Many Requests |
| Invalid Endpoint | 404 with error JSON |
| Validation Error | 422 with field details |
| Expired Token | 401 Unauthorized |
| Blacklisted Token | 401 Unauthorized |
| CORS Preflight | 200 with headers |
| Production /docs | 404 Not Found |

---

**Ready to test?** Start with the automated script: `./manual_test_security.sh`
