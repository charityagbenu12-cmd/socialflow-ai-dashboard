import 'reflect-metadata';
import { injectable, inject } from 'inversify';
import { NotificationManager } from './notificationProvider';
import { alertConfigService } from './alertConfigService';
import { TYPES } from '../../../config/types';

export interface HealthMetrics {
  service: string;
  status: 'healthy' | 'unhealthy';
  latency: number;
  errorRate: number;
  consecutiveFailures: number;
  lastChecked: string;
}

@injectable()
export class HealthMonitor {
  private metrics: Map<string, HealthMetrics> = new Map();
  private notificationManager: NotificationManager;

  constructor(@inject(TYPES.NotificationManager) notificationManager: NotificationManager) {
    this.notificationManager = notificationManager;
  }

  async recordMetric(metric: HealthMetrics): Promise<void> {
    const previous = this.metrics.get(metric.service);
    this.metrics.set(metric.service, metric);

    await this.evaluateThresholds(metric, previous);
  }

  private async evaluateThresholds(
    current: HealthMetrics,
    previous?: HealthMetrics,
  ): Promise<void> {
    const config = alertConfigService.getConfig(current.service);
    if (!config || !config.enabled) return;

    const { thresholds } = config;
    const shouldAlert = alertConfigService.canAlert(current.service);

    // Check error rate
    if (current.errorRate > thresholds.errorRatePercent && shouldAlert) {
      await this.notificationManager.sendAlert({
        severity: 'critical',
        service: current.service,
        message: `High error rate detected: ${current.errorRate.toFixed(2)}%`,
        details: {
          threshold: `${thresholds.errorRatePercent}%`,
          current: `${current.errorRate.toFixed(2)}%`,
          status: current.status,
        },
        timestamp: current.lastChecked,
      });
      alertConfigService.recordAlert(current.service);
    }

    // Check response time
    if (current.latency > thresholds.responseTimeMs && shouldAlert) {
      await this.notificationManager.sendAlert({
        severity: 'warning',
        service: current.service,
        message: `High response time detected: ${current.latency}ms`,
        details: {
          threshold: `${thresholds.responseTimeMs}ms`,
          current: `${current.latency}ms`,
          status: current.status,
        },
        timestamp: current.lastChecked,
      });
      alertConfigService.recordAlert(current.service);
    }

    // Check consecutive failures
    if (current.consecutiveFailures >= thresholds.consecutiveFailures && shouldAlert) {
      await this.notificationManager.sendAlert({
        severity: 'critical',
        service: current.service,
        message: `Service experiencing consecutive failures: ${current.consecutiveFailures}`,
        details: {
          threshold: thresholds.consecutiveFailures,
          current: current.consecutiveFailures,
          status: current.status,
        },
        timestamp: current.lastChecked,
      });
      alertConfigService.recordAlert(current.service);
    }

    // Check status transition from healthy to unhealthy
    if (previous?.status === 'healthy' && current.status === 'unhealthy' && shouldAlert) {
      await this.notificationManager.sendAlert({
        severity: 'critical',
        service: current.service,
        message: `Service status changed to UNHEALTHY`,
        details: {
          previousStatus: previous.status,
          currentStatus: current.status,
          latency: current.latency,
          errorRate: `${current.errorRate.toFixed(2)}%`,
        },
        timestamp: current.lastChecked,
      });
      alertConfigService.recordAlert(current.service);
    }
  }

  getMetrics(service?: string): HealthMetrics[] {
    if (service) {
      const metric = this.metrics.get(service);
      return metric ? [metric] : [];
    }
    return Array.from(this.metrics.values());
  }
}
