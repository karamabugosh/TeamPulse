import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OpenAiEmbeddingProvider } from '../ai/workspace/retrieval/openai-embedding.provider';
import { MemoryOutboxService } from './memory-outbox.service';
import { MemorySourceLoader, MemoryNormalizerService } from './memory-source.loader';
import { MemoryChunkerService } from './memory-chunker.service';
import { MemoryEmbeddingService } from './memory-embedding.service';
import { MemoryIndexWorkerService } from './memory-index.worker';
import { MemoryBackfillService } from './memory-backfill.service';
import { MemoryAclService } from './memory-acl.service';
import { MemoryFullTextSearchService } from './memory-fulltext-search.service';
import { MemoryVectorSearchService } from './memory-vector-search.service';
import { MemoryHybridRankingService } from './memory-hybrid-ranking.service';
import { MemoryRetrievalService } from './memory-retrieval.service';
import { MemoryEvidenceMergeService } from './memory-evidence-merge.service';
import { MemoryV2ReadinessService } from './memory-v2-readiness.service';
import { MemoryV2EvaluationService } from './memory-v2-evaluation.service';

/**
 * Pulse V2 Team Memory — outbox (2A) + worker (2B) + backfill (2C) + retrieval (3A)
 * + Ask Pulse integration (3B) + evaluation/readiness (3C).
 * Does not remove legacy RAG collectors. Does not auto-enable V2_PRIMARY.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    MemoryOutboxService,
    MemorySourceLoader,
    MemoryNormalizerService,
    MemoryChunkerService,
    OpenAiEmbeddingProvider,
    MemoryEmbeddingService,
    MemoryIndexWorkerService,
    MemoryBackfillService,
    MemoryAclService,
    MemoryFullTextSearchService,
    MemoryVectorSearchService,
    MemoryHybridRankingService,
    MemoryRetrievalService,
    MemoryEvidenceMergeService,
    MemoryV2ReadinessService,
    MemoryV2EvaluationService,
  ],
  exports: [
    MemoryOutboxService,
    MemoryIndexWorkerService,
    MemoryChunkerService,
    MemoryEmbeddingService,
    MemoryBackfillService,
    MemoryRetrievalService,
    MemoryAclService,
    MemoryEvidenceMergeService,
    MemoryV2ReadinessService,
    MemoryV2EvaluationService,
  ],
})
export class MemoryModule {}
