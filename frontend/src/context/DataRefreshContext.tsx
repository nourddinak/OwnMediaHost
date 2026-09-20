import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

/**
 * Global data-refresh event bus.
 *
 * Any component can:
 *   - Call `refresh()` to broadcast that data has changed.
 *   - Read `version` (an incrementing counter) in a useEffect dependency
 *     to re-fetch whenever another component calls `refresh()`.
 *   - Call `subscribe(callback)` to be notified imperatively.
 */

type RefreshCallback = () => void;

interface DataRefreshContextValue {
  /** Incrementing counter; include in useEffect deps to re-fetch on change. */
  version: number;
  /** Call this from any component to notify all subscribers that data changed. */
  refresh: () => void;
  /** Register an imperative callback; returns an unsubscribe function. */
  subscribe: (cb: RefreshCallback) => () => void;
}

const DataRefreshContext = createContext<DataRefreshContextValue>({
  version: 0,
  refresh: () => {},
  subscribe: () => () => {},
});

export const DataRefreshProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [version, setVersion] = useState(0);
  const listenersRef = useRef<Set<RefreshCallback>>(new Set());

  const refresh = useCallback(() => {
    setVersion((v) => v + 1);
    for (const cb of listenersRef.current) {
      try {
        cb();
      } catch {
        // Don't let one bad listener break others
      }
    }
  }, []);

  const subscribe = useCallback((cb: RefreshCallback) => {
    listenersRef.current.add(cb);
    return () => {
      listenersRef.current.delete(cb);
    };
  }, []);

  return (
    <DataRefreshContext.Provider value={{ version, refresh, subscribe }}>
      {children}
    </DataRefreshContext.Provider>
  );
};

/** Hook to get the refresh function (for triggering) and version (for reacting). */
export const useDataRefresh = () => useContext(DataRefreshContext);

/**
 * Hook that calls `callback` whenever any component calls `refresh()`.
 * The callback is NOT called on mount — only on subsequent refreshes.
 */
export const useOnDataRefresh = (callback: RefreshCallback) => {
  const { subscribe } = useDataRefresh();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    return subscribe(() => callbackRef.current());
  }, [subscribe]);
};
