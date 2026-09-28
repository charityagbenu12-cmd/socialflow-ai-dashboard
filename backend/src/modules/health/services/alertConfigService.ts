import 'reflect-metadata';
import { injectable, singleton } from 'inversify';
import { createLogger } from '../../../lib/logger';

const logger = createLogger('alertConfig');

export interface AlertThreshold {
  errorRatePercent: number;
  responseTimeMs: number;
  consecutiveFailures: number;
}

export interface ServiceAlertConfig {
  enabled: boolean;
  thresholds: AlertThreshold;
  cooldownMs: number;
}

@injectable()
@singleton()
export class AlertConfigService {
  private configs: Map<string, ServiceAlertConfig> = new Map();
  private lastAlertTime: Map<string, number> = new Map();

  constructor() {
    this.initializeDefaults();
  }

  private initializeDefaults(): void {
    const defaultThresholds: AlertThreshold = {
      errorRatePercent: parseFloat(process.env.ALERT_ERROR_RATE_PERCENT || '10'),
      responseTimeMs: parseInt(process.env.ALERT_RESPONSE_TIME_MS || '5000', 10),
      consecutiveFailures: parseInt(process.env.ALERT_CONSECUTIVE_FAILURES || '3', 10),
    };

    const defaultCooldown = parseInt(process.env.ALERT_COOLDOWN_MS || '300000', 10); // 5 minutes

    const services = ['database', 'redis', 's3', 'twitter', 'youtube', 'facebook'];
    services.forEach((service) => {
      this.configs.set(service, {
        enabled: true,
        thresholds: defaultThresholds,
        cooldownMs: defaultCooldown,
      });
    });

    logger.info('Alert configuration initialized', {
      errorRatePercent: defaultThresholds.errorRatePercent,
      responseTimeMs: defaultThresholds.responseTimeMs,
      consecutiveFailures: defaultThresholds.consecutiveFailures,
      cooldownMs: defaultCooldown,
    });
  }

  getConfig(service: string): ServiceAlertConfig | undefined {
    return this.configs.get(service);
  }

  setConfig(service: string, config: ServiceAlertConfig): void {
    this.configs.set(service, config);
    logger.info('Alert configuration updated', { service, config });
  }

  canAlert(service: string): boolean {
    const lastAlert = this.lastAlertTime.get(service) || 0;
    const config = this.configs.get(service);
    if (!config) return false;

    const timeSinceLastAlert = Date.now() - lastAlert;
    return timeSinceLastAlert >= config.cooldownMs;
  }

  recordAlert(service: string): void {
    this.lastAlertTime.set(service, Date.now());
  }
}
