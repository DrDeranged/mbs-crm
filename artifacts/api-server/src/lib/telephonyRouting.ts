export const APPROVED_TWILIO_NUMBERS = [
  "+19088608507",
  "+19084987548",
] as const;

export const approvedTwilioNumbers = new Set<string>(APPROVED_TWILIO_NUMBERS);

export function selectVoiceCallerId(voiceCallerId: string, clientIdentity: string): string {
  return voiceCallerId || clientIdentity;
}

export function isOwnedInboundNumber(number: string, ownedNumbers: ReadonlySet<string>): boolean {
  return Boolean(number) && ownedNumbers.has(number);
}

export function selectSmsSender(
  configuredSender: string,
  inboundTo: string | null | undefined,
  ownedNumbers: ReadonlySet<string>,
): string {
  return isOwnedInboundNumber(inboundTo || "", ownedNumbers) ? inboundTo! : configuredSender;
}