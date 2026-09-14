/**
 * Fails when the production client bundle uses JavaScript that Safari on
 * iOS 15.0, the oldest supported browser, can't run. Runs after `next build`.
 *
 * Next.js 16's own runtime ships ES2020–2022 syntax (??, ??=, class fields,
 * private fields) regardless of browserslist. iOS 15 runs all of that, so the
 * check targets what it can't: syntax that fails to parse (breaking the whole
 * chunk) and APIs that throw when called. Next.js's polyfill module already
 * covers Array.prototype.at, flat/flatMap, Object.fromEntries, Object.hasOwn,
 * String trimStart/trimEnd and URL.canParse, so those aren't flagged.
 *
 * Scans every .js file under .next/static: locally Turbopack writes client
 * chunks to static/chunks, but on Vercel its adapter enables immutable assets
 * and they land under static/immutable instead.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "acorn";

const STATIC_DIR = path.join(process.cwd(), ".next", "static");

const LOOKBEHIND = /\(\?<[=!]/;

/** APIs newer than Safari 15.0 that nothing polyfills. */
const APIS = [
  [/\bstructuredClone\(/, "structuredClone (Safari 15.4)"],
  [/\.findLast(?:Index)?\(/, "Array.prototype.findLast (Safari 15.4)"],
  [/\.(?:toSorted|toReversed|toSpliced)\(/, "change-array-by-copy methods (Safari 16)"],
  [/\bArray\.fromAsync\(/, "Array.fromAsync (Safari 16.4)"],
  [/\bObject\.groupBy\(|\bMap\.groupBy\(/, "Object/Map.groupBy (Safari 17.4)"],
  [/\bPromise\.withResolvers\(/, "Promise.withResolvers (Safari 17.4)"],
];

function findSyntaxProblems(source) {
  const problems = [];
  let ast;
  try {
    ast = parse(source, { ecmaVersion: "latest", sourceType: "script", allowReturnOutsideFunction: true });
  } catch {
    ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  }
  const visit = (node) => {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "StaticBlock") problems.push(`class static block (Safari 16.4) at ${node.start}`);
    if (node.type === "Literal" && node.regex) {
      if (LOOKBEHIND.test(node.regex.pattern)) problems.push(`regex lookbehind (Safari 16.4) at ${node.start}`);
      if (node.regex.flags.includes("v")) problems.push(`regex v flag (Safari 17) at ${node.start}`);
    }
    if (node.type === "Literal" && typeof node.value === "string" && LOOKBEHIND.test(node.value)) {
      problems.push(`possible lookbehind in RegExp string (Safari 16.4) at ${node.start}`);
    }
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value.type === "string") visit(value);
    }
  };
  visit(ast);
  return problems;
}

const files = existsSync(STATIC_DIR)
  ? readdirSync(STATIC_DIR, { recursive: true })
      .map(String)
      .filter((file) => file.endsWith(".js"))
      .sort()
  : [];

if (files.length === 0) {
  console.error(`No client JavaScript found under ${STATIC_DIR}. Run next build first.`);
  process.exit(1);
}

let failures = 0;
for (const file of files) {
  const source = readFileSync(path.join(STATIC_DIR, file), "utf8");
  const problems = findSyntaxProblems(source);
  for (const [pattern, label] of APIS) if (pattern.test(source)) problems.push(label);
  if (problems.length > 0) {
    failures += problems.length;
    console.error(`✖ ${file}\n  ${problems.join("\n  ")}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} iOS 15 compatibility problem(s). Add a polyfill or change the code.`);
  process.exit(1);
}
console.log(`✓ ${files.length} client scripts are compatible with Safari on iOS 15.0`);
