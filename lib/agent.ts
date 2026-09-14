/**
 * The agent behind this white-label build. NEXT_PUBLIC_* values are inlined at
 * build time, so they must be referenced literally. Production builds fail when
 * any are missing (scripts/check-env.ts and next.config.ts), because the CEA
 * details must show on every page.
 */

export const REQUIRED_AGENT_ENV = [
  "NEXT_PUBLIC_AGENT_NAME",
  "NEXT_PUBLIC_CEA_REG_NO",
  "NEXT_PUBLIC_AGENCY_NAME",
  "NEXT_PUBLIC_AGENCY_LICENCE_NO",
  "NEXT_PUBLIC_AGENT_WHATSAPP",
] as const;

/** Names of required agent variables that are unset, blank or (for WhatsApp) not a phone number. */
export function missingAgentEnv(env: Readonly<Record<string, string | undefined>>): string[] {
  return REQUIRED_AGENT_ENV.filter((name) => {
    const value = env[name]?.trim();
    if (!value) return true;
    return name === "NEXT_PUBLIC_AGENT_WHATSAPP" && normaliseWhatsappNumber(value) === null;
  });
}

export function agentEnvErrorMessage(missing: readonly string[]): string {
  return (
    `MOP Radar can't be built without the agent's CEA details. Missing or invalid: ${missing.join(", ")}.\n` +
    "Set them in Vercel (Project → Settings → Environment Variables) or in .env.local. " +
    "NEXT_PUBLIC_AGENT_WHATSAPP is the number with country code, e.g. 6591234567."
  );
}

/** The CEA details every page must show. */
export interface AgentDetails {
  name: string;
  ceaRegNo: string;
  agencyName: string;
  agencyLicenceNo: string;
}

export function agentDetails(
  env: { name?: string; ceaRegNo?: string; agencyName?: string; agencyLicenceNo?: string } = {
    name: process.env.NEXT_PUBLIC_AGENT_NAME,
    ceaRegNo: process.env.NEXT_PUBLIC_CEA_REG_NO,
    agencyName: process.env.NEXT_PUBLIC_AGENCY_NAME,
    agencyLicenceNo: process.env.NEXT_PUBLIC_AGENCY_LICENCE_NO,
  },
): AgentDetails | null {
  const name = env.name?.trim();
  const ceaRegNo = env.ceaRegNo?.trim();
  const agencyName = env.agencyName?.trim();
  const agencyLicenceNo = env.agencyLicenceNo?.trim();
  return name && ceaRegNo && agencyName && agencyLicenceNo ? { name, ceaRegNo, agencyName, agencyLicenceNo } : null;
}

export interface AgentContact {
  name: string;
  /** Digits only, including country code, as wa.me expects. */
  whatsapp: string;
}

export function normaliseWhatsappNumber(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

export function agentContact(
  env: { name?: string; whatsapp?: string } = {
    name: process.env.NEXT_PUBLIC_AGENT_NAME,
    whatsapp: process.env.NEXT_PUBLIC_AGENT_WHATSAPP,
  },
): AgentContact | null {
  const name = env.name?.trim();
  const whatsapp = env.whatsapp ? normaliseWhatsappNumber(env.whatsapp) : null;
  return name && whatsapp ? { name, whatsapp } : null;
}

export function whatsappLink(number: string, message: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

/** Names the block only. No prices or advice, so nothing reads as a valuation. */
export function blockEnquiryMessage(agentName: string, blockTitle: string, townName: string): string {
  return `Hi ${agentName}, I found ${blockTitle} in ${townName} on MOP Radar. Could you tell me more about this block?`;
}
