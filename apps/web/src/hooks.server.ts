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
  const withSecurityHeaders = (response: Response): Response => {
    response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
    response.headers.set('x-content-type-options', 'nosniff');
    response.headers.set('x-frame-options', 'DENY');
    response.headers.set(
      'permissions-policy',
      'camera=(), geolocation=(), microphone=(), payment=()',
    );
    response.headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
    return response;
  };
  const country = event.request.headers.get('cf-ipcountry')?.trim().toUpperCase();
  if (country === 'JP' && !isPublicLegalOrAsset(event.url.pathname)) {
    return withSecurityHeaders(
      new Response(
        '<!doctype html><html lang="en"><meta charset="utf-8"><title>Unavailable in Japan</title><main><h1>Unavailable in Japan</h1><p>Subtitle.fm content is not available in this region.</p><p><a href="/legal/takedown">Copyright and takedown requests</a></p></main></html>',
        { status: 451, headers: { 'content-type': 'text/html; charset=utf-8' } },
      ),
    );
  }
  return paraglideMiddleware(event.request, async ({ request, locale }) => {
    event.request = request;
    const response = await resolve(event, {
      transformPageChunk: ({ html }) =>
        html.replace('%lang%', locale).replace('%dir%', getTextDirection(locale)),
    });
    return withSecurityHeaders(response);
  });
};
