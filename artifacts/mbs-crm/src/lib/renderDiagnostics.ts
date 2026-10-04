// Only fixed descriptions, code asset paths and component names are shown.
// Never expose arbitrary error messages, values, URLs, query strings or stacks.
export function describeRenderError(error: unknown, componentStack = ""): string {
  const name = error instanceof Error && ["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError"].includes(error.name)
    ? error.name : "Error";
  const message = error instanceof Error ? error.message : "";
  let reason = "A component failed to render. Inspect the browser console locally for the original exception.";
  if (/Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk .* failed/i.test(message)) {
    reason = "A page code import failed. Check failed module/dependency requests in the browser Network panel.";
  } else if (/Rendered (?:more|fewer) hooks/i.test(message)) {
    reason = "React hook order changed between renders.";
  } else if (/Maximum update depth exceeded/i.test(message)) {
    reason = "A component entered a repeated state-update loop.";
  } else if (/Cannot read properties of (?:undefined|null)/i.test(message)) {
    reason = "A component tried to read a missing value.";
  } else if (/Invalid time value/i.test(message)) {
    reason = "A component tried to format an invalid date.";
  } else if (/is not defined/i.test(message)) {
    reason = "A component referenced an unavailable variable.";
  } else if (/AppearanceProvider is required/.test(message)) {
    reason = "The appearance context is missing.";
  }
  // Component stacks contain code locations, not record values. Keep only
  // component/function identifiers and omit all location URLs and parameters.
  const components = componentStack.split("\n")
    .map(line => line.match(/^\s*(?:at\s+)?([A-Za-z_$][\w.$]*)\s*(?:@|\()/)?.[1])
    .filter((value): value is string => Boolean(value))
    .slice(0, 16);
  return [`${name}: ${reason}`, components.length ? `Components: ${components.join(" → ")}` : ""].filter(Boolean).join("\n");
}