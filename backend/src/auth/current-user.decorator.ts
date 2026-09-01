import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUserProfile } from './auth.service';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUserProfile => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthUserProfile }>();
    return request.user;
  },
);
