import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { Inbox, X } from "lucide-react";

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      aria-labelledby={titleId}
      onCancel={onClose}
    >
      <div className="modal-heading">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="icon-button"
          title="Fechar"
          aria-label="Fechar"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <Inbox size={32} strokeWidth={1.4} />
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Badge({ value }: { value: string }) {
  const color = ["Finalizada", "Aprovado", "Ativo"].includes(value)
    ? "green"
    : ["Alta", "Recusado", "Sem estoque", "Inativo"].includes(value)
      ? "red"
      : ["Em atendimento", "Enviado"].includes(value)
        ? "blue"
        : ["Pausada", "Estoque baixo"].includes(value)
          ? "amber"
          : "neutral";
  return (
    <span className={`badge ${color}`}>
      <span />
      {value}
    </span>
  );
}
