import type { Context, Next } from 'hono';

const EXEMPT_PATHS = ['/health', '/legal'];

export function requestCountry(request: Request): string | null {
  const country = request.headers.get('cf-ipcountry')?.trim().toUpperCase();
  return country && /^[A-Z]{2}$/.test(country) ? country : null;
}

export function isGeoBlockExempt(pathname: string): boolean {
  return EXEMPT_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * Cloudflare supplies CF-IPCountry at the trusted edge. Do not fall back to
 * client-controlled query parameters, cookies, or X-Forwarded-For guesses.
 */
export async function jpGeoBlock(c: Context, next: Next) {
  if (
    c.req.method !== 'OPTIONS' &&
    requestCountry(c.req.raw) === 'JP' &&
    !isGeoBlockExempt(new URL(c.req.url).pathname)
  ) {
    return c.json(
      {
        error: 'geo_blocked',
        country: 'JP',
        legal: '/legal/takedowns',
      },
      451,
    );
  }
  await next();
}
