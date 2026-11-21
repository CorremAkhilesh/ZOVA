import type { AdminUserDetail, AdminUserRow } from '@zuvo/protocol';
import { HttpResponse, http, server, sessionFixture } from '@/test/msw';

// Shared by the Admin → Users tests: people, one person's page, and the API they call.

export const SLOW = { timeout: 15_000 };
export const MB = 1024 ** 2;
export const GB = 1024 ** 3;

export const adminSession = () => {
  const base = sessionFixture();
  return { ...base, user: { ...base.user, role: 'admin' as const } };
};
export const ME = adminSession().user.id;
export const AT = new Date(Date.now() - 2 * 3_600_000).toISOString();

export const row = (
  id: string,
  name: string,
  overrides: Partial<AdminUserRow> = {},
): AdminUserRow => ({
  id,
  email: `${id}@corremadvisory.com`,
  displayName: name,
  username: id,
  role: 'user',
  status: 'active',
  lastLoginAt: AT,
  createdAt: '2026-10-01T09:00:00.000Z',
  storageBytes: 300 * MB,
  quotaBytes: 3 * GB,
  quotaCustom: false,
  lastActiveAt: AT,
  deviceCount: 2,
  pushOn: true,
  suspendedUntil: null,
  suspendReason: null,
  ...overrides,
});

export const PEOPLE = [
  row('meera', 'Meera Nair', { storageBytes: Math.round(2.8 * GB) }),
  row('ravi', 'Ravi Shah', { pushOn: false, deviceCount: 1 }),
  row(ME, 'Kiran Rao', { role: 'admin' }),
];

export function serve(people = PEOPLE) {
  const queries: URLSearchParams[] = [];
  const posted: Array<{ url: string; body: unknown }> = [];
  const record = async ({ request }: { request: Request }) => {
    posted.push({ url: new URL(request.url).pathname, body: await request.json() });
  };
  server.use(
    http.get('*/v1/auth/me', () => HttpResponse.json(adminSession())),
    http.get('*/v1/admin/users', ({ request }) => {
      queries.push(new URL(request.url).searchParams);
      return HttpResponse.json({ items: people, nextCursor: null });
    }),
    http.post('*/v1/admin/users/bulk', async (info) => {
      await record(info);
      const { userIds } = (posted.at(-1)?.body ?? { userIds: [] }) as { userIds: string[] };
      return HttpResponse.json({
        results: userIds.map((id, index) => ({
          id,
          ok: index === 0,
          code: index === 0 ? null : 'LAST_ADMIN',
        })),
      });
    }),
    http.post('*/v1/admin/users/:id/sign-out', async (info) => {
      await record(info);
      return HttpResponse.json({ revokedSessions: 2 });
    }),
    http.post('*/v1/admin/users/:id/suspend', async (info) => {
      await record(info);
      return HttpResponse.json({
        suspendedUntil: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      });
    }),
    http.post('*/v1/admin/users/:id/unsuspend', async (info) => {
      await record(info);
      return HttpResponse.json({ suspendedUntil: null });
    }),
    http.put('*/v1/admin/users/:id/storage-quota', async (info) => {
      await record(info);
      return HttpResponse.json({ quotaBytes: 5 * GB, custom: true });
    }),
  );
  return { queries, posted };
}

export const detail = (overrides: Partial<AdminUserRow> = {}): AdminUserDetail => ({
  user: row('meera', 'Meera Nair', overrides),
  storage: {
    usedBytes: 2 * GB,
    pendingBytes: 0,
    quotaBytes: 3 * GB,
    custom: false,
    byKind: { image: GB, video: 512 * MB, audio: 0, voice: 12 * MB, document: 500 * MB },
  },
  devices: [
    {
      id: 's1',
      label: 'Chrome on Android',
      platform: 'android',
      installed: true,
      permission: 'granted',
      pushOn: true,
      lastActiveAt: AT,
    },
  ],
});
