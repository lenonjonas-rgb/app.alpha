import type { Activity, Order } from "./domain";
import { orderServiceAddress } from "./domain";

export type Coordinates = { latitude: number; longitude: number };

export function distanceMeters(first: Coordinates, second: Coordinates): number {
  const radians = Math.PI / 180;
  const latitude = (second.latitude - first.latitude) * radians;
  const longitude = (second.longitude - first.longitude) * radians;
  const haversine = Math.sin(latitude / 2) ** 2 +
    Math.cos(first.latitude * radians) * Math.cos(second.latitude * radians) *
    Math.sin(longitude / 2) ** 2;
  return Math.round(6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, haversine)))));
}

export function serviceDistanceForActivity(
  order: Order,
  client: { address: string },
  location: Coordinates,
): NonNullable<Activity["serviceDistance"]> | undefined {
  const point = order.details?.servicePoint;
  if (!point || point.address !== orderServiceAddress(order, client)) return undefined;
  return { ...point, meters: distanceMeters(location, point) };
}

export function serviceDistanceText(activity: Activity): string {
  if (activity.kind !== "Check-in" && activity.kind !== "Check-out") return "Não se aplica";
  if (!activity.location) return "GPS não registrado";
  if (!activity.serviceDistance) return "Sem ponto confirmado na data do registro";
  return `${activity.serviceDistance.meters.toLocaleString("pt-BR")} m do atendimento (linha reta)`;
}
