import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all duration-250 ease-premium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]',
  {
    variants: {
      variant: {
        default:
          'btn-gradient shadow-glow-sm hover:-translate-y-0.5',
        destructive:
          'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 hover:-translate-y-0.5',
        outline:
          'border border-white/[0.1] bg-white/[0.03] text-foreground shadow-sm hover:border-white/[0.16] hover:bg-white/[0.06] hover:-translate-y-0.5',
        secondary:
          'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80 hover:-translate-y-0.5',
        ghost: 'hover:bg-white/[0.06] hover:text-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        cyan: 'bg-cyan-brand/12 text-cyan-brand border border-cyan-brand/20 hover:bg-cyan-brand/20 hover:-translate-y-0.5',
        jira: 'bg-gradient-to-r from-[#4F46E5] to-[#3B82F6] text-white border border-[#6366F1]/30 shadow-[0_0_24px_-8px_rgba(59,130,246,0.55)] hover:from-[#6366F1] hover:to-[#60A5FA] hover:-translate-y-0.5',
        slack: 'bg-module-slack/15 text-module-slack border border-module-slack/25 hover:bg-module-slack/25 hover:-translate-y-0.5',
        reports:
          'bg-module-reports/15 text-module-reports border border-module-reports/25 hover:bg-module-reports/25 hover:-translate-y-0.5',
        blockers:
          'bg-module-blockers/15 text-module-blockers border border-module-blockers/25 hover:bg-module-blockers/25 hover:-translate-y-0.5',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-lg px-3 text-xs',
        lg: 'h-11 rounded-xl px-6',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
