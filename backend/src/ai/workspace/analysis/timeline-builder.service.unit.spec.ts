import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from '@jest/globals';
import { EvidenceEvent } from './analysis.types';
import { TimelineBuilderService } from './timeline-builder.service';

function makeEvent(overrides: Partial<EvidenceEvent> = {}): EvidenceEvent {
  return {
    id: 'evt-1',
    occurredAt: '2024-06-15T12:30:00.000Z',
    source: 'slack_standup',
    label: 'standup',
    summary: 'completed Daily Standup',
    details: 'completed Daily Standup',
    issueKey: null,
    actor: null,
    weight: 1,
    ...overrides,
  };
}

describe('TimelineBuilderService', () => {
  let service: TimelineBuilderService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TimelineBuilderService],
    }).compile();

    service = module.get(TimelineBuilderService);
  });

  describe('build', () => {
    it('returns an empty list when there are no events', () => {
      expect(service.build([])).toEqual([]);
    });

    it('sorts events chronologically ascending by occurredAt', () => {
      const later = makeEvent({
        id: 'evt-later',
        occurredAt: '2024-06-20T10:00:00.000Z',
        summary: 'later',
      });
      const earlier = makeEvent({
        id: 'evt-earlier',
        occurredAt: '2024-06-10T10:00:00.000Z',
        summary: 'earlier',
      });

      const result = service.build([later, earlier]);

      expect(result.map((e) => e.eventId)).toEqual(['evt-earlier', 'evt-later']);
      expect(result[0].date).toBe('2024-06-10');
      expect(result[1].date).toBe('2024-06-20');
    });

    it('does not mutate the input events array', () => {
      const later = makeEvent({
        id: 'evt-later',
        occurredAt: '2024-06-20T10:00:00.000Z',
      });
      const earlier = makeEvent({
        id: 'evt-earlier',
        occurredAt: '2024-06-10T10:00:00.000Z',
      });
      const input = [later, earlier];

      service.build(input);

      expect(input.map((e) => e.id)).toEqual(['evt-later', 'evt-earlier']);
    });

    it('applies the default limit of 40 entries', () => {
      const events = Array.from({ length: 45 }, (_, i) =>
        makeEvent({
          id: `evt-${i}`,
          occurredAt: new Date(Date.UTC(2024, 0, 1, 0, 0, i)).toISOString(),
          summary: `event ${i}`,
        }),
      );

      const result = service.build(events);

      expect(result).toHaveLength(40);
      expect(result[0].eventId).toBe('evt-0');
      expect(result[39].eventId).toBe('evt-39');
    });

    it('respects a custom limit smaller than the event count', () => {
      const events = [
        makeEvent({ id: 'a', occurredAt: '2024-01-01T00:00:00.000Z' }),
        makeEvent({ id: 'b', occurredAt: '2024-01-02T00:00:00.000Z' }),
        makeEvent({ id: 'c', occurredAt: '2024-01-03T00:00:00.000Z' }),
      ];

      const result = service.build(events, 2);

      expect(result).toHaveLength(2);
      expect(result.map((e) => e.eventId)).toEqual(['a', 'b']);
    });

    it('maps source onto each timeline entry', () => {
      const result = service.build([
        makeEvent({ source: 'jira_issue', id: 'j1' }),
      ]);

      expect(result[0].source).toBe('jira_issue');
    });

    describe('formatTimelineText branches', () => {
      it('uses summary alone when actor is null', () => {
        const result = service.build([
          makeEvent({
            actor: null,
            summary: 'blocked on API',
            details: 'blocked on API',
          }),
        ]);

        expect(result[0].text).toBe('blocked on API');
      });

      it('uses summary alone when actor is blank whitespace', () => {
        const result = service.build([
          makeEvent({
            actor: '   ',
            summary: 'opened ticket',
            details: 'opened ticket',
          }),
        ]);

        expect(result[0].text).toBe('opened ticket');
      });

      it('prefixes actor when present', () => {
        const result = service.build([
          makeEvent({
            actor: 'Sara',
            summary: 'completed Daily Standup',
            details: 'completed Daily Standup',
          }),
        ]);

        expect(result[0].text).toBe('Sara — completed Daily Standup');
      });

      it('trims surrounding whitespace on actor', () => {
        const result = service.build([
          makeEvent({
            actor: '  Bob  ',
            summary: 'shipped fix',
            details: 'shipped fix',
          }),
        ]);

        expect(result[0].text).toBe('Bob — shipped fix');
      });

      it('collapses whitespace in summary and details', () => {
        const result = service.build([
          makeEvent({
            actor: null,
            summary: '  fixed   bug   ',
            details: '  fixed   bug   ',
          }),
        ]);

        expect(result[0].text).toBe('fixed bug');
      });

      it('appends issueKey when missing from the text', () => {
        const result = service.build([
          makeEvent({
            actor: 'Sara',
            summary: 'completed Daily Standup',
            details: 'completed Daily Standup',
            issueKey: 'SCRUM-8',
          }),
        ]);

        expect(result[0].text).toBe(
          'Sara — completed Daily Standup (SCRUM-8)',
        );
      });

      it('does not append issueKey when already present in the text', () => {
        const result = service.build([
          makeEvent({
            actor: null,
            summary: 'Updated SCRUM-8 status',
            details: 'Updated SCRUM-8 status',
            issueKey: 'SCRUM-8',
          }),
        ]);

        expect(result[0].text).toBe('Updated SCRUM-8 status');
        expect(result[0].text).not.toContain('(SCRUM-8)');
      });

      it('skips issueKey when null', () => {
        const result = service.build([
          makeEvent({
            actor: 'Alex',
            summary: 'posted update',
            details: 'posted update',
            issueKey: null,
          }),
        ]);

        expect(result[0].text).toBe('Alex — posted update');
      });

      it('appends short distinct details under 160 characters', () => {
        const result = service.build([
          makeEvent({
            actor: 'Sara',
            summary: 'completed Daily Standup',
            details: 'Mentioned waiting on design review',
            issueKey: null,
          }),
        ]);

        expect(result[0].text).toBe(
          'Sara — completed Daily Standup: Mentioned waiting on design review',
        );
      });

      it('truncates long distinct details to 140 characters with ellipsis', () => {
        const longDetail = 'x'.repeat(160);
        const result = service.build([
          makeEvent({
            actor: null,
            summary: 'status update',
            details: longDetail,
          }),
        ]);

        expect(result[0].text).toBe(
          `status update: ${'x'.repeat(140)}…`,
        );
      });

      it('omits details when they match the summary after normalization', () => {
        const result = service.build([
          makeEvent({
            actor: 'Sam',
            summary: 'same text',
            details: '  same   text  ',
          }),
        ]);

        expect(result[0].text).toBe('Sam — same text');
        expect(result[0].text).not.toContain(':');
      });

      it('omits details when details string is empty after trim', () => {
        const result = service.build([
          makeEvent({
            actor: null,
            summary: 'only summary',
            details: '   ',
          }),
        ]);

        expect(result[0].text).toBe('only summary');
      });

      it('combines actor, issueKey, and short details together', () => {
        const result = service.build([
          makeEvent({
            actor: 'Sara',
            summary: 'completed Daily Standup',
            details: 'Blocked on vendor',
            issueKey: 'SCRUM-8',
          }),
        ]);

        expect(result[0].text).toBe(
          'Sara — completed Daily Standup (SCRUM-8): Blocked on vendor',
        );
      });

      it('truncates details that are exactly 160 characters after append path', () => {
        // length 160 triggers the truncation branch (not < 160)
        const detail = 'y'.repeat(160);
        const result = service.build([
          makeEvent({
            summary: 'base',
            details: detail,
          }),
        ]);

        expect(result[0].text).toBe(`base: ${'y'.repeat(140)}…`);
      });
    });
  });
});
