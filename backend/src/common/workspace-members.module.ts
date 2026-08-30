import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkspaceMembersService } from './workspace-members.service';
import { WorkspaceTimelineService } from './workspace-timeline.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [WorkspaceMembersService, WorkspaceTimelineService],
  exports: [WorkspaceMembersService, WorkspaceTimelineService],
})
export class WorkspaceMembersModule {}
