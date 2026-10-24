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
// Several conversations (owner, 2026-10-10): a question without one starts one; asking in it continues it.
const a1 = ok('ask balance', await o.post('/assistant/ask', { text: 'كم رصيد النور؟' }));
check('tool used', a1.answer.content.includes('Al-Nour') && a1.answer.content.includes('balance'), a1.answer.content);
check('the owner is told the phone', a1.answer.content.includes(', phone '), a1.answer.content);
// A phone number is a contact detail (parties:contact), on the assistant too (2026-10-24 review).
const noContactEmail = `aicontact.${Date.now().toString(36)}@skb.local`;
const noContact = ok('someone who may ask but not see contacts', await o.post('/staff', {
  fullName: 'AI no contact', email: noContactEmail, password: 'Str0ngPass!', role: 'NONE', branchId: o.user.branchId,
}));
ok('given the assistant and the parties', await o.put(`/staff/${noContact.id}/permissions`, { granted: ['ai:chat', 'parties:view'], revoked: [] }));
const asker = await login(noContactEmail, 'Str0ngPass!');
const a0 = ok('they ask the balance', await asker.post('/assistant/ask', { text: 'كم رصيد النور؟' }));
check('…and get it without the phone', a0.answer.content.includes('Al-Nour') && !a0.answer.content.includes(', phone '), a0.answer.content);
ok('closed again', await o.put(`/staff/${noContact.id}`, { isActive: false }));
const a2 = ok('ask sales in the same conversation', await o.post('/assistant/ask', { text: 'مبيعات الشهر', conversationId: a1.conversationId }));
eq('same conversation', a2.conversationId, a1.conversationId);
check('sales summary', a2.answer.content.includes('sales'), a2.answer.content);
const a3 = ok('a new conversation', await o.post('/assistant/ask', { text: 'أرصدة الخزائن' }));
check('it is another one', a3.conversationId !== a1.conversationId);
const convs = ok('conversations', await o.get('/assistant/conversations'));
check('both listed, latest first', convs[0]?.id === a3.conversationId && convs.some((c) => c.id === a1.conversationId), convs);
eq('titled by the first question', convs.find((c) => c.id === a1.conversationId)?.title, 'كم رصيد النور؟');
const turns = ok('its turns', await o.get(`/assistant/conversations/${a1.conversationId}`));
eq('four turns in order', turns.map((t) => t.role), ['user', 'assistant', 'user', 'assistant']);
eq("nobody else reads it", (await mona.get(`/assistant/conversations/${a1.conversationId}`)).status, mona.user.permissions.includes('ai:chat') ? 404 : 403);
eq("nor deletes it", (await mona.del(`/assistant/conversations/${a1.conversationId}`)).status, mona.user.permissions.includes('ai:chat') ? 404 : 403);
eq('asking in someone else\'s conversation', (await o.post('/assistant/ask', { text: 'x', conversationId: '00000000-0000-0000-0000-000000000001' })).status, 404);
eq('delete one', (await o.del(`/assistant/conversations/${a3.conversationId}`)).status, 204);
check('gone', !(await o.get('/assistant/conversations')).data.some((c) => c.id === a3.conversationId));
eq('old ones: none older than 30 days', (await o.del('/assistant/conversations?olderThanDays=30')).data?.deleted, 0);
check('the recent one stays', (await o.get('/assistant/conversations')).data.some((c) => c.id === a1.conversationId));
// The answer's language is the app's (owner, 2026-10-11), whatever the tools' results are in.
const fake = async () => (await fetch('http://127.0.0.1:11434/__log')).json();
const en = ok('ask in English', await o.post('/assistant/ask', { text: 'balance of Al-Nour?', language: 'en' }));
check('an English answer as it is', en.answer.content.startsWith('RESULT:'), en.answer.content);
let lg = await fake();
check('told to answer in English', lg.filter((x) => x.q).at(-1).system.includes('Always answer in English'));
const ar = ok('ask in Arabic', await o.post('/assistant/ask', { text: 'balance of Al-Nour?', language: 'ar' }));
check('an English answer written again in Arabic', ar.answer.content.startsWith('هذه هي الإجابة') && ar.answer.content.includes('Al-Nour'), ar.answer.content);
lg = await fake();
check('told to answer in Arabic', lg.filter((x) => x.q).at(-1).system.includes('formal Arabic'));
const sp = ok('ask by voice', await o.post('/assistant/ask', { text: 'مبيعات الشهر', language: 'ar', spoken: true, conversationId: ar.conversationId }));
lg = await fake();
check('a spoken question asks for a short spoken answer', lg.filter((x) => x.q).at(-1).system.includes('by voice'));
eq('in the same conversation', sp.conversationId, ar.conversationId);
// The server's voice reads an answer aloud, made ready for reading (no marks, figures and currency in words).
if (st.voiceLanguages?.includes('ar')) {
  const said = await fetch(`${BASE}/assistant/speak`, {
    method: 'POST',
    headers: { authorization: `Bearer ${o.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ text: '**المبيعات**:\n- اليوم: 1,250.00 EGP\n- الأمس: ٣٬٤٠٠٫٥٠ ج.م 👍', language: 'ar' }),
  });
  eq('spoken as a recording', [said.status, said.headers.get('content-type')], [200, 'audio/wav']);
  lg = await fake();
  eq('read the way a voice reads it', lg.filter((x) => x.speak).at(-1).speak, {
    text: 'المبيعات: اليوم: 1250 جنيه. الأمس: 3400.50 جنيه.',
    language: 'ar',
  });
  eq('nothing to read', (await o.post('/assistant/speak', { text: ' ** ', language: 'ar' })).status, 400);
  eq('no such language', (await o.post('/assistant/speak', { text: 'hi', language: 'fr' })).status, 400);
} else console.log('  (voice not configured: start the API with Assistant__VoiceEndpoint=http://127.0.0.1:11434)');
eq('karim may not hear answers', (await karim.post('/assistant/speak', { text: 'hi', language: 'en' })).status, 403);
// Speaking a question: the recording goes to the server's speech service.
if (st.speechReady) {
  const fa = new FormData();
  fa.append('file', new Blob([new Uint8Array(2000)], { type: 'audio/webm' }), 'q.webm');
  const ra = await fetch(`${BASE}/assistant/transcribe`, { method: 'POST', headers: { authorization: `Bearer ${o.token}` }, body: fa });
  const ta = await ra.json();
  eq('a spoken question read back', [ra.status, ta.text], [200, 'كم رصيد النور؟']);
  const fl = new FormData();
  fl.append('file', new Blob([new Uint8Array(2000)], { type: 'audio/webm' }), 'q.webm');
  await fetch(`${BASE}/assistant/transcribe?language=ar`, { method: 'POST', headers: { authorization: `Bearer ${o.token}` }, body: fl });
  check('heard in the app\'s language', (await fake()).filter((x) => x[0] === 'asr').at(-1)[1].includes('language=ar'));
  const fe = new FormData();
  fe.append('file', new Blob([], { type: 'audio/webm' }), 'e.webm');
  eq('an empty recording', (await (await fetch(`${BASE}/assistant/transcribe`, { method: 'POST', headers: { authorization: `Bearer ${o.token}` }, body: fe })).json()).code, 'empty_audio');
} else console.log('  (speech service not configured: start the API with Assistant__SpeechEndpoint=http://127.0.0.1:11434)');
eq('karim may not transcribe', (await fetch(`${BASE}/assistant/transcribe`, { method: 'POST', headers: { authorization: `Bearer ${karim.token}` } })).status, 403);
// scans: a read starts and is then asked for until it is done (it reads on in the background)
async function readScan(res) {
  if (res.status !== 202) return { status: res.status, body: await res.json() };
  const { jobId } = await res.json();
  for (let i = 0; i < 100; i++) {
    const r = await fetch(`${BASE}/assistant/scan/jobs/${jobId}`, { headers: { authorization: `Bearer ${o.token}` } });
    if (r.status !== 202) return { status: r.status, body: await r.json(), jobId };
    await new Promise((ok) => setTimeout(ok, 200));
  }
  return { status: 0, body: null };
}
const fd = new FormData();
fd.append('file', new Blob([TINY], { type: 'image/png' }), 'p.png');
const r1 = await fetch(`${BASE}/assistant/scan/purchase`, {
  method: 'POST',
  headers: { authorization: `Bearer ${o.token}` },
  body: fd,
});
const s1 = await readScan(r1);
const p1 = s1.body;
check(
  'purchase scan',
  s1.status === 200 &&
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
const s2 = await readScan(r2);
const c2 = s2.body;
eq('only its owner may ask for a read', (await fetch(`${BASE}/assistant/scan/jobs/${s2.jobId}`, { headers: { authorization: `Bearer ${karim.token}` } })).status, 403);
check(
  'cheque scan',
  s2.status === 200 && c2.length === 2 && c2[0].amount === 5000 && c2[0].dueDate === '2026-11-01',
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
