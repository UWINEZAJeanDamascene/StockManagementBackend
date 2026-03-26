#!/bin/bash
# =============================================================================
# Healthcheck Script
# =============================================================================
# Used by Docker healthcheck to verify the application is running
# =============================================================================

set -e

# Configuration
HEALTH_ENDPOINT="${HEALTH_ENDPOINT:-http://localhost:3000/api/health}"
MAX_RETRIES="${MAX_RETRIES:-3}"
RETRY_DELAY="${RETRY_DELAY:-5}"

echo "Checking health endpoint: $HEALTH_ENDPOINT"

# Try to hit the health endpoint
for i in $(seq 1 $MAX_RETRIES); do
    echo "Attempt $i of $MAX_RETRIES..."
    
    response=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 "$HEALTH_ENDPOINT" || echo "000")
    
    if [ "$response" = "200" ]; then
        echo "✅ Health check passed!"
        exit 0
    fi
    
    echo "Response code: $response"
    
    if [ $i -lt $MAX_RETRIES ]; then
        echo "Retrying in $RETRY_DELAY seconds..."
        sleep $RETRY_DELAY
    fi
done

echo "❌ Health check failed after $MAX_RETRIES attempts"
exit 1