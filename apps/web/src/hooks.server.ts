import type { Handle } from '@sveltejs/kit';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { getTextDirection } from '$lib/paraglide/runtime';

function isPublicLegalOrAsset(pathname: string): boolean {
  return (
    pathname === '/legal/takedown' ||
    pathname.startsWith('/legal/takedown/') ||
    pathname.startsWith('/_app/') ||
    pathname === '/favicon.ico'
  );
}

export const handle: Handle = ({ event, resolve }) => {
  const country = event.request.headers.get('cf-ipcountry')?.trim().toUpperCase();
  if (country === 'JP' && !isPublicLegalOrAsset(event.url.pathname)) {
    return new Response(
      '<!doctype html><html lang="en"><meta charset="utf-8"><title>Unavailable in Japan</title><main><h1>Unavailable in Japan</h1><p>Subtitle.fm content is not available in this region.</p><p><a href="/legal/takedown">Copyright and takedown requests</a></p></main></html>',
      { status: 451, headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  }
  return paraglideMiddleware(event.request, ({ request, locale }) => {
    event.request = request;
    return resolve(event, {
      transformPageChunk: ({ html }) =>
        html.replace('%lang%', locale).replace('%dir%', getTextDirection(locale)),
    });
  });
};
