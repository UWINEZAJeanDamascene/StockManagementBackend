#!/bin/bash
# =============================================================================
# Staging Deployment Script
# =============================================================================
# Deploys the application to staging environment
# Usage: ./scripts/deploy-staging.sh
# =============================================================================

set -e

# Configuration
APP_NAME="stock-management"
STAGING_DIR="/var/www/${APP_NAME}"
COMPOSE_FILE="docker-compose.yml"
STAGING_COMPOSE="docker-compose.staging.yml"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Stock Management - Staging Deploy${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check if running as root (for system deployments)
if [ "$1" = "--server" ] && [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Error: Use --server flag with sudo${NC}"
    exit 1
fi

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"

if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker not found${NC}"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}❌ docker-compose not found${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Prerequisites OK${NC}"
echo ""

# Pull latest changes (if in git repo)
if [ -d ".git" ]; then
    echo -e "${YELLOW}Pulling latest changes...${NC}"
    git pull origin main || echo -e "${YELLOW}⚠️  Git pull failed, continuing with local code${NC}"
fi

# Build Docker images
echo ""
echo -e "${YELLOW}Building Docker images...${NC}"
docker build -t ${APP_NAME}:staging . || {
    echo -e "${RED}❌ Docker build failed${NC}"
    exit 1
}
echo -e "${GREEN}✅ Docker image built${NC}"

# Test MongoDB connection (if .env.staging exists)
if [ -f ".env.staging" ]; then
    echo ""
    echo -e "${YELLOW}Testing MongoDB connection...${NC}"
    export $(cat .env.staging | grep -v '^#' | xargs) 2>/dev/null || true
    
    if [ -n "$MONGODB_URI" ]; then
        node -e "
const mongoose = require('mongoose');
mongoose.connect('$MONGODB_URI', { serverSelectionTimeoutMS: 5000 })
  .then(() => { console.log('✅ MongoDB connected'); process.exit(0); })
  .catch(err => { console.log('⚠️  MongoDB connection issue:', err.message); process.exit(0); })
  .finally(() => mongoose.disconnect());
" || true
    fi
fi

# Stop existing containers
echo ""
echo -e "${YELLOW}Stopping existing containers...${NC}"
docker-compose -f ${COMPOSE_FILE} -f ${STAGING_COMPOSE} down || true
echo -e "${GREEN}✅ Containers stopped${NC}"

# Start containers
echo ""
echo -e "${YELLOW}Starting staging environment...${NC}"
docker-compose -f ${COMPOSE_FILE} -f ${STAGING_COMPOSE} up -d

# Wait for health check
echo ""
echo -e "${YELLOW}Waiting for application to be ready...${NC}"
sleep 10

# Check health
for i in {1..10}; do
    if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Application is healthy!${NC}"
        break
    fi
    if [ $i -eq 10 ]; then
        echo -e "${RED}❌ Health check failed${NC}"
        docker-compose -f ${COMPOSE_FILE} -f ${STAGING_COMPOSE} logs
        exit 1
    fi
    sleep 2
done

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Staging Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Endpoints:"
echo "  - API: http://localhost:3000"
echo "  - Health: http://localhost:3000/api/health"
echo ""
echo "View logs: docker-compose -f ${COMPOSE_FILE} -f ${STAGING_COMPOSE} logs -f"
echo "Stop: docker-compose -f ${COMPOSE_FILE} -f ${STAGING_COMPOSE} down"