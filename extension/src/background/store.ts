// Single-writer access to the extension state in chrome.storage.local.
// Every update runs in order on a cloned draft, so concurrent events never lose writes.
import { migrateState, type State } from "./state";

const KEY = "state";
let cache: State | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function load(): Promise<State> {
  if (cache) return cache;
  const stored = await chrome.storage.local.get(KEY);
  cache = migrateState(stored[KEY], crypto.randomUUID());
  if (!stored[KEY]) await chrome.storage.local.set({ [KEY]: cache });
  return cache;
}

/** Reads the state after all pending updates have been written. */
export function readState(): Promise<State> {
  const run = queue.then(load);
  queue = run.catch(() => undefined);
  return run;
}

/** Applies `mutate` to a draft; the draft is saved only if `mutate` does not throw. */
export function updateState<T>(mutate: (draft: State) => T): Promise<T> {
  const run = queue.then(async () => {
    const draft = structuredClone(await load());
    const result = mutate(draft);
    await chrome.storage.local.set({ [KEY]: draft });
    cache = draft;
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}
