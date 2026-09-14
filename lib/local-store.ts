/**
 * A JSON value kept in localStorage, shaped for useSyncExternalStore.
 *
 * Snapshots are cached by the raw stored string so React sees a stable
 * reference between renders. When storage is unavailable (private browsing,
 * blocked site data) the value is kept in memory for the session instead.
 */
export interface LocalStore<T> {
  read: () => T;
  write: (value: T) => void;
  subscribe: (onChange: () => void) => () => void;
  serverSnapshot: () => T;
}

export function createLocalStore<T>(key: string, parse: (value: unknown) => T, fallback: T): LocalStore<T> {
  const changeEvent = `mop-radar:store:${key}`;
  let memory: string | null = null;
  let cachedRaw: string | null | undefined;
  let cachedValue = fallback;

  function rawValue(): string | null {
    try {
      return window.localStorage.getItem(key) ?? memory;
    } catch {
      return memory;
    }
  }

  function read(): T {
    const raw = rawValue();
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      if (raw === null) {
        cachedValue = fallback;
      } else {
        try {
          cachedValue = parse(JSON.parse(raw));
        } catch {
          cachedValue = fallback;
        }
      }
    }
    return cachedValue;
  }

  function write(value: T) {
    const raw = JSON.stringify(value);
    try {
      window.localStorage.setItem(key, raw);
      memory = null;
    } catch {
      memory = raw;
    }
    window.dispatchEvent(new Event(changeEvent));
  }

  function subscribe(onChange: () => void): () => void {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === key) onChange();
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener(changeEvent, onChange);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(changeEvent, onChange);
    };
  }

  return { read, write, subscribe, serverSnapshot: () => fallback };
}
