/**
 * The real `<protvista-uniprot-structure>` attribute handling: the
 * `color-theme` mapping (a camel-cased `colorTheme` would otherwise observe
 * the lowercased `colortheme`), and the warning when React 19 stringified the
 * object-valued `data` prop into an attribute.
 *
 * `nightingale-mocks.ts` stubs this whole module with a bare `HTMLElement`
 * subclass for every other spec, so this one unmocks it to exercise the real
 * property declarations.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// Undo the global stub so the real (self-registering) element loads.
vi.unmock('../protvista-uniprot-structure');
// The global mock of nightingale-structure has no default export, which the
// real module imports; give it one so the module graph loads.
vi.mock('@nightingale-elements/nightingale-structure', () => ({
  default: class extends HTMLElement {},
  amColorScale: () => '#000000',
}));
vi.mock('../icons/download.svg', () => ({ default: '' }));
vi.mock('../icons/external-link.svg', () => ({ default: '' }));
vi.mock('../icons/spinner.svg', () => ({ default: '' }));

type StructureEl = HTMLElement & {
  colorTheme: string;
  data?: unknown;
};

const appended: HTMLElement[] = [];
afterEach(() => {
  appended.splice(0).forEach((el) => el.remove());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('<protvista-uniprot-structure> attributes', () => {
  it('observes `color-theme`, not the lowercased `colortheme`', async () => {
    await import('../protvista-uniprot-structure');
    const ctor = customElements.get('protvista-uniprot-structure') as
      (CustomElementConstructor & { observedAttributes: string[] }) | undefined;
    expect(ctor).toBeDefined();
    expect(ctor!.observedAttributes).toContain('color-theme');
    expect(ctor!.observedAttributes).not.toContain('colortheme');
  });

  it('sets colorTheme from the color-theme attribute', async () => {
    await import('../protvista-uniprot-structure');
    const el = document.createElement(
      'protvista-uniprot-structure'
    ) as StructureEl;
    expect(el.colorTheme).toBe('alphafold');
    el.setAttribute('color-theme', 'confidence');
    expect(el.colorTheme).toBe('confidence');
  });

  it('warns when React 19 stringified `data` into an attribute', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await import('../protvista-uniprot-structure');
    const el = document.createElement(
      'protvista-uniprot-structure'
    ) as StructureEl;
    el.setAttribute('data', '[object Object]');
    document.body.append(el);
    appended.push(el);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/`data`.*value was lost/)
    );
  });
});
