"use client";

import { createContext, useContext } from "react";
import type { SiteTemplate } from "./types";
import { getTemplate } from "./registry";

const TemplateContext = createContext<SiteTemplate | null>(null);

export function TemplateProvider({
  name,
  children,
}: {
  name: string;
  children: React.ReactNode;
}) {
  const template = getTemplate(name);
  return (
    <TemplateContext.Provider value={template}>
      {children}
    </TemplateContext.Provider>
  );
}

export function useTemplate(): SiteTemplate {
  const ctx = useContext(TemplateContext);
  if (!ctx) {
    throw new Error("useTemplate must be used inside TemplateProvider");
  }
  return ctx;
}
