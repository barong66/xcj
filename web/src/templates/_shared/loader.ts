// web/src/templates/_shared/loader.ts
// Server-only: called from app/ route files (RSC), never from client components.
import { getSiteConfig } from "@/lib/site-config";
import { pageLoaders } from "./page-registry";

export async function loadTemplatePage(pageName: "home" | "model" | "search") {
  const config = await getSiteConfig();
  const name = config?.config?.template || "default";
  const loaders = pageLoaders[name] ?? pageLoaders.default;
  const loader = loaders[pageName] ?? loaders.home;
  return loader();
}
