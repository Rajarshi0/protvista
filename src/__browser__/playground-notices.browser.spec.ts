/**
 * Visitor notices in the playground preview, through the real page
 * controller. The preview shows what a visitor will see — notices on, author
 * mode off — because the playground's own diagnostics list is the author view
 * there (it relabels loaded files to `./name`, which an author-mode preview
 * would not).
 *
 * A file of its own: the controller wires itself to the page once, on import.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

import { CSS_PREFIX } from '../styles/css-prefix.js';
import {
  closePlayground,
  listItems,
  openPlayground,
  preview,
} from './playground-page.js';

const CONFIG = `sequence: MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRV
rows:
  - id: lab
    label: Lab hits
    kind: features
    data:
      from: inline
      format: csv
      inlineData: |
        type,start,end,description
        DOMAIN,5,20,a
        REGION,30,60,b
`;

beforeAll(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  await openPlayground({ state: { config: CONFIG, accession: '' } });
});

afterAll(closePlayground);

describe('the playground preview', () => {
  it('shows the visitor notice, no author control, and the diagnostics row', async () => {
    const note = await vi.waitFor(
      () => {
        const el = preview()?.querySelector(
          `#${CSS_PREFIX}-group_lab .${CSS_PREFIX}-note--notice`
        );
        if (!el) throw new Error('no notice yet');
        return el;
      },
      { timeout: 10000 }
    );
    expect(note.getAttribute('aria-label')).toBe('Note about Lab hits');
    expect(preview()!.hasAttribute('show-warnings')).toBe(false);
    expect(preview()!.querySelector(`.${CSS_PREFIX}-note--author`)).toBeNull();
    await vi.waitFor(() =>
      expect(
        listItems().some(
          (li) =>
            li.textContent!.startsWith('[track-data]') &&
            li.textContent!.includes('fall outside your sequence')
        )
      ).toBe(true)
    );
  });
});
