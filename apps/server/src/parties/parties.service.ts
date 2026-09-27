import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Paginated, Party, PartiesListQuery } from '@skb/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PartiesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: PartiesListQuery): Promise<Paginated<Party>> {
    const where: Prisma.PartyWhereInput = {};
    if (query.type) where.types = { has: query.type };
    if (query.search) where.name = { contains: query.search, mode: 'insensitive' };

    const [total, rows] = await Promise.all([
      this.prisma.party.count({ where }),
      this.prisma.party.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      items: rows.map(this.toParty),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async getOne(id: string): Promise<Party> {
    const party = await this.prisma.party.findUnique({ where: { id } });
    if (!party) throw new NotFoundException('Party not found');
    return this.toParty(party);
  }

  private toParty(p: Prisma.PartyGetPayload<object>): Party {
    return {
      id: p.id,
      name: p.name,
      types: p.types,
      phone: p.phone ?? undefined,
      email: p.email ?? undefined,
      taxNumber: p.taxNumber ?? undefined,
      balance: p.balance,
      currency: p.currency,
      isActive: p.isActive,
      createdAt: p.createdAt.toISOString(),
    };
  }
}
