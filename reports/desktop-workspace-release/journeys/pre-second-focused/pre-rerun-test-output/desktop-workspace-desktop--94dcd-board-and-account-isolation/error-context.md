# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: desktop-workspace.spec.ts >> desktop: rail hover delays, no reflow, pin persistence, keyboard and account isolation
- Location: tests/desktop-workspace.spec.ts:30:5

# Error details

```
Error: page.evaluate: e: You're already signed in.
    at ip._baseFetch (https://select-humpback-65.clerk.accounts.dev/npm/@clerk/clerk-js@6/dist/clerk.browser.js:44:171)
    at async iu.execute (https://select-humpback-65.clerk.accounts.dev/npm/@clerk/clerk-js@6/dist/clerk.browser.js:43:6812)
    at async nq._baseMutate (https://select-humpback-65.clerk.accounts.dev/npm/@clerk/clerk-js@6/dist/clerk.browser.js:44:717)
    at async eval (eval at evaluate (:311:30), <anonymous>:2:26)
    at async <anonymous>:337:30
```