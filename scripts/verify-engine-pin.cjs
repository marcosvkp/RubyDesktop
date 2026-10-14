/** Checks that CI's immutable RubyCLI checkout matches this Desktop build contract. */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const engineDirectory = path.resolve(process.argv[2] || "../RubyCLI");
const requestedRef = String(process.argv[3] || process.env.RUBYCLI_REF || "").toLowerCase();
const pin = require(path.join(process.cwd(), "ruby-engine.lock.json"));
const enginePackage = JSON.parse(fs.readFileSync(path.join(engineDirectory, "package.json"), "utf8"));

if (!/^[0-9a-f]{40}$/.test(requestedRef)) {
  throw new Error("RUBYCLI_REF must be a full 40-character commit SHA; branch names and tags are not reproducible pins.");
}
if (enginePackage.version !== pin.version) {
  throw new Error(`RubyCLI version ${enginePackage.version} does not match ruby-engine.lock.json (${pin.version}).`);
}
if (!/^[0-9a-f]{40}$/.test(String(pin.commit || "").toLowerCase())) {
  throw new Error("ruby-engine.lock.json must contain the full 40-character RubyCLI commit SHA.");
}
if (requestedRef !== pin.commit.toLowerCase()) {
  throw new Error(`RUBYCLI_REF ${requestedRef} does not match ruby-engine.lock.json commit ${pin.commit}.`);
}

const actualCommit = execFileSync("git", ["-C", engineDirectory, "rev-parse", "HEAD"], { encoding: "utf8" }).trim().toLowerCase();
if (actualCommit !== requestedRef) {
  throw new Error(`RubyCLI checkout is ${actualCommit}, expected pinned RUBYCLI_REF ${requestedRef}.`);
}

console.log(`RubyCLI pin verified: ${pin.repository}@${actualCommit} (v${pin.version})`);
