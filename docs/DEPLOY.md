# Deploy Qontinui to Production (AWS + Vercel)

**Architecture:**
- Backend: AWS Elastic Beanstalk + RDS PostgreSQL (~$30-40/month)
- Frontend: Vercel (FREE, then $20/month if you exceed limits)
- Total: ~$30-40/month

This guide will get you deployed in ~20 minutes.

---

## Prerequisites

- AWS Account (https://aws.amazon.com - credit card required)
- Vercel Account (https://vercel.com - free, sign up with GitHub)
- Domain name (optional, can use free `.vercel.app` subdomain)

---

## Part 1: Deploy Backend to AWS

### Step 1: Install AWS CLI

```bash
# Linux/WSL
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# Verify
aws --version
```

### Step 2: Get AWS Credentials

1. Go to AWS Console: https://console.aws.amazon.com
2. Navigate to **IAM** → **Users** → **Create User**
3. Username: `qontinui-deployer`
4. Attach policies:
   - `AdministratorAccess-AWSElasticBeanstalk`
   - `AmazonRDSFullAccess`
   - `AmazonS3FullAccess`
5. Go to **Security credentials** → **Create access key**
6. Choose "CLI" use case
7. **Save the Access Key ID and Secret Access Key**

### Step 3: Configure AWS CLI

```bash
aws configure

# Enter:
# AWS Access Key ID: [paste your key]
# AWS Secret Access Key: [paste your secret]
# Default region: us-east-1
# Default output format: json
```

### Step 4: Install Elastic Beanstalk CLI

```bash
cd /home/jspinak/qontinui_parent_directory/qontinui-web/backend
pip install awsebcli
```

### Step 5: Initialize Elastic Beanstalk

```bash
# Initialize EB application
eb init -p docker qontinui-backend --region us-east-1

# When prompted:
# - Application name: qontinui-backend
# - Use CodeCommit: No
# - SSH: Yes (recommended for debugging)
```

### Step 6: Create RDS Database

```bash
# Generate secure password
DB_PASSWORD=$(openssl rand -base64 32)
echo "Database Password: $DB_PASSWORD"
echo "SAVE THIS PASSWORD - you'll need it!"

# Create PostgreSQL database
aws rds create-db-instance \
  --db-instance-identifier qontinui-db \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --engine-version 15.4 \
  --master-username qontinui_admin \
  --master-user-password "$DB_PASSWORD" \
  --allocated-storage 20 \
  --db-name qontinui \
  --backup-retention-period 7 \
  --publicly-accessible

# Wait for database (takes ~5 minutes, go grab coffee ☕)
echo "Waiting for database to be ready..."
aws rds wait db-instance-available --db-instance-identifier qontinui-db
echo "Database ready!"

# Get database endpoint
DB_ENDPOINT=$(aws rds describe-db-instances \
  --db-instance-identifier qontinui-db \
  --query 'DBInstances[0].Endpoint.Address' \
  --output text)

echo "Database Endpoint: $DB_ENDPOINT"
```

### Step 7: Create Elastic Beanstalk Environment

```bash
# Create environment (takes ~5 minutes)
eb create qontinui-prod \
  --instance-type t3.small \
  --database.engine postgres \
  --database.version 15.4

# Wait for creation...
```

### Step 8: Configure Environment Variables

```bash
# Generate secure secret key
SECRET_KEY=$(openssl rand -hex 32)

# Set all environment variables
eb setenv \
  DATABASE_URL="postgresql://qontinui_admin:$DB_PASSWORD@$DB_ENDPOINT:5432/qontinui" \
  SECRET_KEY="$SECRET_KEY" \
  ALGORITHM="HS256" \
  ACCESS_TOKEN_EXPIRE_MINUTES="30" \
  REFRESH_TOKEN_EXPIRE_DAYS="7" \
  STRIPE_SECRET_KEY="sk_test_51SFYGgD0GLnmL6QjB4VOHwLYIk2wFlif4SiPASBgTji2QGfrMG7SO0HGWSHtslntyBza1DQrx9IOIvgdRbiUceYo00grCCcDRx" \
  STRIPE_PUBLISHABLE_KEY="pk_test_51SFYGgD0GLnmL6Qjp8rsmDzzSxQ34gRv78KW6AaMiU3ENUPRfSposbl0EshDiWUdSWakvkxBNs3JoaGXXt5H4pDk00KoAdieQa" \
  STRIPE_PRICE_HOBBY="price_1SFZNAD0GLnmL6QjXNDfglde" \
  STRIPE_PRICE_PRO="price_1SFZPpD0GLnmL6Qj5w0YtADA"

# Deploy with configuration
eb deploy

# Get your backend URL
BACKEND_URL=$(eb status | grep CNAME | awk '{print $2}')
echo "Backend URL: https://$BACKEND_URL"
```

### Step 9: Test Backend

```bash
# Test health endpoint
curl "https://$BACKEND_URL/health"

# Should return: {"status":"ok"}
```

---

## Part 2: Deploy Frontend to Vercel

### Step 1: Prepare Frontend

```bash
cd /home/jspinak/qontinui_parent_directory/qontinui-web/frontend

# Create production env file
echo "NEXT_PUBLIC_API_URL=https://$BACKEND_URL" > .env.production

# Ensure it's in .gitignore
echo ".env.production" >> .gitignore
```

### Step 2: Push to GitHub (if not already)

```bash
# Initialize git if needed
cd /home/jspinak/qontinui_parent_directory/qontinui-web
git init
git add .
git commit -m "Initial commit - ready for deployment"

# Create repo on GitHub, then:
git remote add origin https://github.com/YOUR_USERNAME/qontinui-web.git
git branch -M main
git push -u origin main
```

### Step 3: Deploy to Vercel (Option A: Web Dashboard)

1. Go to https://vercel.com
2. Click **"Add New..." → Project**
3. Import your GitHub repository
4. Configure:
   - **Framework Preset**: Next.js
   - **Root Directory**: `frontend`
   - **Build Command**: `npm run build`
   - **Output Directory**: `.next`
   - **Install Command**: `npm install`

5. **Environment Variables** → Add:
   ```
   NEXT_PUBLIC_API_URL = https://YOUR_BACKEND_URL.elasticbeanstalk.com
   ```

6. Click **Deploy**

7. Wait ~2 minutes for deployment

8. Note your Vercel URL: `https://qontinui.vercel.app`

### Step 3: Deploy to Vercel (Option B: CLI)

```bash
# Install Vercel CLI
npm install -g vercel

# Login to Vercel
vercel login

# Deploy
vercel --prod

# Follow prompts:
# - Setup project: Yes
# - Link to existing: No
# - Project name: qontinui-web
# - Directory: ./frontend
# - Override settings: No

# Set environment variable
vercel env add NEXT_PUBLIC_API_URL production
# When prompted, paste: https://YOUR_BACKEND_URL.elasticbeanstalk.com

# Redeploy with env var
vercel --prod
```

---

## Part 3: Connect Frontend & Backend

### Step 1: Update Backend CORS

```bash
cd /home/jspinak/qontinui_parent_directory/qontinui-web/backend

# Get your Vercel URL
FRONTEND_URL="https://your-app.vercel.app"  # Replace with actual URL

# Update CORS configuration
eb setenv \
  FRONTEND_URL="$FRONTEND_URL" \
  BACKEND_CORS_ORIGINS="[\"$FRONTEND_URL\",\"http://localhost:3001\"]"

# Redeploy backend
eb deploy
```

---

## Part 4: Configure Stripe Webhooks

### Step 1: Get Webhook URL

```bash
echo "Your webhook URL is: https://$BACKEND_URL/api/v1/billing/webhook"
```

### Step 2: Create Webhook in Stripe

1. Go to: https://dashboard.stripe.com/test/webhooks
2. Click **"+ Add endpoint"**
3. **Endpoint URL**: `https://YOUR_BACKEND.elasticbeanstalk.com/api/v1/billing/webhook`
4. **Events to send**:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
5. Click **"Add endpoint"**
6. Click **"Reveal"** next to **"Signing secret"**
7. Copy the secret (starts with `whsec_`)

### Step 3: Add Webhook Secret to Backend

```bash
cd /home/jspinak/qontinui_parent_directory/qontinui-web/backend

# Set webhook secret
eb setenv STRIPE_WEBHOOK_SECRET="whsec_YOUR_SECRET_HERE"

# Deploy
eb deploy
```

---

## Part 5: Test Everything

### Test Checklist:

Visit your Vercel URL and test:

1. ✅ **Register**: Create new account
2. ✅ **Login**: Log in with credentials
3. ✅ **Create Project**: Create a new automation project
4. ✅ **Pricing Page**: Go to `/pricing`
5. ✅ **Upgrade**: Click "Upgrade to Hobby"
6. ✅ **Checkout**: Use test card `4242 4242 4242 4242`
   - Expiry: Any future date (12/34)
   - CVC: Any 3 digits (123)
   - ZIP: Any 5 digits (12345)
7. ✅ **Success Page**: Redirected to success page
8. ✅ **Subscription Badge**: Shows "Hobby" with sparkles icon
9. ✅ **Create More Projects**: Verify you can now create 100 projects

### Test Webhook:

```bash
# Check backend logs for webhook event
cd backend
eb logs | grep "checkout.session.completed"

# Should see webhook processing logs
```

---

## Part 6: Production Checklist

Before going live with real payments:

### 1. Switch to Production Stripe Keys

1. Get production keys from: https://dashboard.stripe.com/apikeys
2. Get production Price IDs from: https://dashboard.stripe.com/products

```bash
eb setenv \
  STRIPE_SECRET_KEY="sk_live_..." \
  STRIPE_PUBLISHABLE_KEY="pk_live_..." \
  STRIPE_PRICE_HOBBY="price_live_..." \
  STRIPE_PRICE_PRO="price_live_..."

eb deploy
```

3. Create production webhook at: https://dashboard.stripe.com/webhooks
4. Update webhook secret:

```bash
eb setenv STRIPE_WEBHOOK_SECRET="whsec_live_..."
eb deploy
```

### 2. Update Frontend Environment

In Vercel Dashboard:
- Settings → Environment Variables
- Update `NEXT_PUBLIC_API_URL` to use custom domain (if you have one)

### 3. Add Custom Domain (Optional)

**For Frontend (Vercel):**
1. Vercel Dashboard → Your Project → Settings → Domains
2. Add your domain: `app.qontinui.com`
3. Follow DNS instructions from your registrar

**For Backend (AWS):**
1. AWS Route 53 → Create Hosted Zone
2. Create A record pointing to EB environment
3. Add SSL certificate via AWS Certificate Manager
4. Update EB to use custom domain

---

## Monitoring & Logs

### Backend Logs:
```bash
# View recent logs
eb logs

# Stream live logs
eb logs --stream

# View specific log
eb logs --log-group /aws/elasticbeanstalk/qontinui-prod/var/log/eb-docker
```

### Frontend Logs:
- Vercel Dashboard → Your Project → Deployments → [Latest] → Runtime Logs

### Database Logs:
```bash
# View RDS logs
aws rds describe-db-log-files --db-instance-identifier qontinui-db
```

---

## Updating Your Deployment

### Update Backend:
```bash
cd backend
# Make changes
git add .
git commit -m "Update backend"
eb deploy
```

### Update Frontend:
```bash
cd frontend
# Make changes
git add .
git commit -m "Update frontend"
git push origin main
# Vercel auto-deploys on git push!
```

---

## Costs Breakdown

### AWS (Estimated Monthly):

**Free Tier (First 12 months):**
- EC2 t3.small: ~$15/month (or FREE if using t3.micro)
- RDS db.t3.micro: FREE (750 hours/month)
- Data transfer: ~$5-10/month
- **Total: $5-25/month**

**After Free Tier:**
- EC2 t3.small: ~$15/month
- RDS db.t3.micro: ~$15/month
- Data transfer: ~$5-10/month
- **Total: $30-40/month**

### Vercel:
- **Hobby Plan: FREE**
  - 100GB bandwidth/month
  - Unlimited deployments
  - Custom domains

- **Pro Plan: $20/month** (if you exceed limits)
  - 1TB bandwidth/month
  - Advanced analytics

### Total: ~$30-60/month depending on usage

---

## Scaling

### Backend Scaling:
```bash
# Scale to multiple instances
eb scale 2

# Or enable auto-scaling
eb config
# Set MinInstances: 1, MaxInstances: 4
```

### Database Scaling:
```bash
# Upgrade to larger instance
aws rds modify-db-instance \
  --db-instance-identifier qontinui-db \
  --db-instance-class db.t3.small \
  --apply-immediately
```

---

## Backup & Recovery

### Database Backups:
```bash
# Manual snapshot
aws rds create-db-snapshot \
  --db-instance-identifier qontinui-db \
  --db-snapshot-identifier qontinui-backup-$(date +%Y%m%d)

# Restore from snapshot
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier qontinui-db-restored \
  --db-snapshot-identifier qontinui-backup-20250107
```

### Code Backups:
- Automatically backed up in GitHub
- Vercel keeps deployment history (30 days)

---

## Troubleshooting

### Backend won't start:
```bash
eb logs
eb ssh  # SSH into instance to debug
```

### Frontend can't reach backend:
1. Check CORS settings include Vercel URL
2. Verify `NEXT_PUBLIC_API_URL` in Vercel environment
3. Test backend directly: `curl https://YOUR_BACKEND/health`

### Database connection failed:
```bash
# Check DATABASE_URL
eb printenv | grep DATABASE_URL

# Test from EB instance
eb ssh
psql $DATABASE_URL
```

### Webhook not firing:
1. Check Stripe Dashboard → Webhooks → Recent deliveries
2. Verify webhook URL is correct
3. Check backend logs for webhook processing

---

## Support Resources

- **AWS EB**: https://docs.aws.amazon.com/elasticbeanstalk
- **Vercel**: https://vercel.com/docs
- **Stripe Webhooks**: https://stripe.com/docs/webhooks
- **PostgreSQL on RDS**: https://docs.aws.amazon.com/rds/

---

## 🎉 Congratulations!

Your app is now live at:
- **Frontend**: https://your-app.vercel.app
- **Backend**: https://your-backend.elasticbeanstalk.com
- **Database**: Managed by AWS RDS

Next steps:
- [ ] Add custom domain
- [ ] Set up monitoring (AWS CloudWatch + Vercel Analytics)
- [ ] Configure CI/CD with GitHub Actions
- [ ] Add error tracking (Sentry)
- [ ] Switch to production Stripe keys when ready
