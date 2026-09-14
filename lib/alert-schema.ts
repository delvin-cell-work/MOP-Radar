import { z } from "zod";

import { ALERT_WATCHLIST_MAX, UNSUBSCRIBE_TOKEN_PATTERN } from "./alerts";
import { townBySlug } from "./towns";
import { BLOCK_ID_PATTERN } from "./watchlist";

const townSlug = z.string().refine((slug) => townBySlug(slug) !== undefined, "Unknown town");

/** The body POSTed to /api/alerts. */
export const alertSignupSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  consent: z.literal(true),
  watchlist: z
    .array(z.object({ id: z.string().max(120).regex(BLOCK_ID_PATTERN), town: townSlug }))
    .min(1)
    .max(ALERT_WATCHLIST_MAX),
  town: townSlug.nullable(),
  /** Hidden field that people never fill in; bots often do. */
  website: z.string().max(500).optional(),
});

export type AlertSignupInput = z.infer<typeof alertSignupSchema>;

export const unsubscribeTokenSchema = z.string().regex(UNSUBSCRIBE_TOKEN_PATTERN);
