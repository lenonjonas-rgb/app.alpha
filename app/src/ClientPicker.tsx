import { useEffect, useId, useRef, useState } from "react";
import type { Client } from "./domain";
import { searchClients } from "./clientSearch";

export function ClientPicker({
  clients,
  value,
  onChange,
}: {
  clients: Client[];
  value: string;
  onChange: (id: string) => void;
}) {
  const inputId = useId();
  const listId = useId();
  const helpId = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState(
    () => clients.find((client) => client.id === value)?.name ?? "",
  );
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const results = searchClients(clients, query, value);
  const selected = clients.find((client) => client.id === value);

  useEffect(() => {
    input.current?.setCustomValidity(
      selected ? "" : "Selecione um cliente cadastrado nas sugestões.",
    );
  }, [selected]);

  useEffect(() => {
    if (open)
      list.current?.children[activeIndex]?.scrollIntoView({
        block: "nearest",
      });
  }, [open, activeIndex]);

  function select(client: Client) {
    onChange(client.id);
    setQuery(client.name);
    setOpen(false);
    setActiveIndex(0);
    input.current?.setCustomValidity("");
  }

  return (
    <div className="field full client-picker">
      <label htmlFor={inputId}>Cliente *</label>
      <input type="hidden" name="clientId" value={value} />
      <input
        ref={input}
        id={inputId}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={
          open && results[activeIndex]
            ? `${listId}-${activeIndex}`
            : undefined
        }
        aria-describedby={helpId}
        placeholder="Digite o nome, CPF ou CNPJ do cliente"
        autoComplete="off"
        value={query}
        required
        onChange={(event) => {
          setQuery(event.target.value);
          onChange("");
          input.current?.setCustomValidity(
            "Selecione um cliente cadastrado nas sugestões.",
          );
          setActiveIndex(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            if (!open) setActiveIndex(0);
            else
              setActiveIndex((index) =>
                results.length
                  ? (index +
                      (event.key === "ArrowDown" ? 1 : results.length - 1)) %
                    results.length
                  : 0,
              );
          } else if (event.key === "Enter" && open) {
            event.preventDefault();
            const client = results[activeIndex];
            if (client) select(client);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
        }}
      />
      <small id={helpId}>
        {selected
          ? `Selecionado: ${selected.name}${selected.document ? ` · ${selected.document}` : ""}`
          : "Busque por parte do nome ou do documento e selecione uma sugestão."}
      </small>
      {open && (
        <>
          <ul
            ref={list}
            id={listId}
            role="listbox"
            aria-label="Clientes encontrados"
            className="client-picker-results"
          >
            {results.map((client, index) => (
              <li
                key={client.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={client.id === value}
                className={index === activeIndex ? "highlighted" : ""}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(client)}
                onMouseMove={() => setActiveIndex(index)}
              >
                <strong>{client.name}</strong>
                <span>
                  {client.document || "Documento não informado"}
                  {!client.active ? " · Inativo" : ""}
                </span>
              </li>
            ))}
          </ul>
          <small role="status" aria-live="polite">
            {results.length
              ? `${results.length} cliente(s) encontrado(s).`
              : "Nenhum cliente cadastrado corresponde à busca."}
          </small>
        </>
      )}
    </div>
  );
}
