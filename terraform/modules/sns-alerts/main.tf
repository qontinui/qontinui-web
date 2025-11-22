/**
 * SNS Topic and Email Alerts Module
 *
 * Creates SNS topic for CloudWatch alarm notifications
 * Free tier: 1,000 email notifications/month (then $2 per 100,000)
 *
 * Usage:
 *   module "sns_alerts" {
 *     source      = "./modules/sns-alerts"
 *     environment = "production"
 *     email_addresses = ["admin@qontinui.io"]
 *   }
 */

variable "environment" {
  description = "Environment name (development, staging, production)"
  type        = string
}

variable "email_addresses" {
  description = "List of email addresses to receive alerts"
  type        = list(string)
}

variable "project_name" {
  description = "Project name for resource naming"
  type        = string
  default     = "qontinui"
}

# SNS Topic for Critical Alerts (P0 - requires immediate attention)
resource "aws_sns_topic" "critical_alerts" {
  name         = "${var.project_name}-${var.environment}-critical-alerts"
  display_name = "Qontinui Critical Alerts (P0)"

  tags = {
    Name        = "${var.project_name}-${var.environment}-critical-alerts"
    Environment = var.environment
    Priority    = "P0"
    ManagedBy   = "terraform"
  }
}

# SNS Topic for Warning Alerts (P1 - requires attention within hours)
resource "aws_sns_topic" "warning_alerts" {
  name         = "${var.project_name}-${var.environment}-warning-alerts"
  display_name = "Qontinui Warning Alerts (P1)"

  tags = {
    Name        = "${var.project_name}-${var.environment}-warning-alerts"
    Environment = var.environment
    Priority    = "P1"
    ManagedBy   = "terraform"
  }
}

# SNS Topic for Info Alerts (P2 - FYI, no immediate action needed)
resource "aws_sns_topic" "info_alerts" {
  name         = "${var.project_name}-${var.environment}-info-alerts"
  display_name = "Qontinui Info Alerts (P2)"

  tags = {
    Name        = "${var.project_name}-${var.environment}-info-alerts"
    Environment = var.environment
    Priority    = "P2"
    ManagedBy   = "terraform"
  }
}

# Email Subscriptions for Critical Alerts (P0)
resource "aws_sns_topic_subscription" "critical_email" {
  for_each  = toset(var.email_addresses)
  topic_arn = aws_sns_topic.critical_alerts.arn
  protocol  = "email"
  endpoint  = each.value

  # Note: Subscribers must confirm subscription via email
}

# Email Subscriptions for Warning Alerts (P1)
resource "aws_sns_topic_subscription" "warning_email" {
  for_each  = toset(var.email_addresses)
  topic_arn = aws_sns_topic.warning_alerts.arn
  protocol  = "email"
  endpoint  = each.value
}

# Email Subscriptions for Info Alerts (P2)
# Only subscribe to info alerts in production (avoid noise in dev/staging)
resource "aws_sns_topic_subscription" "info_email" {
  for_each  = var.environment == "production" ? toset(var.email_addresses) : []
  topic_arn = aws_sns_topic.info_alerts.arn
  protocol  = "email"
  endpoint  = each.value
}

# SNS Topic Policy (allow CloudWatch to publish)
data "aws_iam_policy_document" "sns_topic_policy" {
  statement {
    sid    = "AllowCloudWatchToPublish"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com"]
    }

    actions = [
      "SNS:Publish",
    ]

    resources = [
      aws_sns_topic.critical_alerts.arn,
      aws_sns_topic.warning_alerts.arn,
      aws_sns_topic.info_alerts.arn,
    ]
  }

  statement {
    sid    = "AllowAccountOwnerToManage"
    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = ["*"]
    }

    actions = [
      "SNS:GetTopicAttributes",
      "SNS:SetTopicAttributes",
      "SNS:AddPermission",
      "SNS:RemovePermission",
      "SNS:DeleteTopic",
      "SNS:Subscribe",
      "SNS:ListSubscriptionsByTopic",
      "SNS:Publish",
    ]

    resources = [
      aws_sns_topic.critical_alerts.arn,
      aws_sns_topic.warning_alerts.arn,
      aws_sns_topic.info_alerts.arn,
    ]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceOwner"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

data "aws_caller_identity" "current" {}

# Apply policy to topics
resource "aws_sns_topic_policy" "critical_alerts" {
  arn    = aws_sns_topic.critical_alerts.arn
  policy = data.aws_iam_policy_document.sns_topic_policy.json
}

resource "aws_sns_topic_policy" "warning_alerts" {
  arn    = aws_sns_topic.warning_alerts.arn
  policy = data.aws_iam_policy_document.sns_topic_policy.json
}

resource "aws_sns_topic_policy" "info_alerts" {
  arn    = aws_sns_topic.info_alerts.arn
  policy = data.aws_iam_policy_document.sns_topic_policy.json
}

# Outputs
output "critical_alerts_topic_arn" {
  description = "ARN of the critical alerts SNS topic (P0)"
  value       = aws_sns_topic.critical_alerts.arn
}

output "warning_alerts_topic_arn" {
  description = "ARN of the warning alerts SNS topic (P1)"
  value       = aws_sns_topic.warning_alerts.arn
}

output "info_alerts_topic_arn" {
  description = "ARN of the info alerts SNS topic (P2)"
  value       = aws_sns_topic.info_alerts.arn
}

output "subscription_confirmation_required" {
  description = "Reminder to check email and confirm SNS subscriptions"
  value       = "⚠️ Check your email (${join(", ", var.email_addresses)}) and confirm SNS subscription links"
}

output "estimated_monthly_cost" {
  description = "Estimated monthly cost for SNS email notifications"
  value       = "Free tier: 1,000 emails/month. Beyond that: ~$0.02 per 100 emails"
}
