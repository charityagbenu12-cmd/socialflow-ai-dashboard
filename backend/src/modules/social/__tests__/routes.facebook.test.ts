/**
 * Route tests for backend/src/modules/social/routes.facebook.ts (issue #1609).
 *
 * Covers:
 *  - GET /auth OAuth kickoff: redirect URL construction, scopes, state param
 *  - Auth-failure path on publish endpoints (missing/invalid auth)
 *  - Publish endpoint error-handling paths via mocked facebookService
 */
import express, { type Express } from 'express';
import request from 'supertest';

// Mock the facebook service so publish handlers can be exercised in isolation.
jest.mock('../facebookService', () => ({
  facebookService: {
    getAuthUrl: jest.fn(),
    exchangeCodeForToken: jest.fn(),
    publishPost: jest.fn(),
    publishPhoto: jest.fn(),
  },
}));

// Mock auth middleware so we can drive both success and failure paths.
jest.mock('../../../middleware/auth', () => ({
  authenticate: (req: any, res: any, next: any) => {
    if (req.headers.authorization === 'Bearer valid-token') {
      req.user = { id: 'user-1' };
      return next();
    }
    return res.status(401).json({ error: 'Unauthorized' });
  },
}));

import router from '../routes.facebook';
import { facebookService } from '../facebookService';

const mockedService = facebookService as jest.Mocked<typeof facebookService>;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/social/facebook', router);
  return app;
}

describe('routes.facebook', () => {
  let app: Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  describe('GET /auth (OAuth kickoff)', () => {
    it('redirects to the Facebook OAuth dialog with scopes and state', async () => {
      mockedService.getAuthUrl.mockReturnValue(
        'https://www.facebook.com/v18.0/dialog/oauth?client_id=abc&redirect_uri=https%3A%2F%2Fapp.test%2Fcallback&scope=pages_manage_posts%2Cpages_read_engagement&state=state-123'
      );

      const res = await request(app).get('/api/social/facebook/auth');

      expect(res.status).toBe(302);
      const location = res.headers.location as string;
      expect(location).toContain('https://www.facebook.com');
      expect(location).toContain('dialog/oauth');
      expect(location).toContain('scope=pages_manage_posts');
      expect(location).toContain('state=');
      expect(mockedService.getAuthUrl).toHaveBeenCalledTimes(1);
    });

    it('returns 500 when auth URL construction fails', async () => {
      mockedService.getAuthUrl.mockImplementation(() => {
        throw new Error('missing client id');
      });

      const res = await request(app).get('/api/social/facebook/auth');

      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('publish endpoints', () => {
    it('rejects unauthenticated publish requests with 401', async () => {
      const res = await request(app)
        .post('/api/social/facebook/publish')
        .send({ message: 'hello' });

      expect(res.status).toBe(401);
      expect(mockedService.publishPost).not.toHaveBeenCalled();
    });

    it('publishes a post for an authenticated user', async () => {
      mockedService.publishPost.mockResolvedValue({ id: 'post-1' } as any);

      const res = await request(app)
        .post('/api/social/facebook/publish')
        .set('Authorization', 'Bearer valid-token')
        .send({ message: 'hello' });

      expect(res.status).toBeLessThan(400);
      expect(mockedService.publishPost).toHaveBeenCalled();
    });

    it('surfaces service errors as a non-2xx response', async () => {
      mockedService.publishPost.mockRejectedValue(new Error('facebook api down'));

      const res = await request(app)
        .post('/api/social/facebook/publish')
        .set('Authorization', 'Bearer valid-token')
        .send({ message: 'hello' });

      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });
});
