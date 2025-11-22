###############################################################################
# VPC Endpoints Module
#
# Creates VPC endpoints to avoid NAT Gateway charges
# - S3 Gateway Endpoint (FREE) - Saves ~$32/month in NAT costs
# - Secrets Manager Interface Endpoint (Optional, ~$7/month but more secure)
###############################################################################

variable "vpc_id" {
  description = "VPC ID where endpoints will be created"
  type        = string
}

variable "route_table_ids" {
  description = "Route table IDs for gateway endpoints"
  type        = list(string)
}

variable "subnet_ids" {
  description = "Subnet IDs for interface endpoints"
  type        = list(string)
  default     = []
}

variable "security_group_ids" {
  description = "Security group IDs for interface endpoints"
  type        = list(string)
  default     = []
}

variable "create_secrets_manager_endpoint" {
  description = "Whether to create Secrets Manager endpoint (costs $7/month)"
  type        = bool
  default     = false
}

###############################################################################
# S3 Gateway Endpoint (FREE - Highly Recommended)
###############################################################################

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = var.vpc_id
  service_name      = "com.amazonaws.eu-central-1.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = var.route_table_ids

  tags = {
    Name      = "qontinui-s3-endpoint"
    ManagedBy = "terraform"
  }
}

# S3 endpoint policy (allow all access from this VPC)
resource "aws_vpc_endpoint_policy" "s3" {
  vpc_endpoint_id = aws_vpc_endpoint.s3.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = "*"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ]
        Resource = "*"
      }
    ]
  })
}

###############################################################################
# Secrets Manager Interface Endpoint (Optional, $7/month)
###############################################################################

resource "aws_vpc_endpoint" "secretsmanager" {
  count = var.create_secrets_manager_endpoint ? 1 : 0

  vpc_id              = var.vpc_id
  service_name        = "com.amazonaws.eu-central-1.secretsmanager"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = var.subnet_ids
  security_group_ids  = var.security_group_ids
  private_dns_enabled = true

  tags = {
    Name      = "qontinui-secretsmanager-endpoint"
    ManagedBy = "terraform"
  }
}

###############################################################################
# Outputs
###############################################################################

output "s3_endpoint_id" {
  description = "ID of the S3 VPC endpoint"
  value       = aws_vpc_endpoint.s3.id
}

output "s3_endpoint_prefix_list_id" {
  description = "Prefix list ID of the S3 VPC endpoint"
  value       = aws_vpc_endpoint.s3.prefix_list_id
}

output "secretsmanager_endpoint_id" {
  description = "ID of the Secrets Manager VPC endpoint"
  value       = var.create_secrets_manager_endpoint ? aws_vpc_endpoint.secretsmanager[0].id : null
}

output "estimated_monthly_savings" {
  description = "Estimated monthly cost savings from using VPC endpoints"
  value       = "~$32/month (avoided NAT Gateway data transfer charges)"
}
