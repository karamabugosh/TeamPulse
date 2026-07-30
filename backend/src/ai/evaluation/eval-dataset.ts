// backend/src/ai/evaluation/eval-dataset.ts

import { RawResponseForAnalysis } from '../dto/ai-result.dto';

/**
 * Ground truth for one evaluation case: what a human reviewer expects
 * the AI to find, written BEFORE running the model, so scoring isn't
 * biased by seeing the AI's actual output first.
 */
export interface EvalCase {
  id: string;
  description: string; // why this case is included / what it tests
  input: RawResponseForAnalysis[];
  expected: {
    hasBlocker: boolean;
    blockerKeyword: string | null; // a word/phrase that should appear in the extracted description, if hasBlocker
  };
}

export const EVAL_DATASET: EvalCase[] = [
  {
    id: 'case-1-explicit-blocker',
    description: 'Blocker stated explicitly and clearly',
    input: [
      {
        userId: 'user-1',
        answers: [
          {
            questionId: 'q1',
            questionText: 'What did you do yesterday?',
            text: 'Finished the login API. I am blocked waiting for database access from the DevOps team.',
          },
        ],
      },
    ],
    expected: { hasBlocker: true, blockerKeyword: 'database access' },
  },
  {
    id: 'case-2-no-blocker',
    description: 'Clean update with no blocker at all',
    input: [
      {
        userId: 'user-2',
        answers: [
          {
            questionId: 'q1',
            questionText: 'What did you do yesterday?',
            text: 'Completed the Slack integration and wrote unit tests for it. Everything is working fine.',
          },
        ],
      },
    ],
    expected: { hasBlocker: false, blockerKeyword: null },
  },
  {
    id: 'case-3-implicit-waiting',
    description: 'Blocker implied via "waiting on", not the word "blocked"',
    input: [
      {
        userId: 'user-3',
        answers: [
          {
            questionId: 'q1',
            questionText: 'What did you do yesterday?',
            text: 'I finished the dashboard UI. Still waiting on the backend reports endpoint before I can connect it to real data.',
          },
        ],
      },
    ],
    expected: { hasBlocker: true, blockerKeyword: 'reports endpoint' },
  },
  {
    id: 'case-4-past-not-current',
    description: 'Mentions a past dependency that was already resolved — should NOT be flagged as a current blocker',
    input: [
      {
        userId: 'user-4',
        answers: [
          {
            questionId: 'q1',
            questionText: 'What did you do yesterday?',
            text: 'I was blocked on the API keys last week, but that got resolved on Monday. Yesterday I finished the payment integration with no issues.',
          },
        ],
      },
    ],
    expected: { hasBlocker: false, blockerKeyword: null },
  },
  {
    id: 'case-5-embedded-blocker',
    description: 'Blocker mentioned casually mid-sentence, easy to miss',
    input: [
      {
        userId: 'user-5',
        answers: [
          {
            questionId: 'q1',
            questionText: 'What did you do yesterday?',
            text: 'Worked on the onboarding flow most of the day, though I kept getting stuck because the design team has not shared the final mockups yet, so I switched to writing tests instead.',
          },
        ],
      },
    ],
    expected: { hasBlocker: true, blockerKeyword: 'mockups' },
  },
  {
    id: 'case-6-arabic-blocker',
    description: 'Arabic text with a clear blocker — tests non-English handling',
    input: [
      {
        userId: 'user-6',
        answers: [
          {
            questionId: 'q1',
            questionText: 'What did you do yesterday?',
            text: 'خلصت شغل الداشبورد، بس لسا مستنية الـ backend endpoint تبع الـ reports عشان اقدر اربطه.',
          },
        ],
      },
    ],
    expected: { hasBlocker: true, blockerKeyword: 'reports' },
  },
  {
    id: 'case-7-empty-text',
    description: 'Empty answer text — should be filtered out before reaching the model',
    input: [
      {
        userId: 'user-7',
        answers: [
          { questionId: 'q1', questionText: 'What did you do yesterday?', text: '' },
        ],
      },
    ],
    expected: { hasBlocker: false, blockerKeyword: null },
  },
  {
    id: 'case-8-multiple-people-one-blocker',
    description: 'Multiple participants, only one has a blocker',
    input: [
      {
        userId: 'user-8',
        answers: [
          { questionId: 'q1', questionText: 'What did you do yesterday?', text: 'Finished writing the onboarding docs. No issues.' },
        ],
      },
      {
        userId: 'user-9',
        answers: [
          { questionId: 'q1', questionText: 'What did you do yesterday?', text: 'Started the analytics module but I am stuck because I do not have access to the production database.' },
        ],
      },
    ],
    expected: { hasBlocker: true, blockerKeyword: 'production database' },
  },
];