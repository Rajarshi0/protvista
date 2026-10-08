/**
 * The files a visitor might open in the playground
 * (`src/__fixtures__/local-files/`), for unit specs: authored CSV, TSV, JSON
 * and FASTA files, good and broken. The browser specs read the same directory
 * through `fixtureText` in `__browser__/playground-page.ts`, so both layers
 * pin the same bytes.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Vitest runs from the repo root, so resolve paths from cwd.
export const fixtureText = (name: string): string =>
  readFileSync(
    resolve(process.cwd(), 'src/__fixtures__/local-files', name),
    'utf8'
  );
