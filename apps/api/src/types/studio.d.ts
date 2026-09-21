// The studio package is TypeScript source written for Vite. These are the two Vite-isms it
// uses, declared so the API can type-check it; at runtime src/loaders/raw.mjs answers `?raw`
// and `import.meta.env` is simply undefined under Node (catalog.ts optional-chains it).
declare module '*?raw' { const text: string; export default text; }
interface ImportMeta { readonly env?: Record<string, string | undefined> }
declare module 'gif.js.optimized/dist/gif.worker.js?url' { const url: string; export default url; }
declare module '*.css';
// kit/index.tsx imports the brand mark as an asset. Nothing the API runs reaches kit —
// @blooby/studio/engine does not export it — but tsc compiles the whole package source,
// so the module has to have a type.
declare module '*.png' { const src: string; export default src; }
