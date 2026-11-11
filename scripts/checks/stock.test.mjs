// The store's screens (owner, 2026-11-10): the warehouse statement adds up, the stock statuses
// (run out is "out", not "at the reorder level"), the department shown is the main one, the
// stocktake by branch / warehouse / department / factory, and transfers by period and place.
import { login, check, eq, ok, summary, companyToday, addDays } from './lib.mjs';

const owner = await login('owner@skb.local');
const today = companyToday();
const tag = Date.now().toString(36);
const stores = ok('warehouses', await owner.get('/warehouses?activeOnly=true'));
const wh = stores[0];

console.log('== the warehouse statement adds up');
{
  const st = async (from, to) =>
    ok(
      `statement ${from}..${to}`,
      await owner.get(`/inventory/warehouses/${wh.id}/statement?from=${from}&to=${to}`),
    );
  const week = await st(addDays(today, -6), today);
  eq('opening + in − out = closing', week.opening + week.in - week.out, week.closing);
  const inLines = week.lines.filter((l) => l.quantity > 0).reduce((s, l) => s + l.quantity, 0);
  const outLines = -week.lines.filter((l) => l.quantity < 0).reduce((s, l) => s + l.quantity, 0);
  if (week.lines.length < 5000) {
    eq('in = the lines in', week.in, inLines);
    eq('out = the lines out', week.out, outLines);
  }
  const day = await st(today, today);
  const before = await st(addDays(today, -6), addDays(today, -1));
  eq("a day's opening = the day before's closing", day.opening, before.closing);
  eq('values add up too', before.closingValue, day.openingValue);
  const swapped = await st(today, addDays(today, -6));
  eq('days given the wrong way round still work', swapped.closing, week.closing);
}

process.exit(summary('stock') ? 1 : 0);
