// editor
export { Editor } from './ui/Editor';
export { useEditor } from './core/store';
export { defaultProject, builtinPresets, builtinExpressions, COMP } from './core/defaults';
export { installPublicApi } from './core/publicApi';
export { fetchCatalog, hasBackend, supabase } from './core/catalog';
export { sceneAt } from './core/scene';
export { MascotThumb, Shapes } from './ui/Mascot';
export type { SceneItem } from './core/scene';
export { activeTimeline } from './core/types';
export { smoke } from './smoke';
export type { Project, Preset, Expression, Timeline } from './core/types';

// shared app shell
export * from './kit';
export { startTour, startTourWhenReady, hasSeenTour } from './kit/tour';
export { TourMenu, type TourEntry } from './kit/TourMenu';
export type { DriveStep } from 'driver.js';

// cloud
export { api, ApiError } from './cloud/client';
export { projectsApi, assetsApi, communityApi, splashApi, adminApi } from './cloud/api';
export { useSession, auth } from './cloud/auth';
export { useAsync } from './cloud/useAsync';
export { useAutosave } from './cloud/useAutosave';
export { Splashscreen } from './cloud/Splashscreen';
export { ProjectThumb, AssetThumb } from './cloud/Thumb';
export { AssetPreview } from './cloud/AssetPreview';
export { ProjectCard, AssetCard } from './cloud/cards';
export { PublishDialog } from './cloud/PublishDialog';
export type * from './cloud/types';
