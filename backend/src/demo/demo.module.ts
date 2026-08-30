import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { JiraModule } from '../jira/jira.module';
import { DemoController } from './demo.controller';
import { DemoWorkspaceGeneratorService } from './demo-workspace-generator.service';

@Module({
  imports: [PrismaModule, forwardRef(() => JiraModule)],
  controllers: [DemoController],
  providers: [DemoWorkspaceGeneratorService],
  exports: [DemoWorkspaceGeneratorService],
})
export class DemoModule {}
