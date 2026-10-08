/**
 * The structure panel's colour-scale radios follow `colorTheme` after a user
 * has clicked one (a `?checked` attribute binding stops doing so), and each
 * label targets a radio in its own panel.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { userEvent } from 'vitest/browser';
import { html } from 'lit';

vi.mock('@nightingale-elements/nightingale-structure', () => ({
  default: class extends HTMLElement {},
  amColorScale: () => '#000000',
}));
vi.mock('../icons/download.svg', () => ({ default: '' }));
vi.mock('../icons/external-link.svg', () => ({ default: '' }));
vi.mock('../icons/spinner.svg', () => ({ default: '' }));

type El = HTMLElement & {
  colorTheme: string | null;
  metaInfo?: unknown;
  data?: unknown;
  selectedId?: string;
  noTable?: boolean;
  updateComplete: Promise<boolean>;
};

const mounted: HTMLElement[] = [];
afterEach(() => {
  mounted.splice(0).forEach((e) => e.remove());
});

async function loadReal(): Promise<void> {
  // The browser setup stubs '../protvista-uniprot-structure' globally; the
  // query suffix bypasses that mock and loads the real module.
  // @ts-expect-error query import
  await import('../protvista-uniprot-structure.ts?real=1');
}

async function mountReal(): Promise<El> {
  await loadReal();
  const el = document.createElement('protvista-uniprot-structure') as El;
  el.metaInfo = html`<p>legend</p>`;
  (el as unknown as { alphamissenseAvailable: boolean }).alphamissenseAvailable =
    true;
  document.body.append(el);
  mounted.push(el);
  await el.updateComplete;
  return el;
}

const checkedValue = (el: El) =>
  (el.querySelector('input[type="radio"]:checked') as HTMLInputElement | null)
    ?.value;

const radio = (el: El, value: string) =>
  el.querySelector(`input[value="${value}"]`) as HTMLElement;

describe('colour-scale radios follow colorTheme after user interaction', () => {
  it('host sets color-theme after the user clicked Pathogenicity', async () => {
    const el = await mountReal();
    await userEvent.click(radio(el, 'alphamissense'));
    el.setAttribute('color-theme', 'alphafold');
    await el.updateComplete;
    expect(el.colorTheme).toBe('alphafold');
    expect(checkedValue(el)).toBe('alphafold');
  });

  it('click Pathogenicity, click Confidence, then colorTheme = alphamissense', async () => {
    const el = await mountReal();
    await userEvent.click(radio(el, 'alphamissense'));
    await userEvent.click(radio(el, 'alphafold'));
    el.colorTheme = 'alphamissense';
    await el.updateComplete;
    expect(checkedValue(el)).toBe('alphamissense');
  });

  it('selecting a non-monomer AlphaFold row resets the radio with colorTheme', async () => {
    await loadReal();
    const el = document.createElement('protvista-uniprot-structure') as El;
    el.noTable = true;
    document.body.append(el);
    mounted.push(el);
    el.data = [
      {
        id: 'AF-P1-F1',
        source: 'AlphaFold DB',
        oligomericState: 'Monomer',
        amAnnotationsUrl: 'x',
      },
      {
        id: 'AF-P1-dimer',
        source: 'AlphaFold DB',
        oligomericState: 'Homodimer',
        amAnnotationsUrl: 'x',
        downloadUrl: 'https://example.org/m.cif',
      },
    ];
    el.selectedId = 'AF-P1-F1';
    await el.updateComplete;
    await userEvent.click(radio(el, 'alphamissense'));
    expect(checkedValue(el)).toBe('alphamissense');
    el.selectedId = 'AF-P1-dimer';
    await el.updateComplete;
    await el.updateComplete;
    expect(el.colorTheme).toBe('alphafold');
    expect(checkedValue(el)).toBe('alphafold');
  });

  it('each label targets a radio in its own panel', async () => {
    const a = await mountReal();
    const b = await mountReal();
    for (const host of [a, b]) {
      for (const label of host.querySelectorAll('label')) {
        const control = (label as HTMLLabelElement).control;
        expect(control).not.toBeNull();
        expect(host.contains(control)).toBe(true);
      }
    }
    await userEvent.click(b.querySelectorAll('label')[1] as HTMLElement);
    await b.updateComplete;
    expect(checkedValue(b)).toBe('alphamissense');
    expect(checkedValue(a)).toBe('alphafold');
  });
});
