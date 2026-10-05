/**
 * Real-layout pin for the playground header at phone width. A <select> is
 * as wide as its longest option, and the preset labels are long ("Extend
 * UniProt (your track + the full default viewer)"), so the preset field
 * used to push the page about 60px sideways at 390px.
 *
 * The header markup and stylesheet come from the page's own source
 * (`docs/src/pages/playground.astro`), so this cannot drift from what ships.
 * They are laid out in a shadow root, which keeps the page's `body` rules
 * off the test document; `:root` becomes `:host` so the colour tokens (and
 * the 1px borders that use them) still apply. Nothing is fetched.
 */
import { describe, it, expect, afterEach } from 'vitest';

import pageSource from '../../docs/src/pages/playground.astro?raw';
import { PRESETS } from '../playground/presets.js';

function extract(pattern: RegExp, what: string): string {
  const match = pageSource.match(pattern);
  if (!match) throw new Error(`playground.astro: no ${what} found`);
  return match[1];
}

const css = extract(
  /<style is:global>([\s\S]*?)<\/style>/,
  '<style is:global>'
).replace(/:root\b/g, ':host');

// The header is an Astro template: resolve its few expressions to what the
// built page renders, so the version chip keeps its classes.
const headerHtml = extract(
  /(<header class="bar">[\s\S]*?<\/header>)/,
  'header.bar'
)
  .replace(/class:list=\{\['(\w+)',[^\]]*\]\}/, 'class="$1 is-prerelease"')
  .replace(/\s\w+=\{\w+\}/g, '')
  .replace(/\{version\}/g, '0.0.0-test');

const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

/** The page's header, with the real preset labels, in a `width`-px box. */
function renderHeader(width: number) {
  const host = document.createElement('div');
  host.style.width = `${width}px`;
  document.body.append(host);
  hosts.push(host);
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  const header = new DOMParser()
    .parseFromString(headerHtml, 'text/html')
    .querySelector('header.bar');
  root.append(style, document.adoptNode(header));
  const select = root.querySelector<HTMLSelectElement>('select#preset');
  for (const preset of PRESETS) select.add(new Option(preset.label, preset.id));
  return { host, root, select };
}

describe('playground header at phone width', () => {
  it.each([390, 320])('stays inside a %ipx viewport', (width) => {
    // Precondition: unconstrained, the preset field is wider than the
    // header's content box at this width, so the case is real.
    const wide = renderHeader(2000);
    const field = wide.select.closest('.field').getBoundingClientRect();
    const header = wide.root.querySelector('header.bar');
    const { paddingLeft, paddingRight } = getComputedStyle(header);
    const room = width - parseFloat(paddingLeft) - parseFloat(paddingRight);
    expect(field.width).toBeGreaterThan(room);

    const { host, root } = renderHeader(width);
    const right = host.getBoundingClientRect().right;
    const overflowing = [...root.querySelectorAll('header.bar, header.bar *')]
      .filter((el) => el.getBoundingClientRect().right > right + 0.5)
      .map(
        (el) =>
          el.tagName.toLowerCase() +
          (el.id ? `#${el.id}` : '') +
          [...el.classList].map((c) => `.${c}`).join('')
      );
    expect(overflowing).toEqual([]);
  });
});
