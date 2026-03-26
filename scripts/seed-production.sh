#!/bin/bash
# =============================================================================
# Production Seed Script
# =============================================================================
# One-time seeder for production - seeds essential data only
# Run this after initial production deployment
# =============================================================================

set -e

# Configuration
MONGODB_URI="${MONGODB_URI:-mongodb://localhost:27017/stock-management}"
NODE_ENV="${NODE_ENV:-production}"

echo "========================================"
echo "  Production Seed Script"
echo "========================================"
echo "Environment: $NODE_ENV"
echo "MONGODB_URI: ${MONGODB_URI%%@*}@..."
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check if we're in production
if [ "$NODE_ENV" != "production" ]; then
    echo -e "${YELLOW}⚠️  WARNING: NODE_ENV is not 'production'${NC}"
    read -p "Continue anyway? (yes/no): " -r
    if [[ ! $REPLY =~ ^[Yy]es$ ]]; then
        echo "Aborted."
        exit 1
    fi
fi

# Check for confirmation
echo -e "${YELLOW}This will seed essential data into the production database.${NC}"
echo "This is typically a ONE-TIME operation after initial deployment."
echo ""
read -p "Continue? (type 'yes' to confirm): " -r

if [ "$REPLY" != "yes" ]; then
    echo "Aborted."
    exit 0
fi

echo ""
echo "🔄 Starting production seed..."

# Function to run seed scripts
run_seed() {
    local script="$1"
    local name="$2"
    
    if [ -f "scripts/$script" ]; then
        echo ""
        echo "📄 Running: $name"
        node "scripts/$script" || {
            echo -e "${RED}❌ Failed: $name${NC}"
            return 1
        }
        echo -e "${GREEN}✅ Completed: $name${NC}"
    else
        echo -e "${YELLOW}⚠️  Skipped: $script not found${NC}"
    fi
}

# Run seed scripts in order
echo ""
echo "========================================"
echo "  Seeding Essential Data"
echo "========================================"

# 1. Seed roles (required for users)
run_seed "seedRoles.js" "Roles"

# 2. Seed platform admin
run_seed "seedPlatformAdmin.js" "Platform Admin"

# 3. Seed default account mappings
run_seed "seedDefaultAccountMappings.js" "Account Mappings"

# 4. Seed chart of accounts
run_seed "seedData.js" "Chart of Accounts"

echo ""
echo "========================================"
echo -e "  ${GREEN}✅ Production seeding completed!${NC}"
echo "========================================"
echo ""
echo "Next steps:"
echo "  1. Verify the seeded data in MongoDB"
echo "  2. Test user login with seeded admin credentials"
echo "  3. Configure other settings as needed"
echo ""

exit 0