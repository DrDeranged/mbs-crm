---
name: pdf-parse ESM interop fix
description: How to import pdf-parse v2 in api-server without TypeScript "no call signatures" error
---

# pdf-parse v2 ESM/CJS interop

## The rule
Never use `import * as pdfParse from "pdf-parse"` in api-server — the ESM build exported by pdf-parse v2 doesn't expose a callable default and TypeScript errors out with "This expression is not callable."

## Why
api-server tsconfig uses `"module": "esnext"` and `"moduleResolution": "bundler"`, which resolves to the ESM distribution of pdf-parse. The ESM export object is not callable.

## How to apply
Use a dynamic import at the call site:
```typescript
const mod: any = await import("pdf-parse");
const parseFn = mod.default ?? mod;
const parsed = await parseFn(buffer);
const text = parsed.text ?? "";
```
This pattern works regardless of whether the module exports CJS or ESM.

**File:** `artifacts/api-server/src/lib/ocrBankStatement.ts`
