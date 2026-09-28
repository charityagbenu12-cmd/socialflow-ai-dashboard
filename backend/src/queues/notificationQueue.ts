import { queueManager } from './queueManager';

// Queue names
export const NOTIFICATION_QUEUE_NAME = 'notification';

// Notification types
export type NotificationType = 'push' | 'sms' | 'in_app' | 'webhook' | 'slack' | 'discord';

// Notification job data interfaces
export interface NotificationJobData {
  type: NotificationType;
  recipient: string;
  title: string;
  message: string;
  data?: Record<string, any>;
  metadata?: {
    userId?: string;
    campaignId?: string;
    actionId?: string;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
  };
}

export interface BulkNotificationData {
  notifications: NotificationJobData[];
  batchId?: string;
}

/**
 * Notification channels that are not yet implemented by the worker.
 * Jobs for these channels must fail distinctly instead of silently
 * reporting success, so callers and queue stats reflect the real state.
 */
export const UNIMPLEMENTED_NOTIFICATION_CHANNELS: ReadonlyArray<NotificationType> = [
  'slack',
  'discord',
];

export function isNotificationChannelImplemented(type: NotificationType): boolean {
  return !UNIMPLEMENTED_NOTIFICATION_CHANNELS.includes(type);
}

// Create the notification queue
export const notificationQueue = queueManager.createQueue(NOTIFICATION_QUEUE_NAME, {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000,
  },
  removeOnComplete: 100,
  removeOnFail: 200,
});

/**
 * Send a single notification
 */
export async function sendNotification(data: NotificationJobData): Promise<string | undefined> {
  // Set priority based on metadata
  const priority =
    data.metadata?.priority === 'urgent'
      ? 1
      : data.metadata?.priority === 'high'
        ? 1
        : data.metadata?.priority === 'low'
          ? 3
          : 2;

  return await queueManager.addJob(NOTIFICATION_QUEUE_NAME, 'send-notification', data, {
    priority,
  });
}

/**
 * Send bulk notifications
 */
export async function sendBulkNotifications(
  notifications: NotificationJobData[],
): Promise<string[]> {
  const jobs = notifications.map((notification) => {
    const priority =
      notification.metadata?.priority === 'urgent'
        ? 1
        : notification.metadata?.priority === 'high'
          ? 1
          : notification.metadata?.priority === 'low'
            ? 3
            : 2;

    return {
      name: 'send-notification',
      data: notification,
      options: { priority },
    };
  });

  return await queueManager.addBulkJobs(NOTIFICATION_QUEUE_NAME, jobs);
}

/**
 * Send push notification
 */
export async function sendPushNotification(
  recipient: string,
  title: string,
  message: string,
  data?: Record<string, any>,
  metadata?: NotificationJobData['metadata'],
): Promise<string | undefined> {
  return await sendNotification({
    type: 'push',
    recipient,
    title,
    message,
    data,
    metadata,
  });
}

/**
 * Send SMS notification
 */
export async function sendSmsNotification(
  recipient: string,
  message: string,
  metadata?: NotificationJobData['metadata'],
): Promise<string | undefined> {
  return await sendNotification({
    type: 'sms',
    recipient,
    title: '', // SMS doesn't need title
    message,
    metadata,
  });
}

/**
 * Send in-app notification
 */
export async function sendInAppNotification(
  recipient: string,
  title: string,
  message: string,
  data?: Record<string, any>,
  metadata?: NotificationJobData['metadata'],
): Promise<string | undefined> {
  return await sendNotification({
    type: 'in_app',
    recipient,
    title,
    message,
    data,
    metadata,
  });
}

/**
 * Send webhook notification
 */
export async function sendWebhookNotification(
  url: string,
  payload: Record<string, any>,
  metadata?: NotificationJobData['metadata'],
): Promise<string | undefined> {
  return await sendNotification({
    type: 'webhook',
    recipient: url,
    title: 'Webhook Notification',
    message: JSON.stringify(payload),
    data: payload,
    metadata,
  });
}

/**
 * Send Slack notification
 */
export async function sendSlackNotification(
  webhookUrl: string,
  message: string,
  metadata?: NotificationJobData['metadata'],
): Promise<string | undefined> {
  return await sendNotification({
    type: 'slack',
    recipient: webhookUrl,
    title: '',
    message,
    metadata,
  });
}

/**
 * Send Discord notification
 */
export async function sendDiscordNotification(
  webhookUrl: string,
  message: string,
  metadata?: NotificationJobData['metadata'],
): Promise<string | undefined> {
  return await sendNotification({
    type: 'discord',
    recipient: webhookUrl,
    title: '',
    message,
    metadata,
  });
}

/**
 * Schedule notification
 */
export async function scheduleNotification(
  data: NotificationJobData,
  scheduledFor: Date,
): Promise<string | undefined> {
  const delay = scheduledFor.getTime() - Date.now();

  if (delay < 0) {
    throw new Error('Scheduled time must be in the future');
  }

  return await queueManager.addJob(NOTIFICATION_QUEUE_NAME, 'send-notification', data, {
    delay,
  });
}

/**
 * Get notification queue statistics
 */
export async function getNotificationQueueStats() {
  return await queueManager.getQueueStats(NOTIFICATION_QUEUE_NAME);
}

/**
 * Get failed notification jobs
 */
export async function getFailedNotifications(start: number = 0, end: number = 20) {
  return await queueManager.getFailedJobs(NOTIFICATION_QUEUE_NAME, start, end);
}

/**
 * Get waiting notification jobs
 */
export async function getWaitingNotifications(start: number = 0, end: number = 20) {
  return await queueManager.getWaitingJobs(NOTIFICATION_QUEUE_NAME, start, end);
}

/**
 * Retry a failed notification
 */
export async function retryFailedNotification(jobId: string) {
  return await queueManager.retryJob(NOTIFICATION_QUEUE_NAME, jobId);
}
