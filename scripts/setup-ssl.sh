#!/bin/bash
# =============================================================================
# SSL Certificate Setup Script
# =============================================================================
# Sets up Let's Encrypt SSL certificate for staging/production
# Usage: ./scripts/setup-ssl.sh staging yourdomain.com
# Usage: ./scripts/setup-ssl.sh production yourdomain.com
# =============================================================================

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check arguments
if [ $# -lt 2 ]; then
    echo "Usage: $0 <environment> <domain>"
    echo "Example: $0 staging staging.yourdomain.com"
    echo "Example: $0 production yourdomain.com"
    exit 1
fi

ENVIRONMENT="$1"
DOMAIN="$2"

echo "=========================================="
echo "  SSL Certificate Setup"
echo "=========================================="
echo "Environment: $ENVIRONMENT"
echo "Domain: $DOMAIN"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Error: This script must be run as root (sudo)${NC}"
    exit 1
fi

# Install Certbot if not installed
echo -e "${YELLOW}Installing Certbot...${NC}"
if ! command -v certbot &> /dev/null; then
    apt update
    apt install -y certbot python3-certbot-nginx
fi
echo -e "${GREEN}✅ Certbot installed${NC}"

# Stop nginx temporarily for certificate issuance
echo ""
echo -e "${YELLOW}Stopping Nginx...${NC}"
nginx -s stop 2>/dev/null || true
sleep 2

# Obtain certificate
echo ""
echo -e "${YELLOW}Obtaining SSL certificate...${NC}"
certbot certonly --standalone \
    --non-interactive \
    --agree-tos \
    --email admin@${DOMAIN} \
    -d ${DOMAIN}

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Certificate obtained!${NC}"
else
    echo -e "${RED}❌ Certificate issuance failed${NC}"
    exit 1
fi

# Update nginx config based on environment
echo ""
echo -e "${YELLOW}Updating Nginx configuration...${NC}"

if [ "$ENVIRONMENT" = "staging" ]; then
    CONFIG_FILE="nginx/staging.conf"
    SYSTEM_CONF="/etc/nginx/sites-available/stock-staging"
elif [ "$ENVIRONMENT" = "production" ]; then
    CONFIG_FILE="nginx/production.conf"
    SYSTEM_CONF="/etc/nginx/sites-available/stock-production"
else
    echo -e "${RED}Unknown environment: $ENVIRONMENT${NC}"
    exit 1
fi

# Copy config to system
cp ${CONFIG_FILE} ${SYSTEM_CONF}

# Update certificate paths in config
sed -i "s|/etc/letsencrypt/live/staging.yourdomain.com|/etc/letsencrypt/live/${DOMAIN}|g" ${SYSTEM_CONF}
sed -i "s|/etc/letsencrypt/live/yourdomain.com|/etc/letsencrypt/live/${DOMAIN}|g" ${SYSTEM_CONF}

# Enable SSL in nginx config (uncomment SSL server block)
# This is a simple approach - you may need to manually enable SSL section

# Test nginx config
echo ""
echo -e "${YELLOW}Testing Nginx configuration...${NC}"
nginx -t

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Nginx config valid${NC}"
else
    echo -e "${RED}❌ Nginx config invalid${NC}"
    exit 1
fi

# Start nginx
echo ""
echo -e "${YELLOW}Starting Nginx...${NC}"
nginx

# Setup auto-renewal
echo ""
echo -e "${YELLOW}Setting up auto-renewal...${NC}"

# Add to crontab
CRON_JOB="0 0 * * * certbot renew --quiet --deploy-hook 'nginx -s reload'"
(crontab -l 2>/dev/null | grep -v "certbot renew"; echo "$CRON_JOB") | crontab -

echo -e "${GREEN}✅ Auto-renewal configured${NC}"

# Verification
echo ""
echo -e "${GREEN}==========================================${NC}"
echo -e "${GREEN}  SSL Setup Complete!${NC}"
echo -e "${GREEN}==========================================${NC}"
echo ""
echo "Certificate location: /etc/letsencrypt/live/${DOMAIN}/"
echo "Fullchain: /etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
echo "Private key: /etc/letsencrypt/live/${DOMAIN}/privkey.pem"
echo ""
echo "To test: curl -k https://${DOMAIN}/health"
echo ""
echo "Certificate will auto-renew every 90 days."