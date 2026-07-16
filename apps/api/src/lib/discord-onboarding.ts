import { z } from 'zod';

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const channelSchema = z.object({ id: z.string().min(1) });

export function firstContributionUrl(webUrl = process.env.WEB_URL ?? 'http://localhost:5173') {
  return `${webUrl.replace(/\/$/, '')}/contribute/first`;
}

export async function sendDiscordWelcome(
  discordId: string,
  options: {
    botToken?: string;
    webUrl?: string;
    fetcher?: Fetcher;
  } = {},
): Promise<'sent' | 'not_configured'> {
  const botToken = options.botToken ?? process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return 'not_configured';
  const fetcher = options.fetcher ?? fetch;
  const signal = AbortSignal.timeout(5_000);
  const headers = {
    Authorization: `Bot ${botToken}`,
    'Content-Type': 'application/json',
  };
  const dm = await fetcher('https://discord.com/api/v10/users/@me/channels', {
    method: 'POST',
    headers,
    body: JSON.stringify({ recipient_id: discordId }),
    signal,
  });
  if (!dm.ok) throw new Error(`discord_create_dm_${dm.status}`);
  const channel = channelSchema.parse(await dm.json());
  const message = await fetcher(`https://discord.com/api/v10/channels/${channel.id}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      content: `Welcome to Subtitle.fm! Your contributor account is ready. Claim your first cue: ${firstContributionUrl(options.webUrl)}`,
    }),
    signal,
  });
  if (!message.ok) throw new Error(`discord_send_welcome_${message.status}`);
  return 'sent';
}
