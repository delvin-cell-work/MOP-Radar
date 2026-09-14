import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

import { agentEnvErrorMessage, missingAgentEnv } from "./lib/agent";

const nextConfig: NextConfig = {};

export default function config(phase: string): NextConfig {
  // Every page shows the agent's CEA details, so a production build without them must not ship.
  // `next typegen` (npm run typecheck) loads config in the same phase but ships nothing, so it's exempt.
  if (phase === PHASE_PRODUCTION_BUILD && !process.argv.includes("typegen")) {
    const missing = missingAgentEnv(process.env);
    if (missing.length > 0) throw new Error(agentEnvErrorMessage(missing));
  }
  return nextConfig;
}
