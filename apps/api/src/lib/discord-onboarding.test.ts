import { describe, expect, test } from 'bun:test';
import { firstContributionUrl, sendDiscordWelcome } from './discord-onboarding';

describe('Discord contributor onboarding (SFM-35)', () => {
  test('builds the stable first-contribution link', () => {
    expect(firstContributionUrl('https://subtitle.fm/')).toBe(
      'https://subtitle.fm/contribute/first',
    );
  });

  test('opens a DM and sends the claim-your-first-cue link', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const result = await sendDiscordWelcome('discord-user-35', {
      botToken: 'test-token',
      webUrl: 'https://subtitle.fm',
      fetcher: async (input, init) => {
        requests.push({ url: String(input), init });
        return requests.length === 1
          ? Response.json({ id: 'dm-channel-35' })
          : Response.json({ id: 'message-35' });
      },
    });

    expect(result).toBe('sent');
    expect(requests.map(({ url }) => url)).toEqual([
      'https://discord.com/api/v10/users/@me/channels',
      'https://discord.com/api/v10/channels/dm-channel-35/messages',
    ]);
    expect(requests[0]!.init?.headers).toEqual({
      Authorization: 'Bot test-token',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(requests[1]!.init?.body)).content).toContain(
      'https://subtitle.fm/contribute/first',
    );
  });

  test('does nothing when no bot token is configured', async () => {
    expect(await sendDiscordWelcome('discord-user-35', { botToken: '' })).toBe('not_configured');
  });
});
