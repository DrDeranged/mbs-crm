import { cn } from "@/lib/utils";
import { brandLogoSrc, type BrandLogoVariant } from "@/lib/brand-assets";

type BrandLogoProps = {
  variant?: BrandLogoVariant;
  alt?: string;
  className?: string;
  imageClassName?: string;
};

export function BrandLogo({
  variant = "light",
  alt = "My Business Solutions logo",
  className,
  imageClassName,
}: BrandLogoProps) {
  return (
    <span className={cn("inline-flex shrink-0 items-center", className)}>
      <img
        src={brandLogoSrc(variant, import.meta.env.BASE_URL)}
        alt={alt}
        className={cn("h-7 w-auto object-contain", imageClassName)}
      />
    </span>
  );
}