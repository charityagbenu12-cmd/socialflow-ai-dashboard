import express from 'express';
import request from 'supertest';

// Mock the auth middleware so we can drive the permission-check path.
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', permissions: req.headers['x-test-permissions']
      ? String(req.headers['x-test-permissions']).split(',')
      : [] };
    next();
  },
  checkPermission: (permission: string) => (req: any, res: any, next: any) => {
    const perms: string[] = req.user?.permissions ?? [];
    if (!perms.includes(permission)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  },
}));

// Mock the optimization service so the success path is deterministic.
const optimizeMock = jest.fn();
jest.mock('../../services/ImageOptimizationService', () => ({
  ImageOptimizationService: jest.fn().mockImplementation(() => ({
    optimize: optimizeMock,
  })),
}));

import imagesRouter from '../images';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/images', imagesRouter);
  return app;
}

describe('routes/images', () => {
  beforeEach(() => {
    optimizeMock.mockReset();
  });

  it('optimizes a valid upload and returns the optimized result', async () => {
    optimizeMock.mockResolvedValue({
      url: 'https://cdn.example.com/optimized.png',
      size: 1024,
    });

    const res = await request(buildApp())
      .post('/images/upload')
      .set('x-test-permissions', 'images:write')
      .attach('image', Buffer.from('fake-image-bytes'), 'photo.png');

    expect(res.status).toBe(200);
    expect(optimizeMock).toHaveBeenCalledTimes(1);
    expect(res.body).toEqual(
      expect.objectContaining({ url: 'https://cdn.example.com/optimized.png' })
    );
  });

  it('rejects an upload with no file attached', async () => {
    const res = await request(buildApp())
      .post('/images/upload')
      .set('x-test-permissions', 'images:write')
      .field('description', 'missing file');

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(optimizeMock).not.toHaveBeenCalled();
  });

  it('rejects an upload when the caller lacks the required permission', async () => {
    const res = await request(buildApp())
      .post('/images/upload')
      .attach('image', Buffer.from('fake-image-bytes'), 'photo.png');

    expect(res.status).toBe(403);
    expect(optimizeMock).not.toHaveBeenCalled();
  });
});
