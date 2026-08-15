import { Module } from '@nestjs/common';
import { JiraConfigService } from './jira-config.service';

@Module({
  providers: [JiraConfigService],
  exports: [JiraConfigService],
})
export class JiraModule {}