# MongoDB Atlas Setup Guide

This guide walks you through setting up MongoDB Atlas for your Stock Management System.

## Prerequisites

- MongoDB Atlas account (free tier works)
- Node.js 18+ installed
- Access to your terminal

---

## Step 1: Create MongoDB Atlas Account

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register)
2. Sign up with your email
3. Choose the **Free Tier** (M0) cluster - it's free forever

---

## Step 2: Create a Cluster

1. After login, click **Create**
2. Select **Free** tier
3. Choose a cloud provider (AWS recommended)
4. Select a region closest to your users
5. Click **Create Cluster**

**Wait 1-3 minutes** for the cluster to deploy.

---

## Step 3: Create Database User

1. Click **Database** → **Access** → **Add New Database User**
2. Create username (e.g., `stock_admin`)
3. Generate a strong password (click **Autogenerate**)
4. **Important**: Save the password somewhere safe!
5. Under **Database User Privileges**, select **Atlas Admin**
6. Click **Add User**

---

## Step 4: Configure Network Access

1. Click **Network Access** → **Add IP Address**
2. For **development**, allow access from anywhere:
   - Click **Add IP Address**
   - Select **Allow Access from Anywhere (0.0.0.0/0)**
   - Click **Confirm**
3. For **production**, use your specific deployment IP/CIDR

---

## Step 5: Get Connection String

1. Click **Database** → **Connect**
2. Select **Drivers**
3. Copy the connection string - it looks like:
   ```
   mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
4. Replace `<username>` and `<password>` with your credentials

---

## Step 6: Configure Environment Variables

### For Development (.env.development)
```env
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/stock-management?retryWrites=true&w=majority
```

### For Staging (.env.staging)
```env
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/stock-management-staging?retryWrites=true&w=majority
```

### For Production (.env.production)
```env
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/stock-management-prod?retryWrites=true&w=majority
```

---

## Step 7: Configure Connection Pool (Production)

Add these settings to your production `.env.production`:

```env
# Connection Pool Settings (optimized for production)
MONGODB_MAX_POOL_SIZE=50
MONGODB_MIN_POOL_SIZE=10
MONGODB_SERVER_SELECTION_TIMEOUT_MS=30000
MONGODB_SOCKET_TIMEOUT_MS=45000
MONGODB_CONNECT_TIMEOUT_MS=30000
MONGODB_HEARTBEAT_FREQUENCY_MS=10000
```

---

## Step 8: Test the Connection

Run the health check script:
```bash
cd Stock_tenancy_system
node -e "
const mongoose = require('mongoose');
require('dotenv').config({ path: '.env.production' });
mongoose.connect(process.env.MONGODB_URI)
  .then(() => { console.log('✅ Connected to MongoDB Atlas'); process.exit(0); })
  .catch(err => { console.error('❌ Connection failed:', err.message); process.exit(1); });
"
```

---

## Step 9: Enable Backups (Recommended)

1. In Atlas, go to **Backup** → **Cloud Backup**
2. Enable **Continuous Backups** (free tier includes this)
3. For production, consider:
   - **Point-in-time recovery** (paid feature)
   - **Cloud backup to AWS S3** (cross-cloud backup)

---

## Connection String Format Explained

```
mongodb+srv://<username>:<password>@<cluster-name>..mongodb.net/<database>?<options>
```

| Component | Description |
|-----------|-------------|
| `mongodb+srv` | Uses DNS seed list (auto-discovers cluster members) |
| `<username>` | Your database user from Step 3 |
| `<password>` | Your database password (URL encoded if contains special chars) |
| `<cluster-name>` | Your cluster name (e.g., `cluster0`) |
| `<database>` | Database name to connect to |
| `retryWrites=true` | Retry failed writes automatically |
| `w=majority` | Wait for majority of replicas to acknowledge |

---

## Troubleshooting

### "SCRAM authentication failed"
- Check username/password are correct
- Ensure password is URL-encoded (e.g., `#` → `%23`)

### "Connection timed out"
- Check network access (Step 4)
- Verify firewall rules

### "Database name not found"
- Create the database in Atlas first, or let the app create it
- For existing data, import with `mongorestore`

### "Service cannot connect to Atlas"
- Ensure `MONGODB_URI` is correct in `.env` file
- Check that IP is whitelisted in Network Access

---

## Security Best Practices

1. **Never commit** `.env` files to version control
2. **Use different users** for staging vs production
3. **Enable VPC peering** for production (AWS users)
4. **Rotate passwords** every 90 days
5. **Enable encryption at rest** in Atlas settings
6. **Use private endpoints** for production (paid feature)

---

## Quick Reference

| Environment | Connection | Pool Size |
|-------------|------------|-----------|
| Development | localhost or Atlas | 10 |
| Staging | Atlas | 25 |
| Production | Atlas | 50 |

For production with 1000+ concurrent users, consider:
- M10+ tier (paid)
- Connection pooling
- Read replicas for read-heavy workloads