import mbsLogo from "@/assets/MBS-Logo-Header-Logo.png";
import { cn } from "@/lib/utils";

type BrandLogoProps = {
  variant?: "chip" | "raw";
  alt?: string;
  className?: string;
  imageClassName?: string;
};

/**
 * The official MBS wordmark is black on transparency. Use the chip variant
 * wherever the surrounding surface is dark, and raw on light surfaces.
 */
export function BrandLogo({
  variant = "raw",
  alt = "My Business Solutions",
  className,
  imageClassName,
}: BrandLogoProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center",
        variant === "chip" && "rounded-[10px] bg-white px-3 py-1.5 shadow-sm",
        className,
      )}
    >
      <img
        src={mbsLogo}
        alt={alt}
        className={cn("h-7 w-auto object-contain", imageClassName)}
      />
    </span>
  );
}