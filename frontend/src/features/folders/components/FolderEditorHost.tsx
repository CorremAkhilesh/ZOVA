import { lazy, Suspense } from 'react';
import { useFolderEditor } from '../store';

const FolderEditor = lazy(() => import('./FolderEditor'));

/** Where the folder editor can open; its code loads the first time it does. */
export function FolderEditorHost() {
  const request = useFolderEditor((state) => state.request);
  if (!request) return null;
  return (
    <Suspense fallback={null}>
      <FolderEditor key={request.folder?.id ?? 'new'} request={request} />
    </Suspense>
  );
}
