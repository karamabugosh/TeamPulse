import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DashboardAuthService } from './dashboard-auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [AuthService, DashboardAuthService, JwtAuthGuard],
  exports: [AuthService, DashboardAuthService],
})
export class AuthModule {}
