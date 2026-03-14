// web/src/templates/_shared/page-registry.ts
// Server-only: this file is NOT imported by any client component.
// It holds dynamic imports for full page modules (server components with next/headers).
// Kept separate from registry.ts so the client-side TemplateContext doesn't
// accidentally pull server-only code into the client bundle.
//
// WHY static map: dynamic template literal imports like
//   import(`@/templates/${name}/pages/...`)
// cannot be statically analyzed by webpack/turbopack.
// This explicit map lets the bundler find all page imports.
// Add new templates here when creating them.
export const pageLoaders: Record<string, Record<string, () => Promise<any>>> = {
  default: {
    home: () => import("../default/pages/HomePage"),
    model: () => import("../default/pages/ModelPage"),
    search: () => import("../default/pages/SearchPage"),
  },
};
