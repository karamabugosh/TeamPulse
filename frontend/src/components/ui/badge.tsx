import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary/15 text-primary',
        secondary: 'border-white/[0.08] bg-white/[0.05] text-slate-200',
        destructive: 'border-module-blockers/25 bg-module-blockers/12 text-red-400',
        outline: 'text-foreground border-white/[0.1]',
        success: 'border-module-slack/25 bg-module-slack/12 text-emerald-400',
        warning: 'border-amber-500/25 bg-amber-500/12 text-amber-400',
        danger: 'border-module-blockers/25 bg-module-blockers/12 text-red-400',
        info: 'border-[#6366F1]/30 bg-[#4F46E5]/15 text-[#60A5FA]',
        purple: 'border-module-ai/25 bg-module-ai/12 text-violet-300',
        cyan: 'border-cyan-500/25 bg-cyan-500/12 text-cyan-300',
        todo: 'border-slate-500/30 bg-slate-500/15 text-slate-300',
        progress: 'border-[#6366F1]/30 bg-[#4F46E5]/15 text-[#A5B4FC]',
        done: 'border-module-slack/25 bg-module-slack/12 text-emerald-400',
        blocked: 'border-orange-500/30 bg-orange-500/15 text-orange-400',
        review: 'border-cyan-500/30 bg-cyan-500/15 text-cyan-300',
        jira: 'border-[#6366F1]/30 bg-[#4F46E5]/15 text-[#60A5FA]',
        slack: 'border-module-slack/25 bg-module-slack/12 text-emerald-400',
        reports: 'border-module-reports/25 bg-module-reports/12 text-orange-400',
        blockers: 'border-module-blockers/25 bg-module-blockers/12 text-red-400',
        ai: 'border-module-ai/25 bg-module-ai/12 text-violet-300',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
