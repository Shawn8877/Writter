// Test runner only: resolve the app's aliases and remove Next's bundler-only guard.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
  if (specifier.startsWith("@/")) {
    let url = new URL(`../../src/${specifier.slice(2)}`, import.meta.url);
    if (!existsSync(fileURLToPath(url))) url = new URL(url.href + ".js");
    return { ...nextResolve(url.href, context), format: "module" };
  }
  if (["next/headers", "next/navigation"].includes(specifier)) return nextResolve(specifier + ".js", context);
  if (specifier.startsWith(".") && context.parentURL?.startsWith(new URL("../../src/", import.meta.url).href)) {
    const candidate = new URL(specifier + ".js", context.parentURL);
    if (existsSync(fileURLToPath(candidate))) return { ...nextResolve(candidate.href, context), format: "module" };
  }
  if (context.parentURL?.startsWith(new URL("../../", import.meta.url).href) && (specifier.startsWith(".") || specifier.startsWith("file:"))) {
    const target = new URL(specifier, context.parentURL);
    if (target.href.startsWith(new URL("../../src/", import.meta.url).href)) return { ...nextResolve(specifier, context), format: "module" };
  }
  return nextResolve(specifier, context);
} });
