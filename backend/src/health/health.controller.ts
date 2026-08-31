import { Controller, Get } from '@nestjs/common';

/**
 * Lightweight liveness probe for platform health checks (e.g. Render).
 * Does not touch the database or external services.
 */
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      ok: true,
      status: 'up',
      service: 'teampulse-backend',
    };
  }
}
