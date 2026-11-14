import { describe, expect, it } from 'vitest';
import { buildReport, renderReport } from './index-coverage.ts';
import { blankComments, modelOf, objectShape, scanQueries, splitTop } from './query-sites.ts';

const scan = (source: string) => scanQueries('src/x.ts', source);

describe('query site scanner', () => {
  it('splits at the top level only, and skips strings', () => {
    expect(splitTop("a, { b, c }, 'd,e', [f, g]")).toEqual(['a', '{ b, c }', "'d,e'", '[f, g]']);
  });

  it('reads keys of an object literal, inside $or too, and flags spreads', () => {
    expect(objectShape("{ chatId, 'media.id': x, $or: [{ a: 1 }, { b }] }")).toEqual({
      fields: ['$or.a', '$or.b', 'chatId', 'media.id'],
      dynamic: false,
    });
    expect(objectShape('{ userId, ...(x ? {} : { y }) }')).toEqual({
      fields: ['userId'],
      dynamic: true,
    });
    expect(objectShape('{ _id: { $nin: ids } }').fields).toEqual(['_id:range']);
    expect(objectShape('{ _id: { $in: ids } }').fields).toEqual(['_id']);
  });

  it('resolves models from accessors and aliases', () => {
    expect(modelOf('chatModels(app).ChatMember')).toBe('ChatMember');
    expect(modelOf('usersModel(app())')).toBe('AuthUser');
    expect(modelOf('Message.collection')).toBe('Message');
    expect(modelOf('members')).toBeNull();
  });

  it('blanks comments but keeps strings and line numbers', () => {
    const source = "a // .find({ x })\nb = 'http://x' /* y\n */ c";
    const blank = blankComments(source);
    expect(blank).not.toContain('find');
    expect(blank).toContain("'http://x'");
    expect(blank.split('\n')).toHaveLength(3);
  });

  it('finds calls with their filter, sort and enclosing function, and skips array finds', () => {
    const sites = scan(`
export async function listChats(app) {
  const base = { userId: me };
  const rows = await chatModels(app)
    .ChatMember.find({ ...base, leftAt: null })
    .sort({ lastActivityAt: -1 })
    .lean();
  const peer = rows.find((row) => row.x);
  await Star.deleteMany(filter);
  await Chat.findById(id);
}`);
    expect(sites).toHaveLength(3);
    expect(sites[0]).toMatchObject({
      model: 'ChatMember',
      method: 'find',
      fields: ['leftAt', 'userId'],
      sort: ['lastActivityAt'],
      within: 'listChats',
      line: 5,
    });
    expect(sites[1]).toMatchObject({ model: 'Star', fields: [], dynamic: true });
    expect(sites[2]).toMatchObject({ method: 'findById', fields: ['_id'] });
  });

  it('follows filter variables, helper functions, ternaries and later assignments', () => {
    const [byHelper, byTernary, byAssign, byCall] = scan(`
const usernameFilter = (name: string) => ({ username: { $eq: name } });
async function a() { await Users.findOne(usernameFilter(x)); }
async function b() {
  const filter = after ? { userId, $or: [{ at }] } : { userId, at: 1 };
  await Star.find(filter);
}
async function c() {
  const filter: Record<string, unknown> = { status: 'active' };
  if (q) filter.email = q;
  await Users.find(filter);
  await Message.find(await buildSearchQuery(app, me));
}`);
    expect(byHelper?.fields).toEqual(['username']);
    expect(byTernary?.fields).toEqual(['?$or.at', '?at', 'userId']);
    expect(byTernary?.variants).toHaveLength(2);
    expect(byAssign).toMatchObject({ fields: ['?email', 'status'], dynamic: true });
    expect(byCall?.fields).toEqual(['fn:buildSearchQuery']);
  });
});

describe('index coverage report', () => {
  const tests = [
    {
      file: 'src/x.test.ts',
      text: `
it('indexes', async () => {
  await expectIndexedQuery(
    ChatMember.find({ chatId, leftAt: null }),
  );
  await expectIndexedQuery(dueMessagesQuery(app(), now));
  await expectIndexedQuery(Star.find({}).sort({ at: -1 }));
});`,
    },
  ];
  const sources = [
    {
      file: 'src/a.ts',
      text: `
async function one() { await ChatMember.updateMany({ chatId, leftAt: null, role: 'admin' }, u); }
async function two() { await ChatMember.find({ userId }); }
async function three() { await Chat.updateOne({ _id: id }, u); }
export const dueMessagesQuery = (app, now) => Message.find({ expiresAt: { $lte: now } });
async function four() { await Star.find({}).sort({ at: -1 }); }
async function five() { await Report.find(somewhere); }`,
    },
  ];

  it('covers by subset of fields, _id, tested helpers and empty filters with the same sort', () => {
    const report = buildReport(sources, tests);
    expect(report.sites.map((site) => site.status.kind)).toEqual([
      'covered',
      'gap',
      'id',
      'covered',
      'covered',
      'review',
    ]);
    expect(report.counts).toEqual({ total: 6, covered: 3, id: 1, gap: 1, review: 1 });
    expect(report.sites[0]?.status.by).toBe('src/x.test.ts:4');
  });

  it('a note explains a site the scanner cannot judge, never hides a covered one', () => {
    const notes = {
      'src/a.ts:find:five': 'checked by hand',
      'src/a.ts:updateMany:one': 'gap: should never apply',
    };
    const report = buildReport(sources, tests, notes);
    expect(report.sites[5]?.status).toEqual({ kind: 'review', by: 'checked by hand' });
    expect(report.sites[0]?.status.kind).toBe('covered');
  });

  it('renders a summary and one table per file', () => {
    const markdown = renderReport(buildReport(sources, tests));
    expect(markdown).toContain('| **gap** (no test) | 1 |');
    expect(markdown).toContain('### `src/a.ts`');
    expect(markdown).toContain('| 3 | ChatMember | find | userId |  | **GAP** |');
  });
});
