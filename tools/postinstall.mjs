import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

// Only patch tooling when developing inside the repository checkout
const isRepoCheckout =
  existsSync(new URL("../tsconfig.json", import.meta.url)) &&
  !process.cwd().includes("node_modules");

if (isRepoCheckout) {
  try {
    execSync("effect-tsgo patch --oxlint", { stdio: "inherit" });
  } catch (error) {
    process.exit(1);
  }
}
