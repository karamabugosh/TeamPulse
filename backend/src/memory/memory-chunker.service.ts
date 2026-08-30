import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { MEMORY_WORKER_CONFIG } from './memory.config';
import {
  NormalizedMemorySection,
  NormalizedMemorySource,
  PreparedMemoryChunk,
} from './memory-normalized.types';

@Injectable()
export class MemoryChunkerService {
  prepareChunks(source: NormalizedMemorySource): PreparedMemoryChunk[] {
    const max = MEMORY_WORKER_CONFIG.maxChunkChars;
    const overlap = MEMORY_WORKER_CONFIG.chunkOverlapChars;

    const units: Array<{ key: string; title: string; text: string }> = [];
    if (source.sections && source.sections.length > 0) {
      for (const section of source.sections) {
        const text = section.text.trim();
        if (!text) continue;
        units.push({
          key: section.key,
          title: section.title?.trim() || source.title,
          text,
        });
      }
    } else {
      const text = source.text.trim();
      if (text) {
        units.push({ key: 'body', title: source.title, text });
      }
    }

    const prepared: PreparedMemoryChunk[] = [];
    let chunkIndex = 0;

    for (const unit of units) {
      const pieces = splitDeterministic(unit.text, max, overlap);
      for (let i = 0; i < pieces.length; i += 1) {
        const piece = pieces[i];
        const header =
          pieces.length > 1
            ? `${unit.title} (${unit.key} part ${i + 1}/${pieces.length})`
            : unit.title;
        const text = `${header}\n\n${piece}`.trim();
        prepared.push({
          chunkIndex,
          text,
          title: header,
          contentHash: hashChunkContent(text),
        });
        chunkIndex += 1;
      }
    }

    return prepared;
  }
}

export function hashChunkContent(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function splitDeterministic(
  text: string,
  maxChars: number,
  overlap: number,
): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (normalized.length <= maxChars) return [normalized];

  const parts: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + maxChars, normalized.length);
    if (end < normalized.length) {
      const window = normalized.slice(start, end);
      const breakAt = Math.max(
        window.lastIndexOf('\n\n'),
        window.lastIndexOf('\n'),
        window.lastIndexOf('. '),
        window.lastIndexOf(' '),
      );
      if (breakAt > maxChars * 0.4) {
        end = start + breakAt + 1;
      }
    }
    parts.push(normalized.slice(start, end).trim());
    if (end >= normalized.length) break;
    start = Math.max(0, end - overlap);
  }
  return parts.filter(Boolean);
}

/** Exported for tests — section list helper. */
export function sectionsFromNormalized(
  source: NormalizedMemorySource,
): NormalizedMemorySection[] {
  if (source.sections?.length) return source.sections;
  return [{ key: 'body', title: source.title, text: source.text }];
}
