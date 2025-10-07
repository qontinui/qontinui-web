# Quick Deploy to AWS (Copy-Paste Commands)

Follow these commands in order. This will get you deployed in ~20 minutes.

## 1. Install AWS CLI (if not already installed)

```bash
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install
aws --version
```

## 2. Configure AWS (You'll need AWS Account)

```bash
aws configure
# Enter your Access Key ID (get from AWS Console > IAM > Users > Security credentials)
# Enter your Secret Access Key
# Region: us-east-1
# Output: json
```

## 3. Install Elastic Beanstalk CLI

```bash
cd backend
pip install awsebcli
```

## 4. Initialize and Deploy Backend

```bash
# Initialize EB
eb init -p docker qontinui-backend --region us-east-1

# Create environment (this takes ~5 minutes)
eb create qontinui-prod --instance-type t3.small

# Wait for creation to complete...
```

## 5. Create PostgreSQL Database

```bash
# Generate a secure password
DB_PASSWORD=$(openssl rand -base64 32)
echo "Database password: $DB_PASSWORD"
echo "SAVE THIS PASSWORD!"

# Create database
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

# Wait for database (takes ~5 minutes)
echo "Waiting for database to be ready..."
aws rds wait db-instance-available --db-instance-identifier qontinui-db

# Get database endpoint
DB_ENDPOINT=$(aws rds describe-db-instances \
  --db-instance-identifier qontinui-db \
  --query 'DBInstances[0].Endpoint.Address' \
  --output text)

echo "Database endpoint: $DB_ENDPOINT"
```

## 6. Configure Environment Variables

```bash
# Generate secret key
SECRET_KEY=$(openssl rand -hex 32)

# Set environment variables
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

# Deploy with new config
eb deploy
```

## 7. Get Backend URL

```bash
# Get your backend URL
BACKEND_URL=$(eb status | grep CNAME | awk '{print $2}')
echo "Backend URL: https://$BACKEND_URL"

# Test it
curl "https://$BACKEND_URL/health"
```

## 8. Deploy Frontend to Vercel

```bash
cd ../frontend

# Install Vercel CLI
npm install -g vercel

# Login
vercel login

# Set backend URL
echo "NEXT_PUBLIC_API_URL=https://$BACKEND_URL" > .env.production

# Deploy
vercel --prod
```

Follow Vercel prompts, then note your frontend URL.

## 9. Update CORS and Frontend URL

```bash
cd ../backend

# Get your Vercel URL from previous step
FRONTEND_URL="https://your-app.vercel.app"  # Replace with your actual URL

# Update CORS and frontend URL
eb setenv \
  FRONTEND_URL="$FRONTEND_URL" \
  BACKEND_CORS_ORIGINS="[\"$FRONTEND_URL\",\"http://localhost:3001\"]"

# Deploy
eb deploy
```

## 10. Configure Stripe Webhook

```bash
# Get backend URL again
echo "Your webhook URL is: https://$BACKEND_URL/api/v1/billing/webhook"
```

Now go to Stripe Dashboard:
1. Go to: https://dashboard.stripe.com/test/webhooks
2. Click "+ Add endpoint"
3. Endpoint URL: `https://YOUR-BACKEND-URL.elasticbeanstalk.com/api/v1/billing/webhook`
4. Select events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
5. Click "Add endpoint"
6. Click "Reveal" next to "Signing secret"
7. Copy the webhook secret (starts with `whsec_`)

```bash
# Back in terminal, set webhook secret
WEBHOOK_SECRET="whsec_your_secret_here"  # Replace with actual secret

eb setenv STRIPE_WEBHOOK_SECRET="$WEBHOOK_SECRET"
eb deploy
```

## 11. Test Your Deployment

```bash
# Test backend
curl "https://$BACKEND_URL/health"

# Open frontend
echo "Frontend URL: $FRONTEND_URL"
```

Visit your frontend URL and test:
1. ✅ Register a new account
2. ✅ Login
3. ✅ Create a project
4. ✅ Go to /pricing
5. ✅ Click "Upgrade to Hobby"
6. ✅ Use test card: `4242 4242 4242 4242`
7. ✅ Complete payment
8. ✅ Verify subscription badge shows "Hobby"

## 🎉 Done!

Your app is live at:
- Frontend: https://your-app.vercel.app
- Backend: https://your-backend.elasticbeanstalk.com
- Database: RDS PostgreSQL (managed)

## View Logs

```bash
# Backend logs
eb logs

# Tail logs
eb logs --stream
```

## Update Deployment

```bash
# Backend
cd backend
eb deploy

# Frontend
cd frontend
vercel --prod
```

## Costs

**Estimated monthly cost**: $30-50
- EC2 t3.small: ~$15/month
- RDS db.t3.micro: ~$15/month
- S3 + Data transfer: ~$5-10/month
- Vercel: Free

**Free tier (first year)**:
- 750 hours/month EC2 t3.micro free
- 750 hours/month RDS db.t3.micro free
- Can reduce costs to ~$5-10/month

## Switch to Production Stripe

When ready for real payments:

```bash
# Replace test keys with live keys from Stripe Dashboard
eb setenv \
  STRIPE_SECRET_KEY="sk_live_..." \
  STRIPE_PUBLISHABLE_KEY="pk_live_..." \
  STRIPE_WEBHOOK_SECRET="whsec_..." \
  STRIPE_PRICE_HOBBY="price_live_..." \
  STRIPE_PRICE_PRO="price_live_..."

eb deploy
```

## Troubleshooting

**Backend won't start:**
```bash
eb logs
```

**Database connection failed:**
```bash
# Check security group allows EB to connect
eb printenv | grep DATABASE_URL
```

**Frontend can't reach backend:**
- Verify CORS settings include your frontend URL
- Check `NEXT_PUBLIC_API_URL` in Vercel environment variables
