#!/bin/bash

# Manual Security Testing Script for Qontinui Backend
# Run this script to manually test security features

API_BASE="http://localhost:8000"
echo "🔒 Qontinui Security Testing Script"
echo "===================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
TEST_NUM=0

run_test() {
    TEST_NUM=$((TEST_NUM + 1))
    echo -e "${YELLOW}Test $TEST_NUM: $1${NC}"
}

# 1. Health Check
run_test "Health Check Endpoint"
echo "Testing: GET /health"
curl -s "$API_BASE/health" | python -m json.tool
echo -e "\n${GREEN}✓ Check for: status, version, environment, database${NC}\n"

# 2. Rate Limiting Test
run_test "Rate Limiting (10 rapid requests)"
echo "Making 10 rapid requests to test rate limiting..."
for i in {1..10}; do
    response=$(curl -s -I "$API_BASE/health")
    echo "Request $i:"
    echo "$response" | grep -E "X-RateLimit|HTTP" | head -2
done
echo -e "${GREEN}✓ Look for X-RateLimit headers or 429 status${NC}\n"

# 3. Test Invalid Endpoint (404 Error Handling)
run_test "Error Handling - 404"
echo "Testing: GET /nonexistent"
curl -s "$API_BASE/nonexistent" | python -m json.tool
echo -e "${GREEN}✓ Should return structured error response${NC}\n"

# 4. Test Validation Error
run_test "Error Handling - Validation"
echo "Testing: POST /api/v1/auth/register with invalid data"
curl -s -X POST "$API_BASE/api/v1/auth/register" \
    -H "Content-Type: application/json" \
    -d '{"invalid": "data"}' | python -m json.tool
echo -e "${GREEN}✓ Should return validation error with details${NC}\n"

# 5. Test CORS Headers
run_test "CORS Headers"
echo "Testing: OPTIONS request with Origin header"
curl -s -I -X OPTIONS "$API_BASE/health" \
    -H "Origin: http://localhost:3000" \
    -H "Access-Control-Request-Method: GET" | grep -i "access-control"
echo -e "${GREEN}✓ Should see Access-Control headers${NC}\n"

# 6. Test Authentication - Register
run_test "Authentication - Register New User"
echo "Testing: POST /api/v1/auth/register"
TIMESTAMP=$(date +%s)
curl -s -X POST "$API_BASE/api/v1/auth/register" \
    -H "Content-Type: application/json" \
    -d "{
        \"username\": \"testuser_$TIMESTAMP\",
        \"email\": \"test_$TIMESTAMP@example.com\",
        \"password\": \"TestPassword123!\"
    }" | python -m json.tool
echo -e "${GREEN}✓ Should create user or return conflict if exists${NC}\n"

# 7. Test Authentication - Login
run_test "Authentication - Login"
echo "Testing: POST /api/v1/auth/login"
response=$(curl -s -X POST "$API_BASE/api/v1/auth/login" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "username=testuser_$TIMESTAMP&password=TestPassword123!")
echo "$response" | python -m json.tool

# Extract tokens if login successful
if echo "$response" | grep -q "access_token"; then
    ACCESS_TOKEN=$(echo "$response" | python -c "import sys, json; print(json.load(sys.stdin)['access_token'])")
    REFRESH_TOKEN=$(echo "$response" | python -c "import sys, json; print(json.load(sys.stdin)['refresh_token'])")
    echo -e "${GREEN}✓ Login successful - tokens received${NC}"
    echo "Access Token (first 20 chars): ${ACCESS_TOKEN:0:20}..."
    echo -e "Refresh Token (first 20 chars): ${REFRESH_TOKEN:0:20}...\n"
else
    echo -e "${RED}✗ Login failed${NC}\n"
fi

# 8. Test Token Refresh
if [ ! -z "$REFRESH_TOKEN" ]; then
    run_test "Token Refresh"
    echo "Testing: POST /api/v1/auth/refresh"
    curl -s -X POST "$API_BASE/api/v1/auth/refresh" \
        -H "Content-Type: application/json" \
        -d "{\"refresh_token\": \"$REFRESH_TOKEN\"}" | python -m json.tool
    echo -e "${GREEN}✓ Should return new access and refresh tokens${NC}\n"
fi

# 9. Test Logout
if [ ! -z "$ACCESS_TOKEN" ]; then
    run_test "Logout with Token Blacklisting"
    echo "Testing: POST /api/v1/auth/logout"
    curl -s -X POST "$API_BASE/api/v1/auth/logout" \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"refresh_token\": \"$REFRESH_TOKEN\"}" | python -m json.tool
    echo -e "${GREEN}✓ Should logout and blacklist tokens${NC}\n"

    # Try to use the blacklisted token
    run_test "Using Blacklisted Token (Should Fail)"
    echo "Testing: Using blacklisted token"
    curl -s -X GET "$API_BASE/api/v1/users/me" \
        -H "Authorization: Bearer $ACCESS_TOKEN" | python -m json.tool
    echo -e "${GREEN}✓ Should return 401 Unauthorized${NC}\n"
fi

# 10. Test Production Safety
run_test "Production Safety Checks"
echo "Checking if debug endpoints are disabled..."
curl -s -I "$API_BASE/docs" | grep "HTTP"
echo -e "${GREEN}✓ In production, /docs should return 404${NC}\n"

# Summary
echo "===================================="
echo -e "${GREEN}🎉 Security Testing Complete!${NC}"
echo ""
echo "Manual Verification Checklist:"
echo "[ ] Rate limiting is working (headers or 429 status)"
echo "[ ] Error messages are user-friendly (no stack traces)"
echo "[ ] CORS headers are present and correct"
echo "[ ] JWT tokens have short expiration (check payload)"
echo "[ ] Logout blacklists tokens properly"
echo "[ ] Health endpoint shows environment status"
echo ""
echo "For load testing, run:"
echo "  ab -n 100 -c 10 $API_BASE/health"
echo ""
echo "For security scanning, run:"
echo "  nikto -h $API_BASE"
echo "  owasp-zap -quickurl $API_BASE"
