import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators';

/** Lightweight liveness probe the clients ping to determine connection state. */
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check() {
    return { status: 'ok', time: new Date().toISOString() };
  }
}
