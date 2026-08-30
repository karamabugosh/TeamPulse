import React, { useState } from 'react';
import { JiraIssueSummary } from '@/lib/jira-api';
import { JiraIssueCombobox } from '@/components/jira/JiraIssueCombobox';
import { JiraLinkIssueField } from '@/components/jira/JiraLinkIssueField';
import { QuestionItem } from './QuestionBuilder';

interface SlackPreviewProps {
  introMessage: string;
  outroMessage: string;
  questions: QuestionItem[];
  participantName?: string;
  showJiraLink?: boolean;
}

export const SlackPreview: React.FC<SlackPreviewProps> = ({
  introMessage,
  outroMessage,
  questions,
  participantName = 'Karam',
  showJiraLink = false,
}) => {
  const enabledQuestions = questions
    .filter((q) => q.enabled !== false)
    .sort((a, b) => a.order - b.order);

  const [linkedIssues, setLinkedIssues] = useState<Record<string, JiraIssueSummary>>({});
  const [issueRefSelections, setIssueRefSelections] = useState<Record<string, JiraIssueSummary>>({});

  const renderQuestionControls = (question: QuestionItem, index: number) => {
    if (question.type === 'ISSUE_REF') {
      return (
        <div className="mt-3">
          <JiraIssueCombobox
            value={issueRefSelections[question.id] ?? null}
            onSelect={(issue) =>
              setIssueRefSelections((current) => ({ ...current, [question.id]: issue }))
            }
            onClear={() =>
              setIssueRefSelections((current) => {
                const next = { ...current };
                delete next[question.id];
                return next;
              })
            }
          />
        </div>
      );
    }

    if (showJiraLink) {
      return (
        <div className="mt-3">
          <JiraLinkIssueField
            value={linkedIssues[question.id] ?? null}
            onSelect={(issue) =>
              setLinkedIssues((current) => ({ ...current, [question.id]: issue }))
            }
            onClear={() =>
              setLinkedIssues((current) => {
                const next = { ...current };
                delete next[question.id];
                return next;
              })
            }
          />
        </div>
      );
    }

    return null;
  };

  return (
    <div className="rounded-xl border border-border bg-[#1a1d21] p-4 font-sans text-sm text-[#d1d2d3]">
      <div className="mb-4 flex items-center gap-2 border-b border-[#35373b] pb-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-xs font-bold text-white">
          P
        </div>
        <div>
          <p className="font-semibold text-white">PulseBot</p>
          <p className="text-xs text-[#ababad]">Direct Message</p>
        </div>
      </div>

      <div className="space-y-4">
        <MessageBlock>
          {introMessage
            .replace('{name}', participantName)
            .replace('Good morning!', `Good morning ${participantName}!`)}
        </MessageBlock>

        {enabledQuestions.map((question, index) => (
          <React.Fragment key={question.id}>
            <MessageBlock>
              <span className="font-semibold text-white">
                Question {index + 1}/{enabledQuestions.length}:
              </span>
              <br />
              {question.question}
              {question.type === 'MULTIPLE_CHOICE' && question.options?.length ? (
                <ul className="mt-2 list-disc pl-4 text-[#ababad]">
                  {question.options.map((opt, optionIndex) => (
                    <li key={optionIndex}>{opt}</li>
                  ))}
                </ul>
              ) : null}
              {question.type === 'YES_NO' ||
              question.type === 'YES_NO_MAYBE' ||
              question.type === 'BLOCKER' ? (
                <div className="mt-3 flex gap-2">
                  <span className="rounded bg-[#e01e5a] px-2 py-1 text-xs text-white">
                    {question.type === 'BLOCKER' ? '🔴 Yes' : 'Yes'}
                  </span>
                  <span className="rounded bg-[#2eb67d] px-2 py-1 text-xs text-white">
                    {question.type === 'BLOCKER' ? '🟢 No' : 'No'}
                  </span>
                  {question.type === 'YES_NO_MAYBE' ? (
                    <span className="rounded bg-[#565856] px-2 py-1 text-xs text-white">
                      Maybe
                    </span>
                  ) : null}
                </div>
              ) : null}
              {question.type === 'BLOCKER' ? (
                <p className="mt-2 text-xs text-[#ababad]">
                  Yes opens the existing Blocker Details modal (title, reason, severity, Jira…).
                </p>
              ) : null}
              {renderQuestionControls(question, index)}
            </MessageBlock>

            {index === 0 ? (
              <>
                <MessageBlock isUser>Finished implementing the scheduler.</MessageBlock>
                <MessageBlock>Great! ✅</MessageBlock>
              </>
            ) : null}
          </React.Fragment>
        ))}

        <MessageBlock>{outroMessage}</MessageBlock>
      </div>
    </div>
  );
};

function MessageBlock({ children, isUser }: { children: React.ReactNode; isUser?: boolean }) {
  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
      {!isUser && (
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded bg-primary text-[10px] font-bold text-white">
          P
        </div>
      )}
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 ${
          isUser ? 'bg-[#1264a3] text-white' : 'bg-[#222529]'
        }`}
      >
        {children}
      </div>
    </div>
  );
}

export default SlackPreview;
