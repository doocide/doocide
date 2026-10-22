// Keeping invites and participants' copies in step: what an invite shows, whether a new invite is
// older than the copy someone already has, and what changed since.

import { canonicalJson } from '../format/crypto';
import type { Decision, Invite } from '../format/types';

/**
 * A short fingerprint of what an invite shows people: options, factors, guides, facts, importance (when
 * the organizer sets it) and the scoring rules. Not a security check, just "has this changed?".
 */
export function inviteShape(d: Decision): string {
  const organizerWeights = d.group?.settings.weights !== 'everyone';
  const { rows: _rows, ...settings } = d.settings;
  const text = canonicalJson({
    settings,
    rules: d.group && {
      scoring: d.group.settings.scoring,
      weights: d.group.settings.weights,
      combine: d.group.settings.combine,
      folderResults: d.group.settings.folderResults,
    },
    options: d.options.map((o) => [o.id, o.name, o.description ?? '']),
    factors: d.factors.map((f) => [f.id, f.name, f.guide ?? '', organizerWeights ? f.weight : 0]),
    facts: d.facts.map((f) => [f.optionId, f.factorId, f.text, f.url ?? '']),
  });
  // FNV-1a, 32 bits: plenty to notice an edit.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** The organizer changed what invites show since the last one went out. */
export const editedSinceInvite = (d: Decision) =>
  d.group?.role === 'organizer' && Boolean(d.group.lastInviteShape) && d.group.lastInviteShape !== inviteShape(d);

/** A participant opened an invite older than the one their copy already follows. */
export const isOlderInvite = (d: Decision, invite: Invite) => Boolean(d.group?.inviteVersion && invite.decision.updatedAt < d.group.inviteVersion);

export interface InviteChanges {
  addedOptions: string[];
  addedFactors: string[];
  removedOptions: string[];
  removedFactors: string[];
  /** Options or factors whose name changed. */
  renamed: number;
  /** Factors whose importance changed (when the organizer sets importance). */
  reweighted: number;
  /** The scoring rules changed. */
  rules: boolean;
}

/** What a newer invite changes in a participant's copy. */
export function inviteChanges(d: Decision, invite: Invite): InviteChanges {
  const inv = invite.decision;
  const options = new Map(d.options.map((o) => [o.id, o]));
  const factors = new Map(d.factors.map((f) => [f.id, f]));
  const newOptions = new Set(inv.options.map((o) => o.id));
  const newFactors = new Set(inv.factors.map((f) => f.id));
  const organizerWeights = invite.settings.weights !== 'everyone';
  const s = d.settings;
  const n = inv.settings;
  const g = d.group?.settings;
  return {
    addedOptions: inv.options.filter((o) => !options.has(o.id)).map((o) => o.name),
    addedFactors: inv.factors.filter((f) => !factors.has(f.id)).map((f) => f.name),
    removedOptions: d.options.filter((o) => !newOptions.has(o.id)).map((o) => o.name),
    removedFactors: d.factors.filter((f) => !newFactors.has(f.id)).map((f) => f.name),
    renamed: [...inv.options.filter((o) => options.has(o.id) && options.get(o.id)!.name !== o.name), ...inv.factors.filter((f) => factors.has(f.id) && factors.get(f.id)!.name !== f.name)].length,
    reweighted: organizerWeights ? inv.factors.filter((f) => factors.has(f.id) && factors.get(f.id)!.weight !== f.weight).length : 0,
    rules:
      s.mode !== n.mode ||
      s.scaleMax !== n.scaleMax ||
      s.pughSteps !== n.pughSteps ||
      s.baselineId !== n.baselineId ||
      (g !== undefined &&
        (g.scoring !== invite.settings.scoring ||
          g.weights !== invite.settings.weights ||
          g.combine !== invite.settings.combine ||
          (g.folderResults ?? 'never') !== (invite.settings.folderResults ?? 'never'))),
  };
}

export const hasChanges = (c: InviteChanges) =>
  c.addedOptions.length + c.addedFactors.length + c.removedOptions.length + c.removedFactors.length + c.renamed + c.reweighted > 0 || c.rules;
