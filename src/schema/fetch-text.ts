/**
 * The size-capped text fetch shared by the loader's default fetchers: the
 * `extends:` fetcher (`extends.ts`) and the `sequence:` fetcher (`load.ts`).
 *
 * Both fetch author-named files at config-load time with the same trust
 * posture, so both get the same ceiling. Each wraps the failures below in its
 * own wording — `mergeExtends: …` for a base config, a `cannot-resolve-sequence`
 * issue for a FASTA file — which is why this throws a typed error carrying the
 * reason rather than a finished message.
 */

/**
 * Maximum size (in bytes, post-UTF-8 encoding) the default fetchers accept.
 * Real-world shipped configs sit well under 200 KiB, and the longest known
 * protein is about 35,000 residues; 2 MiB is a loose-but-bounded ceiling that
 * refuses obviously-hostile payloads (a server streaming a multi-gigabyte
 * response the parser would nevertheless try to hold in memory) while leaving
 * room for comment-heavy authoring styles.
 *
 * Only the built-in fetchers apply it; adopters who supply their own fetcher
 * are on the hook for their own size discipline.
 */
export const MAX_FETCH_TEXT_BYTES = 2 * 1024 * 1024;

/** Why {@link fetchTextCapped} refused a body. */
export type FetchTextFailure =
  | { reason: 'no-fetch' }
  | { reason: 'http'; status: number; statusText: string }
  | { reason: 'too-large'; bytes: number; declared: boolean };

export class FetchTextError extends Error {
  readonly failure: FetchTextFailure;

  constructor(url: string, failure: FetchTextFailure) {
    super(describeFailure(url, failure));
    this.name = 'FetchTextError';
    this.failure = failure;
    Object.setPrototypeOf(this, FetchTextError.prototype);
  }
}

function describeFailure(url: string, f: FetchTextFailure): string {
  switch (f.reason) {
    case 'no-fetch':
      return `no fetch implementation available to retrieve '${url}'`;
    case 'http':
      return `fetch failed for '${url}': HTTP ${f.status} ${f.statusText}`.trimEnd();
    case 'too-large':
      return f.declared
        ? `'${url}' declared Content-Length ${f.bytes} bytes exceeds the ${MAX_FETCH_TEXT_BYTES}-byte ceiling`
        : `'${url}' response body is ${f.bytes} bytes, exceeding the ${MAX_FETCH_TEXT_BYTES}-byte ceiling`;
  }
}

/**
 * Fetch `url` as text through `globalThis.fetch`, refusing a non-2xx response
 * or a body over {@link MAX_FETCH_TEXT_BYTES}. A network failure propagates
 * as whatever the fetch implementation threw; every other refusal is a
 * {@link FetchTextError}.
 */
export async function fetchTextCapped(url: string): Promise<string> {
  const fetchImpl = (globalThis as { fetch?: typeof fetch }).fetch;
  if (typeof fetchImpl !== 'function') {
    throw new FetchTextError(url, { reason: 'no-fetch' });
  }
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new FetchTextError(url, {
      reason: 'http',
      status: res.status,
      statusText: res.statusText ?? '',
    });
  }
  // Cheap upper-bound check before we spool the body into memory.
  // `Content-Length` is advisory (a malicious server can lie) but
  // rejecting the obviously-oversized case here avoids buffering a
  // multi-gigabyte response just to throw afterwards.
  const declared = Number(res.headers?.get?.('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_FETCH_TEXT_BYTES) {
    throw new FetchTextError(url, {
      reason: 'too-large',
      bytes: declared,
      declared: true,
    });
  }
  const text = await res.text();
  // Post-decode guard. UTF-8 re-expansion can inflate byte counts, so
  // we measure the decoded string against the same ceiling.
  if (text.length > MAX_FETCH_TEXT_BYTES) {
    throw new FetchTextError(url, {
      reason: 'too-large',
      bytes: text.length,
      declared: false,
    });
  }
  return text;
}
