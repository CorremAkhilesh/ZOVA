import {
  chatFolderSchema,
  createFolderBodySchema,
  folderParamsSchema,
  foldersResponseSchema,
  reorderFoldersBodySchema,
  updateFolderBodySchema,
} from '@zuvo/protocol';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { currentUserId, requireSession } from '../../auth/session.ts';
import {
  createFolder,
  deleteFolder,
  listFolders,
  reorderFolders,
  updateFolder,
} from '../../chats/folders.service.ts';

const oneFolder = z.object({ folder: chatFolderSchema });
const LIMIT = { rateLimit: { max: 60, timeWindow: '1 minute' } };

/** My chat folders: mine alone, on every device of mine. */
export const foldersRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireSession);

  app.get(
    '/me/folders',
    { schema: { tags: ['folders'], response: { 200: foldersResponseSchema } } },
    async (request) => ({ folders: await listFolders(app, currentUserId(request)) }),
  );

  app.post(
    '/me/folders',
    {
      config: LIMIT,
      schema: {
        tags: ['folders'],
        summary: 'Create a folder (at most 10)',
        body: createFolderBodySchema,
        response: { 200: oneFolder },
      },
    },
    async (request) => ({ folder: await createFolder(app, currentUserId(request), request.body) }),
  );

  app.patch(
    '/me/folders/:id',
    {
      config: LIMIT,
      schema: {
        tags: ['folders'],
        params: folderParamsSchema,
        body: updateFolderBodySchema,
        response: { 200: oneFolder },
      },
    },
    async (request) => ({
      folder: await updateFolder(app, currentUserId(request), request.params.id, request.body),
    }),
  );

  app.delete(
    '/me/folders/:id',
    {
      config: LIMIT,
      schema: {
        tags: ['folders'],
        params: folderParamsSchema,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (request) => {
      await deleteFolder(app, currentUserId(request), request.params.id);
      return { ok: true as const };
    },
  );

  app.put(
    '/me/folders/order',
    {
      config: LIMIT,
      schema: {
        tags: ['folders'],
        summary: 'Reorder my folders: every id once, in the new order',
        body: reorderFoldersBodySchema,
        response: { 200: foldersResponseSchema },
      },
    },
    async (request) => ({
      folders: await reorderFolders(app, currentUserId(request), request.body.ids),
    }),
  );
};
