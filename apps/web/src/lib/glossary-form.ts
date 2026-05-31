import type { CreateGlossaryTerm, UpdateGlossaryTerm, GlossaryTermKind } from '@subtitle-fm/shared';

export interface TermFormFields {
  sourceText: string;
  targetText: string;
  kind: GlossaryTermKind;
  notes: string;
}

// Build the API payload from modal fields: trim text, blank notes → null, and
// OMIT sourceText in edit mode (it is the immutable identity key, absent from
// UpdateGlossaryTerm).
export function buildTermPayload(mode: 'create', fields: TermFormFields): CreateGlossaryTerm;
export function buildTermPayload(mode: 'edit', fields: TermFormFields): UpdateGlossaryTerm;
export function buildTermPayload(
  mode: 'create' | 'edit',
  fields: TermFormFields,
): CreateGlossaryTerm | UpdateGlossaryTerm {
  const common = {
    targetText: fields.targetText.trim(),
    kind: fields.kind,
    notes: fields.notes.trim() || null,
  };
  if (mode === 'edit') return common;
  return { sourceText: fields.sourceText.trim(), ...common };
}
