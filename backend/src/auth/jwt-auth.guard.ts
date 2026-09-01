import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { DashboardAuthService } from './dashboard-auth.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly dashboardAuth: DashboardAuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: unknown }>();
    const header = request.headers.authorization;
    const token =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice('Bearer '.length).trim()
        : null;

    if (!token) {
      throw new UnauthorizedException('Authentication required.');
    }

    request.user = this.dashboardAuth.verifyToken(token);
    return true;
  }
}
