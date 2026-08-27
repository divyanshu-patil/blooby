// editor
export { Editor } from './ui/Editor';
export { useEditor } from './core/store';
export { defaultProject, builtinPresets, builtinExpressions, COMP } from './core/defaults';
export { installPublicApi } from './core/publicApi';
export { fetchCatalog, hasBackend, supabase } from './core/catalog';
export { sceneAt } from './core/scene';
export { activeTimeline } from './core/types';
export { smoke } from './smoke';
export type { Project, Preset, Expression, Timeline } from './core/types';

// shared app shell
export * from './kit';

// cloud
export { api, ApiError } from './cloud/client';
export { projectsApi, assetsApi, communityApi, splashApi, adminApi } from './cloud/api';
export { useSession, auth } from './cloud/auth';
export { useAsync } from './cloud/useAsync';
export { useAutosave } from './cloud/useAutosave';
export { Splashscreen } from './cloud/Splashscreen';
export { ProjectThumb, AssetThumb } from './cloud/Thumb';
export { ProjectCard, AssetCard } from './cloud/cards';
export type * from './cloud/types';
