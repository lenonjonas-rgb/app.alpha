import { z } from "zod";

export const servicePointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  address: z.string().min(1).max(2000).refine((value) => value.trim().length > 0, "Informe o endereço do ponto."),
  source: z.literal("Google Maps").optional(),
});
const amount = z.number().int().nonnegative().max(100_000_000);
export const routeEndpointSchema = z.union([servicePointSchema, z.object({
  address: servicePointSchema.shape.address,
}).strict()]);
export const travelRouteSchema = z.object({
  provider: z.literal("Google Maps"),
  calculatedAt: z.iso.datetime(),
  origin: routeEndpointSchema,
  destination: routeEndpointSchema,
  outboundMeters: z.number().int().nonnegative().max(50_000_000),
  returnMeters: z.number().int().nonnegative().max(50_000_000),
  tollEstimate: z.object({ outbound: amount.nullable(), return: amount.nullable() }).optional(),
});
export const travelSchema = z.object({
  route: travelRouteSchema,
  chargeTravel: z.boolean(),
  fuelPrice: amount.positive(),
  kilometersPerLiter: z.number().min(0.01).max(1000),
  kilometerRate: amount,
  tolls: amount,
  tollsConfirmed: z.boolean().optional(),
});
export type Travel = z.infer<typeof travelSchema>;
export type TravelRoute = z.infer<typeof travelRouteSchema>;

export function routeTolls(route: TravelRoute): number | undefined {
  const estimate = route.tollEstimate;
  return estimate && estimate.outbound !== null && estimate.return !== null
    ? estimate.outbound + estimate.return : undefined;
}

export function assertTravelReady(travel: Travel | undefined, chargeTravel: boolean) {
  if (!travel) throw new Error("Calcule a rota e os custos do deslocamento antes de salvar a OS.");
  if (travel.tollsConfirmed === false)
    throw new Error("O Google não informou todos os preços de pedágio. Informe e confirme o total de ida e volta, mesmo que seja zero.");
  if (travel.chargeTravel !== chargeTravel)
    throw new Error("Confira a opção de cobrança de deslocamento antes de salvar.");
}

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

export function travelEndpoint(address: string, point: z.infer<typeof servicePointSchema> | undefined): TravelRoute["origin"] {
  return point?.address === address ? point : { address };
}

export function sameTravelEndpoint(first: TravelRoute["origin"], second: TravelRoute["origin"]) {
  if ("latitude" in first && "latitude" in second) return samePoint(first, second);
  return !("latitude" in first) && !("latitude" in second) && first.address === second.address;
}
