function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("O Google retornou uma localização inválida.");
  return value as Record<string, unknown>;
}

export async function geocodeAddress(address: string, key: string, fetcher: typeof fetch) {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("language", "pt-BR");
  url.searchParams.set("region", "br");
  url.searchParams.set("key", key);
  let result: Response;
  try {
    result = await fetcher(url, { signal: AbortSignal.timeout(15000) });
  } catch {
    throw new Error("Não foi possível consultar o endereço no Google. Verifique a conexão e tente novamente.");
  }
  if (!result.ok) throw new Error("O Google recusou a localização. Confira a Geocoding API, a chave, as cotas e o faturamento.");
  const body = record(await result.json());
  if (body.status === "ZERO_RESULTS") throw new Error("Endereço não encontrado. Confira rua, número, cidade, UF e CEP ou marque o ponto manualmente.");
  if (body.status !== "OK") throw new Error("Não foi possível localizar o endereço. Habilite a Geocoding API e permita essa API na chave do servidor; confira cotas e faturamento.");
  if (!Array.isArray(body.results) || body.results.length !== 1)
    throw new Error("O endereço possui mais de uma localização possível. Complete o endereço ou marque o ponto manualmente.");
  const found = record(body.results[0]);
  const geometry = record(found.geometry);
  if (found.partial_match || !["ROOFTOP", "RANGE_INTERPOLATED"].includes(String(geometry.location_type)))
    throw new Error("O Google encontrou apenas uma localização aproximada ou parcial. Complete o endereço com número e cidade ou marque o ponto manualmente.");
  const location = record(geometry.location);
  if (typeof location.lat !== "number" || !Number.isFinite(location.lat) || Math.abs(location.lat) > 90 ||
    typeof location.lng !== "number" || !Number.isFinite(location.lng) || Math.abs(location.lng) > 180)
    throw new Error("O Google retornou coordenadas inválidas para o endereço.");
  return { latitude: location.lat, longitude: location.lng, address, source: "Google Maps" };
}
