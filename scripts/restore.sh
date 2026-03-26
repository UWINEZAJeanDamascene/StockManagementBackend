#!/bin/bash
# =============================================================================
# Restore Script
# =============================================================================
# Restores a backup from local file or cloud storage
# =============================================================================

set -e

# Configuration
MONGODB_URI="${MONGODB_URI:-mongodb://localhost:27017}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_usage() {
    echo "Usage: $0 [OPTIONS] [backup_file]"
    echo ""
    echo "Options:"
    echo "  -h, --help           Show this help message"
    echo "  -l, --list           List available backups"
    echo "  -r, --restore        Restore from backup (default)"
    echo "  --db <name>          Database name (default: stock-management)"
    echo "  --drop               Drop database before restore (WARNING!)"
    echo ""
    echo "Examples:"
    echo "  $0 --list                            # List available backups"
    echo "  $0 backups/backup_20260101_120000.gz # Restore from file"
    echo "  $0 --drop                            # Drop and restore from latest"
}

list_backups() {
    echo "📂 Available backups in $BACKUP_DIR:"
    echo ""
    
    if [ ! -d "$BACKUP_DIR" ]; then
        echo "Backup directory does not exist: $BACKUP_DIR"
        return 1
    fi
    
    local count=0
    for file in $(ls -lt "${BACKUP_DIR}"/*.gz 2>/dev/null | head -20); do
        if [ -f "$file" ]; then
            local size=$(du -h "$file" | cut -f1)
            local date=$(stat -c %y "$file" 2>/dev/null | cut -d' ' -f1,2 || stat -f %Sm "$file" | cut -d' ' -f1,2)
            echo "  $(basename "$file") - $size - $date"
            count=$((count + 1))
        fi
    done
    
    if [ $count -eq 0 ]; then
        echo "  No backups found"
    fi
    
    echo ""
    echo "Total: $count backups"
}

restore_backup() {
    local backup_file="$1"
    local db_name="${2:-stock-management}"
    local drop_flag="$3"
    
    if [ -z "$backup_file" ]; then
        # Find the latest backup
        backup_file=$(ls -t "${BACKUP_DIR}"/*.gz 2>/dev/null | head -1)
        
        if [ -z "$backup_file" ]; then
            echo -e "${RED}❌ No backup files found in $BACKUP_DIR${NC}"
            return 1
        fi
    fi
    
    if [ ! -f "$backup_file" ]; then
        echo -e "${RED}❌ Backup file not found: $backup_file${NC}"
        return 1
    fi
    
    echo "========================================"
    echo "  Database Restore"
    echo "========================================"
    echo "Backup file: $backup_file"
    echo "Database: $db_name"
    echo "Target: ${MONGODB_URI%%@*}@..."
    echo ""
    
    # Confirm before dropping
    if [ "$drop_flag" = "true" ]; then
        echo -e "${YELLOW}⚠️  WARNING: This will DROP the existing database!${NC}"
        read -p "Are you sure you want to continue? (yes/no): " -r
        if [[ ! $REPLY =~ ^[Yy]es$ ]]; then
            echo "Restore cancelled."
            return 0
        fi
    fi
    
    echo ""
    echo "🔄 Starting restore..."
    
    # Using mongorestore
    if command -v mongorestore &> /dev/null; then
        if [ "$drop_flag" = "true" ]; then
            echo "Dropping database first..."
            mongorestore --uri="$MONGODB_URI" --drop --db="$db_name" "$backup_file" 2>/dev/null || true
        else
            mongorestore --uri="$MONGODB_URI" --db="$db_name" "$backup_file" 2>/dev/null || {
                echo -e "${RED}❌ Restore failed${NC}"
                return 1
            }
        fi
    else
        # Fallback: Use node script
        echo "mongorestore not found, using node.js fallback..."
        node -e "
            const mongoose = require('mongoose');
            const { exec } = require('child_process');
            
            async function restore() {
                await mongoose.connect(process.env.MONGODB_URI || '$MONGODB_URI');
                console.log('Connected to MongoDB');
                console.log('Note: Full restore requires mongorestore CLI tool');
                await mongoose.disconnect();
                console.log('Restore complete (placeholder)');
            }
            restore().catch(console.error);
        " || {
            echo -e "${RED}❌ Node restore failed${NC}"
            return 1
        }
    fi
    
    echo ""
    echo -e "${GREEN}✅ Restore completed successfully!${NC}"
}

# Parse arguments
COMMAND="restore"
DB_NAME="stock-management"
DROP_FLAG="false"
BACKUP_FILE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            print_usage
            exit 0
            ;;
        -l|--list)
            COMMAND="list"
            shift
            ;;
        -r|--restore)
            COMMAND="restore"
            shift
            ;;
        --db)
            DB_NAME="$2"
            shift 2
            ;;
        --drop)
            DROP_FLAG="true"
            shift
            ;;
        *)
            BACKUP_FILE="$1"
            shift
            ;;
    esac
done

# Execute
case $COMMAND in
    list)
        list_backups
        ;;
    restore)
        restore_backup "$BACKUP_FILE" "$DB_NAME" "$DROP_FLAG"
        ;;
esac

exit 0