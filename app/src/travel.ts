import { z } from "zod";

export const servicePointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  address: z.string().min(1).max(2000).refine((value) => value.trim().length > 0, "Informe o endereço do ponto."),
  source: z.literal("Google Maps").optional(),
});
const amount = z.number().int().nonnegative().max(100_000_000);
export const travelRouteSchema = z.object({
  provider: z.literal("Google Maps"),
  calculatedAt: z.iso.datetime(),
  origin: servicePointSchema,
  destination: servicePointSchema,
  outboundMeters: z.number().int().nonnegative().max(50_000_000),
  returnMeters: z.number().int().nonnegative().max(50_000_000),
});
export const travelSchema = z.object({
  route: travelRouteSchema,
  chargeTravel: z.boolean(),
  fuelPrice: amount.positive(),
  kilometersPerLiter: z.number().min(0.01).max(1000),
  kilometerRate: amount,
  tolls: amount,
});
export type Travel = z.infer<typeof travelSchema>;
export type TravelRoute = z.infer<typeof travelRouteSchema>;

export function travelValues(travel: Travel) {
  const kilometers = (travel.route.outboundMeters + travel.route.returnMeters) / 1000;
  const liters = kilometers / travel.kilometersPerLiter;
  const fuelCost = Math.round(liters * travel.fuelPrice);
  const cost = fuelCost + travel.tolls;
  const mileageCharge = travel.chargeTravel ? Math.round(kilometers * travel.kilometerRate) : 0;
  const charge = travel.chargeTravel ? mileageCharge + travel.tolls : 0;
  return { kilometers, liters, fuelCost, cost, mileageCharge, charge, balance: charge - cost };
}

export function samePoint(first: z.infer<typeof servicePointSchema> | undefined, second: z.infer<typeof servicePointSchema> | undefined) {
  return Boolean(first && second && first.latitude === second.latitude && first.longitude === second.longitude && first.address === second.address);
}
