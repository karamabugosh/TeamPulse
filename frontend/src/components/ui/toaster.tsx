import React from 'react';
import { X, CheckCircle2, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export const Toaster: React.FC = () => {
  const { toasts, dismiss } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2">
      {toasts.map((toast) => {
        const isSuccess = toast.variant === 'success';
        const isError = toast.variant === 'destructive';

        return (
          <div
            key={toast.id}
            className={cn(
              'rounded-xl border bg-card p-4 shadow-lg animate-in slide-in-from-bottom-2',
              isSuccess && 'border-emerald-500/30',
              isError && 'border-destructive/40',
              !isSuccess && !isError && 'border-border',
            )}
          >
            <div className="flex items-start gap-3">
              {isSuccess && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />}
              {isError && <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{toast.title}</p>
                {toast.description && (
                  <p className="mt-1 text-xs text-muted-foreground">{toast.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                aria-label="Dismiss notification"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
