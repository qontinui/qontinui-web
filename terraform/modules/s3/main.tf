###############################################################################
# S3 Bucket Module with Cost Optimization
#
# Features:
# - Intelligent Tiering for automatic cost optimization
# - Lifecycle policies to delete old thumbnails
# - Versioning for data protection
# - Encryption at rest
# - Public access blocking
###############################################################################

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
}

variable "bucket_name" {
  description = "S3 bucket name"
  type        = string
}

###############################################################################
# S3 Bucket
###############################################################################

resource "aws_s3_bucket" "main" {
  bucket = var.bucket_name

  tags = {
    Name        = var.bucket_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# Block all public access (security best practice)
resource "aws_s3_bucket_public_access_block" "main" {
  bucket = aws_s3_bucket.main.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Enable versioning (data protection)
resource "aws_s3_bucket_versioning" "main" {
  bucket = aws_s3_bucket.main.id

  versioning_configuration {
    status = "Enabled"
  }
}

# Enable server-side encryption
resource "aws_s3_bucket_server_side_encryption_configuration" "main" {
  bucket = aws_s3_bucket.main.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

###############################################################################
# Cost Optimization: Intelligent Tiering
###############################################################################

# Intelligent-Tiering configuration
resource "aws_s3_bucket_intelligent_tiering_configuration" "main" {
  bucket = aws_s3_bucket.main.id
  name   = "EntireBucket"

  status = "Enabled"

  # Automatically move objects to Archive Access tier after 90 days
  tiering {
    access_tier = "ARCHIVE_ACCESS"
    days        = 90
  }

  # Automatically move objects to Deep Archive Access tier after 180 days
  tiering {
    access_tier = "DEEP_ARCHIVE_ACCESS"
    days        = 180
  }
}

# Lifecycle configuration
resource "aws_s3_bucket_lifecycle_configuration" "main" {
  bucket = aws_s3_bucket.main.id

  # Rule 1: Transition all objects to Intelligent-Tiering immediately
  rule {
    id     = "intelligent-tiering-all"
    status = "Enabled"

    transition {
      days          = 0  # Immediately
      storage_class = "INTELLIGENT_TIERING"
    }
  }

  # Rule 2: Delete old thumbnails after 90 days (cost savings)
  rule {
    id     = "delete-old-thumbnails"
    status = "Enabled"

    filter {
      prefix = "thumbnails/"
    }

    expiration {
      days = 90
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }

  # Rule 3: Delete incomplete multipart uploads after 7 days
  rule {
    id     = "cleanup-incomplete-uploads"
    status = "Enabled"

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  # Rule 4: Transition old versions to Glacier after 30 days, delete after 90 days
  rule {
    id     = "archive-old-versions"
    status = "Enabled"

    noncurrent_version_transition {
      noncurrent_days = 30
      storage_class   = "GLACIER"
    }

    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

###############################################################################
# CORS Configuration (for presigned URLs from frontend)
###############################################################################

resource "aws_s3_bucket_cors_configuration" "main" {
  bucket = aws_s3_bucket.main.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "POST", "DELETE", "HEAD"]
    allowed_origins = [
      "http://localhost:3000",
      "http://localhost:3001",
      "https://qontinui.io",
      "https://*.vercel.app"  # Vercel preview deployments
    ]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

###############################################################################
# Outputs
###############################################################################

output "bucket_name" {
  description = "Name of the S3 bucket"
  value       = aws_s3_bucket.main.id
}

output "bucket_arn" {
  description = "ARN of the S3 bucket"
  value       = aws_s3_bucket.main.arn
}

output "bucket_region" {
  description = "Region of the S3 bucket"
  value       = aws_s3_bucket.main.region
}

output "bucket_domain_name" {
  description = "Domain name of the S3 bucket"
  value       = aws_s3_bucket.main.bucket_domain_name
}
