type SearchableClient = {
  id: string;
  name: string;
  document: string;
  active: boolean;
};

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeDocument(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function searchClients<T extends SearchableClient>(
  clients: T[],
  query: string,
  selectedId = "",
): T[] {
  const nameQuery = normalizeName(query);
  const documentQuery = normalizeDocument(query);
  const words = nameQuery.split(/\s+/).filter(Boolean);
  return clients
    .filter((client) => client.active || client.id === selectedId)
    .map((client) => {
      const name = normalizeName(client.name);
      const document = normalizeDocument(client.document);
      let rank = 0;
      if (nameQuery) {
        if (name === nameQuery || (documentQuery && document === documentQuery))
          rank = 1;
        else if (
          name.startsWith(nameQuery) ||
          (documentQuery && document.startsWith(documentQuery))
        )
          rank = 2;
        else if (
          words.every((word) => name.includes(word)) ||
          (documentQuery && document.includes(documentQuery))
        )
          rank = 3;
        else rank = 4;
      }
      return { client, rank };
    })
    .filter(({ rank }) => rank !== 4)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.client.name.localeCompare(b.client.name, "pt-BR"),
    )
    .map(({ client }) => client);
}
