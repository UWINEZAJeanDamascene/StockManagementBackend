# Database Backup Configuration

This guide covers automated database backups for your Stock Management System.

## Configuration

Add to `.env.staging` or `.env.production`:

```env
# Enable automatic backups
AUTO_BACKUP_ENABLED=true

# Backup schedule (cron format)
# Default: Daily at 2am
BACKUP_CRON=0 2 * * *

# Backup retention (days)
BACKUP_RETENTION_DAYS=30

# Backup directory
BACKUP_DIR=./backups

# Cloud backup (enable to upload to cloud)
ENABLE_CLOUD_BACKUP=true

# Optional: AWS S3
AWS_S3_BUCKET=your-bucket-name
AWS_REGION=us-east-1

# Optional: Google Drive (requires GOOGLE_DRIVE_FOLDER_ID)

# Optional: Dropbox (requires DROPBOX_ACCESS_TOKEN)
```

---

## How It Works

1. **Scheduled**: Runs daily at 2am (configurable)
2. **Local**: Creates `.gz` backup in `./backups`
3. **Cloud**: Uploads to S3/Drive/Dropbox if configured
4. **Retention**: Deletes backups older than 30 days

---

## Manual Backup

```bash
# Run backup manually
node -e "
const backupScheduler = require('./services/backupScheduler');
backupScheduler.runBackup();
"
```

---

## Restore from Backup

```bash
# Use restore script
./scripts/restore.sh backups/backup_latest.gz

# Or specific file
./scripts/restore.sh backups/backup_20240115_020000.gz
```

---

## Cloud Storage Setup

### AWS S3

1. Create S3 bucket
2. Create IAM user with S3 access
3. Add credentials to environment

### Google Drive

1. Set `GOOGLE_DRIVE_FOLDER_ID` in environment
2. Service account must have access to folder

### Dropbox

1. Create Dropbox app
2. Add `DROPBOX_ACCESS_TOKEN` to environment

---

## Backup Schedule

| Environment | Frequency | Retention |
|-------------|------------|-----------|
| Staging | Daily | 7 days |
| Production | Daily | 30 days |

---

## Monitoring

- Check backup logs: `logs/combined.log`
- Look for: "Backup completed successfully"
- Alerts: Configure via Sentry for failures

---

## Verification

To verify a backup is valid:

```bash
# List backups
ls -la backups/

# Check backup size
du -h backups/backup_*

# Test restore (to test database)
./scripts/restore.sh --db test_backup
```

---

## Troubleshooting

### "Backup not created"
- Check MongoDB connection
- Check disk space: `df -h`
- Check permissions: `ls -la backups/`

### "Cloud upload failed"
- Verify cloud credentials
- Check network connectivity
- Check bucket/folder permissions

### "Disk full"
- Clean old backups: `find backups -mtime +7 -delete`
- Increase retention cleanup frequency