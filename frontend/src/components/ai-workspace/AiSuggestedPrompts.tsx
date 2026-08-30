import React from 'react';
import { AI_SUGGESTED_PROMPTS } from './ai-workspace.types';

interface AiSuggestedPromptsProps {
  onSelect: (prompt: string) => void;
  disabled?: boolean;
}

export const AiSuggestedPrompts: React.FC<AiSuggestedPromptsProps> = ({
  onSelect,
  disabled = false,
}) => (
  <section className="mx-auto w-full max-w-3xl px-4" aria-label="Suggested prompts">
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 [scrollbar-width:thin]">
      {AI_SUGGESTED_PROMPTS.map((prompt) => (
        <button
          key={prompt}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(prompt)}
          className="shrink-0 rounded-full border border-white/[0.08] bg-white/[0.03] px-3.5 py-1.5 text-sm text-foreground/90 backdrop-blur-md transition-all duration-250 hover:border-module-ai/40 hover:bg-module-ai/10 hover:text-white hover:shadow-glow-sm disabled:opacity-50"
        >
          {prompt}
        </button>
      ))}
    </div>
  </section>
);

export default AiSuggestedPrompts;
