// Entry point: picks the screen from the URL hash and registers the service worker for offline use.
import { mountHome } from "./home";
import { parseRoute } from "./route";
import { localTzOffset } from "../../extension/src/core";
import { settle } from "./session";
import { Store, browserStorage } from "./storage";
import { mountWarning } from "./warning";

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app");
const store = new Store(browserStorage());

let unmount: (() => void) | null = null;

function show(): void {
  unmount?.();
  unmount = null;
  const route = parseRoute(location.hash);
  document.title = route.name === "warn" ? `DopaDam · ${route.app}` : "DopaDam";
  if (route.name === "warn") {
    unmount = mountWarning(root!, route.app, store);
  } else {
    // Warnings that were left without a choice count as Thoát the next time the page loads.
    const now = Date.now();
    store.update((d) => settle(d, now, localTzOffset(now)));
    unmount = mountHome(root!, store);
  }
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", show);
show();

if ("serviceWorker" in navigator) {
  // Relative to the page, so it works from any sub-path (GitHub Pages project sites).
  navigator.serviceWorker.register("sw.js").catch(() => undefined);
}
