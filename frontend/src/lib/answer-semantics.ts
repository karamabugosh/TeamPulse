export type SemanticSentiment = 'positive' | 'negative' | 'neutral';

export type LinkedJiraIssue = {
  issueKey: string;
  summary: string;
  status?: string | null;
  assigneeName?: string | null;
  projectKey?: string | null;
  issueUrl?: string | null;
};

export type FormattedAnswer = {
  question: string;
  answer: string;
  formattedAnswer?: string;
  sentiment?: SemanticSentiment;
  semanticInterpretation?: string | null;
  linkedJiraIssues?: LinkedJiraIssue[];
};

export function sentimentTextClass(sentiment?: SemanticSentiment): string {
  switch (sentiment) {
    case 'positive':
      return 'text-emerald-600 dark:text-emerald-400';
    case 'negative':
      return 'text-red-600 dark:text-red-400';
    case 'neutral':
      return 'text-amber-600 dark:text-amber-400';
    default:
      return 'text-muted-foreground';
  }
}

export function displayAnswerValue(answer: FormattedAnswer): string {
  return answer.formattedAnswer?.trim() || answer.answer;
}
