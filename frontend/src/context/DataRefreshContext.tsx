import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

/**
 * Global real-time data-refresh event bus.
 *
 * Provides:
 *   - Local component event dispatch and version incrementing
 *   - Cross-tab / cross-window real-time synchronization via BroadcastChannel
 *   - Automatic background re-sync on window focus
 *   - Imperative subscriber hook with optional scope filtering
 */

export type RefreshScope =
  | 'media'
  | 'trash'
  | 'folders'
  | 'aliases'
  | 'keys'
  | 'storage'
  | 'activity'
  | 'settings'
  | 'all';

export type RefreshCallback = (scope?: RefreshScope | string) => void;

interface DataRefreshContextValue {
  /** Incrementing counter; include in useEffect deps to re-fetch on change. */
  version: number;
  /** Call this from any component to notify all subscribers and open tabs that data changed. */
  refresh: (scope?: RefreshScope | string) => void;
  /** Register an imperative callback; returns an unsubscribe function. */
  subscribe: (cb: RefreshCallback) => () => void;
}

const DataRefreshContext = createContext<DataRefreshContextValue>({
  version: 0,
  refresh: () => {},
  subscribe: () => () => {},
});

const BROADCAST_CHANNEL_NAME = 'ownmediahost_data_bus';
const STORAGE_PING_KEY = 'ownmediahost_data_bus_ping';

export const DataRefreshProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [version, setVersion] = useState(0);
  const listenersRef = useRef<Set<RefreshCallback>>(new Set());
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
  const lastFocusRefreshRef = useRef<number>(0);

  const notifyLocal = useCallback((scope?: RefreshScope | string) => {
    setVersion((v) => v + 1);
    for (const cb of listenersRef.current) {
      try {
        cb(scope);
      } catch {
        // Prevent one faulty listener from crashing others
      }
    }
  }, []);

  const refresh = useCallback((scope: RefreshScope | string = 'all') => {
    notifyLocal(scope);

    // Broadcast to other open browser tabs/windows
    if (broadcastChannelRef.current) {
      try {
        broadcastChannelRef.current.postMessage({ type: 'REFRESH', scope, timestamp: Date.now() });
      } catch {
        // BroadcastChannel failed or closed
      }
    } else {
      try {
        localStorage.setItem(STORAGE_PING_KEY, `${Date.now()}:${scope}`);
      } catch {
        // Ignore storage exceptions
      }
    }
  }, [notifyLocal]);

  // Set up BroadcastChannel and localStorage listeners for cross-tab sync
  useEffect(() => {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
        broadcastChannelRef.current = channel;

        channel.onmessage = (event) => {
          if (event.data && event.data.type === 'REFRESH') {
            notifyLocal(event.data.scope);
          }
        };

        return () => {
          channel.close();
          broadcastChannelRef.current = null;
        };
      } catch {
        // Fallback to storage event
      }
    }

    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_PING_KEY && e.newValue) {
        const parts = e.newValue.split(':');
        const scope = parts.length > 1 ? parts[1] : 'all';
        notifyLocal(scope);
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [notifyLocal]);

  // Re-sync on window focus (debounced to at most once every 4 seconds)
  useEffect(() => {
    const handleFocus = () => {
      const now = Date.now();
      if (now - lastFocusRefreshRef.current > 4000) {
        lastFocusRefreshRef.current = now;
        notifyLocal('all');
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [notifyLocal]);

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
 * Hook that calls `callback` whenever any component or tab calls `refresh()`.
 * Supports optional scope filtering (e.g. only trigger if scope matches or is 'all').
 */
export const useOnDataRefresh = (
  callback: RefreshCallback,
  targetScope?: RefreshScope | string
) => {
  const { subscribe } = useDataRefresh();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    return subscribe((scope) => {
      if (!targetScope || !scope || scope === 'all' || scope === targetScope) {
        callbackRef.current(scope);
      }
    });
  }, [subscribe, targetScope]);
};
