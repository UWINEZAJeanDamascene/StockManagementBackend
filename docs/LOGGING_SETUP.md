# Log Aggregation Setup

This guide covers setting up centralized logging for your Stock Management System.

## Supported Providers

| Provider | Free Tier | Setup Complexity |
|----------|-----------|-------------------|
| Console (default) | Yes | None |
| File (local) | Yes | None |
| Datadog | 1GB/mo free | Medium |
| Loggly | 200MB/mo free | Easy |
| Logtail | 5GB/mo free | Easy |
| Custom HTTP | Any | Easy |

---

## Configuration

### Environment Variables

Add these to your `.env.staging` or `.env.production`:

```env
# Logging Level: debug, info, warn, error
LOG_LEVEL=info

# Enable query logging (development only)
LOG_QUERIES=false

# Sentry (error tracking)
SENTRY_DSN=https://xxxx@sentry.io/project

# Datadog (adds to existing logs)
DATADOG_API_KEY=your-datadog-api-key

# Loggly (structured logging)
LOGGLY_TOKEN=your-loggly-token
LOGGLY_SUBDOMAIN=your-subdomain

# Custom HTTP endpoint (any log shipper)
LOG_HTTP_ENDPOINT=https://your-log-service.com/logs
```

---

## Usage in Code

### Basic Logging

```javascript
const logger = require('./src/config/logger');

logger.info('Application started');
logger.warn('Warning message');
logger.error('Error occurred', { error: err });
```

### With Metadata

```javascript
logger.info('User logged in', { 
  userId: user._id, 
  companyId: company._id 
});
```

### HTTP Request Logging

```javascript
const { logRequest } = require('./src/config/logger');

// After response
logRequest(req, res, responseTime);
```

### Database Query Logging

```javascript
const { logQuery } = require('./src/config/logger');

// After query
logQuery('find', 'users', 15); // 15ms
```

---

## Datadog Setup

1. **Create Datadog Account**: [datadoghq.com](https://www.datadoghq.com)
2. **Get API Key**: Settings → API Keys
3. **Install Agent** (optional for container):

```bash
# For Docker
DD_API_KEY=your-api-key docker run -d \
  --name dd-agent \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /proc/:/host/proc/:ro \
  -v /sys/fs/cgroup/:/host/sys/fs/cgroup/:ro \
  gcr.io/datadoghq/agent:7
```

4. **Install Winston Transport** (optional):

```bash
npm install winston-datadog-transport
```

---

## Loggly Setup

1. **Create Account**: [loggly.com](https://www.loggly.com)
2. **Get Token**: Source Setup → Customer Tokens
3. **Install**:

```bash
npm install winston-loggly
```

4. **Configure**:

```env
LOGGLY_TOKEN=your-token
LOGGLY_SUBDOMAIN=your-company
```

---

## Log Storage Strategy

| Environment | Primary | Backup |
|-------------|---------|--------|
| Development | Console | None |
| Staging | File + Datadog | Loggly |
| Production | Datadog | Loggly + File |

---

## Viewing Logs

### Local Development

```bash
# View all logs
tail -f logs/combined.log

# View errors only
tail -f logs/error.log
```

### Datadog

- Dashboard: `app.datadoghq.com/dashboard`
- Logs: `app.datadoghq.com/logs`

### Loggly

- Dashboard: `your-company.loggly.com`

---

## Integration with Morgan (HTTP Logging)

To log HTTP requests using Morgan:

```javascript
const logger = require('./src/config/logger');
const morgan = require('morgan');

app.use(morgan('combined', { 
  stream: logger.stream 
}));
```

---

## Best Practices

1. **Don't log sensitive data** (passwords, tokens, PII)
2. **Use appropriate log levels**:
   - `debug`: Development, verbose info
   - `info`: Normal operations
   - `warn`: Issues that need attention but don't break functionality
   - `error`: Actual errors causing failures
3. **Add context** to logs (userId, companyId, requestId)
4. **Set up alerts** for error-level logs in production