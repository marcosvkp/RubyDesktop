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
    }

    if (
      specifier &&
      !specifier.startsWith(".") &&
      !specifier.startsWith("/") &&
      specifier !== "electron" &&
      !isBuiltin(specifier)
    ) {
      externalPackages.add(`${path.relative(engineDirectory, file)}: ${specifier}`);
    }

    ts.forEachChild(node, inspect);
  }

  inspect(sourceFile);
}

if (externalPackages.size > 0) {
  throw new Error(
    `Engine bundle still imports npm packages at runtime:\n${[...externalPackages].sort().join("\n")}`,
  );
}

console.log(`Engine bundle verified: ${files.length} ESM file(s), no external npm imports.`);
