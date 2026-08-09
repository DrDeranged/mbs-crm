---
name: GitHub push via connectors-sdk
description: The only reliable way to push code changes to GitHub from this workspace; git push via HTTPS fails (token rotation), gitPush() callback returns NO_CREDENTIALS, listConnections("github") returns [].
---

# GitHub Push — Reliable Pattern

## The rule
Use `@replit/connectors-sdk` (`ReplitConnectors.proxy("github", ...)`) from a shell `node --input-type=module` heredoc. This is the only method that works reliably.

**GitHub account:** `DrDeranged` (NOT `MarketingBG` — connector is authorized under DrDeranged)  
**Repo:** `DrDeranged/mbs-crm`

## What does NOT work
- `git push origin main` — no `origin` remote; HTTPS token rotation breaks auth
- `gitPush({ provider: "github" })` callback — returns `NO_CREDENTIALS`
- `listConnections("github")` inside CodeExecution impure — returns `[]`
- `proxyFetch` / `getClient` as CodeExecution globals — `ReferenceError: not defined`

## Working shell script pattern

```js
node --input-type=module << 'EOF'
import { ReplitConnectors } from "@replit/connectors-sdk";
import { readFileSync } from "fs";

const connectors = new ReplitConnectors();
const owner = "DrDeranged";  // <-- always DrDeranged
const repo = "mbs-crm";
const branch = "main";
const filePath = "path/to/changed/file.ts";

const contentB64 = Buffer.from(readFileSync(filePath, "utf8")).toString("base64");

// 1. GET remote HEAD
const refData = await (await connectors.proxy("github", `/repos/${owner}/${repo}/git/refs/heads/${branch}`)).json();
const headSha = refData.object.sha;

// 2. GET base tree SHA
const commitData = await (await connectors.proxy("github", `/repos/${owner}/${repo}/git/commits/${headSha}`)).json();
const treeSha = commitData.tree.sha;

// 3. POST blob
const blobData = await (await connectors.proxy("github", `/repos/${owner}/${repo}/git/blobs`, {
  method: "POST", body: JSON.stringify({ content: contentB64, encoding: "base64" })
})).json();

// 4. POST tree
const newTree = await (await connectors.proxy("github", `/repos/${owner}/${repo}/git/trees`, {
  method: "POST",
  body: JSON.stringify({ base_tree: treeSha, tree: [{ path: filePath, mode: "100644", type: "blob", sha: blobData.sha }] })
})).json();

// 5. POST commit
const newCommit = await (await connectors.proxy("github", `/repos/${owner}/${repo}/git/commits`, {
  method: "POST",
  body: JSON.stringify({ message: "your commit message", tree: newTree.sha, parents: [headSha] })
})).json();

// 6. PATCH ref
await connectors.proxy("github", `/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
  method: "PATCH", body: JSON.stringify({ sha: newCommit.sha, force: false })
});

console.log("Done:", newCommit.sha);
EOF
```

**Why:** The Replit GitHub connector OAuth token lives in the connector proxy and is injected server-side by `ReplitConnectors`. The `GITHUB_PERSONAL_ACCESS_TOKEN` env var is a Replit platform token that doesn't work for git-over-HTTPS push. The `gitPush()` callback and `listConnections("github")` both fail because the GitHub connector binding requires a git-aware credential that isn't exposed through those paths.
