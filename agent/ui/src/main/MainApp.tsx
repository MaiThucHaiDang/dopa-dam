// The agent's main window: overview, programs, websites, settings, guide.
import { createContext, useContext, useEffect, useState } from "react";
import { onEvent } from "../api";
import { AppsPage } from "./AppsPage";
import { GuidePage } from "./GuidePage";
import { OverviewPage } from "./OverviewPage";
import { QuitPage } from "./QuitPage";
import { SettingsPage } from "./SettingsPage";
import { SitesPage } from "./SitesPage";

export type Route = "/" | "/apps" | "/sites" | "/settings" | "/guide" | "/quit";

const NAV: { route: Route; label: string }[] = [
  { route: "/", label: "Tổng quan" },
  { route: "/apps", label: "Chương trình" },
  { route: "/sites", label: "Trang web" },
  { route: "/settings", label: "Cài đặt" },
  { route: "/guide", label: "Hướng dẫn" },
];

/** Increments whenever the agent reports a change, so pages reload their data. */
const RefreshContext = createContext(0);
export const useRefresh = () => useContext(RefreshContext);

const NavContext = createContext<(r: Route) => void>(() => undefined);
export const useNavigate = () => useContext(NavContext);

export function MainApp() {
  const [route, setRoute] = useState<Route>("/");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const a = onEvent<null>("state-changed", () => setTick((t) => t + 1));
    const b = onEvent<string>("navigate", (r) => setRoute((r as Route) || "/"));
    // Counts and timers change with time even without an event.
    const timer = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => {
      void a.then((f) => f());
      void b.then((f) => f());
      clearInterval(timer);
    };
  }, []);

  return (
    <NavContext.Provider value={setRoute}>
      <RefreshContext.Provider value={tick}>
        <div className="shell">
          <nav className="sidebar" aria-label="Mục">
            <div className="brand">
              <img src="/icon.png" alt="" width={28} height={28} />
              DopaDam
            </div>
            {NAV.map((n) => (
              <button
                key={n.route}
                className="nav-item"
                aria-current={route === n.route ? "page" : undefined}
                onClick={() => setRoute(n.route)}
              >
                {n.label}
              </button>
            ))}
          </nav>
          <main className="content">
            {route === "/" && <OverviewPage />}
            {route === "/apps" && <AppsPage />}
            {route === "/sites" && <SitesPage />}
            {route === "/settings" && <SettingsPage />}
            {route === "/guide" && <GuidePage />}
            {route === "/quit" && <QuitPage />}
          </main>
        </div>
      </RefreshContext.Provider>
    </NavContext.Provider>
  );
}
