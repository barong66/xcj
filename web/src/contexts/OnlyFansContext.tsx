"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { ReactNode } from "react";

interface OnlyFansState {
  url: string | null;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

interface OnlyFansContextValue extends OnlyFansState {
  set: (url: string | null, username: string | null, displayName: string | null, avatarUrl: string | null) => void;
}

const OnlyFansContext = createContext<OnlyFansContextValue>({
  url: null,
  username: null,
  displayName: null,
  avatarUrl: null,
  set: () => {},
});

export function OnlyFansProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OnlyFansState>({ url: null, username: null, displayName: null, avatarUrl: null });

  const set = useCallback((url: string | null, username: string | null, displayName: string | null, avatarUrl: string | null) => {
    setState({ url, username, displayName, avatarUrl });
  }, []);

  return (
    <OnlyFansContext.Provider value={{ ...state, set }}>
      {children}
    </OnlyFansContext.Provider>
  );
}

export function useOnlyFans() {
  return useContext(OnlyFansContext);
}

export function OnlyFansHeaderSetter({
  url,
  username,
  displayName,
  avatarUrl,
}: {
  url: string | null;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}) {
  const { set } = useOnlyFans();

  useEffect(() => {
    set(url, username, displayName, avatarUrl);
    return () => set(null, null, null, null);
  }, [url, username, displayName, avatarUrl, set]);

  return null;
}
