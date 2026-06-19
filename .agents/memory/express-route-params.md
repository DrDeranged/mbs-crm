---
name: Express 5 route param types
description: Type quirk in Express 5 req.params that causes TypeScript errors.
---

## The issue
In Express 5, `req.params["id"]` returns `string | string[]`, not `string`.

## How to apply
Always cast route params:
```typescript
const id = req.params["id"] as string;
// or
const id = parseInt(req.params["id"] as string, 10);
```

**Why:** Express 5 changed the type signature. Using the value directly causes TypeScript errors like "Argument of type 'string | string[]' is not assignable to parameter of type 'string'".
