import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  AuthUser,
  Paginated,
  SalesDocument,
  SalesDocumentSummary,
  SalesListQuery,
} from '@skb/shared';
import { PrismaService } from '../prisma/prisma.service';
import { branchScope } from '../common/scope';
import { toDetail, toSummary } from './sales.mapper';

@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, query: SalesListQuery): Promise<Paginated<SalesDocumentSummary>> {
    const where: Prisma.SalesDocumentWhereInput = {
      ...branchScope(user),
      type: 'SALES_INVOICE',
    };
    if (query.status) where.status = query.status as Prisma.SalesDocumentWhereInput['status'];
    if (query.search) {
      where.OR = [
        { number: { contains: query.search, mode: 'insensitive' } },
        { party: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const [total, rows] = await Promise.all([
      this.prisma.salesDocument.count({ where }),
      this.prisma.salesDocument.findMany({
        where,
        include: { branch: true, party: true, staff: true },
        orderBy: { issueDate: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      items: rows.map(toSummary),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async getOne(user: AuthUser, id: string): Promise<SalesDocument> {
    const doc = await this.prisma.salesDocument.findFirst({
      where: { id, ...branchScope(user) },
      include: { branch: true, party: true, staff: true, lines: true },
    });
    if (!doc) throw new NotFoundException('Document not found');
    return toDetail(doc);
  }
}
