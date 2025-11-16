# AWS ElastiCache Setup for Qontinui

This guide covers setting up Redis on AWS using ElastiCache for production deployment.

## Overview

AWS ElastiCache provides managed Redis instances with automatic backups, failover, and scaling. This is the recommended approach for production.

## Prerequisites

- AWS Account with appropriate permissions
- AWS CLI installed and configured
- VPC with at least 2 subnets in different availability zones

## Option 1: Using AWS Console (Manual Setup)

### Step 1: Create ElastiCache Subnet Group

1. Go to **AWS Console** → **ElastiCache**
2. Click **Subnet Groups** in the left sidebar
3. Click **Create Subnet Group**
4. Configure:
   - **Name**: `qontinui-redis-subnet-group`
   - **Description**: Redis subnet group for Qontinui
   - **VPC**: Select your VPC (same as your backend instances)
   - **Subnets**: Select at least 2 subnets in different AZs
5. Click **Create**

### Step 2: Create Security Group

1. Go to **EC2** → **Security Groups**
2. Click **Create Security Group**
3. Configure:
   - **Name**: `qontinui-redis-sg`
   - **Description**: Security group for Qontinui Redis
   - **VPC**: Same VPC as your backend
   - **Inbound Rules**:
     - Type: Custom TCP
     - Port: 6379
     - Source: Security group of your backend instances
4. Click **Create**

### Step 3: Create Redis Cluster

1. Go back to **ElastiCache**
2. Click **Redis clusters** → **Create Redis cluster**
3. Configure:
   - **Cluster mode**: Disabled (for simplicity)
   - **Name**: `qontinui-redis`
   - **Engine version**: 7.0 or latest
   - **Port**: 6379
   - **Node type**:
     - Development: `cache.t3.micro` or `cache.t4g.micro`
     - Production: `cache.t3.medium` or higher
   - **Number of replicas**:
     - Development: 0
     - Production: 1-2 (for high availability)
   - **Subnet group**: Select `qontinui-redis-subnet-group`
   - **Security groups**: Select `qontinui-redis-sg`
   - **Encryption at rest**: Enabled (recommended)
   - **Encryption in transit**: Enabled (recommended)
   - **Automatic backups**: Enabled
   - **Backup retention**: 7 days (or as needed)
4. Click **Create**

### Step 4: Get Connection Details

1. Wait for cluster status to become **Available** (5-10 minutes)
2. Click on your cluster name
3. Copy the **Primary Endpoint** (looks like: `qontinui-redis.abc123.0001.use1.cache.amazonaws.com:6379`)

## Option 2: Using AWS CLI

```bash
# Create subnet group
aws elasticache create-cache-subnet-group \
  --cache-subnet-group-name qontinui-redis-subnet-group \
  --cache-subnet-group-description "Redis subnet group for Qontinui" \
  --subnet-ids subnet-12345678 subnet-87654321

# Create security group (note: requires VPC ID)
SG_ID=$(aws ec2 create-security-group \
  --group-name qontinui-redis-sg \
  --description "Security group for Qontinui Redis" \
  --vpc-id vpc-12345678 \
  --output text)

# Add inbound rule for Redis port (update source-group with backend SG)
aws ec2 authorize-security-group-ingress \
  --group-id $SG_ID \
  --protocol tcp \
  --port 6379 \
  --source-group backend-security-group-id

# Create Redis cluster
aws elasticache create-replication-group \
  --replication-group-id qontinui-redis \
  --replication-group-description "Redis for Qontinui backend" \
  --engine redis \
  --engine-version 7.0 \
  --cache-node-type cache.t3.micro \
  --num-cache-clusters 1 \
  --cache-subnet-group-name qontinui-redis-subnet-group \
  --security-group-ids $SG_ID \
  --at-rest-encryption-enabled \
  --transit-encryption-enabled \
  --automatic-failover-enabled \
  --snapshot-retention-limit 7
```

## Option 3: Using Terraform (Infrastructure as Code)

Create `terraform/elasticache.tf`:

```hcl
# ElastiCache Subnet Group
resource "aws_elasticache_subnet_group" "redis" {
  name       = "qontinui-redis-subnet-group"
  subnet_ids = var.private_subnet_ids

  tags = {
    Name        = "qontinui-redis-subnet-group"
    Environment = var.environment
  }
}

# Security Group for Redis
resource "aws_security_group" "redis" {
  name        = "qontinui-redis-sg"
  description = "Security group for Qontinui Redis"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Redis from backend"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [var.backend_security_group_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "qontinui-redis-sg"
    Environment = var.environment
  }
}

# ElastiCache Redis Replication Group
resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = "qontinui-redis"
  replication_group_description = "Redis for Qontinui backend"

  engine               = "redis"
  engine_version       = "7.0"
  node_type            = var.redis_node_type
  num_cache_clusters   = var.environment == "production" ? 2 : 1

  port                 = 6379
  parameter_group_name = "default.redis7"

  subnet_group_name    = aws_elasticache_subnet_group.redis.name
  security_group_ids   = [aws_security_group.redis.id]

  at_rest_encryption_enabled  = true
  transit_encryption_enabled  = true
  auth_token_enabled         = false  # Enable if you want password auth

  automatic_failover_enabled = var.environment == "production"

  snapshot_retention_limit = 7
  snapshot_window         = "03:00-05:00"
  maintenance_window      = "mon:05:00-mon:07:00"

  tags = {
    Name        = "qontinui-redis"
    Environment = var.environment
  }
}

# Output the connection endpoint
output "redis_endpoint" {
  value       = aws_elasticache_replication_group.redis.primary_endpoint_address
  description = "Redis primary endpoint"
}

output "redis_port" {
  value       = aws_elasticache_replication_group.redis.port
  description = "Redis port"
}
```

Variables file `terraform/variables.tf`:

```hcl
variable "environment" {
  description = "Environment (development, staging, production)"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for ElastiCache"
  type        = list(string)
}

variable "backend_security_group_id" {
  description = "Security group ID of the backend instances"
  type        = string
}

variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.t3.micro"
}
```

Apply Terraform:

```bash
cd terraform
terraform init
terraform plan
terraform apply
```

## Configure Application

After creating ElastiCache, update your environment variables:

### For EC2 / Elastic Beanstalk

Add to `.env` or environment configuration:

```bash
REDIS_HOST=qontinui-redis.abc123.0001.use1.cache.amazonaws.com
REDIS_PORT=6379
REDIS_DB=0
```

### For Docker Compose on EC2

Update `docker-compose.yml`:

```yaml
services:
  backend:
    image: your-backend-image
    environment:
      - REDIS_HOST=qontinui-redis.abc123.0001.use1.cache.amazonaws.com
      - REDIS_PORT=6379
      - REDIS_DB=0
      - DATABASE_URL=${DATABASE_URL}
      - SECRET_KEY=${SECRET_KEY}
    # ... other config

  worker:
    image: your-backend-image
    command: python run_worker.py
    environment:
      - REDIS_HOST=qontinui-redis.abc123.0001.use1.cache.amazonaws.com
      - REDIS_PORT=6379
      - REDIS_DB=0
      - DATABASE_URL=${DATABASE_URL}
    # ... other config
```

### For ECS / Fargate

Add to task definition environment variables:

```json
{
  "environment": [
    {
      "name": "REDIS_HOST",
      "value": "qontinui-redis.abc123.0001.use1.cache.amazonaws.com"
    },
    {
      "name": "REDIS_PORT",
      "value": "6379"
    },
    {
      "name": "REDIS_DB",
      "value": "0"
    }
  ]
}
```

## Deploy Worker Process

The ARQ worker needs to run as a separate process/container:

### Option 1: Separate EC2 Instance

```bash
# SSH into worker instance
ssh ec2-user@worker-instance

# Clone repo and setup
cd /opt/qontinui-backend
poetry install
poetry run python run_worker.py
```

Set up as systemd service (see `app/worker/README.md`).

### Option 2: ECS Task for Worker

Create a separate ECS task definition for the worker:

```json
{
  "family": "qontinui-worker",
  "containerDefinitions": [
    {
      "name": "worker",
      "image": "your-ecr-repo/qontinui-backend:latest",
      "command": ["python", "run_worker.py"],
      "environment": [
        {"name": "REDIS_HOST", "value": "your-elasticache-endpoint"},
        {"name": "REDIS_PORT", "value": "6379"},
        {"name": "DATABASE_URL", "valueFrom": "arn:aws:secretsmanager:..."}
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/qontinui-worker",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

### Option 3: Docker Compose

If deploying with Docker Compose on a single EC2:

```yaml
version: '3.8'

services:
  backend:
    build: .
    ports:
      - "8000:8000"
    environment:
      - REDIS_HOST=${REDIS_HOST}
      - REDIS_PORT=6379
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000

  worker:
    build: .
    environment:
      - REDIS_HOST=${REDIS_HOST}
      - REDIS_PORT=6379
    command: python run_worker.py
    restart: always
```

## Monitoring

### CloudWatch Metrics

ElastiCache automatically publishes metrics to CloudWatch:
- CPUUtilization
- EngineCPUUtilization
- NetworkBytesIn/Out
- CurrConnections
- Evictions
- CacheHits/Misses

Set up alarms:

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name qontinui-redis-high-cpu \
  --alarm-description "Alert when Redis CPU exceeds 75%" \
  --metric-name CPUUtilization \
  --namespace AWS/ElastiCache \
  --statistic Average \
  --period 300 \
  --threshold 75 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --dimensions Name=CacheClusterId,Value=qontinui-redis-001
```

### Application Logs

Monitor ARQ worker logs in CloudWatch or your logging system to track job processing.

## Cost Optimization

### Development Environment
- Node type: `cache.t3.micro` or `cache.t4g.micro`
- Replicas: 0
- Estimated cost: ~$12-15/month

### Production Environment
- Node type: `cache.t3.small` or higher based on load
- Replicas: 1-2 for high availability
- Estimated cost: ~$30-100/month

### Tips
1. Use Reserved Nodes for 1-3 year commitments (30-50% savings)
2. Monitor actual usage and right-size node type
3. Use CloudWatch metrics to determine if you need caching layer

## Troubleshooting

### Connection Timeouts

Check security group rules allow inbound traffic from backend:
```bash
aws ec2 describe-security-groups --group-ids sg-xxxxx
```

### Authentication Errors

If using auth token, ensure `REDIS_PASSWORD` is set in environment.

### High Memory Usage

Monitor evictions metric. If high, consider:
1. Increasing node size
2. Implementing TTLs for jobs
3. Adjusting `keep_result` in worker settings

## Backup and Recovery

ElastiCache automatically creates snapshots based on your configuration. To restore:

1. Go to ElastiCache console
2. Select **Backups**
3. Choose snapshot and click **Restore**
4. Configure new cluster from snapshot

## Security Best Practices

1. ✅ Enable encryption at rest
2. ✅ Enable encryption in transit
3. ✅ Use VPC with private subnets
4. ✅ Restrict security group to only backend instances
5. ⚠️ Consider enabling auth token for additional security
6. ✅ Regular backups with retention policy
7. ✅ Monitor access logs via VPC Flow Logs

## References

- [AWS ElastiCache Documentation](https://docs.aws.amazon.com/elasticache/latest/red-ug/WhatIs.html)
- [ElastiCache Pricing](https://aws.amazon.com/elasticache/pricing/)
- [ARQ Documentation](https://arq-docs.helpmanual.io/)
