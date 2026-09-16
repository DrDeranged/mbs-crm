export type RoutingMode = "manual" | "round_robin";

export type RoutingSettings = {
  mode: RoutingMode;
  staleDays: number;
  autoReassignStale: boolean;
};

export const DEFAULT_ROUTING_SETTINGS: Readonly<RoutingSettings> = {
  mode: "manual",
  staleDays: 7,
  autoReassignStale: false,
};

/**
 * QR card leads already belong to the attributed representative and imported
 * prospect lists are deliberately not inbound traffic. Only ordinary website
 * inbound records may enter the rotation.
 */
export function isRoundRobinEligibleInboundSource(source: string): boolean {
  return source === "website" || source === "usfundadvisor";
}

export function shouldRoundRobinAssign(
  source: string,
  settings: Pick<RoutingSettings, "mode">,
): boolean {
  return settings.mode === "round_robin" && isRoundRobinEligibleInboundSource(source);
}

export function shouldAutoReassignStale(
  source: string,
  settings: Pick<RoutingSettings, "mode" | "autoReassignStale">,
): boolean {
  return settings.autoReassignStale && shouldRoundRobinAssign(source, settings);
}