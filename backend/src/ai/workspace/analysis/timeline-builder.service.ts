import { Injectable } from '@nestjs/common';
import { EvidenceEvent } from './analysis.types';

export type TimelineEntry = {
  date: string;
  text: string;
  eventId: string;
  source: EvidenceEvent['source'];
};

/**
 * Builds a chronological timeline from evidence events.
 */
@Injectable()
export class TimelineBuilderService {
  build(events: EvidenceEvent[], limit = 40): TimelineEntry[] {
    const sorted = [...events].sort(
      (a, b) =>
        new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
    );

    return sorted.slice(0, limit).map((event) => ({
      date: event.occurredAt.slice(0, 10),
      text: formatTimelineText(event),
      eventId: event.id,
      source: event.source,
    }));
  }
}

function formatTimelineText(event: EvidenceEvent): string {
  const actor = event.actor?.trim();
  const base = event.summary.replace(/\s+/g, ' ').trim();
  const detail = event.details.replace(/\s+/g, ' ').trim();
  const issue = event.issueKey;

  // Prefer natural sentences: "Sara — completed Daily Standup (SCRUM-8)"
  let text = actor ? `${actor} — ${base}` : base;
  if (issue && !text.includes(issue)) {
    text = `${text} (${issue})`;
  }
  if (detail && detail !== base && detail.length < 160) {
    text = `${text}: ${detail}`;
  } else if (detail && detail !== base) {
    text = `${text}: ${detail.slice(0, 140)}…`;
  }
  return text.trim();
}
