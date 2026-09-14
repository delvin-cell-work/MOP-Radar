import { unsubscribeTokenSchema } from "@/lib/alert-schema";
import { alertStoreConfig, deleteSignup } from "@/lib/alert-store";

/**
 * Deletes a signup. Accepts the token as `?token=` (email clients' one-click
 * unsubscribe, RFC 8058) or as JSON `{ token }` from the /unsubscribe page.
 * Only POST: link scanners that follow GET links can't unsubscribe anyone.
 * Unknown tokens also succeed, so repeating an unsubscribe is harmless.
 */
export async function POST(request: Request) {
  const config = alertStoreConfig();
  if (!config) return Response.json({ error: "Email alerts aren't available yet." }, { status: 503 });

  let token: unknown = new URL(request.url).searchParams.get("token");
  if (!token) {
    const body: unknown = await request.json().catch(() => null);
    token = body && typeof body === "object" && "token" in body ? body.token : null;
  }
  const parsed = unsubscribeTokenSchema.safeParse(token);
  if (!parsed.success) return Response.json({ error: "This unsubscribe link isn't valid." }, { status: 400 });

  try {
    await deleteSignup(config, parsed.data);
  } catch (cause) {
    console.error("Unsubscribe failed:", cause instanceof Error ? cause.message : "unknown error");
    return Response.json({ error: "Couldn't unsubscribe you just now. Try again in a moment." }, { status: 502 });
  }
  return Response.json({ ok: true });
}
