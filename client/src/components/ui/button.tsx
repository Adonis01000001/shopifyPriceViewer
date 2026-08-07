import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[0.72rem] text-sm font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-150 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/35 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[var(--shadow-button)] hover:-translate-y-px hover:bg-primary/90 hover:shadow-[var(--shadow-button-hover)] active:translate-y-0 active:shadow-none",
        destructive:
          "bg-destructive text-white shadow-[var(--shadow-button)] hover:-translate-y-px hover:bg-destructive/90 hover:shadow-[var(--shadow-button-hover)] active:translate-y-0 active:shadow-none focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border border-input bg-surface-container-lowest text-foreground shadow-[var(--shadow-button)] hover:-translate-y-px hover:border-primary/45 hover:bg-surface-container hover:shadow-[var(--shadow-button-hover)] active:translate-y-0 active:shadow-none dark:bg-surface-container-lowest dark:hover:bg-surface-container",
        secondary:
          "bg-secondary text-secondary-foreground shadow-[var(--shadow-button)] hover:-translate-y-px hover:bg-secondary/80 hover:shadow-[var(--shadow-button-hover)] active:translate-y-0 active:shadow-none",
        ghost:
          "hover:bg-surface-container hover:text-foreground active:bg-surface-container/80",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-4 py-2 has-[>svg]:px-3",
        sm: "h-10 rounded-[0.65rem] gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-11 rounded-[0.75rem] px-6 has-[>svg]:px-4",
        icon: "size-11",
        "icon-sm": "size-10",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
