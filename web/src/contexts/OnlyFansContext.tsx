"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { ReactNode } from "react";

interface OnlyFansState {
  url: string | null;
  username: string | null;
}

interface OnlyFansContextValue extends OnlyFansState {
  set: (url: string | null, username: string | null) => void;
}

const OnlyFansContext = createContext<OnlyFansContextValue>({
  url: null,
  username: null,
  set: () => {},
});

export function OnlyFansProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OnlyFansState>({ url: null, username: null });

  const set = useCallback((url: string | null, username: string | null) => {
    setState({ url, username });
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
}: {
  url: string | null;
  username: string | null;
}) {
  const { set } = useOnlyFans();

  useEffect(() => {
    set(url, username);
    return () => set(null, null);
  }, [url, username, set]);

  return null;
}
