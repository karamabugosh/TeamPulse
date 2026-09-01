import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkspaceMembersService } from './workspace-members.service';
import { WorkspaceTimelineService } from './workspace-timeline.service';
import { WorkspaceBootstrapService } from './workspace-bootstrap.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    WorkspaceMembersService,
    WorkspaceTimelineService,
    WorkspaceBootstrapService,
  ],
  exports: [
    WorkspaceMembersService,
    WorkspaceTimelineService,
    WorkspaceBootstrapService,
  ],
})
export class WorkspaceMembersModule {}
