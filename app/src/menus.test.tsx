import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CalendarDays, Settings, Users } from "lucide-react";
import { GroupedNavigation } from "./GroupedNavigation";
import { DropdownMenu } from "./DropdownMenu";

describe("menus do painel", () => {
  it("expande somente o grupo da página atual e preserva identificação e destino dos itens", () => {
    const html = renderToStaticMarkup(<GroupedNavigation value="clients" orderCount={3} onNavigate={vi.fn()}
      items={[
        { id: "agenda", label: "Agenda", icon: CalendarDays, group: "Operação" },
        { id: "orders", label: "Ordens de serviço", icon: CalendarDays, group: "Operação" },
        { id: "clients", label: "Clientes", icon: Users, group: "Cadastros" },
        { id: "equipment", label: "Equipamentos", icon: Settings, group: "Cadastros" },
        { id: "settings", label: "Configurações", icon: Settings, group: "Administração" },
      ]} />);
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(1);
    expect(html.match(/ hidden=""/g)).toHaveLength(1);
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Clientes");
    expect(html).toContain("<b>3</b>");
    expect(html.match(/aria-controls=/g)).toHaveLength(2);
    expect(html).toContain("Administração</span></button></section>");
  });

  it("mantém ações desabilitadas, perigosas e seleção atual em popover acessível", () => {
    const html = renderToStaticMarkup(<DropdownMenu accessibleLabel="Mais ações: conta" actions={[
      { label: "Classificar", current: true, onSelect: vi.fn() },
      { label: "Cancelar conta", danger: true, disabled: true, onSelect: vi.fn() },
    ]} />);
    expect(html).toContain('popover="auto"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('role="menu"');
    expect(html.match(/role="menuitem"/g)).toHaveLength(2);
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('class="dropdown-action danger" disabled=""');
    expect(html).toContain('aria-label="Mais ações: conta"');
  });
});
