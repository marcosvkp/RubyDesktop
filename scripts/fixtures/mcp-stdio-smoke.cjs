process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  process.stdout.write(`mcp-stdio:${chunk}`);
});
