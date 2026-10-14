/** Ensures the standalone engine bundle has no runtime npm package imports. */
const fs = require("node:fs");
const path = require("node:path");
const { isBuiltin } = require("node:module");
const ts = require("typescript");

const engineDirectory = path.resolve(process.argv[2] || "out/engine");
const files = [];

function collectModules(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) collectModules(target);
    else if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(target);
  }
}

collectModules(engineDirectory);
if (files.length === 0) {
  throw new Error(`No engine modules found in ${engineDirectory}`);
}

const externalPackages = new Set();
const nonLiteralImports = new Set();

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );

  function inspect(node) {
    let specifier;
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifier = node.moduleSpecifier.text;
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifier = node.arguments[0].text;
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      nonLiteralImports.add(path.relative(engineDirectory, file));
    }

    if (
      specifier &&
      !specifier.startsWith(".") &&
      !specifier.startsWith("/") &&
      !isBuiltin(specifier)
    ) {
      externalPackages.add(`${path.relative(engineDirectory, file)}: ${specifier}`);
    }

    ts.forEachChild(node, inspect);
  }

  inspect(sourceFile);
}

if (nonLiteralImports.size > 0) {
  throw new Error(
    `Engine bundle contains non-literal dynamic imports that cannot be audited:\n${[...nonLiteralImports].sort().join("\n")}`,
  );
}

if (externalPackages.size > 0) {
  throw new Error(
    `Engine bundle still imports npm packages at runtime:\n${[...externalPackages].sort().join("\n")}`,
  );
}

const skillRoot = path.join(engineDirectory, "skills", "builtin");
function countSkillFiles(directory) {
  if (!fs.existsSync(directory)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) total += countSkillFiles(target);
    else if (entry.isFile() && entry.name.toLowerCase() === "skill.md") total++;
  }
  return total;
}
const skillCount = countSkillFiles(skillRoot);
if (skillCount === 0) {
  throw new Error(`Engine bundle has no copied builtin skills under ${skillRoot}`);
}

for (const file of files) {
  if (/sourceMappingURL\s*=/.test(fs.readFileSync(file, "utf8"))) {
    throw new Error(`Engine bundle references an unpackaged source map: ${path.relative(engineDirectory, file)}`);
  }
}

console.log(`Engine bundle verified: ${files.length} ESM file(s), ${skillCount} builtin skills, no runtime package imports.`);
