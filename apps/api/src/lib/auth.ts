import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { schema } from "@subtitle-fm/db";
import { db } from "./db";
import { sendDiscordWelcome } from "./discord-onboarding";
import { log } from "./log";

const HANDLE_MAX_SUFFIX = 999;

async function handleExists(handle: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.handle, handle))
    .limit(1);
  return Boolean(row);
}

export async function resolveHandleConflict(baseHandle: string): Promise<string> {
  let candidate = baseHandle;
  let suffix = 2;
  while (await handleExists(candidate)) {
    candidate = `${baseHandle}-${suffix}`;
    suffix++;
    if (suffix > HANDLE_MAX_SUFFIX) {
      throw new Error(`handle '${baseHandle}' exhausted suffix range`);
    }
  }
  return candidate;
}

const WEB_URL = process.env.WEB_URL ?? "http://localhost:5173";

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  trustedOrigins: [WEB_URL],

  database: drizzleAdapter(db, {
    provider: "pg",
    // Keys must match modelName (set below for user/session/account/verification).
    // Better Auth looks up the Drizzle table by the configured modelName, not by its
    // default singular model name.
    schema: {
      users: schema.users,
      sessions: schema.sessions,
      accounts: schema.accounts,
      verifications: schema.verifications,
    },
  }),

  advanced: {
    database: { generateId: "uuid" },
    defaultCookieAttributes: {
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
    },
  },

  user: {
    modelName: "users",
    fields: { name: "handle" },
    additionalFields: {
      discordId: { type: "string", required: false, input: false },
      reputation: { type: "number", required: false, defaultValue: 0, input: false },
      role: { type: "string", required: false, defaultValue: "editor", input: false },
    },
  },

  session: { modelName: "sessions" },
  account: { modelName: "accounts" },
  verification: { modelName: "verifications" },

  socialProviders: {
    discord: {
      clientId: process.env.DISCORD_CLIENT_ID ?? "",
      clientSecret: process.env.DISCORD_CLIENT_SECRET ?? "",
      mapProfileToUser: (profile) => ({
        name: profile.username, // writes to "handle" column via fields.name
        discordId: profile.id,
        email: profile.email ?? `${profile.id}@discord.placeholder.local`,
        role: "editor",
      }),
    },
  },

  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const base = ((user as { name?: string }).name) ?? "user";
          const resolved = await resolveHandleConflict(base);
          return { data: { ...user, name: resolved } };
        },
        after: async (user) => {
          const discordId = (user as { discordId?: string | null }).discordId;
          if (!discordId) return;
          try {
            const result = await sendDiscordWelcome(discordId);
            log.info({ userId: user.id, result }, "discord.onboarding.welcome");
          } catch (error) {
            log.warn({ userId: user.id, error: String(error) }, "discord.onboarding.failed");
          }
        },
      },
    },
  },
});

export type Auth = typeof auth;
