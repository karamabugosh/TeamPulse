import { DashboardBlocker, normalizePriority } from './blockers.types';
import { BlockersFilterState } from './BlockersFilters';

export function filterBlockers(
  blockers: DashboardBlocker[],
  filters: BlockersFilterState,
): DashboardBlocker[] {
  const query = filters.search.trim().toLowerCase();
  const now = Date.now();

  return blockers.filter((blocker) => {
    const created = new Date(blocker.createdAt).getTime();
    const daysAgo = (now - created) / (1000 * 60 * 60 * 24);

    if (filters.datePreset === 'today' && daysAgo > 1) return false;
    if (filters.datePreset === 'last7' && daysAgo > 7) return false;
    if (filters.datePreset === 'last30' && daysAgo > 30) return false;

    if (
      filters.priority !== 'all' &&
      normalizePriority(blocker.priority) !== filters.priority
    ) {
      return false;
    }

    if (filters.status !== 'all' && blocker.status !== filters.status) {
      return false;
    }

    if (filters.reporter !== 'all' && blocker.reporter !== filters.reporter) {
      return false;
    }

    if (filters.category !== 'all') {
      if (!blocker.category || blocker.category !== filters.category) return false;
    }

    if (filters.standup !== 'all') {
      if (!blocker.standupName || blocker.standupName !== filters.standup) {
        return false;
      }
    }

    if (filters.issue === 'none') {
      if (blocker.jiraIssue) return false;
    } else if (filters.issue !== 'all') {
      if (blocker.jiraIssue?.key !== filters.issue) return false;
    }

    if (!query) return true;

    const haystack = [
      blocker.title,
      blocker.description,
      blocker.reporter,
      blocker.slackDisplayName,
      blocker.category,
      blocker.standupName,
      blocker.statusLabel,
      blocker.priority,
      blocker.ownerLabel,
      blocker.expectedResolution,
      blocker.jiraIssue?.key,
      blocker.jiraIssue?.summary,
      blocker.slackContext.question,
      blocker.slackContext.answer,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes(query);
  });
}

export function extractFilterOptions(blockers: DashboardBlocker[]) {
  const reporters = new Set<string>();
  const categories = new Set<string>();
  const standups = new Set<string>();
  const issues = new Set<string>();

  for (const blocker of blockers) {
    if (blocker.reporter) reporters.add(blocker.reporter);
    if (blocker.category) categories.add(blocker.category);
    if (blocker.standupName) standups.add(blocker.standupName);
    if (blocker.jiraIssue?.key) issues.add(blocker.jiraIssue.key);
  }

  return {
    reporters: [...reporters].sort(),
    categories: [...categories].sort(),
    standups: [...standups].sort(),
    issues: [...issues].sort(),
  };
}
