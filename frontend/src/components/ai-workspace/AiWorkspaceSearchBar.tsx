import React, {
  FormEvent,
  ForwardedRef,
  KeyboardEvent,
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
} from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type AiWorkspaceSearchBarHandle = {
  focus: () => void;
};

interface AiWorkspaceSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (query: string) => void;
  disabled?: boolean;
}

export const AiWorkspaceSearchBar = forwardRef(function AiWorkspaceSearchBar(
  {
    value,
    onChange,
    onSubmit,
    disabled = false,
  }: AiWorkspaceSearchBarProps,
  ref: ForwardedRef<AiWorkspaceSearchBarHandle>,
) {
  const inputId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => {
      textareaRef.current?.focus();
    },
  }));

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  const handleSubmit = (event?: FormEvent) => {
    event?.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit?.(trimmed);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  };

  return (
    <section className="mx-auto w-full max-w-3xl px-4">
      <form
        onSubmit={handleSubmit}
        className="group relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] p-2 shadow-card backdrop-blur-xl transition-all duration-300 focus-within:border-module-ai/40 focus-within:shadow-glow-ai"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-br from-module-ai/12 via-transparent to-cyan-400/8 opacity-80"
        />
        <label htmlFor={inputId} className="sr-only">
          Ask AI
        </label>
        <textarea
          ref={textareaRef}
          id={inputId}
          rows={1}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything about your workspace..."
          className="relative z-10 max-h-40 min-h-[2.75rem] w-full resize-none overflow-y-auto bg-transparent px-4 py-3 text-base leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus:outline-none disabled:opacity-60"
        />
        <div className="relative z-10 flex items-center justify-between gap-3 px-2 pb-1.5">
          <p className="hidden text-[11px] text-muted-foreground/80 sm:block">
            Enter to ask · Shift+Enter for new line
          </p>
          <Button
            type="submit"
            size="lg"
            disabled={disabled || !value.trim()}
            className="ml-auto h-10 shrink-0 rounded-full bg-gradient-to-b from-[hsl(263_70%_64%)] to-[hsl(263_70%_52%)] px-5 font-semibold text-white shadow-glow-sm transition-all duration-300 hover:from-[hsl(263_70%_68%)] hover:to-[hsl(263_70%_56%)] hover:shadow-glow-ai disabled:opacity-40"
          >
            <Sparkles className="h-4 w-4" />
            Ask AI
          </Button>
        </div>
      </form>
    </section>
  );
});

export default AiWorkspaceSearchBar;
