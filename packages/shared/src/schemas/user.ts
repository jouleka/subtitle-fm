import { z } from 'zod';

export const UserRole = z.enum(['anon', 'editor', 'translator', 'reviewer', 'admin']);
export type UserRole = z.infer<typeof UserRole>;

export const User = z.object({
  id: z.string().uuid(),
  discordId: z.string().nullable(),
  handle: z.string(),
  reputation: z.number().int().default(0),
  role: UserRole.default('editor'),
  createdAt: z.string().datetime(),
});
export type User = z.infer<typeof User>;
