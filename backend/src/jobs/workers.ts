import { queueManager } from '../queues/queueManager';
import { Worker } from 'bullmq';
import { moderate } from '../services/ModerationService';
import { MODERATION_QUEUE_NAME, enqueueToDLQ } from '../queues/moderationQueue';
import { getSmsService } from '../services/smsService';
import { createLogger } from '../lib/logger';
import { circuitBreakerService } from '../services/CircuitBreakerService';

const logger = createLogger('workers');

// Email job processor
async function processEmailJob(job: any) {
  const {
    to,
    subject: _subject,
    body: _body,
    html: _html,
    attachments: _attachments,
    metadata,
  } = job.data;

  console.log(`Processing email job ${job.id}: sending to ${to}`);

  // Simulate email sending - replace with actual email service
  // const emailService = require('../services/emailService').emailService;
  // await emailService.send({ to, subject, body, html, attachments });

  // For now, simulate processing time
  await new Promise((resolve) => setTimeout(resolve, 100));

  console.log(`Email job ${job.id} completed: sent to ${to}`);

  return {
    success: true,
    emailId: job.id,
    recipient: to,
    sentAt: new Date().toISOString(),
    metadata,
  };
}

// Payout job processor
async function processPayoutJob(job: any) {
  const {
    groupId,
    amount,
    recipient,
    recipientType: _recipientType,
    currency,
    description: _description,
    metadata,
  } = job.data;

  console.log(`Processing payout job ${job.id}: ${amount} ${currency} to ${recipient}`);

  // Simulate payout processing - replace with actual payment service
  // const paymentService = require('../services/paymentService').paymentService;
  // await paymentService.process({ groupId, amount, recipient, recipientType, currency });

  // For now, simulate processing time
  await new Promise((resolve) => setTimeout(resolve, 500));

  console.log(`Payout job ${job.id} completed: ${amount} ${currency} sent to ${recipient}`);

  return {
    success: true,
    transactionId: job.id,
    groupId,
    amount,
    currency,
    recipient,
    status: 'completed',
    processedAt: new Date().toISOString(),
    metadata,
  };
}

// Sync job processors
async function processSyncAccountJob(job: any) {
  const { accountId, metadata } = job.data;

  console.log(`Processing account sync job ${job.id}: syncing account ${accountId}`);

  // Simulate blockchain sync - replace with actual blockchain service
  // const blockchainService = require('../services/blockchainService').blockchainService;
  // await blockchainService.syncAccount(accountId);

  await new Promise((resolve) => setTimeout(resolve, 300));

  console.log(`Account sync job ${job.id} completed for account ${accountId}`);

  return {
    success: true,
    jobId: job.id,
    accountId,
    syncedAt: new Date().toISOString(),
    metadata,
  };
}

async function processSyncTransactionsJob(job: any) {
  const { accountId, startBlock, endBlock, metadata } = job.data;

  console.log(
    `Processing transactions sync job ${job.id}: syncing ${accountId} blocks ${startBlock}-${endBlock}`,
  );

  // Simulate transaction sync
  await new Promise((resolve) => setTimeout(resolve, 400));

  console.log(`Transactions sync job ${job.id} completed`);

  return {
    success: true,
    jobId: job.id,
    accountId,
    startBlock,
    endBlock,
    syncedAt: new Date().toISOString(),
    metadata,
  };
}

async function processSyncBalancesJob(job: any) {
  const { accountId, metadata } = job.data;

  console.log(`Processing balance sync job ${job.id}: syncing balances for ${accountId}`);

  await new Promise((resolve) => setTimeout(resolve, 200));

  console.log(`Balance sync job ${job.id} completed`);

  return {
    success: true,
    jobId: job.id,
    accountId,
    syncedAt: new Date().toISOString(),
    metadata,
  };
}

async function processFullSyncJob(job: any) {
  const { accountId, metadata } = job.data;

  console.log(`Processing full sync job ${job.id}: full sync for ${accountId}`);

  await new Promise((resolve) => setTimeout(resolve, 1000));

  console.log(`Full sync job ${job.id} completed`);

  return {
    success: true,
    jobId: job.id,
    accountId,
    syncedAt: new Date().toISOString(),
    metadata,
  };
}

async function processSyncContractJob(job: any) {
  const { contractId, contractType, action, metadata } = job.data;

  console.log(
    `Processing contract sync job ${job.id}: ${action} ${contractType} contract ${contractId}`,
  );

  await new Promise((resolve) => setTimeout(resolve, 500));

  console.log(`Contract sync job ${job.id} completed`);

  return {
    success: true,
    jobId: job.id,
    contractId,
    contractType,
    action,
    syncedAt: new Date().toISOString(),
    metadata,
  };
}

async function processDeployContractJob(job: any) {
  const { contractId, contractType, metadata } = job.data;

  console.log(
    `Processing contract deploy job ${job.id}: deploying ${contractType} contract ${contractId}`,
  );

  await new Promise((resolve) => setTimeout(resolve, 1000));

  console.log(`Contract deploy job ${job.id} completed`);

  return {
    success: true,
    jobId: job.id,
    contractId,
    contractType,
    deployedAt: new Date().toISOString(),
    metadata,
  };
}

// Notification job processor
async function processNotificationJob(job: any) {
  const { type, recipient, title: _title, message: _message, data: _data, metadata } = job.data;

  console.log(`Processing notification job ${job.id}: ${type} notification to ${recipient}`);

  // Ensure the notification circuit breaker is registered
  circuitBreakerService.getBreaker('notification');

  // Wrap the entire provider call with the circuit breaker so a sustained
  // outage opens the circuit and stops retrying, preventing queue backlog.
  await circuitBreakerService.execute(
    'notification',
    async () => {
      // Route to appropriate notification service based on type
      switch (type) {
        case 'push':
          // await pushService.send(recipient, { title, body: message, data });
          break;
        case 'sms':
          await getSmsService().send(recipient, _message);
          break;
        case 'in_app':
          // await inAppService.create(recipient, { title, message, data });
          break;
        case 'webhook':
          // await webhookService.send(recipient, { title, message, ...data });
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
          // await discordService.send(recipient, message);
          break;
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
      processor: processSyncContractJob,
      concurrency: 3,
    },
    deploy: {
      processor: processDeployContractJob,
      concurrency: 1, // Only one deployment at a time
    },
  },
  notification: {
    processor: processNotificationJob,
    concurrency: 15,
  },
};

// Initialize all workers
export function initializeWorkers(): Map<string, Worker> {
  const workers = new Map<string, Worker>();

  // Initialize email worker
  const emailWorker = new Worker('email', processEmailJob, {
    connection: queueManager.getConnection(),
    concurrency: workerConfigs.email.concurrency,
  });
  workers.set('email', emailWorker);

  // Initialize payout worker
  const payoutWorker = new Worker('payout', processPayoutJob, {
    connection: queueManager.getConnection(),
    concurrency: workerConfigs.payout.concurrency,
  });
  workers.set('payout', payoutWorker);

  // Initialize sync workers
  const syncAccountWorker = new Worker('sync-account', processSyncAccountJob, {
    connection: queueManager.getConnection(),
    concurrency: workerConfigs.sync.account.concurrency,
  });
  workers.set('sync-account', syncAccountWorker);

  const syncTransactionsWorker = new Worker('sync-transactions', processSyncTransactionsJob, {
    connection: queueManager.getConnection(),
    concurrency: workerConfigs.sync.transactions.concurrency,
  });
  workers.set('sync-transactions', syncTransactionsWorker);

  const syncBalancesWorker = new Worker('sync-balances', processSyncBalancesJob, {
    connection: queueManager.getConnection(),
    concurrency: workerConfigs.sync.balances.concurrency,
  });
  workers.set('sync-balances', syncBalancesWorker);

  const fullSyncWorker = new Worker('full-sync', processFullSyncJob, {
    connection: queueManager.getConnection(),
    concurrency: workerConfigs.sync.full.concurrency,
  });
  workers.set('full-sync', fullSyncWorker);

  const syncContractWorker = new Worker('sync-contract', processSyncContractJob, {
    connection: queueManager.getConnection(),
    concurrency: workerConfigs.sync.contract.concurrency,
  });
  workers.set('sync-contract', syncContractWorker);

  const deployContractWorker = new Worker('deploy-contract', processDeployContractJob, {
    connection: queueManager.getConnection(),
    concurrency: workerConfigs.sync.deploy.concurrency,
  });
  workers.set('deploy-contract', deployContractWorker);

  // Initialize notification worker
  const notificationWorker = new Worker('notification', processNotificationJob, {
    connection: queueManager.getConnection(),
    concurrency: workerConfigs.notification.concurrency,
  });
  workers.set('notification', notificationWorker);

  logger.info('All workers initialized');

  return workers;
}

export { processNotificationJob };
