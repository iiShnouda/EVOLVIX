import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { partiesListQuerySchema, type PartiesListQuery } from '@skb/shared';
import { RequirePermissions } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PartiesService } from './parties.service';

@Controller('parties')
export class PartiesController {
  constructor(private readonly parties: PartiesService) {}

  @Get()
  @RequirePermissions('parties:view')
  list(@Query(new ZodValidationPipe(partiesListQuerySchema)) query: PartiesListQuery) {
    return this.parties.list(query);
  }

  @Get(':id')
  @RequirePermissions('parties:view')
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.parties.getOne(id);
  }
}
