export function getSafeUserId(getAuthState: () => { userId?: string | null }) {
  try {
    return getAuthState().userId ?? null;
  } catch {
    // Authentication middleware is not guaranteed to have initialized before
    // Express parses malformed JSON.
    return null;
  }
}