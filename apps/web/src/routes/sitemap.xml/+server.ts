import { PUBLIC_API_URL } from '$env/static/public';
import type { Show } from '$lib/types';
import type { RequestHandler } from './$types';

function xml(value: string): string {
  return value.replace(/[<>&'\"]/g, (character) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;',
  })[character]!);
}

export const GET: RequestHandler = async ({ fetch, url }) => {
  const response = await fetch(`${PUBLIC_API_URL}/shows`);
  const shows = response.ok ? ((await response.json()) as { shows: Show[] }).shows : [];
  const locations = [
    `${url.origin}/`,
    ...shows.map((show) => `${url.origin}/shows/${encodeURIComponent(show.slug)}`),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locations
    .map((location) => `  <url><loc>${xml(location)}</loc></url>`)
    .join('\n')}\n</urlset>\n`;
  return new Response(body, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=3600',
    },
  });
};
