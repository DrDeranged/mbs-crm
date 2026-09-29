function getQueueBlockReason(ownerUserId, currentUserId) {
  if (!ownerUserId) return "legacy_unowned";
  if (ownerUserId !== currentUserId) return "different_user";
  return null;
}

function buildReplayAuthorization(token) {
  if (typeof token !== "string" || token.trim().length === 0) return null;
  return `Bearer ${token}`;
}

function bindQueueMutationToOwner(mutation, ownerUserId) {
  if (typeof ownerUserId !== "string" || ownerUserId.length === 0) {
    throw new Error("Sign in before saving an offline change.");
  }
  return { ...mutation, ownerUserId };
}

module.exports = {
  getQueueBlockReason,
  buildReplayAuthorization,
  bindQueueMutationToOwner,
};