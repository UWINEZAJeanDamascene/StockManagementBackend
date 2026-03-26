#!/bin/bash
# =============================================================================
# MongoDB Atlas Connection Tester
# =============================================================================
# Tests connection to MongoDB Atlas cluster
# Usage: ./scripts/test-atlas-connection.sh
# =============================================================================

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "=========================================="
echo "  MongoDB Atlas Connection Test"
echo "=========================================="
echo ""

# Load environment
if [ -f ".env.staging" ]; then
    source .env.staging
    echo -e "${YELLOW}Using .env.staging${NC}"
elif [ -f ".env.production" ]; then
    source .env.production
    echo -e "${YELLOW}Using .env.production${NC}"
else
    echo -e "${RED}❌ No .env.staging or .env.production found${NC}"
    exit 1
fi

if [ -z "$MONGODB_URI" ]; then
    echo -e "${RED}❌ MONGODB_URI is not set${NC}"
    exit 1
fi

echo "Connection URI: ${MONGODB_URI%%@*}@..."
echo ""

# Test connection using Node.js
echo "Testing connection..."
node -e "
const mongoose = require('mongoose');

mongoose.connect('$MONGODB_URI', {
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 10000
})
.then(() => {
  console.log('✅ Connected successfully!');
  console.log('Host:', mongoose.connection.host);
  console.log('Database:', mongoose.connection.name);
  console.log('State:', mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected');
  return mongoose.connection.db.admin();
})
.then(admin => admin.ping())
.then(() => {
  console.log('✅ Ping successful!');
  process.exit(0);
})
.catch(err => {
  console.error('❌ Connection failed:', err.message);
  process.exit(1);
})
.finally(() => mongoose.disconnect());
"

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ MongoDB Atlas connection test passed!${NC}"
else
    echo ""
    echo -e "${RED}❌ MongoDB Atlas connection test failed!${NC}"
    echo ""
    echo "Troubleshooting:"
    echo "1. Check your MONGODB_URI in .env.staging or .env.production"
    echo "2. Verify your Atlas cluster is running"
    echo "3. Check network access (IP whitelist)"
    echo "4. Verify username/password are correct"
    exit 1
fi

echo ""
echo "To view database stats, run:"
echo "  node -e \"require('mongoose').connect('$MONGODB_URI').then(c => c.connection.db.stats().then(s => console.log(s)).finally(() => process.exit()))\""