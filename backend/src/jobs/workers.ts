import { queueManager } from '../queues/queueManager';
import { Worker, UnrecoverableError } from 'bullmq';
import { moderate } from '../services/ModerationService';
import { MODERATION_QUEUE_NAME, enqueueToDLQ } from '../queues/moderationQueue';
import { getSmsService } from '../services/smsService';
import { createLogger } from '../lib/logger';
import { circuitBreakerService } from '../services/CircuitBreakerService';
import { processEmailJob, createEmailWorker } from './emailJob';
import { processPayoutJob, createPayoutWorker } from './payoutJob';

const logger = createLogger('workers');

/**
 * Sync job processors.
 *
 * There is no blockchain service layer wired into the backend yet, so these
 * processors cannot perform a real account/transaction/balance/contract sync.
 * Rather than fabricating `success: true` (which hides the fact that nothing
 * was synced from job stats, alerting and callers), each processor fails the
 * job with an UnrecoverableError so it is marked failed without burning
 * retries. Replace the body with the real service call once it exists.
 */
function failUnimplementedSync(job: Job, operation: string): never {
  logger.error(`Sync job ${job.id} (${job.name}) failed: ${operation} is not implemented`, {
    jobId: job.id,
    jobName: job.name,
    operation,
  });
  throw new UnrecoverableError(
    `Sync operation "${operation}" is not implemented: no blockchain service is configured`,
  );
}

async function processSyncAccountJob(job: Job): Promise<never> {
  return failUnimplementedSync(job, 'syncAccount');
}

async function processSyncTransactionsJob(job: Job): Promise<never> {
  return failUnimplementedSync(job, 'syncTransactions');
}

async function processSyncBalancesJob(job: Job): Promise<never> {
  return failUnimplementedSync(job, 'syncBalances');
}

async function processFullSyncJob(job: Job): Promise<never> {
  return failUnimplementedSync(job, 'fullSync');
}

async function processSyncContractJob(job: Job): Promise<never> {
  return failUnimplementedSync(job, 'syncContract');
}

async function processDeployContractJob(job: Job): Promise<never> {
  return failUnimplementedSync(job, 'deployContract');
}

// Notification channels that have no delivery service wired up yet
const UNIMPLEMENTED_NOTIFICATION_CHANNELS = new Set(['push', 'in_app', 'webhook']);

// Notification job processor
async function processNotificationJob(job: any) {
  const { type, recipient, title: _title, message: _message, data: _data, metadata } = job.data;

  console.log(`Processing notification job ${job.id}: ${type} notification to ${recipient}`);

  // Channels without a delivery implementation must fail the job rather than
  // report success (#1585, #1586, #1587). Thrown before the circuit breaker so
  // they don't trip it for working channels, and as UnrecoverableError so
  // BullMQ moves the job straight to the failed set without pointless retries.
  if (UNIMPLEMENTED_NOTIFICATION_CHANNELS.has(type)) {
    logger.error(
      `[notification-worker] Job ${job.id}: '${type}' notification channel is not implemented`,
    );
    throw new UnrecoverableError(`Notification channel not implemented: ${type}`);
  }

  // Ensure the notification circuit breaker is registered
  circuitBreakerService.getBreaker('notification');

  // Wrap the entire provider call with the circuit breaker so a sustained
  // outage opens the circuit and stops retrying, preventing queue backlog.
  await circuitBreakerService.execute(
    'notification',
    async () => {
      // Route to appropriate notification service based on type
      switch (type) {
        case 'sms':
          await getSmsService().send(recipient, _message);
          break;
        case 'slack':
          // The Slack delivery implementation is not wired up yet. Fail the
          // job distinctly instead of silently reporting success so callers
          // and queue stats (getNotificationQueueStats/getFailedNotifications)
          // reflect the channel as failing until it is implemented.
          throw new Error(
            `Notification channel 'slack' is not implemented; refusing to report success for job ${job.id}`,
          );
        case 'discord':
          // The Discord delivery implementation is not wired up yet. Fail the
          // job distinctly instead of silently reporting success so callers
          // and queue stats (getNotificationQueueStats/getFailedNotifications)
          // reflect the channel as failing until it is implemented.
          throw new Error(
            `Notification channel 'discord' is not implemented; refusing to report success for job ${job.id}`,
          );
        default:
          console.warn(`Unknown notification type: ${type}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    },
  );

  console.log(`Notification job ${job.id} completed`);

  return {
    success: true,
    notificationId: job.id,
    type,
    recipient,
    sentAt: new Date().toISOString(),
    metadata,
  };
}

// Worker configurations
const workerConfigs = {
  email: {
    processor: processEmailJob,
    concurrency: 10,
  },
  payout: {
    processor: processPayoutJob,
    concurrency: 3, // Lower concurrency for financial transactions
  },
  sync: {
    account: {
      processor: processSyncAccountJob,
      concurrency: 5,
    },
    transactions: {
      processor: processSyncTransactionsJob,
      concurrency: 3,
    },
    balances: {
      processor: processSyncBalancesJob,
      concurrency: 5,
    },
    full: {
      processor: processFullSyncJob,
      concurrency: 2,
    },
    contract: {
      processor: processS

// Initialize all workers
export function initializeWorkers(): Map<string, Worker> {
  const workers = new Map<string, Worker>();

  // Email worker — SES-aware processor from emailJob.ts (non-retryable error
  // handling, email_dropped_total metric, drop-rate alerting)
  workers.set('email', createEmailWorker());

  // Payout worker — idempotent/locked processor from payoutJob.ts
  // (transaction-hash dedup, LockService lock, PayoutTransaction/PayoutFailure persistence)
  workers.set('payout', createPayoutWorker());

  // Sync workers
  const syncWorker = queueManager.createWorker(
    'sync',
    async (job) => {
      const jobName = job.name;

      switch (jobName) {
        case 'sync-account':
          return processSyncAccountJob(job);
        case 'sync-transactions':
          return processSyncTransactionsJob(job);
        case 'sync-balances':
          return processSyncBalancesJob(job);
        case 'full-sync':
          return processFullSyncJob(job);
        case 'sync-contract':
          return processSyncContractJob(job);
        case 'deploy-contract':
          return processDeployContractJob(job);
        default:
          throw new UnrecoverableError(`Unknown sync job type: ${jobName}`);
      }
    },
    {
      concurrency: 5,
    },
  );
  workers.set('sync', syncWorker);

  // Notification worker
  const notificationWorker = queueManager.createWorker('notification', processNotificationJob, {
    concurrency: workerConfigs.notification.concurrency,
  });
  workers.set('notification', notificationWorker);

  // Moderation worker with DLQ routing
  const moderationWorker = queueManager.createWorker(
    MODERATION_QUEUE_NAME,
    async (job) => {
      const { postId } = job.data as { postId: string };
      const status = await moderate(postId);
      return { postId, status };
    },
    { concurrency: 5 },
  );

  // Handle failed jobs that exceed retry limit
  moderationWorker.on('failed', async (job, error) => {
    if (job && job.attemptsMade >= (job.opts.attempts || 3)) {
      logger.warn(
        `[moderation-worker] Job ${job.id} exhausted retries, moving to DLQ: ${error.message}`,
      );
      await enqueueToDLQ(job.data.postId, job.id || 'unknown', error.message);
    }
  });

  workers.set(MODERATION_QUEUE_NAME, moderationWorker);

  console.log(`Initialized ${workers.size} workers`);

  return workers;
}

// Export worker configs for external use
export { workerConfigs };

// Export processor functions for direct testing
export {
  processEmailJob,
  processPayoutJob,
  processSyncAccountJob,
  processSyncTransactionsJob,
  processSyncBalancesJob,
  processFullSyncJob,
  processSyncContractJob,
  processDeployContractJob,
  processNotificationJob,
};
