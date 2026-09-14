import { agentDetails } from "@/lib/agent";
import { alertSignupSchema } from "@/lib/alert-schema";
import { alertStoreConfig, saveSignup } from "@/lib/alert-store";
import { CONSENT_VERSION, consentStatement } from "@/lib/alerts";
import { isSameOrigin, requestOrigin } from "@/lib/request-origin";

const MAX_BODY_CHARACTERS = 20_000;

const error = (message: string, status: number) => Response.json({ error: message }, { status });

/** Optional email alert signup: the agent's lead capture. Stores {email, watchlist, town, consent}. */
export async function POST(request: Request) {
  const config = alertStoreConfig();
  if (!config) return error("Email alerts aren't available yet.", 503);
  if (!isSameOrigin(request)) return error("Sign up from the MOP Radar page.", 403);

  const text = await request.text();
  if (text.length > MAX_BODY_CHARACTERS) return error("That request is too large.", 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return error("Couldn't read that request.", 400);
  }

  const parsed = alertSignupSchema.safeParse(body);
  if (!parsed.success) {
    return error("Check your email address, tick the consent box and save at least one block.", 400);
  }
  // The hidden field was filled in, so this is almost certainly a bot. Look successful, store nothing.
  if (parsed.data.website) return Response.json({ ok: true }, { status: 201 });

  try {
    await saveSignup(
      config,
      { email: parsed.data.email, watchlist: parsed.data.watchlist, town: parsed.data.town },
      {
        now: new Date().toISOString(),
        siteUrl: process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") || requestOrigin(request),
        consentStatement: consentStatement(agentDetails()),
        consentVersion: CONSENT_VERSION,
      },
    );
  } catch (cause) {
    // Never log the email address.
    console.error("Alert signup could not be saved:", cause instanceof Error ? cause.message : "unknown error");
    return error("Couldn't save your signup. Try again in a moment.", 502);
  }
  return Response.json({ ok: true }, { status: 201 });
}
