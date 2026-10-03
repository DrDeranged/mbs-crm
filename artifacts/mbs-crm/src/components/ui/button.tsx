import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 motion-reduce:transition-none",
  {
    variants: {
      variant: {
        default:
            "border border-primary-border bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[.98]",
        destructive:
          "border border-destructive-border bg-destructive text-destructive-foreground hover:bg-destructive/90 active:scale-[.98]",
        outline:
          // @replit Shows the background color of whatever card / sidebar / accent background it is inside of.
          // Inherits the current text color. Uses shadow-xs. no shadow on active
          // No hover state
          "border border-border bg-transparent text-muted-foreground hover:border-primary hover:bg-accent hover:text-foreground active:scale-[.98]",
        secondary:
          // @replit border, no hover, no shadow, secondary border.
          "border border-secondary-border bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground",
        // @replit no hover, transparent border
        ghost: "border border-transparent",
        link: "text-success underline-offset-4 hover:underline",
      },
      size: {
        // @replit changed sizes
        default: "min-h-11 px-5 py-2",
        sm: "min-h-8 rounded-md px-3 text-xs max-md:min-h-11 max-md:min-w-11",
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
