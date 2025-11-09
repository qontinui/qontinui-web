#!/bin/bash
# Update AWS Elastic Beanstalk environment variables
# Run this from WSL to update the production environment

set -e

ENVIRONMENT_NAME="qontinui-prod"
REGION="eu-central-1"

echo "Updating Elastic Beanstalk environment: $ENVIRONMENT_NAME"
echo ""

# Get the Vercel frontend URL
read -p "Enter your Vercel frontend URL (default: https://qontinui.io): " VERCEL_URL
VERCEL_URL=${VERCEL_URL:-https://qontinui.io}

# Generate secrets if needed
echo ""
echo "Generating secure secret keys..."
ACCESS_SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
REFRESH_SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
RESET_PASSWORD_SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
VERIFICATION_SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")

echo "Generated secrets successfully"
echo ""

# Update environment variables
echo "Updating environment variables..."
aws elasticbeanstalk update-environment \
    --environment-name "$ENVIRONMENT_NAME" \
    --region "$REGION" \
    --option-settings \
      Namespace=aws:elasticbeanstalk:application:environment,OptionName=DATABASE_URL,Value="postgresql://qontinui_admin:2008NawaNawa%3D@qontinui-db.c16uiu02ugak.eu-central-1.rds.amazonaws.com:5432/postgres?sslmode=require" \
      Namespace=aws:elasticbeanstalk:application:environment,OptionName=SECRET_KEY,Value="-ZWZgpU1UTinhkj4Ub_znMqAiX5onX80RXb42oWAshM" \
      Namespace=aws:elasticbeanstalk:application:environment,OptionName=ACCESS_SECRET_KEY,Value="$ACCESS_SECRET" \
      Namespace=aws:elasticbeanstalk:application:environment,OptionName=REFRESH_SECRET_KEY,Value="$REFRESH_SECRET" \
      Namespace=aws:elasticbeanstalk:application:environment,OptionName=RESET_PASSWORD_SECRET_KEY,Value="$RESET_PASSWORD_SECRET" \
      Namespace=aws:elasticbeanstalk:application:environment,OptionName=VERIFICATION_SECRET_KEY,Value="$VERIFICATION_SECRET" \
      Namespace=aws:elasticbeanstalk:application:environment,OptionName=STRIPE_SECRET_KEY,Value="sk_test_51SFYGgD0GLnmL6QjB4VOHwLYIk2wFlif4SiPASBgTji2QGfrMG7SO0HGWSHtslntyBza1DQrx9IOIvgdRbiUceYo00grCCcDRx" \
      Namespace=aws:elasticbeanstalk:application:environment,OptionName=STRIPE_PUBLISHABLE_KEY,Value="pk_test_51SFYGgD0GLnmL6Qjp8rsmDzzSxQ34gRv78KW6AaMiU3ENUPRfSposbl0EshDiWUdSWakvkxBNs3JoaGXXt5H4pDk00KoAdieQa" \
      Namespace=aws:elasticbeanstalk:application:environment,OptionName=FRONTEND_URL,Value="$VERCEL_URL" \
      Namespace=aws:elasticbeanstalk:application:environment,OptionName=BACKEND_CORS_ORIGINS,Value='["'"$VERCEL_URL"'","https://*.vercel.app","https://qontinui.io","https://www.qontinui.io","https://qontinui.com"]' \
      Namespace=aws:elasticbeanstalk:application:environment,OptionName=ENVIRONMENT,Value="production" \
      Namespace=aws:elasticbeanstalk:application:environment,OptionName=DEBUG,Value="False" \
      Namespace=aws:elasticbeanstalk:application:environment,OptionName=PORT,Value="8000" \
      Namespace=aws:elasticbeanstalk:application:environment,OptionName=REDIS_ENABLED,Value="False" \
      Namespace=aws:elasticbeanstalk:application:environment,OptionName=RATE_LIMIT_ENABLED,Value="True"

echo ""
echo "✓ Environment variables updated successfully!"
echo ""
echo "IMPORTANT: Save these generated secrets somewhere safe:"
echo "ACCESS_SECRET_KEY=$ACCESS_SECRET"
echo "REFRESH_SECRET_KEY=$REFRESH_SECRET"
echo "RESET_PASSWORD_SECRET_KEY=$RESET_PASSWORD_SECRET"
echo "VERIFICATION_SECRET_KEY=$VERIFICATION_SECRET"
echo ""
echo "The application will restart automatically with the new configuration."
echo "This may take a few minutes..."
