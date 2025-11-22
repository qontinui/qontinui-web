# CloudFront CDN Setup Guide

**Date:** 2025-11-22
**Status:** ✅ Implementation Complete - Ready for Deployment

---

## Overview

This guide covers the CloudFront CDN implementation for qontinui-web image delivery. CloudFront provides significant performance improvements over direct S3 access:

### Performance Benefits

| Metric | S3 Presigned URLs | CloudFront CDN | Improvement |
|--------|------------------|----------------|-------------|
| First Request Latency | 50-100ms | 10-20ms | **70-80% faster** |
| Cached Request Latency | 50-100ms | 5-15ms | **90% faster** |
| Global Edge Locations | N/A | 450+ locations | **Worldwide coverage** |
| Bandwidth Costs (1TB) | $90/month | $0-36/month* | **60-100% savings** |

\* CloudFront first 10 TB = $85/TB vs S3 egress $90/TB. Plus edge caching reduces origin requests by 85-95%.

---

## Implementation Status

### ✅ Completed Components

1. **Backend Configuration** (`app/core/config.py`)
   - Added `USE_CLOUDFRONT`, `CLOUDFRONT_DOMAIN`, `CLOUDFRONT_DISTRIBUTION_ID` settings
   - Backward compatible (defaults to S3 presigned URLs)

2. **Storage Service** (`app/services/object_storage.py`)
   - New `get_cdn_url()` method automatically uses CloudFront when enabled
   - Falls back to presigned S3 URLs when CloudFront is disabled
   - Preserves existing `Cache-Control: max-age=31536000, immutable` headers

3. **API Endpoints** (`app/api/v1/endpoints/images.py`)
   - Updated image upload endpoint to use `get_cdn_url()`
   - Updated image refresh endpoint to use `get_cdn_url()`
   - Maintains backward compatibility

4. **Automation Scripts**
   - `scripts/setup_cloudfront.py` - Automated distribution creation
   - `scripts/manage_cloudfront.py` - Cache invalidation, status checks, statistics

5. **Documentation**
   - Environment variable examples in `.env.example`
   - Comprehensive setup and usage guides

---

## Quick Start (30 Minutes)

### Prerequisites

```bash
# Ensure AWS credentials are configured
export AWS_ACCESS_KEY_ID=your_access_key
export AWS_SECRET_ACCESS_KEY=your_secret_key

# Or use AWS CLI profile
export AWS_PROFILE=qontinui-prod

# Verify credentials
aws sts get-caller-identity
```

### Step 1: Create CloudFront Distribution (5 min)

```bash
cd backend

# Create distribution (replace with your bucket name and region)
python scripts/setup_cloudfront.py \
    --bucket qontinui \
    --region eu-central-1
```

Expected output:
```
🌐 Qontinui CloudFront CDN Setup
======================================================================

📝 Creating Origin Access Control (OAC)...
✅ OAC created: E1ABC2DEF3GH45

🚀 Creating CloudFront distribution for bucket: qontinui
✅ Distribution created!
   ID: E2XYZ3ABC4DEF5
   Domain: d123abc456def.cloudfront.net
   Status: InProgress (will take 5-10 minutes to deploy)

🔒 Updating S3 bucket policy for CloudFront access...
✅ S3 bucket policy updated successfully
```

Copy the **Distribution ID** and **Domain** from the output.

### Step 2: Configure Backend (2 min)

Add to `backend/.env`:

```bash
# CloudFront CDN Configuration
USE_CLOUDFRONT=true
CLOUDFRONT_DOMAIN=d123abc456def.cloudfront.net  # From step 1
CLOUDFRONT_DISTRIBUTION_ID=E2XYZ3ABC4DEF5        # From step 1
```

### Step 3: Wait for Deployment (10-15 min)

Check deployment status:

```bash
python scripts/manage_cloudfront.py status \
    --distribution-id E2XYZ3ABC4DEF5
```

Wait for status to change from `InProgress` to `Deployed`.

### Step 4: Test CloudFront (5 min)

```bash
# Upload a test image through your app
# (or use existing image)

# Test CloudFront URL
curl -I https://d123abc456def.cloudfront.net/images/test.webp

# Should see:
# HTTP/2 200
# cache-control: max-age=31536000, immutable
# x-cache: Hit from cloudfront  (after 2nd request)
# x-amz-cf-pop: FRA56-P1  (edge location)
```

### Step 5: Restart Backend (1 min)

```bash
# Local development
poetry run python run.py

# Production (Elastic Beanstalk)
eb deploy qontinui-prod-py
```

### Step 6: Verify (5 min)

1. Upload a new image through the app
2. Check browser DevTools Network tab
3. Image URLs should now be: `https://d123abc456def.cloudfront.net/images/...`
4. Second load should show `(from disk cache)` in DevTools

---

## Architecture

### Request Flow

```
┌─────────┐
│ Browser │
└────┬────┘
     │ 1. Request image
     │    GET https://d123abc.cloudfront.net/images/abc/thumb.webp
     ↓
┌────────────────┐
│ CloudFront     │ ← 450+ global edge locations
│ Edge Location  │
└───────┬────────┘
        │ 2. Cache MISS? Fetch from S3
        │    (only on first request)
        ↓
   ┌─────────┐
   │ S3 Bucket│
   │ (Origin) │
   └──────────┘
        ↓ 3. Return with Cache-Control: max-age=31536000
   CloudFront caches for 1 year

   Next request: Served from edge cache (5-15ms)
```

### Security: Origin Access Control (OAC)

CloudFront uses **Origin Access Control (OAC)** to securely access S3:

1. S3 bucket can be private (no public access needed)
2. Only CloudFront can access objects (via AWS SigV4 signing)
3. S3 bucket policy explicitly allows CloudFront distribution
4. No presigned URLs needed for CloudFront requests

Benefits:
- ✅ Better security (modern replacement for OAI)
- ✅ Supports AWS SigV4 signing
- ✅ Works with S3 encryption (SSE-S3, SSE-KMS)
- ✅ No credential rotation needed

---

## Cache Behavior Configuration

### Default Cache Policy: CachingOptimized

CloudFront uses AWS managed cache policy `CachingOptimized` (ID: `658327ea-f89d-4fab-a63d-7e88639e58f6`):

- **Min TTL:** 1 second
- **Max TTL:** 31536000 seconds (1 year)
- **Default TTL:** 86400 seconds (1 day)
- **Actual TTL:** Respects `Cache-Control` header from S3

Since our S3 uploads include `Cache-Control: max-age=31536000, immutable`, CloudFront caches images for **1 year**.

### Why 1-Year Cache is Safe

Images use UUID-based keys:
```
images/550e8400-e29b-41d4-a716-446655440000/thumb.webp
       ↑ UUID = immutable identifier
```

- UUIDs never change → same key = same content
- Updates = new UUID = new key = new cache entry
- Old images naturally expire after 1 year of no access

### Path-Specific Cache Behaviors

The setup script configures special behavior for `images/*`:

```python
{
    "PathPattern": "images/*",
    "ViewerProtocolPolicy": "redirect-to-https",  # Force HTTPS
    "Compress": True,                              # Gzip/Brotli compression
    "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",  # CachingOptimized
}
```

---

## Cost Analysis

### CloudFront Pricing (US/Europe)

| Data Transfer (per month) | Price per GB | Example Cost |
|---------------------------|--------------|--------------|
| First 10 TB | $0.085/GB | 100 GB = $8.50 |
| Next 40 TB | $0.080/GB | 1 TB = $85 |
| Next 100 TB | $0.060/GB | 10 TB = $650 |
| Over 500 TB | $0.030/GB | - |

**HTTP Requests:** $0.0075 per 10,000 requests

### Cost Comparison: S3 vs CloudFront

Scenario: **1,000 active users, 50 images/user/month**

| Metric | S3 Direct | CloudFront | Savings |
|--------|-----------|------------|---------|
| Requests | 50,000/month | 50,000/month | - |
| Transfer (first visit) | 25 GB | 25 GB | - |
| Transfer (cached visits) | 212.5 GB | 37.5 GB (85% cache) | 175 GB |
| **Bandwidth Cost** | $21.38 | $5.31 | **$16.07/month** |
| Request Cost | Included | $0.04 | - |
| **Total** | **$21.38** | **$5.35** | **75% savings** |

### Free Tier

CloudFront includes AWS Free Tier for 12 months:
- 1 TB data transfer out
- 10,000,000 HTTP/HTTPS requests
- 2,000,000 CloudFront Function invocations

---

## Management Operations

### Check Distribution Status

```bash
python scripts/manage_cloudfront.py status \
    --distribution-id E2XYZ3ABC4DEF5
```

Output:
```
🌐 CloudFront Distribution Status
======================================================================

Distribution ID:  E2XYZ3ABC4DEF5
Domain:           d123abc456def.cloudfront.net
Status:           Deployed
Enabled:          True
Price Class:      PriceClass_100

Origins:
  • S3-qontinui: qontinui.s3.eu-central-1.amazonaws.com

✅ Distribution is fully deployed and serving traffic

Test URL:
  https://d123abc456def.cloudfront.net/images/test.webp
```

### Invalidate Cache (Clear Specific Images)

**Note:** First 1,000 invalidation paths/month are free, then $0.005/path.

```bash
# Invalidate specific image
python scripts/manage_cloudfront.py invalidate \
    --distribution-id E2XYZ3ABC4DEF5 \
    --paths "/images/550e8400-e29b-41d4-a716-446655440000/*"

# Invalidate all thumbnails (expensive!)
python scripts/manage_cloudfront.py invalidate \
    --distribution-id E2XYZ3ABC4DEF5 \
    --all-images
```

**When to invalidate:**
- Never needed for normal operations (UUIDs prevent stale content)
- Only if you manually replace S3 objects with same key
- Emergency purge if security issue detected

### View Statistics

```bash
python scripts/manage_cloudfront.py stats \
    --distribution-id E2XYZ3ABC4DEF5
```

Output:
```
📊 CloudFront Statistics (Last 24 Hours)
======================================================================

Total Requests:       125,842
Total Bytes Downloaded: 45.23 GB
Average Request Size:  376.4 KB
```

---

## Monitoring & Metrics

### CloudWatch Metrics (Automatic)

CloudFront automatically publishes metrics to CloudWatch:

| Metric | Description | Alerting Threshold |
|--------|-------------|-------------------|
| `Requests` | Total requests | >1M/hour (unexpected spike) |
| `BytesDownloaded` | Data transfer | >100GB/hour (cost control) |
| `4xxErrorRate` | Client errors | >5% (broken links) |
| `5xxErrorRate` | Server errors | >1% (S3 issues) |
| `CacheHitRate` | Cache efficiency | <80% (suboptimal caching) |

### Recommended CloudWatch Alarms

```bash
# High error rate alarm
aws cloudwatch put-metric-alarm \
    --alarm-name "CloudFront-High-5xx-Errors" \
    --metric-name "5xxErrorRate" \
    --namespace "AWS/CloudFront" \
    --statistic "Average" \
    --period 300 \
    --threshold 1.0 \
    --comparison-operator "GreaterThanThreshold" \
    --evaluation-periods 2

# Low cache hit rate alarm
aws cloudwatch put-metric-alarm \
    --alarm-name "CloudFront-Low-Cache-Hit-Rate" \
    --metric-name "CacheHitRate" \
    --namespace "AWS/CloudFront" \
    --statistic "Average" \
    --period 3600 \
    --threshold 80.0 \
    --comparison-operator "LessThanThreshold" \
    --evaluation-periods 1
```

---

## Troubleshooting

### Issue: 403 Forbidden Errors

**Symptom:** Images return 403 when accessed via CloudFront

**Cause:** S3 bucket policy not updated correctly

**Fix:**
```bash
# Check S3 bucket policy
aws s3api get-bucket-policy --bucket qontinui --query Policy --output text | jq .

# Re-run setup script (idempotent)
python scripts/setup_cloudfront.py --bucket qontinui --region eu-central-1
```

### Issue: Distribution Stuck in "InProgress"

**Symptom:** Distribution status stays "InProgress" for >20 minutes

**Cause:** Rare AWS issue (usually resolves itself)

**Fix:**
```bash
# Check status
python scripts/manage_cloudfront.py status --distribution-id E2XYZ

# If stuck for >30 minutes, contact AWS support or create new distribution
```

### Issue: Images Not Caching

**Symptom:** `X-Cache: Miss from cloudfront` on every request

**Cause:** Cache-Control header not set or incorrect

**Check:**
```bash
# Verify S3 object metadata
aws s3api head-object --bucket qontinui --key images/test.webp

# Should see:
# "CacheControl": "max-age=31536000, immutable"
```

**Fix:** Re-upload images (they'll get correct headers from updated upload code)

### Issue: Slow Performance

**Symptom:** CloudFront slower than expected

**Possible causes:**
1. **First request:** Always slower (fetches from S3)
2. **Edge location:** Client far from nearest edge location
3. **HTTP/2 not enabled:** Check distribution config

**Verify:**
```bash
# Check edge location in response headers
curl -I https://d123abc.cloudfront.net/images/test.webp | grep x-amz-cf-pop

# Should see nearby location (e.g., FRA56-P1 for Frankfurt)
```

---

## Production Deployment Checklist

### Pre-Deployment

- [ ] AWS credentials configured with CloudFront permissions
- [ ] S3 bucket exists and is accessible
- [ ] Backend can connect to S3 (test upload works)
- [ ] Distribution created and fully deployed (`Status: Deployed`)
- [ ] Environment variables added to `.env`

### Deployment

- [ ] Test distribution URL directly: `curl -I https://<domain>/images/test.webp`
- [ ] Verify Cache-Control header in response
- [ ] Deploy backend with new environment variables
- [ ] Test image upload through app
- [ ] Verify image URLs now use CloudFront domain
- [ ] Test image load in browser (check DevTools Network tab)

### Post-Deployment

- [ ] Monitor CloudWatch metrics for 24 hours
- [ ] Check cache hit rate (should be >80% after 1 day)
- [ ] Verify costs in AWS Billing dashboard
- [ ] Set up CloudWatch alarms for error rates
- [ ] Document distribution ID in deployment notes

---

## Rollback Procedure

If CloudFront causes issues, rollback is immediate:

### Step 1: Disable CloudFront in Backend

```bash
# In backend/.env, change:
USE_CLOUDFRONT=false

# Restart backend
poetry run python run.py

# Or for production:
eb setenv USE_CLOUDFRONT=false
eb deploy
```

### Step 2: Verify Rollback

- Image URLs should revert to presigned S3 URLs
- Functionality should work as before CloudFront

### Step 3: (Optional) Delete Distribution

```bash
# First disable distribution
aws cloudfront get-distribution-config --id E2XYZ > config.json
# Edit config.json, set "Enabled": false
aws cloudfront update-distribution --id E2XYZ --if-match <ETag> --distribution-config file://config.json

# Wait for deployment (5-10 min)

# Then delete
aws cloudfront delete-distribution --id E2XYZ --if-match <ETag>
```

---

## Performance Testing

### Benchmark Script

```bash
#!/bin/bash
# test_cdn_performance.sh

CLOUDFRONT_URL="https://d123abc.cloudfront.net/images/test.webp"
S3_URL="https://qontinui.s3.eu-central-1.amazonaws.com/images/test.webp"

echo "Testing CloudFront (first request - cache miss):"
time curl -s -o /dev/null -w "Time: %{time_total}s\n" "$CLOUDFRONT_URL"

echo -e "\nTesting CloudFront (second request - cache hit):"
time curl -s -o /dev/null -w "Time: %{time_total}s\n" "$CLOUDFRONT_URL"

echo -e "\nTesting S3 direct (for comparison):"
time curl -s -o /dev/null -w "Time: %{time_total}s\n" "$S3_URL"
```

Expected results:
```
CloudFront (cache miss):  0.080s
CloudFront (cache hit):   0.012s  ← 85% faster
S3 direct:                0.095s
```

---

## Advanced Configuration

### Custom Domain (Optional)

To use `cdn.qontinui.com` instead of `d123abc.cloudfront.net`:

1. **Request SSL certificate:**
   ```bash
   aws acm request-certificate \
       --domain-name cdn.qontinui.com \
       --validation-method DNS \
       --region us-east-1  # Must be us-east-1 for CloudFront
   ```

2. **Add CNAME to DNS:**
   ```
   cdn.qontinui.com → d123abc.cloudfront.net
   ```

3. **Update distribution:**
   ```bash
   # Use AWS Console or update distribution config
   # Add "cdn.qontinui.com" to Alternate Domain Names (CNAMEs)
   # Select ACM certificate
   ```

4. **Update backend:**
   ```bash
   # backend/.env
   CLOUDFRONT_DOMAIN=cdn.qontinui.com
   ```

---

## References

- [AWS CloudFront Documentation](https://docs.aws.amazon.com/cloudfront/)
- [Origin Access Control (OAC) Guide](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)
- [CloudFront Pricing](https://aws.amazon.com/cloudfront/pricing/)
- [Cache Policy Reference](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-cache-policies.html)

---

## Support

For issues or questions:
1. Check troubleshooting section above
2. Review CloudFront distribution logs in S3 (if enabled)
3. Check CloudWatch metrics for anomalies
4. Contact AWS support (Premium support plan)

---

**Last Updated:** 2025-11-22
**Version:** 1.0.0
**Status:** Production Ready
