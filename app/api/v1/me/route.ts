import { api, ok } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

// The signed-in user, their profile and their companies. Also accepts any pending invitation for their email.
export const GET = api(async ({ db }) => ok(await db.bootstrap()));
