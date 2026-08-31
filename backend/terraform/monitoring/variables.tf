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

# ⚠️ STALE REGION — see the warning at the top of README.md.
# This default feeds provider "aws" in main.tf, so it decides the region EVERY
# alarm in this root is created in. The RDS instance it alarms on lives in
# us-east-1; eu-central-1 holds only the SSM secrets store.
#
# This does NOT silently create wrong-region alarms. main.tf:166 looks the
# database up via `data "aws_db_instance"`, and a data block errors when it finds
# nothing -- so with this default, `terraform plan` aborts before creating
# anything. The root is un-appliable as configured, which is louder and safer
# than the alternative.
#
# Deliberately NOT corrected in place: this root also alarms on Elastic
# Beanstalk (qontinui-prod-py), which production no longer runs, so changing the
# region alone would leave a stale stack looking current. Whether the fix is
# "retarget this" or "delete this whole root" depends on whether it was ever
# applied. The correctly-regioned monitoring that IS live is
# qontinui-stack/aws/modules/observability.
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
