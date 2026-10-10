// Staff chat (permissions, mute, monitor, groups, audit) and the assistant's plumbing. The assistant
// part needs the stand-in model server first:  node scripts/checks/fake-ollama.mjs &
import { login, ok, check, eq, summary, BASE } from './lib.mjs';
// A 1×1 PNG: the stand-in model server (fake-ollama.mjs) doesn't look at the picture.
const TINY = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
  'base64',
);
const o = await login('owner@skb.local');
const staff = ok('staff', await o.get('/staff'));
const list = staff.items ?? staff;
const email = (re) => list.find((s) => re.test(s.email))?.email;
const karim = await login(email(/karim/));
const sara = await login(email(/sara/));
const mona = await login('mona@skb.local');
// status / people
ok('karim status', await karim.get('/chat/status'));
const people = ok('people', await karim.get('/chat/people'));
const saraId = people.find((p) => p.name.startsWith('Sara')).id;
const karimId = people.find((p) => p.name.startsWith('Karim')).id;
// direct conversation
const conv = ok('direct', await karim.post('/chat/direct', { staffId: saraId }));
const again = ok('direct again', await karim.post('/chat/direct', { staffId: saraId }));
eq('same conversation', again.id, conv.id);
// One conversation per two people (owner, 2026-10-10): from either side, and with clicks at once.
eq('the other side opens the same one', (await sara.post('/chat/direct', { staffId: karimId })).data?.id, conv.id);
const burst = await Promise.all([1, 2, 3, 4].map(() => mona.post('/chat/direct', { staffId: saraId })));
eq('clicks at once open one conversation', new Set(burst.map((r) => r.data?.id)).size, 1);
ok(
  'send',
  await karim.post(`/chat/conversations/${conv.id}/messages`, {
    text: 'السلام عليكم، هل وصلت البضاعة؟',
  }),
);
const sst = ok('sara status', await sara.get('/chat/status'));
check('sara unread', sst.unread >= 1, sst);
const msgs = ok('sara reads', await sara.get(`/chat/conversations/${conv.id}/messages`));
check(
  'message there',
  msgs.some((m) => m.text.includes('البضاعة')),
);
eq(
  'sara read it',
  (await sara.get('/chat/conversations')).data.find((c) => c.id === conv.id).unread,
  0,
);
// viewer can't read
check(
  'non-member cannot read',
  (await mona.get(`/chat/conversations/${conv.id}/messages`)).status === 404,
);
// owner monitors (not member)
const all = ok('monitor list', await o.get('/chat/conversations?all=true'));
check(
  'owner sees it',
  all.some((c) => c.id === conv.id && !c.mine),
);
ok('owner reads', await o.get(`/chat/conversations/${conv.id}/messages`));
check(
  'owner cannot write in others',
  (await o.post(`/chat/conversations/${conv.id}/messages`, { text: 'x' })).status === 404,
);
check('karim no monitor', (await karim.get('/chat/conversations?all=true')).status === 403);
// mute
check('karim cannot mute', (await karim.post(`/chat/mutes/${saraId}`)).status === 403);
check('mute', (await o.post(`/chat/mutes/${karimId}`)).status === 204);
check(
  'muted cannot send',
  (await karim.post(`/chat/conversations/${conv.id}/messages`, { text: 'hi' })).status === 403,
);
check('muted status', (await karim.get('/chat/status')).data.muted === true);
check('unmute', (await o.del(`/chat/mutes/${karimId}`)).status === 204);
ok(
  'send after unmute',
  await karim.post(`/chat/conversations/${conv.id}/messages`, { text: 'تمام' }),
);
// group
const g = ok(
  'group',
  await o.post('/chat/groups', { title: 'المندوبون', memberIds: [karimId, saraId] }),
);
eq(
  'a group of one other person is the one-to-one conversation',
  (await o.post('/chat/groups', { title: 'x', memberIds: [karimId] })).data?.id,
  (await o.post('/chat/direct', { staffId: karimId })).data?.id,
);
check(
  'karim cannot make group',
  (await karim.post('/chat/groups', { title: 'x', memberIds: [saraId] })).status === 403,
);
ok(
  'karim in group',
  await karim.post(`/chat/conversations/${g.id}/messages`, { text: 'مرحبا بالجميع' }),
);
const mine = ok('karim convs', await karim.get('/chat/conversations'));
check(
  'karim sees group',
  mine.some((c) => c.id === g.id && c.title === 'المندوبون'),
);
// audit
const audit = ok('audit', await o.get('/audit?page=1&pageSize=50'));
const rows = audit.items ?? audit;
check('audited send', JSON.stringify(rows).includes('chat_message'));
// ---- assistant (fake model server)
check('karim no ai', (await karim.get('/assistant/status')).status === 403);
const st = ok('ai status', await o.get('/assistant/status'));
check('ready', st.reachable && st.chatReady && st.visionReady, st);
const a1 = ok('ask balance', await o.post('/assistant/ask', { text: 'كم رصيد النور؟' }));
check('tool used', a1.content.includes('Al-Nour') && a1.content.includes('balance'), a1.content);
const a2 = ok('ask sales', await o.post('/assistant/ask', { text: 'مبيعات الشهر' }));
check('sales summary', a2.content.includes('sales'), a2.content);
const hist = ok('history', await o.get('/assistant/history'));
check('history 4', hist.length >= 4);
// scans
const fd = new FormData();
fd.append('file', new Blob([TINY], { type: 'image/png' }), 'p.png');
const r1 = await fetch(`${BASE}/assistant/scan/purchase`, {
  method: 'POST',
  headers: { authorization: `Bearer ${o.token}` },
  body: fd,
});
const p1 = await r1.json();
check(
  'purchase scan',
  r1.status === 200 &&
    p1.lines.length === 2 &&
    p1.lines[0].unitPrice === 45 &&
    p1.lines[0].quantity === 12 &&
    p1.lines[1].unitPrice === 15.5 &&
    p1.lines[1].discount === 1,
  p1,
);
const fd2 = new FormData();
fd2.append('file', new Blob([TINY], { type: 'image/png' }), 'c.png');
const r2 = await fetch(`${BASE}/assistant/scan/cheques`, {
  method: 'POST',
  headers: { authorization: `Bearer ${o.token}` },
  body: fd2,
});
const c2 = await r2.json();
check(
  'cheque scan',
  r2.status === 200 && c2.length === 2 && c2[0].amount === 5000 && c2[0].dueDate === '2026-11-01',
  c2,
);
const fd3 = new FormData();
fd3.append('file', new Blob([Buffer.from('not an image at all')], { type: 'image/png' }), 'x.png');
const r3 = await fetch(`${BASE}/assistant/scan/cheques`, {
  method: 'POST',
  headers: { authorization: `Bearer ${o.token}` },
  body: fd3,
});
check('non-image refused', r3.status === 400);
summary('chat+assistant');
