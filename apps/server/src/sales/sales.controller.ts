import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { salesListQuerySchema, type AuthUser, type SalesListQuery } from '@skb/shared';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SalesService } from './sales.service';

@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get('invoices')
  @RequirePermissions('sales:view')
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(salesListQuerySchema)) query: SalesListQuery,
  ) {
    return this.sales.list(user, query);
  }

  @Get('invoices/:id')
  @RequirePermissions('sales:view')
  getOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sales.getOne(user, id);
  }
}
