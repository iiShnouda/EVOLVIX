import { Injectable } from '@nestjs/common';
import type { AuthUser, DashboardData, KpiValue, SalesDocumentSummary, TrendPoint } from '@skb/shared';
import { PrismaService } from '../prisma/prisma.service';
import { branchScope } from '../common/scope';
import { toSummary } from '../sales/sales.mapper';

const DEFAULT_CURRENCY = 'EGP';
const TREND_DAYS = 7;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(user: AuthUser): Promise<DashboardData> {
    const scope = branchScope(user);

    const [revenueAgg, purchasesAgg, parties, lowStock, recent] = await Promise.all([
      this.prisma.salesDocument.aggregate({
        _sum: { grandTotal: true },
        where: { ...scope, type: 'SALES_INVOICE', status: { not: 'CANCELLED' } },
      }),
      this.prisma.salesDocument.aggregate({
        _sum: { grandTotal: true },
        where: { ...scope, type: 'PURCHASE_INVOICE', status: { not: 'CANCELLED' } },
      }),
      this.prisma.party.findMany({ select: { balance: true } }),
      this.prisma.product.findMany({
        where: { isActive: true },
        include: { category: true },
      }),
      this.prisma.salesDocument.findMany({
        where: { ...scope },
        orderBy: { issueDate: 'desc' },
        take: 6,
        include: { branch: true, party: true, staff: true },
      }),
    ]);

    const receivables = parties.reduce((sum, p) => (p.balance > 0 ? sum + p.balance : sum), 0);
    const payables = parties.reduce((sum, p) => (p.balance < 0 ? sum - p.balance : sum), 0);
    const lowStockItems = lowStock.filter((p) => p.stockOnHand <= p.reorderLevel);

    const kpis: KpiValue[] = [
      {
        key: 'kpi.revenue',
        value: revenueAgg._sum.grandTotal ?? 0,
        isMoney: true,
        currency: DEFAULT_CURRENCY,
        tone: 'positive',
      },
      {
        key: 'kpi.purchases',
        value: purchasesAgg._sum.grandTotal ?? 0,
        isMoney: true,
        currency: DEFAULT_CURRENCY,
        tone: 'info',
      },
      {
        key: 'kpi.receivables',
        value: receivables,
        isMoney: true,
        currency: DEFAULT_CURRENCY,
        tone: 'positive',
      },
      {
        key: 'kpi.payables',
        value: payables,
        isMoney: true,
        currency: DEFAULT_CURRENCY,
        tone: 'warning',
      },
      {
        key: 'kpi.lowStock',
        value: lowStockItems.length,
        isMoney: false,
        tone: lowStockItems.length > 0 ? 'destructive' : 'neutral',
      },
      {
        key: 'kpi.cashPosition',
        value: (revenueAgg._sum.grandTotal ?? 0) - (purchasesAgg._sum.grandTotal ?? 0),
        isMoney: true,
        currency: DEFAULT_CURRENCY,
        tone: 'neutral',
      },
    ];

    return {
      kpis,
      trend: await this.buildTrend(user),
      lowStock: lowStockItems.map((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        categoryId: p.categoryId,
        unit: p.unit,
        costPrice: p.costPrice,
        salePrice: p.salePrice,
        currency: p.currency,
        stockOnHand: p.stockOnHand,
        reorderLevel: p.reorderLevel,
        barcode: p.barcode ?? undefined,
        isActive: p.isActive,
      })),
      recentDocuments: recent.map<SalesDocumentSummary>(toSummary),
      currency: DEFAULT_CURRENCY,
    };
  }

  private async buildTrend(user: AuthUser): Promise<TrendPoint[]> {
    const scope = branchScope(user);
    const since = new Date();
    since.setDate(since.getDate() - (TREND_DAYS - 1));
    since.setHours(0, 0, 0, 0);

    const docs = await this.prisma.salesDocument.findMany({
      where: {
        ...scope,
        issueDate: { gte: since },
        type: { in: ['SALES_INVOICE', 'PURCHASE_INVOICE'] },
        status: { not: 'CANCELLED' },
      },
      select: { issueDate: true, type: true, grandTotal: true },
    });

    const buckets = new Map<string, { sales: number; purchases: number }>();
    for (let i = 0; i < TREND_DAYS; i++) {
      const d = new Date(since);
      d.setDate(since.getDate() + i);
      buckets.set(d.toISOString().slice(0, 10), { sales: 0, purchases: 0 });
    }
    for (const doc of docs) {
      const key = doc.issueDate.toISOString().slice(0, 10);
      const bucket = buckets.get(key);
      if (!bucket) continue;
      if (doc.type === 'SALES_INVOICE') bucket.sales += doc.grandTotal;
      else bucket.purchases += doc.grandTotal;
    }
    return Array.from(buckets.entries()).map(([date, v]) => ({ date, ...v }));
  }
}
