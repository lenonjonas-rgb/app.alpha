import { useEffect, useId, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronDown } from "lucide-react";

export type DropdownAction = {
  label: string;
  onSelect: () => void;
  icon?: LucideIcon;
  disabled?: boolean;
  danger?: boolean;
  current?: boolean;
};

export function DropdownMenu({ label = "Mais ações", accessibleLabel = label, actions, active = false }: {
  label?: string;
  accessibleLabel?: string;
  actions: DropdownAction[];
  active?: boolean;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const available = actions.filter((action) => !action.disabled);

  useEffect(() => {
    function close(event: Event) {
      if (event.type === "scroll" && event.target instanceof Node && popup.current?.contains(event.target)) return;
      popup.current?.hidePopover();
    }
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
    };
  }, []);

  function focusItem(last = false) {
    const items = popup.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
    (last ? items?.[items.length - 1] : items?.[0])?.focus({ preventScroll: true });
  }

  return <div className="dropdown">
    <button ref={trigger} type="button" className={`button ${active ? "primary" : "secondary"} dropdown-trigger`}
      popoverTarget={id} aria-haspopup="menu" aria-expanded="false" aria-label={accessibleLabel}
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        popup.current?.showPopover();
        focusItem(event.key === "ArrowUp");
      }}>
      {label}<ChevronDown size={15} />
    </button>
    <div ref={popup} id={id} popover="auto" role="menu" aria-label={accessibleLabel}
      className="dropdown-popup"
      onToggle={(event) => {
        const open = event.newState === "open";
        trigger.current?.setAttribute("aria-expanded", String(open));
        if (!open || !trigger.current || !popup.current) return;
        const anchor = trigger.current.getBoundingClientRect();
        const menu = popup.current;
        const width = menu.getBoundingClientRect().width;
        const below = window.innerHeight - anchor.bottom - 12;
        const above = anchor.top - 12;
        const upwards = below < Math.min(menu.scrollHeight, 240) && above > below;
        menu.style.maxHeight = `${Math.max(80, upwards ? above : below)}px`;
        menu.style.left = `${Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8))}px`;
        menu.style.top = upwards ? "auto" : `${anchor.bottom + 6}px`;
        menu.style.bottom = upwards ? `${window.innerHeight - anchor.top + 6}px` : "auto";
        focusItem();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          popup.current?.hidePopover();
          trigger.current?.focus({ preventScroll: true });
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End", "Tab"].includes(event.key)) return;
        if (event.key === "Tab") {
          popup.current?.hidePopover();
          return;
        }
        event.preventDefault();
        const items = Array.from(popup.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
        const index = items.findIndex((item) => item === document.activeElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 :
          (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}>
      {actions.map((action) => <button type="button" role="menuitem" key={action.label}
        className={`dropdown-action${action.danger ? " danger" : ""}`}
        disabled={action.disabled} aria-current={action.current ? "page" : undefined}
        onClick={() => {
          popup.current?.hidePopover();
          trigger.current?.focus();
          action.onSelect();
        }}>
        {action.icon && <action.icon size={17} />}<span>{action.label}</span>
      </button>)}
      {!available.length && <span className="dropdown-empty">Nenhuma ação disponível</span>}
    </div>
  </div>;
}
