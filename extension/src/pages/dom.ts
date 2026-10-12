// Tiny DOM helpers shared by the extension pages.

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

type Props = Partial<Record<string, string | number | boolean | EventListener>>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  children: (Node | string | null | undefined | false)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "text") {
      node.textContent = String(value);
    } else if (value === true) {
      node.setAttribute(key, "");
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

export function show(node: HTMLElement, visible: boolean): void {
  node.classList.toggle("hidden", !visible);
}

/** "1:05" from milliseconds. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

export function formatMinutes(minutes: number): string {
  return `${Math.round(minutes)} phút`;
}

export function minutesUntil(at: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((at - now) / 60_000));
}
