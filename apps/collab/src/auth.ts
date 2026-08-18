import { verifyCollabTicket } from '@subtitle-fm/shared/collab-ticket';

export interface AuthedUser {
  id: string;
  handle: string;
}

export async function authenticateToken(token: string): Promise<AuthedUser> {
  const secret = process.env.COLLAB_SECRET;
  if (!secret) throw new Error('collab secret is not configured');
  return verifyCollabTicket(token, secret);
}
