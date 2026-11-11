import { FEED_DESCRIPTION } from "../../api/backend";

export function Header() {
  return (
    <header className="header">
      <h1>STS2026 Robotic AI</h1>
      <span className="header__backend">{FEED_DESCRIPTION}</span>
    </header>
  );
}
