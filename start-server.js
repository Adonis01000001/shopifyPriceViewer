const { spawn } = require("child_process");
const path = require("path");
const root = path.resolve(__dirname);
const nodeExe = "C:\\Program Files\\nodejs\\node.exe";
const p = spawn(
  nodeExe,
  ["./node_modules/.bin/tsx", "watch", "server/_core/index.ts"],
  {
    cwd: root,
    env: { ...process.env, NODE_ENV: "development" },
    stdio: "ignore",
    detached: true,
  }
);
p.unref();
console.log("Server started in background");
