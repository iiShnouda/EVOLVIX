// The bell across the program (owner, 2026-11-12): each kind goes only to whoever holds its
// permission and may see the place, never to whoever did it, and not to whoever switched it off;
// stock and cheque notices are told once; the daily summary is scoped to each person; the list
// reads, deletes and pages. Runs against BASE (a Development server: /notifications/run-daily).
import { BASE, login, check, eq, ok, summary, companyToday, addDays } from './lib.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const mona = await login('mona@skb.local'); // ACCOUNTANT: cheques, stock, journal, transfers
const karim = await login('karim@skb.local'); // SALES: none of those
const sara = await login('sara@skb.local'); // INVENTORY in another branch: stock
const mainId = owner.user.branchId;
const today = companyToday();

const bell = async (who, q = '') => ok('the bell', await who.get(`/notifications${q}`));
const told = async (who, kind, id) =>
  (await bell(who)).items.filter((n) => n.kind === kind && (!id || n.documentId === id));

const units = (await owner.get('/units')).data;
const piece = units.find((u) => ['قطعة', 'Piece'].includes(u.name));
const cat = (await owner.get('/categories')).data[0];
const level = (await owner.get('/price-levels')).data.find((l) => l.side === 'SALE' && l.isDefault);
const wh = (await owner.get('/warehouses')).data.find((w) => w.isDefault && w.branchId === mainId);
const cust = ok(
  'a customer',
  await owner.post('/parties', { name: `NotCust ${tag}`, types: ['CUSTOMER'] }),
);
const supp = ok(
  'a supplier',
  await owner.post('/parties', { name: `NotSupp ${tag}`, types: ['SUPPLIER'] }),
);
const item = ok(
  'an item, reorder at 5',
  await owner.post('/products', {
    name: `NotItem ${tag}`,
    categoryId: cat.id,
    reorderLevel: 5,
    units: [{ unitId: piece.id, factor: 1 }],
    prices: [{ unitId: piece.id, priceLevelId: level.id, price: 2000 }],
  }),
);
const buy = async (qty) =>
  ok(
    `buy ${qty}`,
    await owner.post('/purchases/invoices', {
      partyId: supp.id,
      warehouseId: wh.id,
      taxPercent: 0,
      lines: [{ productId: item.id, quantity: qty, unitCost: 1000 }],
    }),
  );
const sell = async (who, qty) =>
  ok(
    `sell ${qty}`,
    await who.post('/sales/invoices', {
      partyId: cust.id,
      warehouseId: wh.id,
      taxPercent: 0,
      lines: [{ productId: item.id, quantity: qty, unitPrice: 2000 }],
    }),
  );

console.log('== stock: reorder level, out of stock, once until restocked');
await buy(8);
await sell(owner, 3);
eq(
  'down to its reorder level: the accountant is told',
  (await told(mona, 'STOCK_LOW', item.id)).length,
  1,
);
eq(
  'not the stock keeper of another branch (not her store)',
  (await told(sara, 'STOCK_LOW', item.id)).length,
  0,
);
eq('not the seller (who did it)', (await told(owner, 'STOCK_LOW', item.id)).length, 0);
eq('not sales staff (no stock notices)', (await told(karim, 'STOCK_LOW', item.id)).length, 0);
await sell(owner, 1);
eq('lower still: not told again', (await told(mona, 'STOCK_LOW', item.id)).length, 1);
await sell(owner, 4);
const out1 = await told(mona, 'STOCK_OUT', item.id);
eq('the last piece left: out of stock', out1.length, 1);
eq('…with the store', out1[0]?.departmentName, wh.name);
await buy(10);
await sell(owner, 10);
eq('restocked and run out again: told again', (await told(mona, 'STOCK_OUT', item.id)).length, 2);
await buy(20);

console.log('== an approved pending invoice, a return on my invoice');
const inv = await sell(karim, 2);
check(
  'a new invoice: the collector (accountant) is told',
  (await told(mona, 'INVOICE_NEW', inv.id)).length === 1,
);
eq('…not its maker', (await told(karim, 'INVOICE_NEW', inv.id)).length, 0);
const detail = ok('the invoice', await owner.get(`/sales/invoices/${inv.id}`));
const ret = ok(
  'the owner takes one back',
  await owner.confirmed().post(`/sales/invoices/${inv.id}/returns`, {
    lines: [{ lineId: detail.lines[0].id, quantity: 1 }],
  }),
);
const r = await told(karim, 'RETURN_MADE', ret.id);
eq('the invoice maker hears of the return', r.length, 1);
eq('…naming the invoice', r[0]?.data?.invoice, inv.number);
eq('…not the one who took it back', (await told(owner, 'RETURN_MADE', ret.id)).length, 0);

console.log('== cheques: due soon and overdue (once each), bounced');
const note = (dueDate, serial) =>
  owner.post('/notes/receive', {
    partyId: cust.id,
    kind: 'CHEQUE',
    serialNumber: serial,
    amount: 3000,
    dueDate,
    bankName: 'CIB',
  });
const soon = ok('a cheque due tomorrow', await note(addDays(today, 1), `S${tag}`));
const late = ok('a cheque due yesterday', await note(addDays(today, -1), `L${tag}`));
const far = ok('a cheque due next month', await note(addDays(today, 40), `F${tag}`));
eq(
  "sales staff can't run the daily jobs",
  (await karim.post('/notifications/run-daily')).status,
  403,
);
const run1 = ok('run the daily jobs', await owner.post('/notifications/run-daily'));
check('…some cheques told of', run1.notes >= 2, run1);
eq('due soon: the accountant is told', (await told(mona, 'NOTE_DUE', soon.id)).length, 1);
eq('overdue: told', (await told(mona, 'NOTE_OVERDUE', late.id)).length, 1);
eq('the owner too (no one did it)', (await told(owner, 'NOTE_DUE', soon.id)).length, 1);
eq('not one due next month', (await told(mona, 'NOTE_DUE', far.id)).length, 0);
eq('not sales staff', (await told(karim, 'NOTE_DUE', soon.id)).length, 0);
check(
  '…with its due day',
  (await told(mona, 'NOTE_DUE', soon.id))[0]?.data?.due === addDays(today, 1),
);
ok('run them again', await owner.post('/notifications/run-daily'));
eq('each stage told once', (await told(mona, 'NOTE_DUE', soon.id)).length, 1);
eq('…overdue too', (await told(mona, 'NOTE_OVERDUE', late.id)).length, 1);
ok('the late one bounces', await owner.post(`/notes/${late.id}/bounce`, {}));
eq('bounced: the accountant is told', (await told(mona, 'NOTE_BOUNCED', late.id)).length, 1);
eq('…not the one who marked it', (await told(owner, 'NOTE_BOUNCED', late.id)).length, 0);

console.log('== my choices');
const prefs = ok('my choices', await mona.get('/notifications/preferences'));
check(
  'cheque notices are offered to the accountant',
  prefs.offered.includes('NOTE_BOUNCED'),
  prefs.offered,
);
const kp = ok("sales staff's choices", await karim.get('/notifications/preferences'));
check(
  '…not to sales staff',
  !kp.offered.includes('NOTE_DUE') && kp.offered.includes('ORDER_APPROVED'),
  kp.offered,
);
const saved = ok(
  'switch bounced cheques and new sign-ins off, sound off',
  await mona.put('/notifications/preferences', {
    off: ['NOTE_BOUNCED', 'NEW_SIGNIN', 'NOPE'],
    sound: false,
  }),
);
eq('only what may be switched off is', saved.off, ['NOTE_BOUNCED']);
eq('sound off', saved.sound, false);
ok('the soon one bounces', await owner.post(`/notes/${soon.id}/bounce`, {}));
eq('switched off: not told', (await told(mona, 'NOTE_BOUNCED', soon.id)).length, 0);
ok('back on', await mona.put('/notifications/preferences', { off: [], sound: true }));

console.log('== transfers waiting to be received');
const branches = (await owner.get('/branches')).data;
const other = (await owner.get('/warehouses')).data.find(
  (w) => w.branchId !== mainId && w.kind === 'STORE',
);
const before = (await owner.get('/settings')).data.transfersRequireReceipt;
ok('receipt needed', await owner.put('/settings', { transfersRequireReceipt: true }));
const tr = ok(
  'send 2 to another branch',
  await owner.post('/transfers', {
    fromWarehouseId: wh.id,
    toWarehouseId: other.id,
    lines: [{ productId: item.id, quantity: 2 }],
  }),
);
eq('whoever receives there is told', (await told(mona, 'TRANSFER_SENT', tr.id)).length, 1);
eq('not the sender', (await told(owner, 'TRANSFER_SENT', tr.id)).length, 0);
ok('received', await mona.post(`/transfers/${tr.id}/receive`));
eq('the sender hears it arrived', (await told(owner, 'TRANSFER_RECEIVED', tr.id)).length, 1);
ok('setting back', await owner.put('/settings', { transfersRequireReceipt: before }));
check('(two branches)', branches.length >= 2);

console.log('== the books');
ok('lock the period', await owner.put('/ledger/lock', { lockDate: addDays(today, -400) }));
const lk = (await bell(mona)).items.find((n) => n.kind === 'PERIOD_LOCK');
eq('the accountant hears of the lock', lk?.data?.date, addDays(today, -400));
eq('not the owner who did it', (await told(owner, 'PERIOD_LOCK')).length, 0);
ok('open it', await owner.put('/ledger/lock', { lockDate: '' }));

console.log('== the daily summary');
const run2 = ok(
  'run the summary for today',
  await owner.post('/notifications/run-daily', { day: today }),
);
check('someone got it', run2.summaries >= 1, run2);
const sum = (await told(owner, 'DAILY_SUMMARY'))[0];
check('the owner has it', !!sum);
check(
  "…with today's sales",
  sum?.data?.day === today && sum.data.sales?.count >= 1 && sum.data.sales.total > 0,
  sum?.data,
);
check('…the cash boxes', Array.isArray(sum?.data?.boxes), sum?.data);
check(
  '…cheques and stock',
  !!sum?.data?.cheques && typeof sum?.data?.stock?.out === 'number',
  sum?.data,
);
eq('the accountant has no summary permission: none', (await told(mona, 'DAILY_SUMMARY')).length, 0);
const st = (await owner.get('/settings')).data;
eq('the summary time is a setting (21:00)', st.dailySummaryMinute, 21 * 60);
ok('turn it off', await owner.put('/settings', { dailySummaryMinute: -1, noteAlertDays: 5 }));
const st2 = (await owner.get('/settings')).data;
eq('off', [st2.dailySummaryMinute, st2.noteAlertDays], [null, 5]);
eq(
  "sales staff can't change it",
  (await karim.put('/settings', { dailySummaryMinute: 600 })).status,
  403,
);
ok(
  'back to 21:00',
  await owner.put('/settings', { dailySummaryMinute: 21 * 60, noteAlertDays: 3 }),
);

console.log('== read, delete, pages, only mine');
const mine = await bell(mona);
check('unread are counted', mine.unread > 0, mine.unread);
const first = mine.items[0];
ok('read one', await mona.post(`/notifications/${first.id}/read`), [204]);
eq("someone else's can't be deleted", (await karim.del(`/notifications/${first.id}`)).status, 204);
check(
  '…and is still there',
  (await bell(mona)).items.some((n) => n.id === first.id),
);
ok('delete one', await mona.del(`/notifications/${first.id}`), [204]);
check('gone', !(await bell(mona)).items.some((n) => n.id === first.id));
const only = await bell(mona, '?unread=true');
check(
  'unread only',
  only.items.every((n) => !n.read),
);
const p1 = await bell(owner);
if (p1.more) {
  const p2 = await bell(owner, `?before=${p1.items[p1.items.length - 1].id}`);
  check(
    'the next page is older',
    p2.items.every((n) => n.createdAt <= p1.items[p1.items.length - 1].createdAt),
  );
}
ok('read all', await mona.post('/notifications/read-all'), [204]);
eq('none unread', (await bell(mona)).unread, 0);
ok('clear the read ones', await mona.del('/notifications/read'), [204]);
eq('none left', (await bell(mona)).items.length, 0);

console.log('== a new device on my account');
const email = `notif.${tag}@skb.local`;
ok(
  'a person',
  await owner.post('/staff', {
    fullName: `Notif ${tag}`,
    email,
    password: 'Str0ngPass!',
    role: 'SALES',
    branchId: mainId,
  }),
);
const signIn = async (ua) => {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': ua },
    body: JSON.stringify({ email, password: 'Str0ngPass!' }),
  });
  return (await r.json()).accessToken;
};
const look = async (token) =>
  (
    await (
      await fetch(`${BASE}/notifications`, { headers: { authorization: `Bearer ${token}` } })
    ).json()
  ).items;
const t1 = await signIn('CheckBrowser/1.0 (X11; Linux)');
eq(
  'the first sign-in is not news',
  (await look(t1)).filter((n) => n.kind === 'NEW_SIGNIN').length,
  0,
);
const t2 = await signIn('CheckBrowser/2.5 (X11; Linux)');
eq(
  'the same browser, updated: not news',
  (await look(t2)).filter((n) => n.kind === 'NEW_SIGNIN').length,
  0,
);
const t3 = await signIn('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148');
eq('another device: told', (await look(t3)).filter((n) => n.kind === 'NEW_SIGNIN').length, 1);

summary('notify');
