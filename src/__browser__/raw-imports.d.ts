/**
 * The browser specs read shipped example files as text, through Vite's
 * `?raw` suffix (`examples/sequence-only/protein.fasta?raw`), so a spec
 * exercises the files the repo ships rather than a copy. Declared here,
 * beside the specs, for the two extensions they import; `*.yaml?raw` is in
 * `src/env.d.ts`.
 */
declare module '*.fasta?raw' {
  const content: string;
  export default content;
}

declare module '*.csv?raw' {
  const content: string;
  export default content;
}
