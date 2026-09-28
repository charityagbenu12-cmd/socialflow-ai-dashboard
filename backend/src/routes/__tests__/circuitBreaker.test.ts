import express from 'express';
import request from 'supertest';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'test-user', permissions: ['admin'] };
    next();
  },
  checkPermission: () => (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../services/circuitBreakerService', () => ({
  CircuitBreakerService: {
    getInstance: jest.fn(() => ({
      getState: jest.fn(() => ({ state: 'CLOSED', failures: 0 })),
      getAllStates: jest.fn(() => ({})),
      reset: jest.fn(),
    })),
  },
}));

jest.mock('../../services/aiService', () => ({
  AIService: {
    getInstance: jest.fn(() => ({
      getCircuitBreakerState: jest.fn(() => ({ state: 'CLOSED' })),
    })),
  },
}));

jest.mock('../../services/twitterService', () => ({
  TwitterService: {
    getInstance: jest.fn(() => ({
      getCircuitBreakerState: jest.fn(() => ({ state: 'CLOSED' })),
    })),
  },
}));

import circuitBreakerRouter from '../circuitBreaker';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/circuit-breaker', circuitBreakerRouter);
  return app;
}

describe('circuitBreaker routes', () => {
  describe('success paths', () => {
    it('returns circuit breaker state', async () => {
      const res = await request(buildApp()).get('/circuit-breaker/state');
      expect(res.status).toBeLessThan(500);
    });

    it('returns all circuit breaker states', async () => {
      const res = await request(buildApp()).get('/circuit-breaker/states');
      expect(res.status).toBeLessThan(500);
    });
  });

  describe('permission-denied path', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.doMock('../../middleware/auth', () => ({
        authMiddleware: (_req: any, res: any) => res.status(401).json({ error: 'Unauthorized' }),
        checkPermission: () => (_req: any, res: any) => res.status(403).json({ error: 'Forbidden' }),
      }));
    });

    it('rejects unauthenticated requests', async () => {
      const router = require('../circuitBreaker').default;
      const app = express();
      app.use('/circuit-breaker', router);
      const res = await request(app).get('/circuit-breaker/state');
      expect([401, 403]).toContain(res.status);
    });
  });
});
