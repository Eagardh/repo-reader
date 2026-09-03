import { neon } from "@neondatabase/serverless";

/**
 * Lazy Neon client.
 *
 * `neon()` throws when DATABASE_URL is missing, and Next.js evaluates
 * top-level module code during `next build` — so constructing this eagerly
 * would break any build that runs before the database is provisioned.
 * A plain function, not a Proxy: Proxy wrappers break libraries that inspect
 * the client object.
 */
let client: ReturnType<typeof neon> | null = null;

export function getSql() {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set. Run `vercel env pull .env.local --yes`.",
      );
    }
    client = neon(url);
  }
  return client;
}
