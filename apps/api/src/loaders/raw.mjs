// Node module hook: `import text from './file.ts?raw'` → the file's text, as Vite does.
// The studio's copilot reads its own store source this way (find_functions); under tsx the
// API needs the same answer. Registered by `--import ./src/loaders/register.mjs`.
import { readFile } from 'node:fs/promises';

export async function resolve(specifier, context, next) {
  if (!specifier.endsWith('?raw')) return next(specifier, context);
  const { url } = await next(specifier.slice(0, -4), context);
  return { url: `${url}?raw`, shortCircuit: true, format: 'module' };
}

export async function load(url, context, next) {
  if (!url.endsWith('?raw')) return next(url, context);
  const text = await readFile(new URL(url.slice(0, -4)), 'utf8');
  return { format: 'module', source: `export default ${JSON.stringify(text)};`, shortCircuit: true };
}
