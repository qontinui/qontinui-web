#!/bin/bash
# Update Vercel environment variable for production

# Check if vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "Installing Vercel CLI..."
    npm install -g vercel
fi

echo "Setting NEXT_PUBLIC_API_URL for production..."
vercel env add NEXT_PUBLIC_API_URL production << INPUT
http://qontinui-prod.eba-km2u4s23.eu-central-1.elasticbeanstalk.com
INPUT

echo ""
echo "Environment variable updated. Now redeploying..."
vercel --prod

echo ""
echo "Done! Your frontend should now connect to: http://qontinui-prod.eba-km2u4s23.eu-central-1.elasticbeanstalk.com"
