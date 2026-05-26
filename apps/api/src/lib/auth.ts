import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { schema } from "@subtitle-fm/db";
import { db } from "./db";

const WEB_URL = process.env.WEB_URL ?? "http://localhost:5173";

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  trustedOrigins: [WEB_URL],

  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
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
      }),
    },
  },
});

export type Auth = typeof auth;
