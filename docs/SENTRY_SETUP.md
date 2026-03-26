# Error Monitoring with Sentry

This guide covers setting up Sentry for error tracking and performance monitoring.

## Prerequisites

- Sentry account (free tier available)
- Node.js application with Express

---

## Step 1: Create Sentry Project

1. Go to [sentry.io](https://sentry.io)
2. Create new project: **Express** → **Node.js**
3. Get the DSN (Data Source Name)

---

## Step 2: Install Sentry SDK

```bash
npm install @sentry/node
```

---

## Step 3: Configure

Add to your environment files:

```env
# .env.staging
SENTRY_DSN=https://xxxxx@sentry.io/staging-project

# .env.production
SENTRY_DSN=https://xxxxx@sentry.io/production-project
```

---

## Step 4: Integrate with Express

In your `server.js`:

```javascript
const { sentryRequestHandler, sentryErrorHandler } = require('./src/config/sentry');

// Add Sentry middleware BEFORE other middleware
app.use(sentryRequestHandler());

// Your routes and other middleware

// Add error handler BEFORE errorHandler middleware
app.use(sentryErrorHandler());

// Your existing error handler
app.use(errorHandler);
```

---

## Step 5: Track Custom Events

```javascript
const { captureError } = require('./src/config/sentry');

// Capture custom error
try {
  await doSomething();
} catch (err) {
  captureError(err, { userId: user._id });
}

// Or directly
const { Sentry } = require('./src/config/sentry');
Sentry.captureMessage('User action logged', 'info');
Sentry.captureException(err);
```

---

## Features

### Error Tracking
- Automatic error capture in Express routes
- Stack traces with source maps
- Environment/context (user, tags)

### Performance Monitoring
- Transaction tracking
- Endpoint response times
- Database query performance

### Release Tracking
- Links errors to deployment
- Shows which release introduced bug

---

## Environment Setup

| Environment | DSN | Sample Rate |
|-------------|-----|-------------|
| Development | Optional | 100% |
| Staging | staging project | 50% |
| Production | production project | 10% |

---

## Best Practices

1. **Use appropriate sample rates** - Higher in dev, lower in prod
2. **Add user context** - When user is authenticated:
   ```javascript
   Sentry.setUser({ id: user._id, email: user.email });
   ```
3. **Add tags** - For filtering:
   ```javascript
   Sentry.setTag('company_id', companyId);
   ```

---

## Viewing Errors

1. **Dashboard**: https://sentry.io/[your-org]/
2. **Issues**: All errors grouped
3. **Performance**: Transaction traces
4. **Releases**: Deployment tracking

---

## Troubleshooting

### "No DSN provided"
- Check SENTRY_DSN in your .env file

### "Events not showing"
- Check filter settings in Sentry dashboard
- Verify sample rate isn't 0

### "Performance too verbose"
- Reduce tracesSampleRate in config