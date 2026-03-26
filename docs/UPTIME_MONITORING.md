# Uptime Monitoring Setup

This guide covers setting up uptime monitoring for your Stock Management System.

## Supported Services

| Service | Free Tier | Alerts | Setup |
|---------|-----------|--------|-------|
| UptimeRobot | 50 monitors | Email, SMS | Easy |
| Pingdom | 1 monitor | Email | Medium |
| Healthchecks.io | 20 monitors | Email, Webhook | Easy |
| Prometheus/Grafana | Unlimited | Various | Hard |

---

## Step 1: Choose Monitoring Service

### Option A: UptimeRobot (Recommended for simplicity)

1. **Sign up**: [uptimerobot.com](https://uptimerobot.com)
2. **Create Monitor**:
   - Type: HTTP(s)
   - URL: `https://yourdomain.com/health` or `/api/health`
   - Interval: 5 minutes
3. **Add Alerts**: Email, SMS (optional)

### Option B: Healthchecks.io

1. **Sign up**: [healthchecks.io](https://healthchecks.io)
2. **Create Check**: Get unique URL
3. **Configure in App**: Add to cron job
4. **Add Alerts**: Email, Slack, etc.

---

## Health Endpoints

The application provides these health endpoints:

| Endpoint | Purpose | Auth Required |
|----------|---------|----------------|
| `/health` | Basic health | No |
| `/api/health` | Full system health | No |
| `/api/health/detailed` | Detailed diagnostics | No |
| `/api/health/ready` | Readiness probe | No |
| `/api/health/live` | Liveness probe | No |

---

## Sample Response - /health

```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600,
  "services": {
    "mongodb": { "status": "healthy", "state": "connected" },
    "redis": { "status": "healthy" },
    "memory": { "status": "healthy", "heapPercent": "45%" }
  }
}
```

---

## Docker Health Checks

Add to your `docker-compose.yml`:

```yaml
healthcheck:
  test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 40s
```

---

## Kubernetes Probes

Add to your deployment:

```yaml
livenessProbe:
  httpGet:
    path: /api/health/live
    port: 3000
  initialDelaySeconds: 30
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /api/health/ready
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 5
```

---

## Integration with Monitoring Service

### UptimeRobot Setup

1. Create account at uptimerobot.com
2. Add new monitor:
   ```
   Name: Stock Management API
   Type: HTTP(s)
   URL: https://staging.yourdomain.com/api/health
   ```
3. Set alert contacts

### Healthchecks.io Setup

1. Create account at healthchecks.io
2. Create check, get URL
3. Add cron job to ping:

```bash
# Add to crontab
*/5 * * * * curl -fsS -m 10 https://hc-ping.com/YOUR-UUID > /dev/null
```

---

## Alert Configuration

### Recommended Settings

| Check Type | Interval | Timeout | Retries |
|------------|----------|---------|---------|
| Basic /health | 5 min | 10s | 3 |
| Detailed /api/health | 15 min | 30s | 3 |

### Alert Channels

1. **Email** - All environments
2. **Slack** - Production critical alerts
3. **SMS** - Production only (for critical failures)

---

## Response Time Alerts

Configure alerts for slow responses:

| Threshold | Action |
|-----------|--------|
| > 500ms | Log warning |
| > 1s | Log error |
| > 3s | Alert |

---

## Dashboard Integration

### Grafana Setup (optional)

```yaml
# docker-compose section for Prometheus
services:
  prometheus:
    image: prom/prometheus
    ports:
      - "9090:9090"
```

Add to `/api/health` response to track:
- Response time
- Memory usage
- Database latency
- Redis latency

---

## Troubleshooting

### "Service appears down"
- Check endpoint returns 200
- Verify SSL certificate valid
- Check firewall allows monitoring IP

### "Flapping" (up and down)
- Increase check interval
- Increase timeout
- Check for memory leaks causing crashes