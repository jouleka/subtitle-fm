import type { CreateGlossaryTerm, UpdateGlossaryTerm, GlossaryTerm } from '@subtitle-fm/shared';

export class GlossaryApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
    this.name = 'GlossaryApiError';
  }
}

const glossaryUrl = (apiBase: string, showId: string) => `${apiBase}/shows/${showId}/glossary`;

async function fail(res: Response): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  throw new GlossaryApiError(res.status, body.error ?? 'request_failed');
}

export async function fetchGlossary(apiBase: string, showId: string): Promise<GlossaryTerm[]> {
  const res = await fetch(glossaryUrl(apiBase, showId), { credentials: 'include' });
  if (!res.ok) return fail(res);
  return ((await res.json()) as { glossaryTerms: GlossaryTerm[] }).glossaryTerms;
}

export async function createTerm(apiBase: string, showId: string, input: CreateGlossaryTerm): Promise<GlossaryTerm> {
  const res = await fetch(glossaryUrl(apiBase, showId), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) return fail(res);
  return (await res.json()) as GlossaryTerm;
}

export async function updateTerm(
  apiBase: string,
  showId: string,
  termId: string,
  input: UpdateGlossaryTerm,
): Promise<GlossaryTerm> {
  const res = await fetch(`${glossaryUrl(apiBase, showId)}/${termId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) return fail(res);
  return (await res.json()) as GlossaryTerm;
}

export async function deleteTerm(apiBase: string, showId: string, termId: string): Promise<void> {
  const res = await fetch(`${glossaryUrl(apiBase, showId)}/${termId}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) return fail(res);
}
