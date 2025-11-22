variable "environment_name" {
  description = "Elastic Beanstalk environment name"
  type        = string
  default     = "qontinui-prod-py"
}

variable "application_name" {
  description = "Elastic Beanstalk application name"
  type        = string
  default     = "qontinui-backend"
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "eu-central-1"
}

variable "alert_email" {
  description = "Email address for CloudWatch alerts"
  type        = string
  # Set via environment variable: TF_VAR_alert_email
}

variable "alarm_evaluation_periods" {
  description = "Number of periods to evaluate for alarm state"
  type        = number
  default     = 2
}

variable "alarm_period" {
  description = "Period in seconds for alarm evaluation"
  type        = number
  default     = 300 # 5 minutes
}

# Health Check Thresholds
variable "health_degraded_threshold" {
  description = "Threshold for degraded health alarm (percentage)"
  type        = number
  default     = 50 # Alert if health drops below 50%
}

variable "health_severe_threshold" {
  description = "Threshold for severe health alarm (percentage)"
  type        = number
  default     = 25 # Alert if health drops below 25%
}

# Application Thresholds
variable "error_rate_threshold" {
  description = "Threshold for 5xx error rate (percentage)"
  type        = number
  default     = 5 # Alert if 5xx errors exceed 5%
}

variable "response_time_threshold" {
  description = "Threshold for average response time (seconds)"
  type        = number
  default     = 2 # Alert if avg response time exceeds 2 seconds
}

# RDS Thresholds
variable "rds_cpu_threshold" {
  description = "Threshold for RDS CPU utilization (percentage)"
  type        = number
  default     = 80
}

variable "rds_storage_threshold" {
  description = "Threshold for RDS free storage space (bytes)"
  type        = number
  default     = 5368709120 # 5 GB in bytes
}

variable "rds_connections_threshold" {
  description = "Threshold for RDS database connections"
  type        = number
  default     = 80 # Alert at 80% of max connections
}
