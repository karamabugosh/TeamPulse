import { Module } from '@nestjs/common';
import { CollectionService } from './collection.service';
import { CollectionController } from './collection.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { JiraModule } from '../jira/jira.module';

@Module({
  imports: [PrismaModule, JiraModule],
  controllers: [CollectionController],
  providers: [CollectionService],
  exports: [CollectionService],
})
export class CollectionModule {}
