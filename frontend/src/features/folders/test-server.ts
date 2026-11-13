import { type ChatFolderDef, NO_FOLDER_RULES } from '@zuvo/protocol';
import { chatFixture, personFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';

/** Test-only: a folder API kept in memory, recording what the app sends. */
export interface FolderServer {
  folders: ChatFolderDef[];
  requests: Array<{ method: string; path: string; body: unknown }>;
}

export const folderFixture = (overrides: Partial<ChatFolderDef> = {}): ChatFolderDef => ({
  id: 'f1',
  name: 'Work',
  emoji: null,
  chatIds: [],
  rules: NO_FOLDER_RULES,
  ...overrides,
});

export function serveFolders(initial: ChatFolderDef[]): FolderServer {
  const state: FolderServer = { folders: [...initial], requests: [] };
  const record = async (request: Request) => {
    const body =
      request.method === 'GET' || request.method === 'DELETE' ? null : await request.json();
    state.requests.push({ method: request.method, path: new URL(request.url).pathname, body });
    return body as Record<string, unknown> | null;
  };
  server.use(
    http.get('*/v1/me/folders', () => HttpResponse.json({ folders: state.folders })),
    http.post('*/v1/me/folders', async ({ request }) => {
      const body = (await record(request)) as Omit<ChatFolderDef, 'id'>;
      const folder = { ...body, id: `f${state.folders.length + 10}` };
      state.folders.push(folder);
      return HttpResponse.json({ folder });
    }),
    http.put('*/v1/me/folders/order', async ({ request }) => {
      const { ids } = (await record(request)) as { ids: string[] };
      state.folders = ids.flatMap((id) => state.folders.find((item) => item.id === id) ?? []);
      return HttpResponse.json({ folders: state.folders });
    }),
    http.patch('*/v1/me/folders/:id', async ({ request, params }) => {
      const changes = (await record(request)) ?? {};
      const folder = {
        ...(state.folders.find((item) => item.id === params.id) as ChatFolderDef),
        ...changes,
      };
      state.folders = state.folders.map((item) => (item.id === folder.id ? folder : item));
      return HttpResponse.json({ folder });
    }),
    http.delete('*/v1/me/folders/:id', async ({ request, params }) => {
      await record(request);
      state.folders = state.folders.filter((item) => item.id !== params.id);
      return HttpResponse.json({ ok: true });
    }),
  );
  return state;
}

const lastMessage = (preview: string, createdAt: string) => ({
  id: 'm',
  seq: 1,
  senderId: 'u-x',
  type: 'text' as const,
  preview,
  createdAt,
});

/** Asha (2 unread), Rahul (read), Team (a muted group, 1 unread). */
export const folderChats = () => [
  chatFixture({
    id: 'c-asha',
    seq: 2,
    unreadCount: 2,
    lastMessage: lastMessage('hi', '2026-11-04T09:00:00.000Z'),
    lastActivityAt: '2026-11-04T09:00:00.000Z',
  }),
  chatFixture({
    id: 'c-rahul',
    seq: 1,
    lastReadSeq: 1,
    otherUser: personFixture({ id: 'u-rahul', displayName: 'Rahul Menon', username: 'rahul' }),
    lastActivityAt: '2026-11-04T08:00:00.000Z',
  }),
  chatFixture({
    id: 'c-team',
    type: 'group',
    seq: 1,
    unreadCount: 1,
    mutedUntil: '2099-01-01T00:00:00.000Z',
    otherUser: null,
    lastActivityAt: '2026-11-04T07:00:00.000Z',
    group: {
      name: 'Team',
      description: '',
      photo: null,
      memberCount: 2,
      settings: {
        editInfo: 'all',
        sendMessages: 'all',
        addMembers: 'all',
        pinMessages: 'all',
        mentionEveryone: 'admins',
        disappearing: 'admins',
      },
      myRole: 'member',
      active: true,
    },
  }),
];
