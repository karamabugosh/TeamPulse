import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { DashboardAuthService } from './dashboard-auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import type { JwtPayload } from './dashboard-auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly dashboardAuth: DashboardAuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() body: { email?: string; password?: string }) {
    return this.dashboardAuth.login(body.email ?? '', body.password ?? '');
  }

  @Post('logout')
  @HttpCode(200)
  logout() {
    return { ok: true };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: JwtPayload) {
    return this.dashboardAuth.getProfile(user.sub);
  }
}
