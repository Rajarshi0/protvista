/**
 * The size-capped text fetch shared by the `extends:` and `sequence:`
 * default fetchers: each refusal is a typed `FetchTextError` its caller
 * rewords, and a body over the 2 MiB ceiling is refused whether or not the
 * server declared its length.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fetchTextCapped,
  FetchTextError,
  MAX_FETCH_TEXT_BYTES,
} from '../fetch-text.js';

const response = (init: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  length?: string;
  body?: string;
}) =>
  ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? '',
    headers: { get: () => init.length ?? null },
    text: async () => init.body ?? '',
  }) as unknown as Response;

const refusal = async (url: string) => {
  try {
    await fetchTextCapped(url);
  } catch (err) {
    expect(err).toBeInstanceOf(FetchTextError);
    return err as FetchTextError;
  }
  throw new Error('expected a refusal');
};

afterEach(() => vi.unstubAllGlobals());

describe('fetchTextCapped', () => {
  it('returns the body of a 2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ body: '>x\nMKT' }))
    );
    await expect(fetchTextCapped('./p.fasta')).resolves.toBe('>x\nMKT');
  });

  it('refuses a non-2xx response with its status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response({ ok: false, status: 404, statusText: 'Not Found' })
      )
    );
    const err = await refusal('./p.fasta');
    expect(err.failure).toEqual({
      reason: 'http',
      status: 404,
      statusText: 'Not Found',
    });
    expect(err.message).toBe(
      "fetch failed for './p.fasta': HTTP 404 Not Found"
    );
  });

  it('refuses a declared Content-Length over the ceiling before reading', async () => {
    const text = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ...response({ length: String(MAX_FETCH_TEXT_BYTES + 1) }),
        text,
      }))
    );
    const err = await refusal('./big.fasta');
    expect(err.failure).toEqual({
      reason: 'too-large',
      bytes: MAX_FETCH_TEXT_BYTES + 1,
      declared: true,
    });
    expect(text).not.toHaveBeenCalled();
  });

  it('refuses an undeclared body over the ceiling', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response({ body: 'M'.repeat(MAX_FETCH_TEXT_BYTES + 1) })
      )
    );
    const err = await refusal('./big.fasta');
    expect(err.failure).toMatchObject({ reason: 'too-large', declared: false });
    expect(err.message).toContain('response body is');
  });

  it('refuses when there is no fetch at all', async () => {
    vi.stubGlobal('fetch', undefined);
    const err = await refusal('./p.fasta');
    expect(err.failure).toEqual({ reason: 'no-fetch' });
  });
});
