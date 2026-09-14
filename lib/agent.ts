/**
 * The agent behind this white-label build. NEXT_PUBLIC_* values are inlined at
 * build time, so they must be referenced literally. Step 5 makes the build fail
 * when they're missing; until then, contact links are hidden without them.
 */

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
