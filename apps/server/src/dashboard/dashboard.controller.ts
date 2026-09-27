import { Controller, Get } from '@nestjs/common';
import type { AuthUser } from '@skb/shared';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @RequirePermissions('dashboard:view')
  get(@CurrentUser() user: AuthUser) {
    return this.dashboard.getDashboard(user);
  }
}
