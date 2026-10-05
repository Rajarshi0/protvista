/**
 * The visitor's sentences and the strings around them. Visitor text is plain
 * language: it says what is missing, counts it, and names tracks by the label
 * the visitor can see — never a file, a URL, a field or a variable.
 */

import { describe, it, expect } from 'vitest';

import {
  NOTICE_TEXT,
  NOTE_UI,
  mergeFacts,
  plural,
  stripTag,
  type NoticeCode,
} from '../notices.js';

describe('visitor sentences', () => {
  it('counts features outside the sequence, singular and plural', () => {
    const text = NOTICE_TEXT['coordinate-out-of-range'];
    expect(text({ count: 1 })).toBe(
      "1 feature extends beyond this sequence, so it isn't shown in full."
    );
    expect(text({ count: 2 })).toBe(
      "2 features extend beyond this sequence, so they aren't shown in full."
    );
  });

  it('says colours may be wrong without naming them', () => {
    expect(NOTICE_TEXT['unpaintable-color']({})).toBe(
      "Some colours in the data couldn't be shown, so some features may be in the wrong colour."
    );
  });

  it('names skipped tracks that show nothing', () => {
    const text = NOTICE_TEXT['url-variable-unresolved'];
    expect(text({ names: ['Partner data'] })).toBe(
      "“Partner data” isn't shown: its data couldn't be loaded."
    );
    expect(text({ names: ['A', 'B'] })).toBe(
      "2 tracks aren't shown: their data couldn't be loaded (“A”, “B”)."
    );
  });

  it('names skipped tracks that show only part of their data', () => {
    const text = NOTICE_TEXT['url-variable-unresolved'];
    expect(text({ partial: ['A'] })).toBe(
      "“A” is incomplete: some of its data couldn't be loaded."
    );
    expect(text({ partial: ['A', 'B'] })).toBe(
      "2 tracks are incomplete: some of their data couldn't be loaded (“A”, “B”)."
    );
  });

  it('puts the tracks not shown first, then the incomplete ones', () => {
    expect(
      NOTICE_TEXT['url-variable-unresolved']({ names: ['A'], partial: ['B'] })
    ).toBe(
      "“A” isn't shown: its data couldn't be loaded. “B” is incomplete: some of its data couldn't be loaded."
    );
  });

  it('names components that cannot be drawn, singular and plural', () => {
    const text = NOTICE_TEXT['unrendered-component'];
    expect(text({ names: ['Mine'] })).toBe(
      "“Mine” can't be displayed in this viewer."
    );
    expect(text({ names: ['A', 'B'] })).toBe(
      "2 tracks can't be displayed in this viewer: “A”, “B”."
    );
  });

  it('never names a URL, a file, a variable, or hedges a plural', () => {
    const facts = [
      {},
      { count: 1 },
      { count: 3 },
      { names: ['A'] },
      { names: ['A', 'B'] },
      { partial: ['A'] },
      { names: ['A'], partial: ['B', 'C'] },
    ];
    for (const code of Object.keys(NOTICE_TEXT) as NoticeCode[]) {
      for (const f of facts) {
        expect(NOTICE_TEXT[code](f)).not.toMatch(/https?:|\{|\.csv|\(s\)/);
      }
    }
  });
});

describe('mergeFacts', () => {
  it('sums counts', () => {
    expect(mergeFacts({ count: 2 }, { count: 3 })).toEqual({ count: 5 });
  });

  it('takes the union of names in first-seen order, without duplicates', () => {
    expect(mergeFacts({ names: ['A', 'B'] }, { names: ['B', 'C'] })).toEqual({
      names: ['A', 'B', 'C'],
    });
    expect(mergeFacts({ partial: ['A'] }, { partial: ['A', 'B'] })).toEqual({
      partial: ['A', 'B'],
    });
  });

  it('keeps a track in names when it is also partial — not shown beats incomplete', () => {
    expect(mergeFacts({ partial: ['A', 'B'] }, { names: ['A'] })).toEqual({
      names: ['A'],
      partial: ['B'],
    });
  });

  it('adds no fields the facts did not have', () => {
    expect(mergeFacts({}, {})).toEqual({});
  });
});

describe('controls and announcements', () => {
  it('pluralises every count in words', () => {
    expect(plural(1, 'authoring note')).toBe('1 authoring note');
    expect(plural(2, 'authoring note')).toBe('2 authoring notes');
    expect(NOTE_UI.trackLabel(1, 'Lab hits')).toBe('Note about Lab hits');
    expect(NOTE_UI.trackLabel(2, 'Lab hits')).toBe('2 notes about Lab hits');
    expect(NOTE_UI.authorLabel(1)).toBe('1 authoring note for this view');
    expect(NOTE_UI.authorLabel(3, 'Lab hits')).toBe(
      '3 authoring notes for Lab hits'
    );
    expect(NOTE_UI.errorLabel(2)).toBe(
      'Track failed to load — 2 authoring notes'
    );
    expect(NOTE_UI.announceAuthor(1)).toBe(
      '1 authoring note. Use the warning buttons to read it.'
    );
  });

  it('drops the console tag, and nothing else', () => {
    expect(stripTag('[protvista] a')).toBe('a');
    expect(stripTag('[protvista-uniprot] b')).toBe('b');
    expect(stripTag('c [protvista] d')).toBe('c [protvista] d');
  });
});
