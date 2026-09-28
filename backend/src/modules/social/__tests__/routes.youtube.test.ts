/**
 * Route tests for backend/src/modules/social/routes.youtube.ts (issue #1610).
 *
 * Covers:
 *  - GET /auth OAuth kickoff (redirect when configured, 500 when not)
 *  - POST /sync auth-middleware failure path
 *  - POST /sync error-handling path when enqueueYouTubeSync rejects
 *  - POST /sync happy path enqueues a sync job
 */

const mockEnqueueYouTubeSync = jest.fn();
const mockRequireAuth = jest.fn();

jest.mock('../services/youtubeSyncService', () => ({
  enqueueYouTubeSync: (...args: unknown[]) => mockEnqueueYouTubeSync(...args),
}));

jest.mock('../middleware/auth', () => ({
  requireAuth: (req: any, res: any, next: any) => mockRequireAuth(req, res, next),
}));

import express from 'express';
import request from 'supertest';
import youtubeRoutes from '../routes.youtube';

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/youtube', youtubeRoutes);
  return app;
};

describe('social/routes.youtube', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    // Default: auth middleware passes through.
    mockRequireAuth.mockImplementation((_req: any, _res: any, next: any) => next());
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('GET /auth', () => {
    it('redirects to the Google OAuth consent screen when configured', async () => {
      process.env.GOOGLE_CLIENT_ID = 'test-client-id';
      process.env.GOOGLE_REDIRECT_URI = 'https://example.com/callback';

      const res = await request(buildApp()).get('/youtube/auth');

      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('accounts.google.com');
      expect(res.headers.location).toContain('client_id=test-client-id');
      expect(res.headers.location).toContain('youtube');
    });

    it('returns an error when OAuth is not configured', async () => {
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_REDIRECT_URI;

      const res = await request(buildApp()).get('/youtube/auth');

      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('POST /sync', () => {
    it('rejects unauthenticated requests via the auth middleware', async () => {
      mockRequireAuth.mockImplementation((_req: any, res: any) =>
        res.status(401).json({ error: 'Unauthorized' }),
      );

      const res = await request(buildApp()).post('/youtube/sync').send({});

      expect(res.status).toBe(401);
      expect(mockEnqueueYouTubeSync).not.toHaveBeenCalled();
    });

    it('returns an error when enqueueYouTubeSync rejects', async () => {
      mockEnqueueYouTubeSync.mockRejectedValueOnce(new Error('queue down'));

      const res = await request(buildApp())
        .post('/youtube/sync')
        .send({ userId: 'user-1' });

      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('enqueues a sync job for authenticated requests', async () => {
      mockEnqueueYouTubeSync.mockResolvedValueOnce({ jobId: 'job-1' });

      const res = await request(buildApp())
        .post('/youtube/sync')
        .send({ userId: 'user-1' });

      expect(res.status).toBeLessThan(400);
      expect(mockEnqueueYouTubeSync).toHaveBeenCalled();
    });
  });
});
