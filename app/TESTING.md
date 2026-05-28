# Testing

**Philosophy:** 100% test coverage is the key to great vibe coding. Tests let you move fast, trust your instincts, and ship with confidence — without them, vibe coding is just yolo coding. With tests, it's a superpower.

## Framework

- **vitest** v4.x + **@testing-library/react** + **jsdom**
- Config: `vitest.config.ts`
- Setup file: `src/test/setup.ts` (loads `@testing-library/jest-dom`)

## Running tests

```bash
npm test          # run once
npm run test:watch  # watch mode
```

## Test layers

| Layer | What | Where | When |
|-------|------|-------|------|
| Unit | Pure functions (format, matching, scoring) | `src/test/*.test.ts` | Every PR |
| Integration | API routes + Supabase queries | `src/test/*.integration.test.ts` | Pre-deploy |
| Component | React components with user interactions | `src/test/*.component.test.tsx` | When adding UI |

## Conventions

- Files: `{module}.test.ts` or `{module}.test.tsx`
- Describe block = module name, it() = behavior in plain French/English
- Never `expect(x).toBeDefined()` — test what the code actually does
- Mock external deps (Supabase, Claude API) with `vi.mock()`
- Regression tests include attribution comment: `// Regression: ISSUE-NNN`
