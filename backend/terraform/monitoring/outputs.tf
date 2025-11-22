output "sns_topic_arn" {
  description = "ARN of the SNS topic for alerts"
  value       = aws_sns_topic.alerts.arn
}

output "sns_topic_name" {
  description = "Name of the SNS topic"
  value       = aws_sns_topic.alerts.name
}

output "dashboard_name" {
  description = "Name of the CloudWatch dashboard"
  value       = aws_cloudwatch_dashboard.main.dashboard_name
}

output "dashboard_url" {
  description = "URL to access the CloudWatch dashboard"
  value       = "https://console.aws.amazon.com/cloudwatch/home?region=${var.region}#dashboards:name=${aws_cloudwatch_dashboard.main.dashboard_name}"
}

output "alarm_arns" {
  description = "ARNs of all CloudWatch alarms"
  value = {
    environment_health_degraded = aws_cloudwatch_metric_alarm.environment_health_degraded.arn
    environment_health_severe   = aws_cloudwatch_metric_alarm.environment_health_severe.arn
    application_5xx_errors      = aws_cloudwatch_metric_alarm.application_5xx_errors.arn
    response_time_high          = aws_cloudwatch_metric_alarm.response_time_high.arn
    rds_cpu_high                = aws_cloudwatch_metric_alarm.rds_cpu_high.arn
    rds_storage_low             = aws_cloudwatch_metric_alarm.rds_storage_low.arn
    rds_connections_high        = aws_cloudwatch_metric_alarm.rds_connections_high.arn
    instance_health             = aws_cloudwatch_metric_alarm.instance_health.arn
  }
}

output "subscription_status" {
  description = "Status of the SNS email subscription (will be PendingConfirmation until confirmed)"
  value       = aws_sns_topic_subscription.alert_email.pending_confirmation ? "PendingConfirmation - Check your email to confirm" : "Confirmed"
}
