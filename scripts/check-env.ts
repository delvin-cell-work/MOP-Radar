/**
 * Fails the build before the (slow) data pipeline runs when the agent's CEA
 * details aren't configured. next.config.ts repeats the check for builds that
 * skip npm scripts (`npx next build`).
 */
import { loadEnvConfig } from "@next/env";

import { agentEnvErrorMessage, missingAgentEnv } from "../lib/agent";

loadEnvConfig(process.cwd(), false);

const missing = missingAgentEnv(process.env);
if (missing.length > 0) {
  console.error(`\n✗ ${agentEnvErrorMessage(missing)}\n`);
  process.exit(1);
}
console.log("✓ Agent CEA details are set");
