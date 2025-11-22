###############################################################################
# CloudWatch Alarms and Dashboard Module
#
# Creates CloudWatch alarms for monitoring and a centralized dashboard
# Cost: Free for first 10 alarms and 3 dashboards
###############################################################################

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
}

variable "alb_arn_suffix" {
  description = "ARN suffix of the Application Load Balancer"
  type        = string
}

variable "rds_instance_id" {
  description = "RDS instance identifier"
  type        = string
}

variable "sns_topic_arn" {
  description = "SNS topic ARN for alarm notifications"
  type        = string
}

###############################################################################
# P0: Critical Alarms (Immediate Response Required)
###############################################################################

resource "aws_cloudwatch_metric_alarm" "api_error_rate_critical" {
  alarm_name          = "${var.environment}-api-error-rate-critical"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 300  # 5 minutes
  statistic           = "Sum"
  threshold           = 50  # 50 errors in 5 minutes
  alarm_description   = "P0: API returning high 5XX error rate"
  alarm_actions       = [var.sns_topic_arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = var.alb_arn_suffix
  }

  tags = {
    Name        = "${var.environment}-api-error-rate-critical"
    Environment = var.environment
    Priority    = "P0"
  }
}

resource "aws_cloudwatch_metric_alarm" "database_connections_exhausted" {
  alarm_name          = "${var.environment}-database-connections-exhausted"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "DatabaseConnections"
  namespace           = "AWS/RDS"
  period              = 60
  statistic           = "Average"
  threshold           = 15  # 15 connections (out of 20 max for db.t3.medium)
  alarm_description   = "P0: Database connection pool nearly exhausted"
  alarm_actions       = [var.sns_topic_arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = var.rds_instance_id
  }

  tags = {
    Name        = "${var.environment}-database-connections-exhausted"
    Environment = var.environment
    Priority    = "P0"
  }
}

resource "aws_cloudwatch_metric_alarm" "rds_storage_critical" {
  alarm_name          = "${var.environment}-rds-storage-critical"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 5368709120  # 5 GB in bytes
  alarm_description   = "P0: RDS storage space critically low"
  alarm_actions       = [var.sns_topic_arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = var.rds_instance_id
  }

  tags = {
    Name        = "${var.environment}-rds-storage-critical"
    Environment = var.environment
    Priority    = "P0"
  }
}

###############################################################################
# P1: High Priority Alarms (Response Within 1 Hour)
###############################################################################

resource "aws_cloudwatch_metric_alarm" "api_latency_high" {
  alarm_name          = "${var.environment}-api-latency-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "TargetResponseTime"
  namespace           = "AWS/ApplicationELB"
  period              = 300
  statistic           = "Average"
  threshold           = 1.0  # 1 second
  alarm_description   = "P1: API latency degraded"
  alarm_actions       = [var.sns_topic_arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = var.alb_arn_suffix
  }

  tags = {
    Name        = "${var.environment}-api-latency-high"
    Environment = var.environment
    Priority    = "P1"
  }
}

resource "aws_cloudwatch_metric_alarm" "api_4xx_error_rate" {
  alarm_name          = "${var.environment}-api-4xx-error-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "HTTPCode_Target_4XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 300
  statistic           = "Sum"
  threshold           = 100  # 100 client errors in 5 minutes
  alarm_description   = "P1: High client error rate (may indicate API issues)"
  alarm_actions       = [var.sns_topic_arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = var.alb_arn_suffix
  }

  tags = {
    Name        = "${var.environment}-api-4xx-error-rate"
    Environment = var.environment
    Priority    = "P1"
  }
}

###############################################################################
# P2: Medium Priority Alarms (Response Within 4 Hours)
###############################################################################

resource "aws_cloudwatch_metric_alarm" "rds_cpu_high" {
  alarm_name          = "${var.environment}-rds-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "P2: RDS CPU utilization high"
  alarm_actions       = [var.sns_topic_arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = var.rds_instance_id
  }

  tags = {
    Name        = "${var.environment}-rds-cpu-high"
    Environment = var.environment
    Priority    = "P2"
  }
}

resource "aws_cloudwatch_metric_alarm" "rds_memory_low" {
  alarm_name          = "${var.environment}-rds-memory-low"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 3
  metric_name         = "FreeableMemory"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 536870912  # 512 MB in bytes
  alarm_description   = "P2: RDS freeable memory low"
  alarm_actions       = [var.sns_topic_arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = var.rds_instance_id
  }

  tags = {
    Name        = "${var.environment}-rds-memory-low"
    Environment = var.environment
    Priority    = "P2"
  }
}

###############################################################################
# CloudWatch Dashboard
###############################################################################

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "Qontinui-${var.environment}"

  dashboard_body = jsonencode({
    widgets = [
      # Row 1: API Metrics
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["AWS/ApplicationELB", "RequestCount", { stat = "Sum", label = "Total Requests", yAxis = "left" }]
          ]
          period = 300
          stat   = "Sum"
          region = "eu-central-1"
          title  = "API Request Rate"
          yAxis = {
            left = {
              label = "Requests"
            }
          }
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["AWS/ApplicationELB", "HTTPCode_Target_2XX_Count", { stat = "Sum", label = "2XX Success", color = "#2ca02c" }],
            [".", "HTTPCode_Target_4XX_Count", { stat = "Sum", label = "4XX Client Error", color = "#ff7f0e" }],
            [".", "HTTPCode_Target_5XX_Count", { stat = "Sum", label = "5XX Server Error", color = "#d62728" }]
          ]
          period = 300
          stat   = "Sum"
          region = "eu-central-1"
          title  = "API Status Code Distribution"
          yAxis = {
            left = {
              label = "Count"
            }
          }
        }
      },

      # Row 2: API Latency
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["AWS/ApplicationELB", "TargetResponseTime", { stat = "p50", label = "p50", color = "#1f77b4" }],
            ["...", { stat = "p95", label = "p95", color = "#ff7f0e" }],
            ["...", { stat = "p99", label = "p99", color = "#d62728" }],
            ["...", { stat = "Average", label = "Average", color = "#2ca02c" }]
          ]
          period = 300
          region = "eu-central-1"
          title  = "API Latency (Percentiles)"
          yAxis = {
            left = {
              label = "Seconds"
            }
          }
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["AWS/ApplicationELB", "TargetConnectionErrorCount", { stat = "Sum", label = "Connection Errors" }],
            [".", "RejectedConnectionCount", { stat = "Sum", label = "Rejected Connections" }]
          ]
          period = 300
          stat   = "Sum"
          region = "eu-central-1"
          title  = "Connection Errors"
          yAxis = {
            left = {
              label = "Count"
            }
          }
        }
      },

      # Row 3: RDS Metrics
      {
        type   = "metric"
        x      = 0
        y      = 12
        width  = 8
        height = 6
        properties = {
          metrics = [
            ["AWS/RDS", "CPUUtilization", { DBInstanceIdentifier = var.rds_instance_id, stat = "Average" }]
          ]
          period = 300
          stat   = "Average"
          region = "eu-central-1"
          title  = "RDS CPU Utilization"
          yAxis = {
            left = {
              min = 0
              max = 100
              label = "Percent"
            }
          }
        }
      },
      {
        type   = "metric"
        x      = 8
        y      = 12
        width  = 8
        height = 6
        properties = {
          metrics = [
            ["AWS/RDS", "DatabaseConnections", { DBInstanceIdentifier = var.rds_instance_id, stat = "Average" }]
          ]
          period = 300
          stat   = "Average"
          region = "eu-central-1"
          title  = "RDS Database Connections"
          yAxis = {
            left = {
              min = 0
              label = "Connections"
            }
          }
        }
      },
      {
        type   = "metric"
        x      = 16
        y      = 12
        width  = 8
        height = 6
        properties = {
          metrics = [
            ["AWS/RDS", "FreeableMemory", { DBInstanceIdentifier = var.rds_instance_id, stat = "Average" }]
          ]
          period = 300
          stat   = "Average"
          region = "eu-central-1"
          title  = "RDS Freeable Memory"
          yAxis = {
            left = {
              label = "Bytes"
            }
          }
        }
      },

      # Row 4: RDS Storage and I/O
      {
        type   = "metric"
        x      = 0
        y      = 18
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["AWS/RDS", "FreeStorageSpace", { DBInstanceIdentifier = var.rds_instance_id, stat = "Average" }]
          ]
          period = 300
          stat   = "Average"
          region = "eu-central-1"
          title  = "RDS Free Storage Space"
          yAxis = {
            left = {
              label = "Bytes"
            }
          }
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 18
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["AWS/RDS", "ReadLatency", { DBInstanceIdentifier = var.rds_instance_id, stat = "Average", label = "Read Latency" }],
            [".", "WriteLatency", { DBInstanceIdentifier = var.rds_instance_id, stat = "Average", label = "Write Latency" }]
          ]
          period = 300
          stat   = "Average"
          region = "eu-central-1"
          title  = "RDS I/O Latency"
          yAxis = {
            left = {
              label = "Seconds"
            }
          }
        }
      }
    ]
  })
}

###############################################################################
# Outputs
###############################################################################

output "dashboard_url" {
  description = "URL to CloudWatch dashboard"
  value       = "https://console.aws.amazon.com/cloudwatch/home?region=eu-central-1#dashboards:name=${aws_cloudwatch_dashboard.main.dashboard_name}"
}

output "alarm_arns" {
  description = "ARNs of all created alarms"
  value = {
    api_error_rate_critical       = aws_cloudwatch_metric_alarm.api_error_rate_critical.arn
    database_connections_exhausted = aws_cloudwatch_metric_alarm.database_connections_exhausted.arn
    rds_storage_critical          = aws_cloudwatch_metric_alarm.rds_storage_critical.arn
    api_latency_high              = aws_cloudwatch_metric_alarm.api_latency_high.arn
    api_4xx_error_rate            = aws_cloudwatch_metric_alarm.api_4xx_error_rate.arn
    rds_cpu_high                  = aws_cloudwatch_metric_alarm.rds_cpu_high.arn
    rds_memory_low                = aws_cloudwatch_metric_alarm.rds_memory_low.arn
  }
}
