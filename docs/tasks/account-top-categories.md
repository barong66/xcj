# Account Top Categories

**Status:** Implemented and deployed
**Design doc:** `docs/superpowers/specs/2026-03-24-account-top-categories-design.md`
**ClickUp:** https://app.clickup.com/t/869cm8qvx

## Summary

Add `top_categories` to account API — categories ranked by total view count of account's videos. Replaces the `getVideo()` workaround in SameCategoryStrategy, fixing similar models on profile pages.

## Implementation Tasks

| # | Task | File | Status |
|---|------|------|--------|
| 1 | Add CategorySummary + TopCategories to Account model | `api/internal/model/account.go` | DONE |
| 2 | Add GetTopCategoriesByViews to AccountStore | `api/internal/store/account_store.go` | DONE |
| 3 | Update account handler for ?top_categories=N | `api/internal/handler/account.go` | DONE |
| 4 | Add AccountCategory type to frontend types | `web/src/types/index.ts` | DONE |
| 5 | Update getAccountBySlug with options param | `web/src/lib/api.ts` | DONE |
| 6 | Pass top_categories: 3 in ModelPage | `web/src/templates/default/pages/ModelPage.tsx` | DONE |
| 7 | Simplify SameCategoryStrategy | `web/src/lib/similarity/same-category.ts` | DONE |

## Key Design Decisions

- **Ranking:** SUM(view_count) per category across all account's active videos on the site
- **Limit:** configurable via query param, `3` used by ModelPage
- **Zero overhead by default:** SQL only runs when `?top_categories=N` is present
- **Errors silent:** missing top_categories never breaks the page
