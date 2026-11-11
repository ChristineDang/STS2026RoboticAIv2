import type { PageId } from "../../hooks/useHashPage";

const NAV_ITEMS: { id: PageId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "alerts", label: "Alert log" },
  { id: "settings", label: "Settings" },
];

export function Sidebar({ current }: { current: PageId }) {
  return (
    <nav className="sidebar" aria-label="Main">
      <ul>
        {NAV_ITEMS.map((item) => (
          <li key={item.id}>
            <a
              href={`#/${item.id}`}
              className={`sidebar__link${current === item.id ? " sidebar__link--active" : ""}`}
              aria-current={current === item.id ? "page" : undefined}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
