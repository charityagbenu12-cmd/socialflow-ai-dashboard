import { AuthBlacklistService } from '../../services/AuthBlacklistService';

jest.mock('../../services/AuthBlacklistService', () => ({
  AuthBlacklistService: {
    isBlacklisted: jest.fn(),
    keyFromPayload: jest.fn((p: any) => p.jti ?? `${p.sub}:${p.iat}`),
    blacklistToken: jest.fn(),
    accessTokenTTL: jest.fn(() => 900),
  },
}));

jest.mock('../../lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    post: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    organizationMember: { findUnique: jest.fn() },
  },
}));

// Import resolvers AFTER mocks are set up
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resolvers } = require('../resolvers');

const mockIsBlacklisted = AuthBlacklistService.isBlacklisted as jest.Mock;

describe('GraphQL requireAuth – blacklist enforcement', () => {
  afterEach(() => jest.clearAllMocks());

  it('throws UNAUTHENTICATED when userId is missing', async () => {
    await expect(resolvers.Query.me({}, {}, {})).rejects.toThrow('UNAUTHENTICATED');
  });

  it('throws UNAUTHENTICATED when token is blacklisted', async () => {
    mockIsBlacklisted.mockResolvedValue(true);
    const ctx = { userId: 'user-1', tokenKey: 'jti-abc' };
    await expect(resolvers.Query.me({}, {}, ctx)).rejects.toThrow('UNAUTHENTICATED');
    expect(mockIsBlacklisted).toHaveBeenCalledWith('jti-abc');
  });

  it('allows the query when token is valid and not blacklisted', async () => {
    mockIsBlacklisted.mockResolvedValue(false);
    const { prisma } = require('../../lib/prisma');
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });

    const ctx = { userId: 'user-1', tokenKey: 'jti-abc' };
    const result = await resolvers.Query.me({}, {}, ctx);
    expect(result).toEqual({ id: 'user-1' });
    expect(mockIsBlacklisted).toHaveBeenCalledWith('jti-abc');
  });

  it('skips blacklist check when no tokenKey is present (legacy context)', async () => {
    const { prisma } = require('../../lib/prisma');
    prisma.user.findUnique.mockResolvedValue({ id: 'user-2' });

    const ctx = { userId: 'user-2' }; // no tokenKey
    const result = await resolvers.Query.me({}, {}, ctx);
    expect(result).toEqual({ id: 'user-2' });
    expect(mockIsBlacklisted).not.toHaveBeenCalled();
  });
});

describe('Subscription.orgUpdate – org membership validation', () => {
  afterEach(() => jest.clearAllMocks());

  it('throws FORBIDDEN when the subscriber belongs to a different org', async () => {
    mockIsBlacklisted.mockResolvedValue(false);
    const { prisma } = require('../../lib/prisma');
    prisma.organizationMember.findUnique.mockResolvedValue(null);

    const ctx = { userId: 'user-1', tokenKey: 'jti-abc' };
    await expect(
      resolvers.Subscription.orgUpdate.subscribe({}, { orgId: 'org-b' }, ctx),
    ).rejects.toThrow('FORBIDDEN');
  });

  it('resolves the iterator when the subscriber belongs to the requested org', async () => {
    mockIsBlacklisted.mockResolvedValue(false);
    const { prisma } = require('../../lib/prisma');
    prisma.organizationMember.findUnique.mockResolvedValue({ organizationId: 'org-a' });

    const ctx = { userId: 'user-1', tokenKey: 'jti-abc' };
    // Should not throw — returns an async iterator
    const result = await resolvers.Subscription.orgUpdate.subscribe({}, { orgId: 'org-a' }, ctx);
    expect(result).toBeDefined();
  });

  it('throws UNAUTHENTICATED when there is no userId in context', async () => {
    const ctx = {};
    await expect(
      resolvers.Subscription.orgUpdate.subscribe({}, { orgId: 'org-a' }, ctx),
    ).rejects.toThrow('UNAUTHENTICATED');
  });
});

describe('Query.post – organization membership enforcement', () => {
  afterEach(() => jest.clearAllMocks());

  it('throws FORBIDDEN when the caller is not a member of the post\'s organization', async () => {
    mockIsBlacklisted.mockResolvedValue(false);
    const { prisma } = require('../../lib/prisma');
    prisma.post.findUnique.mockResolvedValue({ id: 'post-1', organizationId: 'org-b' });
    prisma.organizationMember.findUnique.mockResolvedValue(null);

    const ctx = { userId: 'user-1', tokenKey: 'jti-abc' };
    await expect(resolvers.Query.post({}, { id: 'post-1' }, ctx)).rejects.toThrow('FORBIDDEN');
  });

  it('returns the post for a member of the owning organization', async () => {
    mockIsBlacklisted.mockResolvedValue(false);
    const { prisma } = require('../../lib/prisma');
    const post = { id: 'post-1', organizationId: 'org-a', title: 'Hello' };
    prisma.post.findUnique.mockResolvedValue(post);
    prisma.organizationMember.findUnique.mockResolvedValue({ organizationId: 'org-a' });

    const ctx = { userId: 'user-1', tokenKey: 'jti-abc' };
    const result = await resolvers.Query.post({}, { id: 'post-1' }, ctx);
    expect(result).toEqual(post);
  });

  it('throws NOT_FOUND when the post does not exist', async () => {
    mockIsBlacklisted.mockResolvedValue(false);
    const { prisma } = require('../../lib/prisma');
    prisma.post.findUnique.mockResolvedValue(null);

    const ctx = { userId: 'user-1', tokenKey: 'jti-abc' };
    await expect(resolvers.Query.post({}, { id: 'missing' }, ctx)).rejects.toThrow('NOT_FOUND');
  });
});
