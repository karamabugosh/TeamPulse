import { Injectable } from '@nestjs/common';
import { WorkspaceRetrievalService } from '../retrieval/workspace-retrieval.service';
import {
  WorkspaceSearchFilters,
  WorkspaceSearchResult,
} from '../types/workspace-ai.types';

/**
 * Compatibility alias for the Retrieval Layer.
 * Prefer WorkspaceRetrievalService for new code.
 */
@Injectable()
export class WorkspaceSearchService {
  constructor(private readonly retrieval: WorkspaceRetrievalService) {}

  search(params: {
    workspaceId: string;
    query: string;
    filters?: WorkspaceSearchFilters;
    limit?: number;
  }): Promise<WorkspaceSearchResult> {
    return this.retrieval.retrieve(params);
  }

  mergeQueryIntoFilters(
    query: string,
    base: WorkspaceSearchFilters,
  ): WorkspaceSearchFilters {
    return this.retrieval.mergeQueryIntoFilters(query, base);
  }
}
