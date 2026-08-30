import { Injectable } from '@nestjs/common';
import {
  DetectiveFocus,
  DetectivePattern,
  EvidenceEvent,
  RootCauseCandidate,
} from './analysis.types';

/**
 * Detects repeated patterns and proposes root-cause candidates from evidence only.
 */
@Injectable()
export class PatternDetectorService {
  detectPatterns(events: EvidenceEvent[]): DetectivePattern[] {
    const patterns: DetectivePattern[] = [];

    const blockerEvents = events.filter(
      (e) => e.source === 'blocker' || e.source === 'blocker_update',
    );
    if (blockerEvents.length >= 2) {
      patterns.push({
        id: 'repeated-blockers',
        label: `Blocker activity appears ${blockerEvents.length} times in the evidence window`,
        evidenceIds: blockerEvents.map((e) => e.id),
        strength: blockerEvents.length >= 4 ? 'strong' : 'moderate',
      });
    }

    const dependencyMentions = events.filter((e) =>
      /\b(depend|waiting|backend|api|review|deploy|blocked)\b/i.test(
        `${e.summary} ${e.details}`,
      ),
    );
    if (dependencyMentions.length >= 2) {
      const sample = dependencyMentions[0];
      patterns.push({
        id: 'dependency-theme',
        label: `Dependency / waiting language repeats across ${dependencyMentions.length} events (e.g. “${clip(
          sample.details || sample.summary,
          60,
        )}”)`,
        evidenceIds: dependencyMentions.map((e) => e.id),
        strength: dependencyMentions.length >= 3 ? 'strong' : 'moderate',
      });
    }

    const statusChanges = events.filter(
      (e) =>
        e.source === 'jira_changelog' &&
        /status changed/i.test(e.summary),
    );
    const createdEvent = events.find(
      (e) =>
        e.source === 'jira_changelog' && /\bCreated\b/i.test(e.summary),
    );
    if (createdEvent && statusChanges.length <= 1) {
      const start = new Date(createdEvent.occurredAt).getTime();
      const last = events[events.length - 1];
      const end = new Date(last.occurredAt).getTime();
      const idleDays = Math.max(0, Math.round((end - start) / 86_400_000));
      if (idleDays >= 3) {
        patterns.push({
          id: 'stalled-jira',
          label: `Little or no Jira status progress for about ${idleDays} day(s) after creation/update signals`,
          evidenceIds: [createdEvent.id, ...statusChanges.map((e) => e.id)],
          strength: idleDays >= 5 ? 'strong' : 'moderate',
        });
      }
    } else if (statusChanges.length === 0 && events.some((e) => e.issueKey)) {
      const jiraEvents = events.filter(
        (e) => e.source === 'jira_issue' || e.source === 'jira_changelog',
      );
      if (jiraEvents.length >= 1) {
        patterns.push({
          id: 'no-status-movement',
          label: 'No Jira status-change history was found in the available evidence',
          evidenceIds: jiraEvents.map((e) => e.id),
          strength: 'moderate',
        });
      }
    }

    const actors = new Map<string, EvidenceEvent[]>();
    for (const event of blockerEvents) {
      if (!event.actor) continue;
      const list = actors.get(event.actor) ?? [];
      list.push(event);
      actors.set(event.actor, list);
    }
    for (const [actor, list] of actors) {
      if (list.length >= 2) {
        patterns.push({
          id: `actor-blocked-${actor}`,
          label: `${actor} appears in ${list.length} blocker-related events`,
          evidenceIds: list.map((e) => e.id),
          strength: list.length >= 3 ? 'strong' : 'moderate',
        });
      }
    }

    const standupMentions = events.filter((e) => e.source === 'slack_standup');
    const sharedTheme = findSharedToken(standupMentions);
    if (sharedTheme && standupMentions.length >= 2) {
      patterns.push({
        id: 'standup-theme',
        label: `Standups repeatedly mention “${sharedTheme}”`,
        evidenceIds: standupMentions
          .filter((e) =>
            `${e.summary} ${e.details}`.toLowerCase().includes(sharedTheme),
          )
          .map((e) => e.id),
        strength: 'moderate',
      });
    }

    const escalations = events.filter((e) =>
      /escalat/i.test(`${e.summary} ${e.details}`),
    );
    if (escalations.length >= 1) {
      patterns.push({
        id: 'escalation',
        label: `Escalation language appears in ${escalations.length} evidence item(s)`,
        evidenceIds: escalations.map((e) => e.id),
        strength: 'moderate',
      });
    }

    const ownershipChurn = events.filter(
      (e) =>
        e.source === 'jira_changelog' && /assign/i.test(e.summary),
    );
    if (ownershipChurn.length >= 2) {
      patterns.push({
        id: 'ownership-churn',
        label: `Issue ownership changed ${ownershipChurn.length} time(s) in the evidence window`,
        evidenceIds: ownershipChurn.map((e) => e.id),
        strength: ownershipChurn.length >= 3 ? 'strong' : 'moderate',
      });
    }

    const handoffGap = events.filter((e) =>
      /\b(hand\s*off|waiting on|blocked on|pinged|follow.?up)\b/i.test(
        `${e.summary} ${e.details}`,
      ),
    );
    if (handoffGap.length >= 2) {
      patterns.push({
        id: 'handoff-gap',
        label: `Cross-person handoff / waiting language appears ${handoffGap.length} times`,
        evidenceIds: handoffGap.map((e) => e.id),
        strength: handoffGap.length >= 3 ? 'strong' : 'moderate',
      });
    }

    return patterns.slice(0, 10);
  }

  proposeRootCauses(params: {
    events: EvidenceEvent[];
    patterns: DetectivePattern[];
    focus: DetectiveFocus;
  }): RootCauseCandidate[] {
    const causes: RootCauseCandidate[] = [];
    const { events, patterns, focus } = params;

    const depPattern = patterns.find((p) => p.id === 'dependency-theme');
    if (depPattern) {
      causes.push({
        id: 'cause-dependency',
        label: 'Unresolved dependency / waiting state',
        rationale:
          'Multiple evidence items mention waiting on another system, person, or deliverable.',
        evidenceIds: depPattern.evidenceIds,
        contribution: depPattern.strength === 'strong' ? 'high' : 'medium',
      });
    }

    const stall = patterns.find(
      (p) => p.id === 'stalled-jira' || p.id === 'no-status-movement',
    );
    if (stall) {
      causes.push({
        id: 'cause-no-progress',
        label: 'Missing or delayed Jira progress',
        rationale:
          'Issue status history shows little movement relative to the surrounding standup/blocker activity.',
        evidenceIds: stall.evidenceIds,
        contribution: 'high',
      });
    }

    const repeated = patterns.find((p) => p.id === 'repeated-blockers');
    if (repeated) {
      causes.push({
        id: 'cause-blocker-persistence',
        label: 'Persistent blocker(s)',
        rationale:
          'Blockers were opened and/or updated multiple times without a quick resolution signal.',
        evidenceIds: repeated.evidenceIds,
        contribution: 'high',
      });
    }

    const reviewMentions = events.filter((e) =>
      /\b(code review|review|PR|pull request)\b/i.test(
        `${e.summary} ${e.details}`,
      ),
    );
    if (reviewMentions.length >= 1) {
      causes.push({
        id: 'cause-review',
        label: 'Review / PR bottleneck',
        rationale: 'Evidence mentions code review or pull-request waiting.',
        evidenceIds: reviewMentions.map((e) => e.id),
        contribution: reviewMentions.length >= 2 ? 'medium' : 'low',
      });
    }

    const lateEscalation = events.filter((e) =>
      /escalat/i.test(`${e.summary} ${e.details}`),
    );
    const firstBlocker = events.find((e) => e.source === 'blocker');
    if (firstBlocker && lateEscalation.length > 0) {
      const blockerAt = new Date(firstBlocker.occurredAt).getTime();
      const escalateAt = Math.min(
        ...lateEscalation.map((e) => new Date(e.occurredAt).getTime()),
      );
      const gapDays = Math.round((escalateAt - blockerAt) / 86_400_000);
      if (gapDays >= 2) {
        causes.push({
          id: 'cause-late-escalation',
          label: 'Delayed escalation',
          rationale: `Escalation signals appear about ${gapDays} day(s) after the first blocker evidence.`,
          evidenceIds: [firstBlocker.id, ...lateEscalation.map((e) => e.id)],
          contribution: 'medium',
        });
      }
    }

    const actorPattern = patterns.find((p) => p.id.startsWith('actor-blocked-'));
    if (actorPattern && focus.userQuery) {
      causes.push({
        id: 'cause-repeat-person-block',
        label: `Repeated blocking involving ${focus.userQuery}`,
        rationale: actorPattern.label,
        evidenceIds: actorPattern.evidenceIds,
        contribution: 'high',
      });
    }

    const ownership = patterns.find((p) => p.id === 'ownership-churn');
    if (ownership) {
      causes.push({
        id: 'cause-ownership-churn',
        label: 'Unstable ownership / reassignment',
        rationale:
          'Multiple assignee changes often correlate with delayed delivery and unclear accountability.',
        evidenceIds: ownership.evidenceIds,
        contribution: ownership.strength === 'strong' ? 'high' : 'medium',
      });
    }

    const handoff = patterns.find((p) => p.id === 'handoff-gap');
    if (handoff) {
      causes.push({
        id: 'cause-handoff-gap',
        label: 'Handoff / waiting gap between people or systems',
        rationale:
          'Evidence repeatedly mentions waiting, pinging, or handoff without a clean resolution signal.',
        evidenceIds: handoff.evidenceIds,
        contribution: 'medium',
      });
    }

    if (causes.length === 0 && events.length > 0) {
      const top = [...events].sort((a, b) => b.weight - a.weight).slice(0, 3);
      causes.push({
        id: 'cause-evidence-limited',
        label: 'Evidence points to interrupted delivery flow',
        rationale:
          'Available records show relevant activity, but no single dominant root cause pattern was strong enough to isolate further.',
        evidenceIds: top.map((e) => e.id),
        contribution: 'low',
      });
    }

    return causes.slice(0, 6);
  }

  proposeDecisionImpacts(params: {
    events: EvidenceEvent[];
    patterns: DetectivePattern[];
    rootCauses: RootCauseCandidate[];
  }): Array<{ label: string; rationale: string; evidenceIds: string[] }> {
    const impacts: Array<{
      label: string;
      rationale: string;
      evidenceIds: string[];
    }> = [];

    for (const cause of params.rootCauses.slice(0, 4)) {
      impacts.push({
        label: cause.label,
        rationale: cause.rationale,
        evidenceIds: cause.evidenceIds,
      });
    }

    const assignments = params.events.filter(
      (e) =>
        e.source === 'jira_changelog' && /assign/i.test(e.summary),
    );
    if (assignments.length) {
      const last = assignments[assignments.length - 1];
      impacts.push({
        label: 'Assignment / ownership change',
        rationale: last.details || last.summary,
        evidenceIds: assignments.map((e) => e.id),
      });
    }

    const sprintChanges = params.events.filter(
      (e) =>
        e.source === 'jira_changelog' && /sprint/i.test(e.summary),
    );
    if (sprintChanges.length) {
      impacts.push({
        label: 'Sprint scope / membership changes',
        rationale: sprintChanges.map((e) => e.summary).join('; '),
        evidenceIds: sprintChanges.map((e) => e.id),
      });
    }

    return impacts.slice(0, 6);
  }
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function findSharedToken(events: EvidenceEvent[]): string | null {
  const stop = new Set([
    'the',
    'and',
    'for',
    'with',
    'from',
    'that',
    'this',
    'have',
    'will',
    'were',
    'been',
    'into',
    'about',
    'today',
    'yesterday',
    'working',
    'worked',
    'still',
    'just',
    'issue',
    'task',
  ]);
  const counts = new Map<string, number>();
  for (const event of events) {
    const tokens = `${event.summary} ${event.details}`
      .toLowerCase()
      .match(/[a-z][a-z0-9-]{3,}/g);
    if (!tokens) continue;
    const unique = new Set(tokens.filter((t) => !stop.has(t)));
    for (const token of unique) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [token, count] of counts) {
    if (count >= 2 && count > bestCount) {
      best = token;
      bestCount = count;
    }
  }
  return best;
}
