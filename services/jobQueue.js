/**
 * Background Job Queue Service using BullMQ
 * Handles:
 * - Pre-computed aggregations (nightly jobs)
 * - Recurring invoice generation
 * - Report generation
 * - Email notifications
 */

const { Queue, Worker, Scheduler } = require('bullmq');
const redisConnection = require('../config/redis');

// Job types
const JOB_TYPES = {
  // Pre-computed aggregations
  NIGHTLY_AGGREGATION: 'nightly-aggregation',
  DAILY_SUMMARY: 'daily-summary',
  MONTHLY_SUMMARY: 'monthly-summary',
  
  // Report generation
  GENERATE_REPORT: 'generate-report',
  EXPORT_REPORT: 'export-report',
  
  // Recurring invoices
  RECURRING_INVOICE: 'recurring-invoice',
  
  // Notifications
  SEND_EMAIL: 'send-email',
  LOW_STOCK_NOTIFICATION: 'low-stock-notification'
};

// Create queues
const queues = {
  // High priority queue for urgent jobs
  highPriority: new Queue('high-priority', { connection: redisConnection }),
  
  // Default queue for regular jobs
  default: new Queue('default', { connection: redisConnection }),
  
  // Low priority queue for background jobs (nightly jobs)
  background: new Queue('background', { connection: redisConnection }),
  
  // Reports queue
  reports: new Queue('reports', { connection: redisConnection })
};

/**
 * Add a job to the queue
 * @param {string} queueName - Queue name (highPriority, default, background, reports)
 * @param {string} jobName - Job type from JOB_TYPES
 * @param {Object} data - Job data
 * @param {Object} options - Job options (priority, delay, repeat, etc.)
 */
async function addJob(queueName, jobName, data, options = {}) {
  const queue = queues[queueName];
  if (!queue) {
    throw new Error(`Queue ${queueName} not found`);
  }

  const job = await queue.add(jobName, data, {
    priority: options.priority || 2,
    delay: options.delay || 0,
    attempts: options.attempts || 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    },
    removeOnComplete: {
      count: 100,
      age: 24 * 3600 // 24 hours
    },
    removeOnFail: {
      count: 500,
      age: 7 * 24 * 3600 // 7 days
    },
    ...options
  });

  return job;
}

/**
 * Schedule a recurring job (nightly, daily, weekly)
 * @param {string} queueName - Queue name
 * @param {string} jobName - Job type
 * @param {Object} data - Job data
 * @param {Object} repeatOptions - Repeat options (cron expression)
 */
async function scheduleRecurringJob(queueName, jobName, data, repeatOptions) {
  const queue = queues[queueName];
  
  const job = await queue.add(jobName, data, {
    repeat: {
      tz: 'Africa/Kigali', // Rwanda timezone
      ...repeatOptions
    },
    removeOnComplete: {
      count: 10,
      age: 24 * 3600
    }
  });

  return job;
}

/**
 * Setup nightly aggregation job (runs at 2 AM daily)
 */
async function setupNightlyAggregation() {
  await scheduleRecurringJob('background', JOB_TYPES.NIGHTLY_AGGREGATION, {}, {
    pattern: '0 2 * * *' // 2 AM daily
  });
  console.log('Nightly aggregation job scheduled');
}

/**
 * Setup daily summary job (runs at 6 AM daily)
 */
async function setupDailySummary() {
  await scheduleRecurringJob('background', JOB_TYPES.DAILY_SUMMARY, {}, {
    pattern: '0 6 * * *' // 6 AM daily
  });
  console.log('Daily summary job scheduled');
}

/**
 * Setup monthly summary job (runs at 1st of month at 3 AM)
 */
async function setupMonthlySummary() {
  await scheduleRecurringJob('background', JOB_TYPES.MONTHLY_SUMMARY, {}, {
    pattern: '0 3 1 * *' // 1st of month at 3 AM
  });
  console.log('Monthly summary job scheduled');
}

/**
 * Setup all scheduled jobs
 */
async function setupScheduledJobs() {
  await setupNightlyAggregation();
  await setupDailySummary();
  await setupMonthlySummary();
}

/**
 * Add recurring invoice generation job
 */
async function scheduleRecurringInvoices(companyId, invoiceData) {
  return await addJob('default', JOB_TYPES.RECURRING_INVOICE, {
    companyId,
    ...invoiceData
  }, {
    priority: 1
  });
}

/**
 * Add report generation job
 */
async function scheduleReportGeneration(companyId, reportType, params) {
  return await addJob('reports', JOB_TYPES.GENERATE_REPORT, {
    companyId,
    reportType,
    params,
    requestedAt: new Date().toISOString()
  }, {
    priority: 1
  });
}

/**
 * Add email job
 */
async function scheduleEmail(to, subject, template, data) {
  return await addJob('highPriority', JOB_TYPES.SEND_EMAIL, {
    to,
    subject,
    template,
    data,
    queuedAt: new Date().toISOString()
  });
}

/**
 * Get queue statistics
 */
async function getQueueStats() {
  const stats = {};
  
  for (const [name, queue] of Object.entries(queues)) {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount()
    ]);
    
    stats[name] = {
      waiting,
      active,
      completed,
      failed,
      delayed,
      total: waiting + active + delayed
    };
  }
  
  return stats;
}

/**
 * Clean up old jobs
 */
async function cleanupOldJobs() {
  for (const queue of Object.values(queues)) {
    await queue.clean(24 * 3600 * 1000, 100, 'completed'); // Clean completed older than 24h
    await queue.clean(7 * 24 * 3600 * 1000, 100, 'failed'); // Clean failed older than 7 days
  }
}

module.exports = {
  JOB_TYPES,
  queues,
  addJob,
  scheduleRecurringJob,
  setupScheduledJobs,
  scheduleRecurringInvoices,
  scheduleReportGeneration,
  scheduleEmail,
  getQueueStats,
  cleanupOldJobs
};
