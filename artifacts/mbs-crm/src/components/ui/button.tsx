import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#17A567] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 motion-reduce:transition-none",
  {
    variants: {
      variant: {
        default:
            "border border-[#149258] bg-gradient-to-b from-[#1DB674] to-[#149258] text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,.18)] hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(23,165,103,.35)] active:scale-[.98] motion-reduce:hover:translate-y-0",
        destructive:
          "border border-destructive-border bg-destructive text-destructive-foreground shadow-[inset_0_1px_0_rgba(255,255,255,.16)] hover:-translate-y-0.5 hover:shadow-lg active:scale-[.98] motion-reduce:hover:translate-y-0",
        outline:
          // @replit Shows the background color of whatever card / sidebar / accent background it is inside of.
          // Inherits the current text color. Uses shadow-xs. no shadow on active
          // No hover state
          "border border-border bg-transparent text-[#46586C] shadow-xs hover:border-[#17A567] hover:bg-[#17A567]/5 hover:text-[#149258] active:scale-[.98]",
        secondary:
          // @replit border, no hover, no shadow, secondary border.
          "border border-secondary-border bg-secondary text-secondary-foreground hover:bg-[#17A567]/5 hover:text-[#149258] ",
        // @replit no hover, transparent border
        ghost: "border border-transparent",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        // @replit changed sizes
        default: "min-h-11 px-5 py-2",
        sm: "min-h-8 rounded-md px-3 text-xs",
        lg: "min-h-11 px-8",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
