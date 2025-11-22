resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "${var.environment_name}-dashboard"

  dashboard_body = jsonencode({
    widgets = [
      # Environment Health
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/ElasticBeanstalk", "EnvironmentHealth", { stat = "Average", label = "Environment Health" }]
          ]
          period = 300
          stat   = "Average"
          region = var.region
          title  = "Environment Health"
          yAxis = {
            left = {
              min = 0
              max = 100
            }
          }
        }
      },

      # Application Requests
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/ElasticBeanstalk", "ApplicationRequestsTotal", { stat = "Sum", label = "Total Requests" }],
            [".", "ApplicationRequests2xx", { stat = "Sum", label = "2xx Responses" }],
            [".", "ApplicationRequests4xx", { stat = "Sum", label = "4xx Errors" }],
            [".", "ApplicationRequests5xx", { stat = "Sum", label = "5xx Errors" }]
          ]
          period = 300
          stat   = "Sum"
          region = var.region
          title  = "Application Requests"
        }
      },

      # Response Time (Latency)
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/ElasticBeanstalk", "ApplicationLatencyP50", { stat = "Average", label = "P50" }],
            [".", "ApplicationLatencyP75", { stat = "Average", label = "P75" }],
            [".", "ApplicationLatencyP90", { stat = "Average", label = "P90" }],
            [".", "ApplicationLatencyP95", { stat = "Average", label = "P95" }],
            [".", "ApplicationLatencyP99", { stat = "Average", label = "P99" }]
          ]
          period = 300
          stat   = "Average"
          region = var.region
          title  = "Application Latency (Percentiles)"
          yAxis = {
            left = {
              label = "Seconds"
            }
          }
        }
      },

      # RDS CPU Utilization
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", data.aws_db_instance.main.id, { stat = "Average", label = "CPU %" }]
          ]
          period = 300
          stat   = "Average"
          region = var.region
          title  = "RDS CPU Utilization"
          yAxis = {
            left = {
              min = 0
              max = 100
            }
          }
        }
      },

      # RDS Connections
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/RDS", "DatabaseConnections", "DBInstanceIdentifier", data.aws_db_instance.main.id, { stat = "Average", label = "Connections" }]
          ]
          period = 300
          stat   = "Average"
          region = var.region
          title  = "RDS Database Connections"
        }
      },

      # RDS Storage
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/RDS", "FreeStorageSpace", "DBInstanceIdentifier", data.aws_db_instance.main.id, { stat = "Average", label = "Free Storage" }]
          ]
          period = 300
          stat   = "Average"
          region = var.region
          title  = "RDS Free Storage Space"
          yAxis = {
            left = {
              label = "Bytes"
            }
          }
        }
      },

      # RDS Read/Write IOPS
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/RDS", "ReadIOPS", "DBInstanceIdentifier", data.aws_db_instance.main.id, { stat = "Average", label = "Read IOPS" }],
            [".", "WriteIOPS", ".", ".", { stat = "Average", label = "Write IOPS" }]
          ]
          period = 300
          stat   = "Average"
          region = var.region
          title  = "RDS IOPS"
        }
      },

      # RDS Latency
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/RDS", "ReadLatency", "DBInstanceIdentifier", data.aws_db_instance.main.id, { stat = "Average", label = "Read Latency" }],
            [".", "WriteLatency", ".", ".", { stat = "Average", label = "Write Latency" }]
          ]
          period = 300
          stat   = "Average"
          region = var.region
          title  = "RDS Latency"
          yAxis = {
            left = {
              label = "Seconds"
            }
          }
        }
      },

      # EC2 Instance CPU
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/EC2", "CPUUtilization", { stat = "Average", label = "CPU %" }]
          ]
          period = 300
          stat   = "Average"
          region = var.region
          title  = "EC2 Instance CPU Utilization"
          yAxis = {
            left = {
              min = 0
              max = 100
            }
          }
        }
      },

      # EC2 Network Traffic
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/EC2", "NetworkIn", { stat = "Sum", label = "Network In" }],
            [".", "NetworkOut", { stat = "Sum", label = "Network Out" }]
          ]
          period = 300
          stat   = "Sum"
          region = var.region
          title  = "EC2 Network Traffic"
          yAxis = {
            left = {
              label = "Bytes"
            }
          }
        }
      },

      # Alarm Status
      {
        type = "alarm"
        properties = {
          title  = "Alarm Status"
          alarms = [
            aws_cloudwatch_metric_alarm.environment_health_degraded.arn,
            aws_cloudwatch_metric_alarm.environment_health_severe.arn,
            aws_cloudwatch_metric_alarm.application_5xx_errors.arn,
            aws_cloudwatch_metric_alarm.response_time_high.arn,
            aws_cloudwatch_metric_alarm.rds_cpu_high.arn,
            aws_cloudwatch_metric_alarm.rds_storage_low.arn,
            aws_cloudwatch_metric_alarm.rds_connections_high.arn,
            aws_cloudwatch_metric_alarm.instance_health.arn
          ]
        }
      }
    ]
  })
}
