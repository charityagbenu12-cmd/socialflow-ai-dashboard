import 'reflect-metadata';
import { injectable } from 'inversify';
import { createLogger } from '../../../lib/logger';

const logger = createLogger('notificationProvider');

export interface AlertPayload {
  severity: 'critical' | 'warning';
  service: string;
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

export interface NotificationProvider {
  send(alert: AlertPayload): Promise<void>;
}

function formatAlertSummary(alert: AlertPayload): string {
  const queueName =
    typeof alert.details?.queueName === 'string' ? alert.details.queueName : undefined;
  const lastErrorMessage =
    typeof alert.details?.lastErrorMessage === 'string'
      ? alert.details.lastErrorMessage
      : typeof alert.details?.error === 'string'
      ? alert.details.error
      : typeof alert.details?.failedReason === 'string'
      ? alert.details.failedReason
      : undefined;

  const context: string[] = [];

  if (queueName) {
    context.push(`queue=${queueName}`);
  }

  if (lastErrorMessage) {
    context.push(`lastError=${lastErrorMessage}`);
  }

  return context.length > 0 ? `${alert.message} (${context.join(', ')})` : alert.message;
}

@injectable()
class SlackNotificationProvider implements NotificationProvider {
  private webhookUrl: string;

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl;
  }

  async send(alert: AlertPayload): Promise<void> {
    try {
      const color = alert.severity === 'critical' ? 'danger' : 'warning';
      const summary = formatAlertSummary(alert);
      const payload = {
        attachments: [
          {
            color,
            title: `${alert.severity.toUpperCase()}: ${alert.service}`,
            text: summary,
            fields: alert.details
              ? Object.entries(alert.details).map(([key, value]) => ({
                  title: key,
                  value: String(value),
                  short: true,
                }))
              : [],
            ts: Math.floor(new Date(alert.timestamp).getTime() / 1000),
          },
        ],
      };

      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Slack API error: ${response.statusText}`);
      }

      logger.info('Alert sent to Slack', { service: alert.service });
    } catch (error) {
      logger.error('Failed to send Slack notification', {
        error: error instanceof Error ? error.message : String(error),
        service: alert.service,
      });
    }
  }
}

@injectable()
class PagerDutyNotificationProvider implements NotificationProvider {
  private integrationKey: string;

  constructor(integrationKey: string) {
    this.integrationKey = integrationKey;
  }

  async send(alert: AlertPayload): Promise<void> {
    try {
      const summary = formatAlertSummary(alert);
      const payload = {
        routing_key: this.integrationKey,
        event_action: alert.severity === 'critical' ? 'trigger' : 'resolve',
        dedup_key: `${alert.service}-${alert.timestamp}`,
        payload: {
          summary: `${alert.service}: ${summary}`,
          severity: alert.severity === 'critical' ? 'critical' : 'warning',
          source: 'SocialFlow Health Monitor',
          custom_details: alert.details || {},
          timestamp: alert.timestamp,
        },
      };

      const response = await fetch('https://events.pagerduty.com/v2/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`PagerDuty API error: ${response.statusText}`);
      }

      logger.info('Alert sent to PagerDuty', { service: alert.service });
    } catch (error) {
      logger.error('Failed to send PagerDuty notification', {
        error: error instanceof Error ? error.message : String(error),
        service: alert.service,
      });
    }
  }
}

@injectable()
export class NotificationManager {
  private providers: Map<string, NotificationProvider> = new Map();

  registerProvider(name: string, provider: NotificationProvider): void {
    this.providers.set(name, provider);
  }

  async sendAlert(alert: AlertPayload): Promise<void> {
    const promises = Array.from(this.providers.values()).map((provider) =>
      provider.send(alert).catch((error) => {
        logger.error('Provider error', {
          error: error instanceof Error ? error.message : String(error),
        });
      }),
    );

    await Promise.all(promises);
  }
}

export function createNotificationManager(): NotificationManager {
  const manager = new NotificationManager();

  const slackWebhook = process.env.SLACK_WEBHOOK_URL;
  if (slackWebhook) {
    manager.registerProvider('slack', new SlackNotificationProvider(slackWebhook));
    logger.info('Slack notification provider registered');
  }

  const pagerDutyKey = process.env.PAGERDUTY_INTEGRATION_KEY;
  if (pagerDutyKey) {
    manager.registerProvider('pagerduty', new PagerDutyNotificationProvider(pagerDutyKey));
    logger.info('PagerDuty notification provider registered');
  }

  return manager;
}
