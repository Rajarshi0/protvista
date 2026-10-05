/**
 * Every string the viewer shows about a warning: the visitor notice, and the
 * controls and headings around it and around author mode.
 *
 * A visitor notice is plain language for someone looking at an embedded
 * viewer: what is missing or misleading, never a file, a URL, a field, a code
 * or a variable. Its facts (how many features, which tracks) come from the
 * report; the sentence is built here. Author mode shows the author-facing
 * text instead, which is the event's and the console's.
 *
 * Kept in one pure module (no lit, no DOM) so the strings can be localised
 * later without hunting through the element.
 */

import type { FailureCode } from './router.js';

/** The codes whose routing row raises a visitor notice. */
export type NoticeCode = Extract<
  FailureCode,
  | 'coordinate-out-of-range'
  | 'unpaintable-color'
  | 'url-variable-unresolved'
  | 'unrendered-component'
>;

/**
 * What a notice needs to be specific. `partial` is only for skipped sources:
 * tracks that lost some of their URLs but still draw something.
 */
export interface NoticeFacts {
  count?: number;
  names?: string[];
  partial?: string[];
}

/** `1 track`, `2 tracks`. No rendered string contains `(s)`. */
export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;

/** A name the visitor will recognise, quoted. */
const quote = (name: string) => `“${name}”`;
const quoteAll = (names: string[]) => names.map(quote).join(', ');

/**
 * Two reports' facts as one: counts add up, and names are a union in
 * first-seen order. A track that is both not shown and incomplete is listed
 * as not shown, which is the stronger statement.
 */
export function mergeFacts(a: NoticeFacts, b: NoticeFacts): NoticeFacts {
  const union = (x: string[] = [], y: string[] = []) => [
    ...new Set([...x, ...y]),
  ];
  const names = union(a.names, b.names);
  const partial = union(a.partial, b.partial).filter((n) => !names.includes(n));
  const count =
    a.count === undefined && b.count === undefined
      ? undefined
      : (a.count ?? 0) + (b.count ?? 0);
  return {
    ...(count !== undefined ? { count } : {}),
    ...(names.length ? { names } : {}),
    ...(partial.length ? { partial } : {}),
  };
}

/** The visitor's sentence for each notice code, from its merged facts. */
export const NOTICE_TEXT: Record<NoticeCode, (facts: NoticeFacts) => string> = {
  // "Features", not "rows": to a visitor the rows are the tracks. "This
  // sequence", not "this protein": it reads right in sequence mode too. "In
  // full", because one partly outside is drawn clipped.
  'coordinate-out-of-range': ({ count = 1 }) =>
    count === 1
      ? "1 feature extends beyond this sequence, so it isn't shown in full."
      : `${count} features extend beyond this sequence, so they aren't shown in full.`,
  'unpaintable-color': () =>
    "Some colours in the data couldn't be shown, so some features may be in the wrong colour.",
  'url-variable-unresolved': ({ names = [], partial = [] }) => {
    const out: string[] = [];
    if (names.length === 1) {
      out.push(`${quote(names[0])} isn't shown: its data couldn't be loaded.`);
    } else if (names.length > 1) {
      out.push(
        `${names.length} tracks aren't shown: their data couldn't be loaded (${quoteAll(names)}).`
      );
    }
    if (partial.length === 1) {
      out.push(
        `${quote(partial[0])} is incomplete: some of its data couldn't be loaded.`
      );
    } else if (partial.length > 1) {
      out.push(
        `${partial.length} tracks are incomplete: some of their data couldn't be loaded (${quoteAll(partial)}).`
      );
    }
    return out.length ? out.join(' ') : "Some data couldn't be loaded.";
  },
  // "Can't be displayed": the cause is permanent, not a failed attempt.
  'unrendered-component': ({ names = [] }) =>
    names.length === 1
      ? `${quote(names[0])} can't be displayed in this viewer.`
      : names.length > 1
        ? `${names.length} tracks can't be displayed in this viewer: ${quoteAll(names)}.`
        : "A track can't be displayed in this viewer.",
};

/** Whether a code has a visitor sentence. */
export const isNoticeCode = (code: string | undefined): code is NoticeCode =>
  code !== undefined && Object.prototype.hasOwnProperty.call(NOTICE_TEXT, code);

/** Buttons, headings and announcements. */
export const NOTE_UI = {
  /** The track ⓘ's accessible name. */
  trackLabel: (n: number, label: string) =>
    n === 1 ? `Note about ${label}` : `${n} notes about ${label}`,
  /** The top-bar ⓘ's accessible name. */
  viewerLabel: (n: number) => `Notes about this view (${n})`,
  viewerHeading: 'About this view',
  /** A note about a track that is not on screen, in the top-bar list. */
  offscreen: (label: string, text: string) => `${label}: ${text}`,
  /** The author ⚠'s visible text and accessible name. */
  authorText: (n: number) => `⚠ ${n}`,
  authorLabel: (n: number, label?: string) =>
    `${plural(n, 'authoring note')} for ${label ?? 'this view'}`,
  /** The author-mode error badge's accessible name. */
  errorLabel: (n: number) =>
    `Track failed to load — ${plural(n, 'authoring note')}`,
  authorFooter:
    "Shown because author mode (show-warnings) is on. Visitors don't see this list.",
  source: (url: string) => `Source: ${url}`,
  repeat: (n: number) => `×${n}`,
  visitorsSee: (text: string) => `Visitors see: “${text}”`,
  /** Sent once to the polite live region. */
  announceOne: (where: string | undefined, text: string) =>
    `Note about ${where ?? 'this view'}: ${text}`,
  announceMany: (n: number) =>
    `${n} notes about what's shown. Use the information buttons beside the track names and the Customize button to read them.`,
  announceAuthor: (n: number) =>
    `${plural(n, 'authoring note')}. Use the warning buttons to read ${n === 1 ? 'it' : 'them'}.`,
} as const;

/** The console's `[protvista…]` tag, which no person-facing surface shows. */
export const stripTag = (message: string): string =>
  message.replace(/^\[protvista(?:-uniprot)?\] /, '');
