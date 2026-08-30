import {
  AiDigestResult,
  NamedPersonSection,
  RawResponseForAnalysis,
} from '../ai/dto/ai-result.dto';
import {
  lookupSlackDisplayName,
  resolveAllSlackIdsInText,
  textContainsSlackUserId,
} from './slack-member.util';

function resolveStringList(
  values: string[] | null | undefined,
  nameMap: Map<string, string>,
): string[] {
  if (!values?.length) return [];
  return values.map((value) =>
    resolveAllSlackIdsInText(value ?? '', nameMap),
  );
}

function resolveNamedSections(
  sections: NamedPersonSection[] | undefined,
  nameMap: Map<string, string>,
): NamedPersonSection[] | undefined {
  if (!sections?.length) return sections;
  return sections.map((section) => ({
    displayName: resolvePersonLabel(section.displayName ?? '', null, nameMap),
    items: resolveStringList(section.items, nameMap),
  }));
}

function resolvePersonLabel(
  label: string,
  slackUserId: string | null | undefined,
  nameMap: Map<string, string>,
): string {
  const resolved = resolveAllSlackIdsInText(label ?? '', nameMap);
  if (textContainsSlackUserId(resolved) && slackUserId?.trim()) {
    return lookupSlackDisplayName(slackUserId, nameMap);
  }
  if (textContainsSlackUserId(resolved)) {
    return 'Unknown User';
  }
  return resolved.trim() || 'Unknown User';
}

/** Resolve every human-facing string field in a standup AI digest. */
export function resolveSlackIdsInDigest(
  digest: AiDigestResult,
  nameMap: Map<string, string>,
): AiDigestResult {
  const sections = digest.reportSections ?? ({} as AiDigestResult['reportSections']);
  const themes = Array.isArray(digest.themes) ? digest.themes : [];
  const blockers = Array.isArray(digest.blockers) ? digest.blockers : [];
  const participantUpdates = Array.isArray(sections.participantUpdates)
    ? sections.participantUpdates
    : [];

  return {
    ...digest,
    summary: resolveAllSlackIdsInText(digest.summary ?? '', nameMap),
    themes: themes.map((theme) => ({
      ...theme,
      theme: resolveAllSlackIdsInText(theme?.theme ?? '', nameMap),
      summary: resolveAllSlackIdsInText(theme?.summary ?? '', nameMap),
    })),
    blockers: blockers.map((blocker) => ({
      ...blocker,
      userId: blocker?.userId?.trim() || 'unknown',
      description: resolveAllSlackIdsInText(blocker?.description ?? '', nameMap),
      dependency: blocker?.dependency
        ? resolveAllSlackIdsInText(blocker.dependency, nameMap)
        : null,
    })),
    reportSections: {
      ...sections,
      keyAccomplishments: resolveStringList(
        sections.keyAccomplishments,
        nameMap,
      ),
      risks: resolveStringList(sections.risks, nameMap),
      aiInsights: resolveStringList(sections.aiInsights, nameMap),
      actionItems: resolveStringList(sections.actionItems, nameMap),
      overallProgress: resolveAllSlackIdsInText(
        sections.overallProgress ?? '',
        nameMap,
      ),
      participationSummary: sections.participationSummary
        ? resolveAllSlackIdsInText(sections.participationSummary, nameMap)
        : undefined,
      namedBlockers: resolveNamedSections(sections.namedBlockers, nameMap),
      helpRequests: resolveNamedSections(sections.helpRequests, nameMap),
      namedRisks: resolveNamedSections(sections.namedRisks, nameMap),
      namedAccomplishments: resolveNamedSections(
        sections.namedAccomplishments,
        nameMap,
      ),
      teamProgress: sections.teamProgress
        ? resolveStringList(sections.teamProgress, nameMap)
        : undefined,
      participantUpdates: participantUpdates.map((participant) => ({
        ...participant,
        displayName: resolvePersonLabel(
          participant?.displayName ?? '',
          participant?.slackUserId,
          nameMap,
        ),
        answers: (participant?.answers ?? []).map((answer) => ({
          ...answer,
          question: resolveAllSlackIdsInText(answer?.question ?? '', nameMap),
          answer: resolveAllSlackIdsInText(answer?.answer ?? '', nameMap),
          formattedAnswer: answer?.formattedAnswer
            ? resolveAllSlackIdsInText(answer.formattedAnswer, nameMap)
            : undefined,
          semanticInterpretation: answer?.semanticInterpretation
            ? resolveAllSlackIdsInText(answer.semanticInterpretation, nameMap)
            : null,
        })),
      })),
      participantProfiles: sections.participantProfiles?.map((profile) => ({
        ...profile,
        displayName: resolvePersonLabel(
          profile?.displayName ?? '',
          profile?.slackUserId,
          nameMap,
        ),
        yesterdaysWork: resolveAllSlackIdsInText(
          profile?.yesterdaysWork ?? '',
          nameMap,
        ),
        todaysPlan: resolveAllSlackIdsInText(profile?.todaysPlan ?? '', nameMap),
        blockedDetail: resolveAllSlackIdsInText(
          profile?.blockedDetail ?? '',
          nameMap,
        ),
        helpDetail: resolveAllSlackIdsInText(profile?.helpDetail ?? '', nameMap),
        taskStatus: resolveAllSlackIdsInText(profile?.taskStatus ?? '', nameMap),
      })),
    },
  };
}

/** Resolve standup answer text before sending to OpenAI. */
export function resolveSlackIdsInRawResponses(
  responses: RawResponseForAnalysis[],
  nameMap: Map<string, string>,
): RawResponseForAnalysis[] {
  return (responses ?? []).map((response) => ({
    ...response,
    displayName:
      response.displayName?.trim() ||
      lookupSlackDisplayName(response.userId, nameMap),
    answers: (response.answers ?? []).map((answer) => ({
      ...answer,
      text: resolveAllSlackIdsInText(answer?.text ?? '', nameMap),
      formattedAnswer: answer?.formattedAnswer
        ? resolveAllSlackIdsInText(answer.formattedAnswer, nameMap)
        : answer?.formattedAnswer,
      semanticInterpretation: answer?.semanticInterpretation
        ? resolveAllSlackIdsInText(answer.semanticInterpretation, nameMap)
        : answer?.semanticInterpretation,
    })),
  }));
}

/** True when any digest field still contains Slack ids or mention syntax. */
export function digestContainsSlackUserIds(digest: AiDigestResult): boolean {
  const checks: Array<string | null | undefined> = [
    digest.summary,
    digest.reportSections.overallProgress,
    digest.reportSections.participationSummary,
  ];

  for (const theme of digest.themes) {
    checks.push(theme.theme, theme.summary);
  }
  for (const section of [
    ...(digest.reportSections.namedBlockers ?? []),
    ...(digest.reportSections.helpRequests ?? []),
    ...(digest.reportSections.namedRisks ?? []),
    ...(digest.reportSections.namedAccomplishments ?? []),
  ]) {
    checks.push(section.displayName, ...section.items);
  }
  for (const list of [
    digest.reportSections.keyAccomplishments,
    digest.reportSections.risks,
    digest.reportSections.aiInsights,
    digest.reportSections.actionItems,
    digest.reportSections.teamProgress ?? [],
  ]) {
    checks.push(...list);
  }
  for (const participant of digest.reportSections.participantUpdates) {
    checks.push(participant.displayName);
    for (const answer of participant.answers) {
      checks.push(answer.question, answer.answer, answer.formattedAnswer);
    }
  }

  return checks.some((value) => textContainsSlackUserId(value));
}
