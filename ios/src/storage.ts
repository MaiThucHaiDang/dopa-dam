// The page's state lives in localStorage on the phone, as the extension's State object under one key.
// Every update re-reads the stored value first, so two open tabs never overwrite each other.
import { initialState, migrateState, type State } from "../../extension/src/background/state";

export const STORAGE_KEY = "dopadam-ios:state";
export const CORRUPT_KEY = `${STORAGE_KEY}:corrupt`;

/** The part of the Storage interface the page uses. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** localStorage, or null when the browser refuses it (private mode, blocked site data). */
export function browserStorage(): KeyValueStore | null {
  try {
    const ls = window.localStorage;
    const probe = "dopadam-ios:probe";
    ls.setItem(probe, "1");
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

/** Turns whatever is stored into a State: missing or broken parts get defaults. This client has no domain rules. */
export function parseStored(text: string | null, profileId: string): State {
  let raw: unknown = null;
  if (text) {
    try {
      raw = JSON.parse(text);
    } catch {
      raw = null;
    }
  }
  const state = raw ? migrateState(raw, profileId) : initialState(profileId);
  state.domainRules = [];
  state.allowUrls = [];
  return state;
}

export class Store {
  /** False while data cannot be written to the browser's storage (it is then kept in memory for this page only). */
  persistent: boolean;
  private memory: State | null = null;

  constructor(
    private readonly kv: KeyValueStore | null,
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {
    this.persistent = kv !== null;
  }

  /** A copy of the stored state; mutating it changes nothing. */
  read(): State {
    if (!this.persistent && this.memory) return structuredClone(this.memory);
    let text: string | null = null;
    if (this.kv) {
      try {
        text = this.kv.getItem(STORAGE_KEY);
      } catch {
        this.persistent = false;
        if (this.memory) return structuredClone(this.memory);
      }
    }
    // A text that is not valid JSON is kept aside once, so a bug never destroys the only copy.
    if (text && this.kv && !isJson(text)) {
      try {
        if (!this.kv.getItem(CORRUPT_KEY)) this.kv.setItem(CORRUPT_KEY, text);
      } catch {
        // Nothing more to do.
      }
    }
    return parseStored(text, this.newId());
  }

  /** Applies `mutate` to a draft and saves it; the result of `mutate` is returned. A throw saves nothing. */
  update<T>(mutate: (draft: State) => T): T {
    const draft = this.read();
    const result = mutate(draft);
    this.write(draft);
    return result;
  }

  private write(state: State): void {
    this.memory = structuredClone(state);
    if (!this.kv) return;
    try {
      this.kv.setItem(STORAGE_KEY, JSON.stringify(state));
      this.persistent = true;
    } catch {
      this.persistent = false;
    }
  }
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}
