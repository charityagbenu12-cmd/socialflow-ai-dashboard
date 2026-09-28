/**
 * workers.ts unit tests (issue #1236).
 *
 * initializeWorkers() was previously only referenced as a mock target from
 * gracefulShutdown.test.ts — nothing exercised the real implementation.
 * These tests verify it creates the expected set of BullMQ workers (via
 * queueManager.createWorker) with the configured concurrency, and that the
 * moderation worker's 'failed' event handler is wired to route
 * retry-exhausted jobs to the DLQ.
 */

type Handler = (...args: unknown[]) => unknown;

interface FakeWorker {
  name: string;
  on: jest.Mock;
  handlers: Record<string, Handler[]>;
}

jest.mock('../../queues/queueManager', () => {
  const createWorker = jest.fn((name: string, _processor: unknown) => {
    const handlers: Record<string, Handler[]> = {};
    const worker: FakeWorker = {
      name,
      handlers,
      on: jest.fn((event: string, cb: Handler) => {
        handlers[event] = handlers[event] || [];
        handlers[event].push(cb);
        return worker;
      }),
    };
    return worker;
  });

  return {
    queueManager: {
      createQueue: jest.fn(() => ({})),
      createWorker,
    },
  };
});

jest.mock('../../services/ModerationService', () => ({
  moderate: jest.fn(),
}));

jest.mock('../../queues/moderationQueue', () => ({
  MODERATION_QUEUE_NAME: 'moderation',
  enqueueToDLQ: jest.fn(),
}));

import { initializeWorkers, workerConfigs } from '../workers';
import { queueManager } from '../../queues/queueManager';
import { enqueueToDLQ } from '../../queues/moderationQueue';

const createWorker = queueManager.createWorker as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('initializeWorkers', () => {
  it('creates the expected set of workers', () => {
    const workers = initializeWorkers();

    expect(Array.from(workers.keys()).sort()).toEqual(
      ['email', 'moderation', 'notification', 'payout', 'sync'].sort(),
    );
  });

  it('creates each worker via queueManager.createWorker with the configured concurrency', () => {
    initializeWorkers();

    expect(createWorker).toHaveBeenCalledWith('email', expect.any(Function), {
      concurrency: workerConfigs.email.concurrency,
    });
    expect(createWorker).toHaveBeenCalledWith('payout', expect.any(Function), {
      concurrency: workerConfigs.payout.concurrency,
    });
    expect(createWorker).toHaveBeenCalledWith('sync', expect.any(Function), {
      concurrency: 5,
    });
    expect(createWorker).toHaveBeenCalledWith('notification', expect.any(Function), {
      concurrency: workerConfigs.notification.concurrency,
    });
    expect(createWorker).toHaveBeenCalledWith('moderation', expect.any(Function), {
      concurrency: 5,
    });
  });

  it("wires a 'failed' handler on the moderation worker", () => {
    const workers = initializeWorkers();
    const moderationWorker = workers.get('moderation') as unknown as FakeWorker;

    expect(moderationWorker.on).toHaveBeenCalledWith('failed', expect.any(Function));
  });

  it('routes a job to the DLQ once its retries are exhausted', async () => {
    const workers = initializeWorkers();
    const moderationWorker = workers.get('moderation') as unknown as FakeWorker;
    const failedHandler = moderationWorker.handlers.failed[0];

    const job = {
      id: 'job-1',
      data: { postId: 'post-1' },
      attemptsMade: 3,
      opts: { attempts: 3 },
    };
    await failedHandler(job, new Error('boom'));

    expect(enqueueToDLQ).toHaveBeenCalledWith('post-1', 'job-1', 'boom');
  });

  it('does not route to the DLQ while retries remain', async () => {
    const workers = initializeWorkers();
    const moderationWorker = workers.get('moderation') as unknown as FakeWorker;
    const failedHandler = moderationWorker.handlers.failed[0];

    const job = {
      id: 'job-2',
      data: { postId: 'post-2' },
      attemptsMade: 1,
      opts: { attempts: 3 },
    };
    await failedHandler(job, new Error('boom'));

    expect(enqueueToDLQ).not.toHaveBeenCalled();
  });

  it('does nothing when the failed handler fires with no job', async () => {
    const workers = initializeWorkers();
    const moderationWorker = workers.get('moderation') as unknown as FakeWorker;
    const failedHandler = moderationWorker.handlers.failed[0];

    await expect(failedHandler(undefined, new Error('boom'))).resolves.toBeUndefined();
    expect(enqueueToDLQ).not.toHaveBeenCalled();
  });
});

describe('sync worker job routing', () => {
  it('dispatches a job to the processor matching its job name', async () => {
    initializeWorkers();
    const [, syncProcessor] = createWorker.mock.calls.find(([name]) => name === 'sync')!;

    const result = (await (syncProcessor as Handler)({
      id: '1',
      name: 'sync-account',
      data: { accountId: 'acct-1' },
    })) as Record<string, unknown>;

    expect(result).toMatchObject({ success: true, accountId: 'acct-1' });
  });

  it('returns a failure result for an unrecognized job name', async () => {
    initializeWorkers();
    const [, syncProcessor] = createWorker.mock.calls.find(([name]) => name === 'sync')!;

    const result = await (syncProcessor as Handler)({ id: '2', name: 'bogus-job', data: {} });

    expect(result).toEqual({ success: false, error: 'Unknown job type' });
  });
});

describe('notification worker slack channel', () => {
  it('does not report success for the unimplemented slack channel', async () => {
    initializeWorkers();
    const [, notificationProcessor] = createWorker.mock.calls.find(
      ([name]) => name === 'notification',
    )!;

    const result = (await (notificationProcessor as Handler)({
      id: 'slack-1',
      name: 'notification',
      data: { type: 'slack', recipient: 'user-1', payload: { text: 'hi' } },
    })) as Record<string, unknown>;

    expect(result.success).not.toBe(true);
  });
});

describe('notification worker discord channel', () => {
  it('does not report success for the unimplemented discord channel', async () => {
    initializeWorkers();
    const [, notificationProcessor] = createWorker.mock.calls.find(
      ([name]) => name === 'notification',
    )!;

    const result = (await (notificationProcessor as Handler)({
      id: 'discord-1',
      name: 'notification',
      data: { type: 'discord', recipient: 'user-1', payload: { text: 'hi' } },
    })) as Record<string, unknown>;

    expect(result.success).not.toBe(true);
  });
});
