# AWS Deployment Guide for Qontinui-Web

This guide will help you deploy the Qontinui web application to AWS.

## Prerequisites

1. AWS Account (create at https://aws.amazon.com)
2. AWS CLI installed and configured
3. Domain name (optional, but recommended)

## Deployment Options

We'll use the **easiest and most cost-effective** approach:

- **Backend**: AWS Elastic Beanstalk (managed service)
- **Database**: RDS PostgreSQL (managed database)
- **Storage**: S3 (for images/files)
- **Frontend**: Vercel (free tier, easiest)

**Estimated Monthly Cost**: ~$30-50 for small traffic

## Step 1: Install AWS CLI

```bash
# Install AWS CLI
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# Verify installation
aws --version
```

## Step 2: Configure AWS Credentials

```bash
# Configure AWS CLI with your credentials
aws configure

# You'll be prompted for:
# - AWS Access Key ID: (get from AWS Console > IAM > Users > Security credentials)
# - AWS Secret Access Key: (get from same place)
# - Default region: us-east-1 (or your preferred region)
# - Default output format: json
```

### Getting AWS Access Keys:
1. Go to AWS Console: https://console.aws.amazon.com
2. Navigate to IAM > Users
3. Click your username
4. Go to "Security credentials" tab
5. Click "Create access key"
6. Save the Access Key ID and Secret Access Key

## Step 3: Deploy Backend to Elastic Beanstalk

### 3.1 Initialize Elastic Beanstalk

```bash
cd /home/jspinak/qontinui_parent_directory/qontinui-web/backend

# Install EB CLI
pip install awsebcli

# Initialize EB application
eb init -p docker qontinui-backend --region us-east-1

# Create environment
eb create qontinui-prod-env --instance-type t3.small
```

### 3.2 Set Environment Variables

```bash
# Set all environment variables
eb setenv \
  SECRET_KEY="$(openssl rand -hex 32)" \
  ALGORITHM=HS256 \
  ACCESS_TOKEN_EXPIRE_MINUTES=30 \
  REFRESH_TOKEN_EXPIRE_DAYS=7 \
  FRONTEND_URL=https://your-frontend-url.vercel.app \
  STRIPE_SECRET_KEY=your_stripe_secret_key \
  STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key \
  STRIPE_WEBHOOK_SECRET=your_webhook_secret \
  STRIPE_PRICE_HOBBY=price_1SFZNAD0GLnmL6QjXNDfglde \
  STRIPE_PRICE_PRO=price_1SFZPpD0GLnmL6Qj5w0YtADA \
  BACKEND_CORS_ORIGINS='["https://your-frontend-url.vercel.app","http://localhost:3001"]'
```

### 3.3 Set Up RDS Database

```bash
# Create RDS PostgreSQL database
aws rds create-db-instance \
  --db-instance-identifier qontinui-db \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --engine-version 15.4 \
  --master-username qontinui_admin \
  --master-user-password "$(openssl rand -base64 32)" \
  --allocated-storage 20 \
  --vpc-security-group-ids sg-xxxxx \
  --db-name qontinui \
  --backup-retention-period 7 \
  --publicly-accessible

# Wait for database to be available (takes ~5 minutes)
aws rds wait db-instance-available --db-instance-identifier qontinui-db

# Get the database endpoint
aws rds describe-db-instances \
  --db-instance-identifier qontinui-db \
  --query 'DBInstances[0].Endpoint.Address' \
  --output text
```

### 3.4 Update Database URL

```bash
# Set DATABASE_URL with RDS endpoint
eb setenv DATABASE_URL=postgresql://qontinui_admin:YOUR_PASSWORD@RDS_ENDPOINT:5432/qontinui
```

### 3.5 Deploy Backend

```bash
# Deploy the application
eb deploy

# Open in browser to test
eb open
```

## Step 4: Set Up S3 for File Storage

```bash
# Create S3 bucket
aws s3 mb s3://qontinui-storage --region us-east-1

# Enable CORS
cat > cors.json << EOF
{
  "CORSRules": [
    {
      "AllowedOrigins": ["https://your-frontend-url.vercel.app"],
      "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
      "AllowedHeaders": ["*"],
      "MaxAgeSeconds": 3000
    }
  ]
}
EOF

aws s3api put-bucket-cors --bucket qontinui-storage --cors-configuration file://cors.json

# Create IAM user for S3 access
aws iam create-user --user-name qontinui-s3-user

# Attach S3 policy
aws iam attach-user-policy \
  --user-name qontinui-s3-user \
  --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess

# Create access keys
aws iam create-access-key --user-name qontinui-s3-user

# Add S3 credentials to EB environment
eb setenv \
  AWS_ACCESS_KEY_ID=your_s3_access_key \
  AWS_SECRET_ACCESS_KEY=your_s3_secret_key \
  AWS_S3_BUCKET=qontinui-storage \
  AWS_REGION=us-east-1
```

## Step 5: Deploy Frontend to Vercel

### 5.1 Install Vercel CLI

```bash
npm install -g vercel
```

### 5.2 Deploy Frontend

```bash
cd /home/jspinak/qontinui_parent_directory/qontinui-web/frontend

# Login to Vercel
vercel login

# Deploy (follow prompts)
vercel --prod

# Set environment variables in Vercel Dashboard
# NEXT_PUBLIC_API_URL=https://your-backend-url.elasticbeanstalk.com
```

Or use Vercel Dashboard:
1. Go to https://vercel.com
2. Import your GitHub repo
3. Set build settings:
   - Framework: Next.js
   - Build Command: `npm run build`
   - Output Directory: `.next`
4. Add environment variable:
   - `NEXT_PUBLIC_API_URL` = your Elastic Beanstalk URL

## Step 6: Configure Stripe Webhook

```bash
# Get your backend URL
eb status | grep CNAME

# In Stripe Dashboard:
# 1. Go to Developers > Webhooks
# 2. Click "Add endpoint"
# 3. Endpoint URL: https://your-backend-url.elasticbeanstalk.com/api/v1/billing/webhook
# 4. Select events:
#    - checkout.session.completed
#    - customer.subscription.updated
#    - customer.subscription.deleted
#    - invoice.payment_failed
# 5. Copy the webhook signing secret

# Update webhook secret
eb setenv STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
eb deploy
```

## Step 7: Set Up Custom Domain (Optional)

### Using Route 53 + CloudFront

```bash
# Create hosted zone
aws route53 create-hosted-zone --name qontinui.com --caller-reference $(date +%s)

# Get nameservers and update your domain registrar

# Request SSL certificate
aws acm request-certificate \
  --domain-name qontinui.com \
  --domain-name *.qontinui.com \
  --validation-method DNS \
  --region us-east-1

# Create CloudFront distribution (via Console is easier)
# Point to your Elastic Beanstalk environment
```

## Step 8: Verify Deployment

### Backend Health Check
```bash
curl https://your-backend-url.elasticbeanstalk.com/health
```

### Frontend Check
Visit your Vercel URL and test:
1. User registration
2. Login
3. Create project
4. Stripe checkout (use test card: 4242 4242 4242 4242)
5. Verify webhook updates subscription

## Monitoring & Logs

### View Backend Logs
```bash
eb logs
```

### View Recent Activity
```bash
eb health
```

### CloudWatch Logs
```bash
aws logs tail /aws/elasticbeanstalk/qontinui-prod-env/var/log/eb-engine.log --follow
```

## Cost Optimization

**Free Tier Eligible (First Year)**:
- Elastic Beanstalk: Free (pay for underlying EC2)
- EC2 t3.micro: 750 hours/month free
- RDS db.t3.micro: 750 hours/month free
- S3: 5GB storage free
- Vercel: Free tier (100GB bandwidth)

**After Free Tier (~$30-50/month)**:
- EC2 t3.small: ~$15/month
- RDS db.t3.micro: ~$15/month
- S3: ~$0.023/GB (~$0.50 for 20GB)
- Data transfer: ~$5-10/month

## Scaling

### Auto Scaling (when needed)
```bash
# Enable auto-scaling
eb scale 2  # Scale to 2 instances

# Or configure auto-scaling
eb config
# Set MinInstances and MaxInstances
```

### Database Scaling
```bash
# Upgrade database instance
aws rds modify-db-instance \
  --db-instance-identifier qontinui-db \
  --db-instance-class db.t3.small \
  --apply-immediately
```

## Backup Strategy

### RDS Automated Backups
- Enabled by default (7-day retention)
- Increase if needed:
```bash
aws rds modify-db-instance \
  --db-instance-identifier qontinui-db \
  --backup-retention-period 30
```

### S3 Versioning
```bash
aws s3api put-bucket-versioning \
  --bucket qontinui-storage \
  --versioning-configuration Status=Enabled
```

## Troubleshooting

### Backend won't start
```bash
eb logs  # Check logs
eb ssh   # SSH into instance
```

### Database connection issues
```bash
# Check security group allows connection from EB environment
# Verify DATABASE_URL is correct
eb printenv
```

### CORS errors
- Update BACKEND_CORS_ORIGINS to include your frontend URL
- Redeploy backend

## Production Checklist

Before going live:
- [ ] Change all test Stripe keys to live keys
- [ ] Set strong SECRET_KEY
- [ ] Enable HTTPS only
- [ ] Configure custom domain
- [ ] Set up monitoring/alerts
- [ ] Enable CloudWatch logs
- [ ] Configure backup strategy
- [ ] Test subscription flow end-to-end
- [ ] Test webhook events
- [ ] Load test with expected traffic

## Next Steps

1. Set up CI/CD with GitHub Actions
2. Add monitoring with CloudWatch
3. Set up error tracking (Sentry)
4. Configure CDN for static assets
5. Implement rate limiting
6. Add database connection pooling

## Support

For issues:
- AWS EB: https://docs.aws.amazon.com/elasticbeanstalk
- Vercel: https://vercel.com/docs
- Stripe: https://stripe.com/docs/webhooks
