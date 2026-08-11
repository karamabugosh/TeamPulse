import React from 'react';
import { QuestionItem } from './QuestionBuilder';

interface SlackPreviewProps {
  introMessage: string;
  outroMessage: string;
  questions: QuestionItem[];
  participantName?: string;
}

export const SlackPreview: React.FC<SlackPreviewProps> = ({
  introMessage,
  outroMessage,
  questions,
  participantName = 'Karam',
}) => {
  const enabledQuestions = questions.filter((q) => q.enabled !== false).sort((a, b) => a.order - b.order);

  return (
    <div className="rounded-xl border border-border bg-[#1a1d21] p-4 text-[#d1d2d3] font-sans text-sm">
      <div className="mb-4 flex items-center gap-2 border-b border-[#35373b] pb-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-xs font-bold text-white">P</div>
        <div>
          <p className="font-semibold text-white">PulseBot</p>
          <p className="text-xs text-[#ababad]">Direct Message</p>
        </div>
      </div>

      <div className="space-y-4">
        <MessageBlock>
          {introMessage.replace('{name}', participantName).replace('Good morning!', `Good morning ${participantName}!`)}
        </MessageBlock>

        {enabledQuestions.length > 0 && (
          <MessageBlock>
            <span className="font-semibold text-white">Question 1:</span>
            <br />
            {enabledQuestions[0].question}
            {enabledQuestions[0].type === 'MULTIPLE_CHOICE' && enabledQuestions[0].options?.length ? (
              <ul className="mt-2 list-disc pl-4 text-[#ababad]">
                {enabledQuestions[0].options.map((opt, i) => (
                  <li key={i}>{opt}</li>
                ))}
              </ul>
            ) : null}
          </MessageBlock>
        )}

        <MessageBlock isUser>Finished implementing the scheduler.</MessageBlock>

        <MessageBlock>Great! ✅</MessageBlock>

        {enabledQuestions.length > 1 && (
          <MessageBlock>
            <span className="font-semibold text-white">Question 2:</span>
            <br />
            {enabledQuestions[1].question}
          </MessageBlock>
        )}

        <MessageBlock isUser>Continue working on the Pulse V2 Dashboard.</MessageBlock>
        <MessageBlock>Awesome.</MessageBlock>

        {enabledQuestions.length > 2 && (
          <>
            <MessageBlock>
              <span className="font-semibold text-white">Question {enabledQuestions.length}:</span>
              <br />
              {enabledQuestions[enabledQuestions.length - 1].question}
            </MessageBlock>
            <MessageBlock isUser>No blockers.</MessageBlock>
          </>
        )}

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
