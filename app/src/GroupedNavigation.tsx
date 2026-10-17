import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export function GroupedNavigation<T extends string>({ items, value, onNavigate, orderCount }: {
  items: { id: T; label: string; icon: LucideIcon; group: string }[];
  value: T;
  onNavigate: (value: T) => void;
  orderCount: number;
}) {
  const id = useId();
  const [openGroup, setOpenGroup] = useState<string | null>(
    () => items.find((item) => item.id === value)?.group ?? null,
  );
  const groups = [...new Set(items.map((item) => item.group))];
  return <nav aria-label="Navegação principal">
    {groups.map((group, index) => {
      const children = items.filter((item) => item.group === group);
      const current = children.some((item) => item.id === value);
      const expanded = openGroup === group;
      const Icon = children[0].icon;
      if (children.length === 1) return <section className="nav-section" key={group}>
        <button type="button" className={`nav-section-toggle${current ? " current" : ""}`}
          aria-current={current ? "page" : undefined}
          onClick={() => onNavigate(children[0].id)}>
          <Icon size={18} /><span>{group}</span>
        </button>
      </section>;
      return <section className="nav-section" key={group}>
        <button type="button" className={`nav-section-toggle${current ? " current" : ""}`}
          aria-expanded={expanded} aria-controls={`${id}-${index}`}
          onClick={() => setOpenGroup(expanded ? null : group)}>
          <Icon size={18} /><span>{group}</span><ChevronDown size={15} />
        </button>
        <div id={`${id}-${index}`} className="nav-section-items" hidden={!expanded}>
          {children.map((item) => <button type="button" key={item.id}
            className={`nav-item ${value === item.id ? "active" : ""}`}
            aria-current={value === item.id ? "page" : undefined}
            onClick={() => onNavigate(item.id)}>
            <item.icon size={18} strokeWidth={1.7} /><span>{item.label}</span>
            {item.id === "orders" && <b>{orderCount}</b>}
          </button>)}
        </div>
      </section>;
    })}
  </nav>;
}
