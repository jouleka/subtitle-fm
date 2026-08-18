import { describe, expect, test } from 'bun:test';
import { createCollabTicket, verifyCollabTicket } from './collab-ticket';

const SECRET = 'test-only-collab-secret-with-enough-entropy';
const NOW = Date.UTC(2026, 7, 18, 12, 0, 0);

describe('collab tickets', () => {
  test('round-trips a short-lived scoped user ticket', async () => {
    const result = await createCollabTicket({ id: 'user-1', handle: 'editor' }, SECRET, {
      nowMs: NOW,
      ttlSeconds: 60,
    });
    await expect(verifyCollabTicket(result.ticket, SECRET, { nowMs: NOW })).resolves.toEqual({
      id: 'user-1',
      handle: 'editor',
    });
    expect(result.expiresAt).toBe('2026-08-18T12:01:00.000Z');
  });

  test('rejects tampering, expiry, and unexpectedly long validity', async () => {
    const { ticket } = await createCollabTicket({ id: 'user-1', handle: 'editor' }, SECRET, {
      nowMs: NOW,
      ttlSeconds: 60,
    });
    const [payload, signature] = ticket.split('.');
    await expect(
      verifyCollabTicket(`${payload}x.${signature}`, SECRET, { nowMs: NOW }),
    ).rejects.toThrow('invalid collab ticket');
    await expect(verifyCollabTicket(ticket, SECRET, { nowMs: NOW + 60_000 })).rejects.toThrow(
      'collab ticket expired',
    );
    await expect(verifyCollabTicket(ticket, SECRET, { nowMs: NOW - 61_000 })).rejects.toThrow(
      'invalid collab ticket',
    );
  });
});
