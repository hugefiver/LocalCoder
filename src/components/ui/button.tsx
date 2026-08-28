import { ComponentProps } from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium outline-none transition-[color,background-color,border-color,opacity] duration-100 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 data-[loading=true]:cursor-wait [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/40",
  {
    variants: {
      variant: {
        default:
          "border border-primary bg-primary text-primary-foreground hover:border-[var(--accent-hover)] hover:bg-[var(--accent-hover)] active:opacity-80",
        destructive:
          "border border-destructive bg-destructive text-destructive-foreground hover:opacity-90 focus-visible:ring-destructive",
        outline:
          "border border-border bg-background text-foreground hover:border-[var(--border-strong)] hover:bg-accent hover:text-accent-foreground",
        secondary:
          "border border-border bg-secondary text-secondary-foreground hover:border-[var(--border-strong)] hover:bg-[var(--surface-raised)]",
        ghost:
          "border border-transparent hover:border-border hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 gap-1 px-3 has-[>svg]:px-2",
        lg: "h-12 px-6 has-[>svg]:px-4",
        icon: "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  ...props
}: ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    loading?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      data-loading={loading}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
