terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

# SNS Topic for Alerts
resource "aws_sns_topic" "alerts" {
  name              = "${var.environment_name}-alerts"
  display_name      = "Qontinui Production Alerts"
  kms_master_key_id = "alias/aws/sns"

  tags = {
    Environment = var.environment_name
    Application = var.application_name
    ManagedBy   = "Terraform"
  }
}

# SNS Topic Subscription (Email)
resource "aws_sns_topic_subscription" "alert_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# CloudWatch Alarm: Environment Health - Degraded
resource "aws_cloudwatch_metric_alarm" "environment_health_degraded" {
  alarm_name          = "${var.environment_name}-health-degraded"
  alarm_description   = "Environment health has degraded below ${var.health_degraded_threshold}%"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = var.alarm_evaluation_periods
  metric_name         = "EnvironmentHealth"
  namespace           = "AWS/ElasticBeanstalk"
  period              = var.alarm_period
  statistic           = "Average"
  threshold           = var.health_degraded_threshold
  treat_missing_data  = "breaching"

  dimensions = {
    EnvironmentName = var.environment_name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = {
    Environment = var.environment_name
    Severity    = "Warning"
  }
}

# CloudWatch Alarm: Environment Health - Severe
resource "aws_cloudwatch_metric_alarm" "environment_health_severe" {
  alarm_name          = "${var.environment_name}-health-severe"
  alarm_description   = "CRITICAL: Environment health has dropped below ${var.health_severe_threshold}%"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1 # Immediate alert for severe issues
  metric_name         = "EnvironmentHealth"
  namespace           = "AWS/ElasticBeanstalk"
  period              = 60 # Check every minute
  statistic           = "Average"
  threshold           = var.health_severe_threshold
  treat_missing_data  = "breaching"

  dimensions = {
    EnvironmentName = var.environment_name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = {
    Environment = var.environment_name
    Severity    = "Critical"
  }
}

# CloudWatch Alarm: Application 5xx Errors
resource "aws_cloudwatch_metric_alarm" "application_5xx_errors" {
  alarm_name          = "${var.environment_name}-5xx-errors-high"
  alarm_description   = "5xx error rate exceeds ${var.error_rate_threshold}%"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = var.alarm_evaluation_periods
  threshold           = var.error_rate_threshold
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "error_rate"
    expression  = "(m2/m1)*100"
    label       = "5xx Error Rate"
    return_data = true
  }

  metric_query {
    id = "m1"
    metric {
      metric_name = "RequestCount"
      namespace   = "AWS/ElasticBeanstalk"
      period      = var.alarm_period
      stat        = "Sum"
      dimensions = {
        EnvironmentName = var.environment_name
      }
    }
  }

  metric_query {
    id = "m2"
    metric {
      metric_name = "ApplicationRequestsTotal"
      namespace   = "AWS/ElasticBeanstalk"
      period      = var.alarm_period
      stat        = "Sum"
      dimensions = {
        EnvironmentName = var.environment_name
      }
    }
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = {
    Environment = var.environment_name
    Severity    = "Warning"
  }
}

# CloudWatch Alarm: Response Time
resource "aws_cloudwatch_metric_alarm" "response_time_high" {
  alarm_name          = "${var.environment_name}-response-time-high"
  alarm_description   = "Average response time exceeds ${var.response_time_threshold} seconds"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = var.alarm_evaluation_periods
  metric_name         = "ApplicationLatencyP99"
  namespace           = "AWS/ElasticBeanstalk"
  period              = var.alarm_period
  statistic           = "Average"
  threshold           = var.response_time_threshold
  treat_missing_data  = "notBreaching"

  dimensions = {
    EnvironmentName = var.environment_name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = {
    Environment = var.environment_name
    Severity    = "Warning"
  }
}

# Data source to find RDS instance
data "aws_db_instance" "main" {
  db_instance_identifier = "qontinui-db"
}

# CloudWatch Alarm: RDS CPU Utilization
resource "aws_cloudwatch_metric_alarm" "rds_cpu_high" {
  alarm_name          = "${var.environment_name}-rds-cpu-high"
  alarm_description   = "RDS CPU utilization exceeds ${var.rds_cpu_threshold}%"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = var.alarm_evaluation_periods
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = var.alarm_period
  statistic           = "Average"
  threshold           = var.rds_cpu_threshold
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = data.aws_db_instance.main.id
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = {
    Environment = var.environment_name
    Severity    = "Warning"
  }
}

# CloudWatch Alarm: RDS Free Storage Space
resource "aws_cloudwatch_metric_alarm" "rds_storage_low" {
  alarm_name          = "${var.environment_name}-rds-storage-low"
  alarm_description   = "RDS free storage space is below ${var.rds_storage_threshold / 1073741824} GB"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = var.alarm_evaluation_periods
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  period              = var.alarm_period
  statistic           = "Average"
  threshold           = var.rds_storage_threshold
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = data.aws_db_instance.main.id
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = {
    Environment = var.environment_name
    Severity    = "Warning"
  }
}

# CloudWatch Alarm: RDS Database Connections
resource "aws_cloudwatch_metric_alarm" "rds_connections_high" {
  alarm_name          = "${var.environment_name}-rds-connections-high"
  alarm_description   = "RDS database connections exceed ${var.rds_connections_threshold}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = var.alarm_evaluation_periods
  metric_name         = "DatabaseConnections"
  namespace           = "AWS/RDS"
  period              = var.alarm_period
  statistic           = "Average"
  threshold           = var.rds_connections_threshold
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = data.aws_db_instance.main.id
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = {
    Environment = var.environment_name
    Severity    = "Warning"
  }
}

# CloudWatch Alarm: Instance Health (EC2)
resource "aws_cloudwatch_metric_alarm" "instance_health" {
  alarm_name          = "${var.environment_name}-instance-health"
  alarm_description   = "EC2 instance health check failed"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  metric_name         = "StatusCheckFailed"
  namespace           = "AWS/EC2"
  period              = 60
  statistic           = "Maximum"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = {
    Environment = var.environment_name
    Severity    = "Critical"
  }
}
