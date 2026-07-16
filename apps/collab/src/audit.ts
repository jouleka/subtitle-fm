import type { Extension } from '@hocuspocus/server';
import { eq } from 'drizzle-orm';
import type * as Y from 'yjs';
import { schema } from '@subtitle-fm/db';
import { CUE_DIFF_FIELDS, type CueDiffField } from '@subtitle-fm/shared';
import { liveCuesFromDoc, type LiveCue } from '@subtitle-fm/shared/yjs';
import { db } from './db';
import { branchIdFromDocumentName } from './persistence';

export const TEXT_AUDIT_DEBOUNCE_MS = 750;

export interface CueAuditChange {
  cueId: string;
  fieldChanged: CueDiffField | 'cue';
  oldValue: unknown;
  newValue: unknown;
}

export interface AttributedCueAuditChange extends CueAuditChange {
  episodeId: string;
  userId: string;
}

type CueState = Map<string, LiveCue>;
type WriteChanges = (changes: AttributedCueAuditChange[]) => Promise<void>;
type ResolveEpisode = (documentName: string) => Promise<string | null>;
type PendingText = AttributedCueAuditChange & { documentName: string; timer: ReturnType<typeof setTimeout> };

function cueState(document: Y.Doc): CueState {
  return new Map(liveCuesFromDoc(document).map((cue) => [cue.id, structuredClone(cue)]));
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Produce field-level changes, with cue insertion/deletion represented as one event. */
export function diffCueAuditChanges(before: CueState, after: CueState): CueAuditChange[] {
  const changes: CueAuditChange[] = [];
  const cueIds = new Set([...before.keys(), ...after.keys()]);
  for (const cueId of cueIds) {
    const oldCue = before.get(cueId);
    const newCue = after.get(cueId);
    if (!oldCue && newCue) {
      changes.push({ cueId, fieldChanged: 'cue', oldValue: null, newValue: newCue });
      continue;
    }
    if (oldCue && !newCue) {
      changes.push({ cueId, fieldChanged: 'cue', oldValue: oldCue, newValue: null });
      continue;
    }
    if (!oldCue || !newCue) continue;
    for (const fieldChanged of CUE_DIFF_FIELDS) {
      if (!equal(oldCue[fieldChanged], newCue[fieldChanged])) {
        changes.push({
          cueId,
          fieldChanged,
          oldValue: oldCue[fieldChanged] ?? null,
          newValue: newCue[fieldChanged] ?? null,
        });
      }
    }
  }
  return changes;
}

export class CueAuditTracker {
  private readonly states = new Map<string, CueState>();
  private readonly pendingText = new Map<string, PendingText>();

  constructor(
    private readonly writeChanges: WriteChanges,
    private readonly resolveEpisode: ResolveEpisode,
    private readonly debounceMs = TEXT_AUDIT_DEBOUNCE_MS,
  ) {}

  seed(documentName: string, document: Y.Doc) {
    this.states.set(documentName, cueState(document));
  }

  async record(documentName: string, document: Y.Doc, userId: string | null) {
    const after = cueState(document);
    const before = this.states.get(documentName);
    this.states.set(documentName, after);
    if (!before || !userId) return;
    const episodeId = await this.resolveEpisode(documentName);
    if (!episodeId) return;

    const immediate: AttributedCueAuditChange[] = [];
    for (const change of diffCueAuditChanges(before, after)) {
      const attributed = { ...change, episodeId, userId };
      if (change.fieldChanged === 'text') this.debounceText(documentName, attributed);
      else immediate.push(attributed);
    }
    if (immediate.length > 0) await this.writeChanges(immediate);
  }

  private debounceText(documentName: string, change: AttributedCueAuditChange) {
    const key = JSON.stringify([documentName, change.cueId, change.userId, change.fieldChanged]);
    const existing = this.pendingText.get(key);
    if (existing) clearTimeout(existing.timer);
    const merged = { ...change, oldValue: existing?.oldValue ?? change.oldValue };
    if (equal(merged.oldValue, merged.newValue)) {
      this.pendingText.delete(key);
      return;
    }
    const timer = setTimeout(() => {
      void this.flushKey(key).catch((error) => console.error('cue audit flush failed', error));
    }, this.debounceMs);
    this.pendingText.set(key, { ...merged, documentName, timer });
  }

  private async flushKey(key: string) {
    const pending = this.pendingText.get(key);
    if (!pending) return;
    this.pendingText.delete(key);
    const { documentName: _documentName, timer: _timer, ...change } = pending;
    await this.writeChanges([change]);
  }

  async release(documentName: string) {
    const keys = [...this.pendingText.entries()]
      .filter(([, pending]) => pending.documentName === documentName)
      .map(([key]) => key);
    await Promise.all(keys.map((key) => this.flushKey(key)));
    this.states.delete(documentName);
  }

  async flushAll() {
    await Promise.all([...this.pendingText.keys()].map((key) => this.flushKey(key)));
    this.states.clear();
  }
}

async function resolveEpisode(documentName: string): Promise<string | null> {
  const branchId = branchIdFromDocumentName(documentName);
  if (!branchId) return documentName;
  const [branch] = await db
    .select({ episodeId: schema.subtitleBranches.episodeId })
    .from(schema.subtitleBranches)
    .where(eq(schema.subtitleBranches.id, branchId))
    .limit(1);
  return branch?.episodeId ?? null;
}

const tracker = new CueAuditTracker(
  async (changes) => {
    await db.insert(schema.auditLog).values(changes);
  },
  resolveEpisode,
);

export function createAuditExtension(auditTracker: CueAuditTracker): Extension {
  return {
    extensionName: 'cue-audit',
    async afterLoadDocument({ documentName, document }) {
      auditTracker.seed(documentName, document);
    },
    async onChange({ documentName, document, context }) {
      await auditTracker.record(documentName, document, context?.user?.id ?? null);
    },
    async afterUnloadDocument({ documentName }) {
      await auditTracker.release(documentName);
    },
    async onDestroy() {
      await auditTracker.flushAll();
    },
  };
}

export const auditExtension = createAuditExtension(tracker);
