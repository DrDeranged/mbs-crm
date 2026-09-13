import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Return the name that should be shown for a CRM user.
 *
 * Some Clerk users have not set a display name yet. In that case the local
 * part of their email is useful context, while showing the full address in a
 * person-picker or activity feed is noisy and can expose more information
 * than is needed for a label.
 */
export function getUserDisplayName(
  user:
    | {
        name?: string | null
        email?: string | null
        fullName?: string | null
        primaryEmailAddress?: { emailAddress?: string | null } | null
      }
    | null
    | undefined,
  fallback = "User",
) {
  const name = user?.name?.trim() || user?.fullName?.trim()
  if (name) return name

  const email =
    user?.email?.trim() ||
    user?.primaryEmailAddress?.emailAddress?.trim() ||
    ""
  const localPart = email.split("@")[0]?.trim()
  return localPart || fallback
}
