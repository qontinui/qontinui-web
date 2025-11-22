# CloudWatch Monitoring Infrastructure

This Terraform configuration sets up comprehensive monitoring for the Qontinui production environment on AWS Elastic Beanstalk.

## What This Creates

### SNS Topic & Email Alerts
- **SNS Topic**: `qontinui-prod-py-alerts`
- **Email Subscription**: Sends alert notifications to specified email address
- **Encryption**: Uses AWS managed KMS key for SNS

### CloudWatch Alarms

#### Application Health
1. **Environment Health - Degraded** (Warning)
   - Triggers when environment health drops below 50%
   - Evaluation: 2 periods of 5 minutes

2. **Environment Health - Severe** (Critical)
   - Triggers when environment health drops below 25%
   - Evaluation: 1 period of 1 minute (immediate alert)

#### Application Performance
3. **5xx Error Rate** (Warning)
   - Triggers when 5xx errors exceed 5% of total requests
   - Evaluation: 2 periods of 5 minutes

4. **Response Time** (Warning)
   - Triggers when P99 latency exceeds 2 seconds
   - Evaluation: 2 periods of 5 minutes

#### RDS Database
5. **CPU Utilization** (Warning)
   - Triggers when RDS CPU exceeds 80%
   - Evaluation: 2 periods of 5 minutes

6. **Free Storage Space** (Warning)
   - Triggers when free storage drops below 5 GB
   - Evaluation: 2 periods of 5 minutes

7. **Database Connections** (Warning)
   - Triggers when connections exceed 80
   - Evaluation: 2 periods of 5 minutes

#### EC2 Instance
8. **Instance Health** (Critical)
   - Triggers when EC2 status checks fail
   - Evaluation: 2 periods of 1 minute

### CloudWatch Dashboard

A comprehensive dashboard displaying:
- Environment health metrics
- Application request counts and error rates
- Response time percentiles (P50, P75, P90, P95, P99)
- RDS metrics (CPU, connections, storage, IOPS, latency)
- EC2 metrics (CPU, network traffic)
- Alarm status overview

## Prerequisites

1. **Terraform** installed (version >= 1.0)
   ```bash
   # Install Terraform (macOS)
   brew tap hashicorp/tap
   brew install hashicorp/tap/terraform

   # Install Terraform (Ubuntu/Debian)
   wget -O- https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
   echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
   sudo apt update && sudo apt install terraform
   ```

2. **AWS CLI** configured with credentials
   ```bash
   aws configure
   # Enter your AWS Access Key ID, Secret Access Key, and region (eu-central-1)
   ```

3. **AWS Permissions** - Your AWS user/role needs permissions for:
   - CloudWatch (alarms, dashboards)
   - SNS (topics, subscriptions)
   - RDS (read access to describe instances)
   - Elastic Beanstalk (read access)

## Deployment Steps

### 1. Set Alert Email

Set the email address that will receive alerts:

```bash
export TF_VAR_alert_email="your-email@example.com"
```

Or create a `terraform.tfvars` file:
```hcl
alert_email = "your-email@example.com"
```

### 2. Initialize Terraform

```bash
cd terraform/monitoring
terraform init
```

This downloads the required AWS provider plugin.

### 3. Review the Plan

```bash
terraform plan
```

Review the resources that will be created. You should see:
- 1 SNS topic
- 1 SNS subscription
- 8 CloudWatch alarms
- 1 CloudWatch dashboard

### 4. Apply the Configuration

```bash
terraform apply
```

Type `yes` when prompted to confirm.

### 5. Confirm Email Subscription

**IMPORTANT**: After applying, AWS will send a confirmation email to the address you specified. You MUST click the confirmation link in that email to receive alerts.

Check your email inbox and spam folder for an email from "AWS Notifications" with subject "AWS Notification - Subscription Confirmation".

### 6. Verify Deployment

After applying, Terraform will output:
- SNS topic ARN
- Dashboard URL
- Alarm ARNs
- Subscription status

Open the dashboard URL to view your monitoring dashboard.

## Accessing the Dashboard

After deployment, access your dashboard at:
```
https://console.aws.amazon.com/cloudwatch/home?region=eu-central-1#dashboards:name=qontinui-prod-py-dashboard
```

Or use the URL from Terraform output:
```bash
terraform output dashboard_url
```

## Customizing Thresholds

You can customize alarm thresholds by setting variables:

```bash
# In terraform.tfvars
alert_email                = "ops-team@example.com"
error_rate_threshold       = 10  # Alert at 10% error rate instead of 5%
response_time_threshold    = 3   # Alert at 3 seconds instead of 2
rds_cpu_threshold          = 90  # Alert at 90% CPU instead of 80%
health_degraded_threshold  = 30  # Alert at 30% health instead of 50%
```

Then apply the changes:
```bash
terraform apply
```

## Managing the Infrastructure

### View Current State
```bash
terraform show
```

### List All Resources
```bash
terraform state list
```

### Update Configuration
1. Modify the `.tf` files
2. Run `terraform plan` to preview changes
3. Run `terraform apply` to apply changes

### Destroy All Resources
```bash
terraform destroy
```

**WARNING**: This will delete all alarms, the dashboard, and SNS topic. Only do this if you want to completely remove monitoring.

## Terraform State

Terraform stores state in `terraform.tfstate` (local backend by default).

**IMPORTANT**:
- Do NOT commit `terraform.tfstate` to git (it's in .gitignore)
- Do NOT share state files (they may contain sensitive data)
- For team collaboration, consider using Terraform Cloud or S3 backend

### Example: S3 Backend (Team Collaboration)

To store state in S3:

1. Create S3 bucket and DynamoDB table:
```bash
aws s3 mb s3://qontinui-terraform-state
aws dynamodb create-table \
  --table-name qontinui-terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST
```

2. Add backend configuration to `main.tf`:
```hcl
terraform {
  backend "s3" {
    bucket         = "qontinui-terraform-state"
    key            = "monitoring/terraform.tfstate"
    region         = "eu-central-1"
    dynamodb_table = "qontinui-terraform-locks"
    encrypt        = true
  }
}
```

3. Re-initialize:
```bash
terraform init -migrate-state
```

## Testing Alarms

To test if alarms are working:

1. **Trigger a test alarm** (optional):
```bash
aws cloudwatch set-alarm-state \
  --alarm-name "qontinui-prod-py-health-degraded" \
  --state-value ALARM \
  --state-reason "Testing alarm notification"
```

2. **Check email** - You should receive an alert email

3. **Reset alarm**:
```bash
aws cloudwatch set-alarm-state \
  --alarm-name "qontinui-prod-py-health-degraded" \
  --state-value OK \
  --state-reason "Test complete"
```

## Cost Estimate

Approximate monthly costs:
- **SNS Topic**: $0 (first 1,000 email notifications free, then $2 per 100,000)
- **CloudWatch Alarms**: 8 alarms × $0.10 = $0.80/month
- **CloudWatch Dashboard**: 1 dashboard × $3 = $3.00/month
- **CloudWatch Metrics**: Free (standard metrics from AWS services)

**Total**: ~$3.80/month

## Troubleshooting

### Email Not Received
- Check spam/junk folder
- Verify email address in Terraform output: `terraform output`
- Check SNS subscription status in AWS Console: SNS → Topics → Subscriptions

### Alarm Not Triggering
- Check alarm state: `aws cloudwatch describe-alarms`
- Review alarm history in CloudWatch console
- Verify metric data is available: CloudWatch → Metrics

### RDS Data Source Error
- Verify RDS instance exists: `aws rds describe-db-instances`
- Check instance identifier matches "qontinui-db"
- Ensure AWS credentials have RDS read permissions

### Terraform State Locked
If you see "state locked" error:
```bash
# Force unlock (use carefully)
terraform force-unlock <lock-id>
```

## Maintenance

### Regular Tasks
- Review alarm thresholds quarterly
- Check for cost optimization opportunities
- Update Terraform provider versions annually

### When Scaling
If you add more EC2 instances or change environment:
1. Update variables in `terraform.tfvars`
2. Run `terraform plan` to review changes
3. Run `terraform apply` to update infrastructure

## Support

For issues or questions:
- Check [Terraform AWS Provider Docs](https://registry.terraform.io/providers/hashicorp/aws/latest/docs)
- Review [AWS CloudWatch Docs](https://docs.aws.amazon.com/cloudwatch/)
- Check deployment logs in `terraform.log`
