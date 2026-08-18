import { afterEach, describe, expect, test } from 'bun:test';
import { createCollabTicket } from '@subtitle-fm/shared/collab-ticket';
import { authenticateToken } from './auth';

const originalSecret = process.env.COLLAB_SECRET;

afterEach(() => {
  if (originalSecret === undefined) delete process.env.COLLAB_SECRET;
  else process.env.COLLAB_SECRET = originalSecret;
});

describe('authenticateToken', () => {
  test('accepts a valid short-lived collab ticket', async () => {
    process.env.COLLAB_SECRET = 'test-collab-secret';
    const { ticket } = await createCollabTicket(
      { id: 'user-1', handle: 'editor' },
      process.env.COLLAB_SECRET,
    );
    await expect(authenticateToken(ticket)).resolves.toEqual({ id: 'user-1', handle: 'editor' });
  });

  test('rejects a ticket signed with another secret', async () => {
    process.env.COLLAB_SECRET = 'expected-collab-secret';
    const { ticket } = await createCollabTicket(
      { id: 'user-1', handle: 'editor' },
      'different-collab-secret',
    );
    await expect(authenticateToken(ticket)).rejects.toThrow('invalid collab ticket');
  });

  test('fails closed when the service secret is absent', async () => {
    delete process.env.COLLAB_SECRET;
    await expect(authenticateToken('anything')).rejects.toThrow('collab secret is not configured');
  });
});
