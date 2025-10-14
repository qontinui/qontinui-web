#!/bin/bash
#
# Setup AWS ElastiCache for Qontinui
# This script creates a production-ready Redis cluster on AWS
#
# Prerequisites:
#   - AWS CLI installed and configured
#   - Appropriate IAM permissions for ElastiCache, EC2, VPC
#   - Existing VPC with subnets
#
# Usage:
#   ./setup-elasticache.sh [environment] [vpc-id] [subnet-id-1] [subnet-id-2] [backend-sg-id]
#
# Example:
#   ./setup-elasticache.sh production vpc-12345678 subnet-abc123 subnet-def456 sg-backend123
#

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
CLUSTER_NAME="qontinui-redis"
ENVIRONMENT="${1:-production}"
VPC_ID="${2}"
SUBNET_ID_1="${3}"
SUBNET_ID_2="${4}"
BACKEND_SG_ID="${5}"

# Redis configuration based on environment
if [ "$ENVIRONMENT" = "production" ]; then
    NODE_TYPE="cache.t3.small"
    NUM_REPLICAS=2
    SNAPSHOT_RETENTION=7
elif [ "$ENVIRONMENT" = "staging" ]; then
    NODE_TYPE="cache.t3.micro"
    NUM_REPLICAS=1
    SNAPSHOT_RETENTION=3
else
    NODE_TYPE="cache.t3.micro"
    NUM_REPLICAS=0
    SNAPSHOT_RETENTION=1
fi

echo -e "${GREEN}=== AWS ElastiCache Setup for Qontinui ===${NC}"
echo "Environment: $ENVIRONMENT"
echo "Node Type: $NODE_TYPE"
echo "Replicas: $NUM_REPLICAS"
echo ""

# Validate AWS CLI
if ! command -v aws &> /dev/null; then
    echo -e "${RED}Error: AWS CLI is not installed${NC}"
    echo "Install it with: pip install awscli"
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}Error: AWS credentials not configured${NC}"
    echo "Configure with: aws configure"
    exit 1
fi

echo -e "${GREEN}✓ AWS CLI configured${NC}"

# Validate parameters
if [ -z "$VPC_ID" ] || [ -z "$SUBNET_ID_1" ] || [ -z "$SUBNET_ID_2" ] || [ -z "$BACKEND_SG_ID" ]; then
    echo -e "${RED}Error: Missing required parameters${NC}"
    echo ""
    echo "Usage: $0 [environment] [vpc-id] [subnet-id-1] [subnet-id-2] [backend-sg-id]"
    echo ""
    echo "Example:"
    echo "  $0 production vpc-12345678 subnet-abc123 subnet-def456 sg-backend123"
    echo ""
    echo "To find your VPC and subnet IDs:"
    echo "  aws ec2 describe-vpcs"
    echo "  aws ec2 describe-subnets --filters \"Name=vpc-id,Values=YOUR_VPC_ID\""
    echo ""
    echo "To find your backend security group:"
    echo "  aws ec2 describe-security-groups --filters \"Name=vpc-id,Values=YOUR_VPC_ID\""
    exit 1
fi

# Verify VPC exists
echo -e "${YELLOW}Verifying VPC...${NC}"
if ! aws ec2 describe-vpcs --vpc-ids "$VPC_ID" &> /dev/null; then
    echo -e "${RED}Error: VPC $VPC_ID not found${NC}"
    exit 1
fi
echo -e "${GREEN}✓ VPC verified${NC}"

# Verify subnets exist
echo -e "${YELLOW}Verifying subnets...${NC}"
if ! aws ec2 describe-subnets --subnet-ids "$SUBNET_ID_1" "$SUBNET_ID_2" &> /dev/null; then
    echo -e "${RED}Error: One or more subnets not found${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Subnets verified${NC}"

# Verify backend security group exists
echo -e "${YELLOW}Verifying backend security group...${NC}"
if ! aws ec2 describe-security-groups --group-ids "$BACKEND_SG_ID" &> /dev/null; then
    echo -e "${RED}Error: Security group $BACKEND_SG_ID not found${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Backend security group verified${NC}"

echo ""
echo -e "${GREEN}=== Step 1: Create ElastiCache Subnet Group ===${NC}"

SUBNET_GROUP_NAME="${CLUSTER_NAME}-subnet-group"

# Check if subnet group already exists
if aws elasticache describe-cache-subnet-groups \
    --cache-subnet-group-name "$SUBNET_GROUP_NAME" &> /dev/null; then
    echo -e "${YELLOW}Subnet group already exists, skipping...${NC}"
else
    aws elasticache create-cache-subnet-group \
        --cache-subnet-group-name "$SUBNET_GROUP_NAME" \
        --cache-subnet-group-description "Redis subnet group for Qontinui $ENVIRONMENT" \
        --subnet-ids "$SUBNET_ID_1" "$SUBNET_ID_2" \
        --tags "Key=Name,Value=${CLUSTER_NAME}-subnet-group" \
              "Key=Environment,Value=${ENVIRONMENT}" \
              "Key=Application,Value=Qontinui"

    echo -e "${GREEN}✓ Subnet group created${NC}"
fi

echo ""
echo -e "${GREEN}=== Step 2: Create Security Group for Redis ===${NC}"

SG_NAME="${CLUSTER_NAME}-sg"
SG_DESCRIPTION="Security group for Qontinui Redis $ENVIRONMENT"

# Check if security group already exists
SG_ID=$(aws ec2 describe-security-groups \
    --filters "Name=group-name,Values=$SG_NAME" "Name=vpc-id,Values=$VPC_ID" \
    --query 'SecurityGroups[0].GroupId' \
    --output text 2>/dev/null || echo "None")

if [ "$SG_ID" != "None" ] && [ -n "$SG_ID" ]; then
    echo -e "${YELLOW}Security group already exists: $SG_ID${NC}"
else
    SG_ID=$(aws ec2 create-security-group \
        --group-name "$SG_NAME" \
        --description "$SG_DESCRIPTION" \
        --vpc-id "$VPC_ID" \
        --output text)

    echo -e "${GREEN}✓ Security group created: $SG_ID${NC}"

    # Add tags
    aws ec2 create-tags \
        --resources "$SG_ID" \
        --tags "Key=Name,Value=${SG_NAME}" \
              "Key=Environment,Value=${ENVIRONMENT}" \
              "Key=Application,Value=Qontinui"

    # Add inbound rule for Redis port from backend
    aws ec2 authorize-security-group-ingress \
        --group-id "$SG_ID" \
        --protocol tcp \
        --port 6379 \
        --source-group "$BACKEND_SG_ID"

    echo -e "${GREEN}✓ Security group rules configured${NC}"
fi

echo ""
echo -e "${GREEN}=== Step 3: Create Redis Replication Group ===${NC}"

REPLICATION_GROUP_ID="${CLUSTER_NAME}-${ENVIRONMENT}"

# Check if replication group already exists
if aws elasticache describe-replication-groups \
    --replication-group-id "$REPLICATION_GROUP_ID" &> /dev/null; then
    echo -e "${YELLOW}Redis cluster already exists${NC}"

    # Get endpoint
    ENDPOINT=$(aws elasticache describe-replication-groups \
        --replication-group-id "$REPLICATION_GROUP_ID" \
        --query 'ReplicationGroups[0].NodeGroups[0].PrimaryEndpoint.Address' \
        --output text)

    echo -e "${GREEN}Endpoint: $ENDPOINT${NC}"
else
    echo "Creating Redis cluster (this takes 5-10 minutes)..."

    # Determine if automatic failover should be enabled
    AUTOMATIC_FAILOVER="false"
    if [ $NUM_REPLICAS -gt 0 ]; then
        AUTOMATIC_FAILOVER="true"
    fi

    aws elasticache create-replication-group \
        --replication-group-id "$REPLICATION_GROUP_ID" \
        --replication-group-description "Redis for Qontinui $ENVIRONMENT" \
        --engine redis \
        --engine-version "7.0" \
        --cache-node-type "$NODE_TYPE" \
        --num-cache-clusters $((NUM_REPLICAS + 1)) \
        --cache-subnet-group-name "$SUBNET_GROUP_NAME" \
        --security-group-ids "$SG_ID" \
        --at-rest-encryption-enabled \
        --transit-encryption-enabled \
        --automatic-failover-enabled \
        --snapshot-retention-limit "$SNAPSHOT_RETENTION" \
        --snapshot-window "03:00-05:00" \
        --preferred-maintenance-window "mon:05:00-mon:07:00" \
        --tags "Key=Name,Value=${REPLICATION_GROUP_ID}" \
              "Key=Environment,Value=${ENVIRONMENT}" \
              "Key=Application,Value=Qontinui" \
        > /dev/null

    echo -e "${YELLOW}Waiting for cluster to become available...${NC}"

    # Wait for cluster to be available
    aws elasticache wait replication-group-available \
        --replication-group-id "$REPLICATION_GROUP_ID"

    echo -e "${GREEN}✓ Redis cluster created${NC}"

    # Get endpoint
    ENDPOINT=$(aws elasticache describe-replication-groups \
        --replication-group-id "$REPLICATION_GROUP_ID" \
        --query 'ReplicationGroups[0].NodeGroups[0].PrimaryEndpoint.Address' \
        --output text)
fi

echo ""
echo -e "${GREEN}=== Setup Complete! ===${NC}"
echo ""
echo "Redis Cluster Details:"
echo "  Cluster ID: $REPLICATION_GROUP_ID"
echo "  Endpoint: $ENDPOINT"
echo "  Port: 6379"
echo "  Node Type: $NODE_TYPE"
echo "  Replicas: $NUM_REPLICAS"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "1. Update your application environment variables:"
echo "   export REDIS_HOST=$ENDPOINT"
echo "   export REDIS_PORT=6379"
echo ""
echo "2. Deploy your backend with updated configuration"
echo ""
echo "3. Deploy your worker process (see docs/AWS_ELASTICACHE_SETUP.md)"
echo ""
echo "4. Set up CloudWatch alarms for monitoring:"
echo "   - CPUUtilization > 75%"
echo "   - EngineCPUUtilization > 75%"
echo "   - CurrConnections > 1000"
echo ""
echo -e "${GREEN}Documentation: backend/docs/AWS_ELASTICACHE_SETUP.md${NC}"
