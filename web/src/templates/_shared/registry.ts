import type { SiteTemplate } from "./types";
import { template as defaultTemplate } from "../default";

/**
 * Template registry — maps template names to their implementations.
 * To add a new template:
 *   1. Create web/src/templates/<name>/ with all required components
 *   2. Export a `template: SiteTemplate` from <name>/index.ts
 *   3. Import and add it here
 */
export const templates: Record<string, SiteTemplate> = {
  default: defaultTemplate,
  // magazine: magazineTemplate,
  // minimal: minimalTemplate,
};

export function getTemplate(name: string): SiteTemplate {
  return templates[name] ?? templates.default;
}
