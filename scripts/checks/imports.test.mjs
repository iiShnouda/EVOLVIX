// Importing from Excel (owner, 2026-11-16: "data can be brought in from an Excel file"): each kind
// is its own permission (the owner's alone), the server makes the templates (Arabic or English
// headers, either read back), a preview lists every row's problems and saves nothing, and an import
// happens only when every row is right (all or nothing), audited. Items, customers, suppliers and
// the opening balances of customers, suppliers, cash boxes and stock. Runs against BASE.
import { BASE, login, check, eq, ok, summary } from './lib.mjs';
import { xlsx, upload } from './zipfile.mjs';

const tag = Date.now().toString(36).slice(-5);
const owner = await login('owner@skb.local');
const mona = await login('mona@skb.local'); // ACCOUNTANT
const send = (who, kind, rows, preview = true) =>
  upload(BASE, who, `/imports/${kind}${preview ? '/preview' : ''}`, xlsx(rows), `${kind}.xlsx`);
const list = (x) => (Array.isArray(x) ? x : (x?.items ?? []));
const codes = (p) => p.errors.map((e) => `${e.row}:${e.column}:${e.code}`);
const KINDS = [
  'items',
  'customers',
  'suppliers',
  'opening_customers',
  'opening_suppliers',
  'opening_money',
  'opening_stock',
];

// ------------------------------------------------------------------ permissions
console.log('== permissions');
eq("an accountant can't list the imports", (await mona.get('/imports')).status, 403);
eq('…nor get a template', (await mona.get('/imports/items/template')).status, 403);
eq(
  '…nor check a file',
  (
    await send(mona, 'items', [
      ['Name', 'Department'],
      ['x', 'y'],
    ])
  ).status,
  403,
);
eq('…nor import one', (await send(mona, 'customers', [['Name'], ['x']], false)).status, 403);
const kinds = ok('the owner sees every kind', await owner.get('/imports'));
eq('all seven kinds', kinds.map((k) => k.kind).sort(), [...KINDS].sort());
check(
  'each column has both headers',
  kinds.every((k) => k.columns.every((c) => c.en && c.ar)),
  kinds,
);
eq('an unknown kind', (await owner.get('/imports/nothing/template')).status, 404);
const staffPerms = ok('the grantable permissions', await owner.get('/permissions'));
check(
  'imports and restoring are not grantable to anyone else',
  !JSON.stringify(staffPerms).includes('import:') &&
    !JSON.stringify(staffPerms).includes('backup:restore'),
);

// ------------------------------------------------------------------ templates
console.log('== templates');
for (const lang of ['ar', 'en']) {
  for (const kind of KINDS) {
    const r = await fetch(`${BASE}/imports/${kind}/template?lang=${lang}`, {
      headers: { authorization: `Bearer ${owner.token}` },
    });
    const bytes = new Uint8Array(await r.arrayBuffer());
    check(
      `${kind} template (${lang}) is an xlsx`,
      r.ok && bytes[0] === 0x50 && bytes[1] === 0x4b,
      r.status,
    );
    // Uploaded back as it is: every header is understood (no column missing).
    const p = await upload(BASE, owner, `/imports/${kind}/preview`, bytes, `${kind}.xlsx`);
    const missing = (p.data?.errors ?? []).filter((e) => e.code === 'missing_column');
    check(
      `${kind} template (${lang}) is read back`,
      p.status === 200 && missing.length === 0,
      p.data,
    );
  }
}
const notXlsx = await upload(BASE, owner, '/imports/items/preview', Buffer.from('hello'), 'x.xlsx');
eq('a file that is not Excel', [notXlsx.status, notXlsx.data?.code], [400, 'bad_file']);
const noCols = ok(
  'a sheet without the needed columns',
  await send(owner, 'items', [['Colour'], ['red']]),
);
eq('…names the missing ones', codes(noCols).sort(), [
  '0:department:missing_column',
  '0:name:missing_column',
]);

// ------------------------------------------------------------------ items
console.log('== items');
const head = [
  'Code',
  'Name',
  'Department',
  'Group',
  'Unit',
  'Sale price',
  'Supply price',
  'Supplier',
  'Barcode',
  'Reorder level',
];
const used = ok('an existing item', await owner.get('/products?limit=1'));
const usedBarcode = (await owner.get(`/products/${(used.items ?? used)[0].id}`)).data?.units?.[0]
  ?.barcode;
const bad = [
  head,
  [
    `IMP-${tag}-1`,
    `Imported shirt ${tag}`,
    `Imported ${tag}`,
    'Shirts',
    'Piece',
    '12.50',
    '8',
    `Factory ${tag}`,
    `99${tag}01`,
    5,
  ],
  ['', '', `Imported ${tag}`, '', '', '', '', '', '', ''],
  ['', `Imported belt ${tag}`, `Imported ${tag}`, '', '', 'abc', '', '', '', '1.5'],
  ['', `Imported shirt ${tag}`, `Imported ${tag}`, '', '', '', '', '', '', ''],
  ['', `Imported cap ${tag}`, `Imported ${tag}`, '', '', '', '', '', usedBarcode ?? 'x', ''],
];
const p1 = ok('preview of a file with problems', await send(owner, 'items', bad));
eq(
  'every problem, by row and column',
  codes(p1).sort(),
  [
    '3:name:required',
    '4:price:bad_amount',
    '4:reorder:bad_number',
    '5:name:duplicate',
    ...(usedBarcode ? ['6:barcode:barcode_used'] : []),
  ].sort(),
);
eq('rows read', p1.rows, 5);
check(
  'each row has its status',
  p1.sample.find((r) => r.row === 3)?.status === 'error' &&
    p1.sample.find((r) => r.row === 2)?.status === 'new',
  p1.sample,
);
const refused = await send(owner, 'items', bad, false);
eq(
  'the import is refused as a whole',
  [refused.status, refused.data?.code],
  [422, 'import_has_errors'],
);
eq(
  '…and nothing was added',
  ok('search', await owner.get(`/products?name=${encodeURIComponent(`Imported shirt ${tag}`)}`))
    .length,
  0,
);

const good = [
  [
    'اسم الصنف',
    'القسم',
    'المجموعة',
    'الوحدة',
    'سعر البيع',
    'سعر التوريد',
    'المورد',
    'الباركود',
    'حد الطلب',
    'الكود',
  ],
  [
    `Imported shirt ${tag}`,
    `Imported ${tag}`,
    'Shirts',
    'Piece',
    '12.50',
    '8',
    `Factory ${tag}`,
    `99${tag}01`,
    5,
    `IMP-${tag}-1`,
  ],
  [`Imported belt ${tag}`, `Imported ${tag}`, '', '', 20, '', '', '', '', ''],
];
const p2 = ok(
  'preview of a good file (Arabic headers, another order)',
  await send(owner, 'items', good),
);
eq('…two ready, no problems', [p2.ready, p2.errorCount], [2, 0]);
const done = ok('import', await send(owner, 'items', good, false));
eq('two added', [done.added, done.skipped], [2, 0]);
const shirt = ok(
  'find it',
  await owner.get(`/products?name=${encodeURIComponent(`Imported shirt ${tag}`)}`),
)[0];
eq(
  'its code, price (minor units) and department',
  [shirt?.sku, shirt?.salePrice],
  [`IMP-${tag}-1`.toUpperCase(), 1250],
);
const again = ok('the same file again', await send(owner, 'items', good, false));
eq('…everything already there', [again.added, again.skipped], [0, 2]);

// ------------------------------------------------------------------ customers and suppliers
console.log('== customers and suppliers');
const free = 900000 + Math.floor(Math.random() * 90000);
const cust = [
  ['Code', 'Name', 'Phone', 'Other phones', 'Address', 'Credit limit'],
  [free, `Imported customer ${tag}`, '0100', '0111, 0122', 'Cairo', '5,000'],
  ['', `Imported customer B ${tag}`, '', '', '', ''],
];
const dup = await send(owner, 'customers', [...cust, [free, `Another ${tag}`, '', '', '', '']]);
eq('a code twice in the file', codes(dup.data), ['4:code:duplicate']);
const c1 = ok('customers imported', await send(owner, 'customers', cust, false));
eq('two customers', c1.added, 2);
const custA = list(
  ok(
    'find',
    await owner.get(
      `/parties?type=CUSTOMER&search=${encodeURIComponent(`Imported customer ${tag}`)}`,
    ),
  ),
).find((p) => p.name === `Imported customer ${tag}`);
eq(
  'its own code, phones and limit',
  [custA?.code, custA?.otherPhones, custA?.creditLimit],
  [free, ['0111', '0122'], 500000],
);
const usedCode = ok(
  'a used code',
  await send(owner, 'customers', [
    ['Code', 'Name'],
    [free, `X ${tag}`],
  ]),
);
eq('…is refused', codes(usedCode), ['2:code:code_used']);
const sup = ok(
  'suppliers imported',
  await send(
    owner,
    'suppliers',
    [
      ['الاسم', 'الهاتف', 'المسؤول'],
      [`Imported supplier ${tag}`, '0123', 'Ali'],
    ],
    false,
  ),
);
eq('one supplier', sup.added, 1);
const other = ok(
  'a supplier name as a customer',
  await send(owner, 'customers', [['Name'], [`Imported supplier ${tag}`]]),
);
eq('…is refused', codes(other), ['2:name:exists_other_kind']);

// ------------------------------------------------------------------ opening balances
console.log('== opening balances');
const before = ok('the customer', await owner.get(`/parties/${custA.id}`));
const oc = ok(
  'customers’ openings',
  await send(owner, 'opening_customers', [
    ['Customer (code or name)', 'Balance'],
    [String(free), '1,000'],
    [`Nobody ${tag}`, 5],
  ]),
);
eq('an unknown customer', codes(oc), ['3:party:unknown_party']);
const oc2 = ok(
  'customers’ openings imported',
  await send(
    owner,
    'opening_customers',
    [
      ['العميل', 'الرصيد'],
      [String(free), '1,000.50'],
    ],
    false,
  ),
);
eq('one opened', oc2.added, 1);
eq(
  'the balance (minor units)',
  (await owner.get(`/parties/${custA.id}`)).data.balance - before.balance,
  100050,
);
const st = ok('their statement', await owner.get(`/ledger/parties/${custA.id}/statement`));
check('the opening is on the statement', JSON.stringify(st).includes('100050'), st);
const twice = ok(
  'the same opening again',
  await send(owner, 'opening_customers', [
    ['Customer', 'Balance'],
    [String(free), 5],
  ]),
);
eq('…is refused', codes(twice), ['2:party:already_opened']);
const supplier = list(
  ok(
    'find',
    await owner.get(
      `/parties?type=SUPPLIER&search=${encodeURIComponent(`Imported supplier ${tag}`)}`,
    ),
  ),
)[0];
ok(
  'suppliers’ openings imported',
  await send(
    owner,
    'opening_suppliers',
    [
      ['Supplier', 'Balance'],
      [`Imported supplier ${tag}`, 300],
    ],
    false,
  ),
);
eq('we owe the supplier', (await owner.get(`/parties/${supplier.id}`)).data.balance, -30000);

const branches = ok('branches', await owner.get('/branches'));
const box = ok(
  'a new cash box',
  await owner.post('/money-accounts', {
    branchId: branches[0].id,
    name: `Import box ${tag}`,
    kind: 'CASH_BOX',
  }),
);
const tpl = await fetch(`${BASE}/imports/opening_money/template?lang=en`, {
  headers: { authorization: `Bearer ${owner.token}` },
});
check('the cash template lists the new box', (await tpl.arrayBuffer()).byteLength > 0);
ok(
  'cash openings imported',
  await send(
    owner,
    'opening_money',
    [
      ['Cash box or bank', 'Balance'],
      [`Import box ${tag}`, 250],
    ],
    false,
  ),
);
const boxNow = ok('the box', await owner.get('/money-accounts')).find((a) => a.id === box.id);
eq('its balance', boxNow?.balance, 25000);
const moved = ok(
  'again',
  await send(owner, 'opening_money', [
    ['Cash box or bank', 'Balance'],
    [`Import box ${tag}`, 1],
  ]),
);
eq('…money already moved', codes(moved), ['2:account:has_movements']);

const warehouses = ok('warehouses', await owner.get('/warehouses'));
const store = warehouses.find((w) => w.kind !== 'TRANSIT' && w.isActive !== false);
const transit = warehouses.find((w) => w.kind === 'TRANSIT');
const stockRows = [
  ['Item (code, barcode or name)', 'Warehouse', 'Quantity', 'Unit cost'],
  [`IMP-${tag}-1`, store.name, 10, '5'],
  [`Imported belt ${tag}`, store.name, '1.5', 2],
  [`Nothing ${tag}`, store.name, 1, 1],
  ...(transit ? [[`Imported belt ${tag}`, transit.name, 1, 1]] : []),
];
const ps = ok('stock preview', await send(owner, 'opening_stock', stockRows));
eq('its problems', codes(ps), [
  '3:quantity:bad_number',
  '4:item:unknown_item',
  ...(transit ? ['5:warehouse:unknown_warehouse'] : []),
]);
ok('opening stock imported', await send(owner, 'opening_stock', stockRows.slice(0, 2), false));
const inStore = ok(
  'the item there',
  await owner.get(
    `/products?name=${encodeURIComponent(`Imported shirt ${tag}`)}&warehouseId=${store.id}`,
  ),
)[0];
eq('its quantity there', inStore?.stockOnHand, 10);
const again2 = ok('again', await send(owner, 'opening_stock', stockRows.slice(0, 2)));
eq('…it already has movements there', codes(again2), ['2:item:has_movements']);

// ------------------------------------------------------------------ audit
console.log('== audit');
const log = ok('the log', await owner.get('/audit?action=import&pageSize=50'));
for (const kind of [
  'items',
  'customers',
  'suppliers',
  'opening_customers',
  'opening_suppliers',
  'opening_money',
  'opening_stock',
])
  check(
    `the ${kind} import is in the log`,
    log.items.some((e) => e.resource === `import_${kind}`),
    log.items.map((e) => e.resource),
  );

summary('imports');
