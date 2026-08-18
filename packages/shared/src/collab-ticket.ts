const encoder = new TextEncoder();
const TICKET_VERSION = 1;

export interface CollabTicketUser {
  id: string;
  handle: string;
}

interface CollabTicketPayload {
  v: typeof TICKET_VERSION;
  sub: string;
  handle: string;
  exp: number;
  nonce: string;
}

function base64UrlEncode(value: Uint8Array | string): string {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  return Buffer.from(bytes).toString('base64url');
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(Buffer.from(value, 'base64url'));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  if (!secret) throw new Error('collab secret is not configured');
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(`subtitle-fm:collab-ticket:v${TICKET_VERSION}:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function createCollabTicket(
  user: CollabTicketUser,
  secret: string,
  options: { nowMs?: number; ttlSeconds?: number } = {},
): Promise<{ ticket: string; expiresAt: string }> {
  const nowMs = options.nowMs ?? Date.now();
  const ttlSeconds = options.ttlSeconds ?? 60;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 120) {
    throw new Error('collab ticket TTL must be between 1 and 120 seconds');
  }
  const payload: CollabTicketPayload = {
    v: TICKET_VERSION,
    sub: user.id,
    handle: user.handle,
    exp: Math.floor(nowMs / 1000) + ttlSeconds,
    nonce: crypto.randomUUID(),
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(encodedPayload)),
  );
  return {
    ticket: `${encodedPayload}.${base64UrlEncode(signature)}`,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

export async function verifyCollabTicket(
  ticket: string,
  secret: string,
  options: { nowMs?: number } = {},
): Promise<CollabTicketUser> {
  const [encodedPayload, encodedSignature, extra] = ticket.split('.');
  if (!encodedPayload || !encodedSignature || extra !== undefined) {
    throw new Error('invalid collab ticket');
  }

  let signature: Uint8Array<ArrayBuffer>;
  try {
    signature = base64UrlDecode(encodedSignature);
  } catch {
    throw new Error('invalid collab ticket');
  }
  const valid = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    signature,
    encoder.encode(encodedPayload),
  );
  if (!valid) throw new Error('invalid collab ticket');

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload)));
  } catch {
    throw new Error('invalid collab ticket');
  }
  if (
    !payload ||
    typeof payload !== 'object' ||
    (payload as Partial<CollabTicketPayload>).v !== TICKET_VERSION ||
    typeof (payload as Partial<CollabTicketPayload>).sub !== 'string' ||
    typeof (payload as Partial<CollabTicketPayload>).handle !== 'string' ||
    typeof (payload as Partial<CollabTicketPayload>).exp !== 'number' ||
    typeof (payload as Partial<CollabTicketPayload>).nonce !== 'string'
  ) {
    throw new Error('invalid collab ticket');
  }
  const parsed = payload as CollabTicketPayload;
  if (!parsed.sub || !parsed.handle || !parsed.nonce) throw new Error('invalid collab ticket');
  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
  if (parsed.exp <= nowSeconds) throw new Error('collab ticket expired');
  if (parsed.exp > nowSeconds + 120) throw new Error('invalid collab ticket');
  return { id: parsed.sub, handle: parsed.handle };
}
