/**
 * Seed a coherent wholesale-office dataset: branches, staff (incl. the owner), products,
 * parties, and sales/purchase documents whose totals tie back to the dashboard.
 * Idempotent: clears the business tables first, then re-creates.
 *
 * Money values are written in MINOR UNITS (piastres) — the `money()` helper converts.
 */
import { DocumentStatus, DocumentType, PartyType, PrismaClient, Role } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();
const CURRENCY = 'EGP';
const VAT_RATE = 0.14;

const money = (major: number): number => Math.round(major * 100);
const hash = (plain: string): Promise<string> => argon2.hash(plain, { type: argon2.argon2id });

function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(10, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

async function main(): Promise<void> {
  // --- Clear (respecting FK order) ----------------------------------------
  await prisma.documentLine.deleteMany();
  await prisma.salesDocument.deleteMany();
  await prisma.session.deleteMany();
  await prisma.auditEntry.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  await prisma.party.deleteMany();
  await prisma.staff.deleteMany();
  await prisma.branch.deleteMany();

  // --- Branches -----------------------------------------------------------
  const main = await prisma.branch.create({
    data: { name: 'Main Branch', code: 'MAIN', location: 'Cairo — Downtown' },
  });
  const warehouse = await prisma.branch.create({
    data: { name: 'Warehouse Branch', code: 'WH2', location: '6th of October — Industrial' },
  });

  // --- Staff --------------------------------------------------------------
  const ownerEmail = (process.env.SEED_OWNER_EMAIL ?? 'owner@skb.local').toLowerCase();
  const ownerPassword = process.env.SEED_OWNER_PASSWORD ?? 'ChangeMe!Owner123';
  const defaultPassword = 'ChangeMe!Staff123';

  const owner = await prisma.staff.create({
    data: {
      fullName: 'Founder Owner',
      email: ownerEmail,
      passwordHash: await hash(ownerPassword),
      role: Role.OWNER,
      branchId: main.id,
      phone: '+20 100 000 0001',
    },
  });
  const accountant = await prisma.staff.create({
    data: {
      fullName: 'Mona Accountant',
      email: 'mona@skb.local',
      passwordHash: await hash(defaultPassword),
      role: Role.ACCOUNTANT,
      branchId: main.id,
      phone: '+20 100 000 0002',
    },
  });
  const salesRep = await prisma.staff.create({
    data: {
      fullName: 'Karim Sales',
      email: 'karim@skb.local',
      passwordHash: await hash(defaultPassword),
      role: Role.SALES,
      branchId: main.id,
      phone: '+20 100 000 0003',
    },
  });
  await prisma.staff.create({
    data: {
      fullName: 'Sara Stock',
      email: 'sara@skb.local',
      passwordHash: await hash(defaultPassword),
      role: Role.INVENTORY,
      branchId: warehouse.id,
      phone: '+20 100 000 0004',
    },
  });

  // --- Categories & products ---------------------------------------------
  const beverages = await prisma.category.create({ data: { name: 'Beverages' } });
  const snacks = await prisma.category.create({ data: { name: 'Snacks' } });
  const cleaning = await prisma.category.create({ data: { name: 'Cleaning' } });
  const packaging = await prisma.category.create({ data: { name: 'Packaging' } });

  const products = await Promise.all([
    prisma.product.create({
      data: { sku: 'BEV-001', name: 'Mineral Water 1.5L (Pack of 6)', categoryId: beverages.id, unit: 'pack', costPrice: money(24), salePrice: money(33), currency: CURRENCY, stockOnHand: 480, reorderLevel: 100 },
    }),
    prisma.product.create({
      data: { sku: 'BEV-002', name: 'Cola 330ml (Case of 24)', categoryId: beverages.id, unit: 'case', costPrice: money(96), salePrice: money(126), currency: CURRENCY, stockOnHand: 60, reorderLevel: 80 },
    }),
    prisma.product.create({
      data: { sku: 'SNK-001', name: 'Salted Chips 25g (Box of 40)', categoryId: snacks.id, unit: 'box', costPrice: money(80), salePrice: money(112), currency: CURRENCY, stockOnHand: 140, reorderLevel: 50 },
    }),
    prisma.product.create({
      data: { sku: 'SNK-002', name: 'Biscuits Assorted (Box of 24)', categoryId: snacks.id, unit: 'box', costPrice: money(120), salePrice: money(168), currency: CURRENCY, stockOnHand: 18, reorderLevel: 40 },
    }),
    prisma.product.create({
      data: { sku: 'CLN-001', name: 'Dish Soap 1L (Pack of 12)', categoryId: cleaning.id, unit: 'pack', costPrice: money(144), salePrice: money(198), currency: CURRENCY, stockOnHand: 96, reorderLevel: 30 },
    }),
    prisma.product.create({
      data: { sku: 'CLN-002', name: 'Bleach 2L (Pack of 8)', categoryId: cleaning.id, unit: 'pack', costPrice: money(96), salePrice: money(140), currency: CURRENCY, stockOnHand: 12, reorderLevel: 25 },
    }),
    prisma.product.create({
      data: { sku: 'PKG-001', name: 'Carton Box Large (Bundle of 25)', categoryId: packaging.id, unit: 'bundle', costPrice: money(75), salePrice: money(110), currency: CURRENCY, stockOnHand: 300, reorderLevel: 60 },
    }),
    prisma.product.create({
      data: { sku: 'PKG-002', name: 'Stretch Wrap Roll', categoryId: packaging.id, unit: 'roll', costPrice: money(60), salePrice: money(92), currency: CURRENCY, stockOnHand: 8, reorderLevel: 20 },
    }),
  ]);

  // --- Parties (customers / suppliers / factories) ------------------------
  const c1 = await prisma.party.create({
    data: { name: 'Al-Nour Supermarket', types: [PartyType.CUSTOMER], phone: '+20 122 111 2222', email: 'buy@alnour.example', balance: money(18450), currency: CURRENCY },
  });
  const c2 = await prisma.party.create({
    data: { name: 'City Mart Chain', types: [PartyType.CUSTOMER], phone: '+20 122 333 4444', balance: money(7320), currency: CURRENCY },
  });
  const c3 = await prisma.party.create({
    data: { name: 'Green Valley Grocery', types: [PartyType.CUSTOMER], phone: '+20 122 555 6666', balance: 0, currency: CURRENCY },
  });
  const s1 = await prisma.party.create({
    data: { name: 'Delta Distribution Co.', types: [PartyType.SUPPLIER], phone: '+20 155 777 8888', balance: money(-9600), currency: CURRENCY },
  });
  const s2 = await prisma.party.create({
    data: { name: 'Nile Beverages Factory', types: [PartyType.SUPPLIER, PartyType.FACTORY], phone: '+20 155 999 0000', email: 'orders@nilebev.example', balance: money(-14250), currency: CURRENCY },
  });
  await prisma.party.create({
    data: { name: 'Pyramid Packaging Factory', types: [PartyType.FACTORY, PartyType.SUPPLIER], phone: '+20 155 121 3141', balance: money(-3200), currency: CURRENCY },
  });

  // --- Documents ----------------------------------------------------------
  type LineSpec = { productIndex: number; quantity: number; discountMajor?: number };
  let salesSeq = 0;
  let purchaseSeq = 0;

  async function createDoc(params: {
    type: DocumentType;
    status: DocumentStatus;
    partyId: string;
    staffId: string;
    branchId: string;
    issuedAgo: number;
    dueInDays?: number;
    lines: LineSpec[];
    paidRatio?: number;
  }): Promise<void> {
    const isPurchase = params.type === DocumentType.PURCHASE_INVOICE;
    const number = isPurchase
      ? `PUR-2026-${String(++purchaseSeq).padStart(6, '0')}`
      : `INV-2026-${String(++salesSeq).padStart(6, '0')}`;

    const lineData = params.lines.map((spec) => {
      const product = products[spec.productIndex]!;
      const unitPrice = isPurchase ? product.costPrice : product.salePrice;
      const discount = money(spec.discountMajor ?? 0);
      const lineTotal = spec.quantity * unitPrice - discount;
      return {
        productId: product.id,
        productName: product.name,
        quantity: spec.quantity,
        unitPrice,
        discount,
        lineTotal,
      };
    });

    const subtotal = lineData.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
    const discountTotal = lineData.reduce((s, l) => s + l.discount, 0);
    const taxable = subtotal - discountTotal;
    const taxTotal = Math.round(taxable * VAT_RATE);
    const grandTotal = taxable + taxTotal;
    const paidAmount = Math.round(grandTotal * (params.paidRatio ?? 0));

    const issueDate = daysAgo(params.issuedAgo);
    const dueDate =
      params.dueInDays !== undefined
        ? new Date(issueDate.getTime() + params.dueInDays * 86_400_000)
        : undefined;

    await prisma.salesDocument.create({
      data: {
        number,
        type: params.type,
        status: params.status,
        branchId: params.branchId,
        partyId: params.partyId,
        staffId: params.staffId,
        issueDate,
        dueDate,
        subtotal,
        discountTotal,
        taxTotal,
        grandTotal,
        paidAmount,
        currency: CURRENCY,
        lines: { create: lineData },
      },
    });
  }

  // Sales invoices spread across the last 7 days.
  await createDoc({ type: DocumentType.SALES_INVOICE, status: DocumentStatus.PAID, partyId: c1.id, staffId: salesRep.id, branchId: main.id, issuedAgo: 6, dueInDays: 30, paidRatio: 1, lines: [{ productIndex: 0, quantity: 40 }, { productIndex: 2, quantity: 10, discountMajor: 50 }] });
  await createDoc({ type: DocumentType.SALES_INVOICE, status: DocumentStatus.PARTIALLY_PAID, partyId: c2.id, staffId: salesRep.id, branchId: main.id, issuedAgo: 5, dueInDays: 30, paidRatio: 0.5, lines: [{ productIndex: 4, quantity: 12 }, { productIndex: 6, quantity: 20 }] });
  await createDoc({ type: DocumentType.SALES_INVOICE, status: DocumentStatus.CONFIRMED, partyId: c3.id, staffId: salesRep.id, branchId: main.id, issuedAgo: 4, dueInDays: 15, paidRatio: 0, lines: [{ productIndex: 1, quantity: 8 }, { productIndex: 3, quantity: 6 }] });
  await createDoc({ type: DocumentType.SALES_INVOICE, status: DocumentStatus.OVERDUE, partyId: c1.id, staffId: accountant.id, branchId: main.id, issuedAgo: 20, dueInDays: 7, paidRatio: 0, lines: [{ productIndex: 0, quantity: 24 }, { productIndex: 5, quantity: 5 }] });
  await createDoc({ type: DocumentType.SALES_INVOICE, status: DocumentStatus.PAID, partyId: c2.id, staffId: salesRep.id, branchId: main.id, issuedAgo: 3, dueInDays: 30, paidRatio: 1, lines: [{ productIndex: 2, quantity: 15 }] });
  await createDoc({ type: DocumentType.SALES_INVOICE, status: DocumentStatus.CONFIRMED, partyId: c3.id, staffId: salesRep.id, branchId: main.id, issuedAgo: 1, dueInDays: 30, paidRatio: 0, lines: [{ productIndex: 6, quantity: 30 }, { productIndex: 4, quantity: 6 }] });
  await createDoc({ type: DocumentType.SALES_INVOICE, status: DocumentStatus.PAID, partyId: c1.id, staffId: salesRep.id, branchId: main.id, issuedAgo: 0, dueInDays: 30, paidRatio: 1, lines: [{ productIndex: 0, quantity: 12 }, { productIndex: 2, quantity: 8 }] });

  // Purchase invoices from suppliers/factories.
  await createDoc({ type: DocumentType.PURCHASE_INVOICE, status: DocumentStatus.CONFIRMED, partyId: s1.id, staffId: accountant.id, branchId: warehouse.id, issuedAgo: 5, dueInDays: 45, paidRatio: 0, lines: [{ productIndex: 4, quantity: 30 }, { productIndex: 6, quantity: 40 }] });
  await createDoc({ type: DocumentType.PURCHASE_INVOICE, status: DocumentStatus.PARTIALLY_PAID, partyId: s2.id, staffId: accountant.id, branchId: warehouse.id, issuedAgo: 2, dueInDays: 45, paidRatio: 0.4, lines: [{ productIndex: 0, quantity: 100 }, { productIndex: 1, quantity: 20 }] });

  const counts = {
    branches: await prisma.branch.count(),
    staff: await prisma.staff.count(),
    products: await prisma.product.count(),
    parties: await prisma.party.count(),
    documents: await prisma.salesDocument.count(),
  };
  // eslint-disable-next-line no-console
  console.log('Seed complete:', counts, `\nOwner login: ${ownerEmail} / ${ownerPassword}`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
