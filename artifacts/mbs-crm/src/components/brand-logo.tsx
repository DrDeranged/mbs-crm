import { cn } from "@/lib/utils";
import { brandLogoSrc, type BrandLogoVariant } from "@/lib/brand-assets";
import { useOptionalAppearance } from "@/components/appearance-provider";

type BrandLogoProps = {
  variant?: BrandLogoVariant;
  alt?: string;
  className?: string;
  imageClassName?: string;
};

export function BrandLogo({
  variant,
  alt = "My Business Solutions logo",
  className,
  imageClassName,
}: BrandLogoProps) {
  const appearance = useOptionalAppearance();
  const resolvedVariant = variant ?? (appearance?.mode === "dark" ? "reverse" : "light");
  return (
    <span className={cn("inline-flex shrink-0 items-center", className)}>
      <img
        src={brandLogoSrc(resolvedVariant, import.meta.env.BASE_URL)}
        alt={alt}
        className={cn("h-7 w-auto object-contain", imageClassName)}
      />
    </span>
  );
}