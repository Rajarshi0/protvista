import { css, unsafeCSS } from 'lit';
import { CSS_PREFIX } from './css-prefix.js';
import { tokenRef } from './tokens.js';

/**
 * Styles for the visitor notices and author mode: the quiet ⓘ on a track's
 * label or on the top bar, the author-mode ⚠ count, and the popover either
 * opens.
 *
 * Conventions match `error-styles.ts`: internal class names carry the
 * collision-proof `CSS_PREFIX` hash and every rule is scoped under the
 * `protvista-uniprot` element tag (light DOM). Colours flow through the shared
 * `--protvista-*` tokens with their literal defaults; the error tone reuses
 * the badge's red.
 *
 * Nothing here changes a label cell's own positioning or overflow. The
 * popover is `position: fixed` and placed by Floating UI, which is what lets
 * it escape a label cell that is `overflow: hidden` in customize mode.
 */
const p = unsafeCSS(CSS_PREFIX);
const ref = (name: string) => unsafeCSS(tokenRef(name));

export default css`
  protvista-uniprot .${p}-note {
    /* Wraps whole under Customize at narrow widths rather than squeezing. */
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.2em;
    /* WCAG 2.5.8: a 24px pointer target. */
    min-width: 24px;
    min-height: 24px;
    margin-left: 0.25em;
    padding: 0 0.25em;
    font: inherit;
    font-size: 0.85rem;
    font-weight: normal;
    line-height: 1;
    vertical-align: middle;
    color: ${ref('--protvista-color-text-muted')};
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--protvista-radius, 4px);
    cursor: pointer;
  }

  protvista-uniprot .${p}-note:hover {
    border-color: ${ref('--protvista-color-border')};
  }

  protvista-uniprot .${p}-note:focus-visible {
    outline: 2px solid ${ref('--protvista-color-accent')};
    outline-offset: 1px;
  }

  protvista-uniprot .${p}-note--error {
    color: #b3261e;
  }

  protvista-uniprot .${p}-note-popover {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 1000;
    box-sizing: border-box;
    width: max-content;
    max-width: min(22rem, calc(100vw - 16px));
    padding: 0.5rem 0.75rem;
    overflow-wrap: anywhere;
    white-space: normal;
    text-align: left;
    font-size: 0.8rem;
    font-weight: normal;
    line-height: 1.4;
    color: ${ref('--protvista-color-text')};
    background: ${ref('--protvista-color-surface')};
    border: 1px solid ${ref('--protvista-color-border')};
    border-radius: var(--protvista-radius, 4px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    cursor: auto;
  }

  protvista-uniprot .${p}-note-popover[hidden] {
    display: none;
  }

  protvista-uniprot .${p}-note-popover__title {
    margin: 0 0 0.35rem;
    font-weight: 600;
  }

  protvista-uniprot .${p}-note-popover__list {
    margin: 0;
    padding-left: 1.1rem;
  }

  protvista-uniprot .${p}-note-popover__list > li + li {
    margin-top: 0.35rem;
  }

  protvista-uniprot .${p}-note-popover__meta {
    margin: 0.2rem 0 0;
    color: ${ref('--protvista-color-text-muted')};
    font-size: 0.75rem;
  }

  protvista-uniprot .${p}-note-popover__footer {
    margin: 0.5rem 0 0;
    color: ${ref('--protvista-color-text-muted')};
    font-size: 0.75rem;
  }

  @media (forced-colors: active) {
    protvista-uniprot .${p}-note-popover {
      outline: 1px solid CanvasText;
    }
  }
`;
