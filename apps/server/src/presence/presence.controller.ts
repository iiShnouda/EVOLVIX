import { Controller, Get } from '@nestjs/common';
import type { PresenceEntry } from '@skb/shared';
import { RequirePermissions } from '../common/decorators';
import { PresenceService } from './presence.service';

/** REST view of live presence, restricted to users with `presence:view` (owner/admin). */
@Controller('presence')
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  @Get()
  @RequirePermissions('presence:view')
  list(): PresenceEntry[] {
    return this.presence.list();
  }
}
