export { Editor } from './ui/Editor';
export { useEditor } from './core/store';
export { defaultProject, builtinPresets, builtinExpressions } from './core/defaults';
export { installPublicApi } from './core/publicApi';
export { fetchCatalog, hasBackend, supabase } from './core/catalog';
export { smoke } from './smoke';
export type { Project, Preset, Expression, Timeline } from './core/types';
