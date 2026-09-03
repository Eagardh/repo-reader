import { localDev, vercelOidc } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

/**
 * Route auth for the agent's HTTP endpoints.
 *
 * eve fails closed: with this policy, local development works and Vercel-hosted
 * callers authenticate via OIDC, while anonymous production traffic gets a 401.
 * Before putting this on a public URL, add an authenticator for your own users
 * (see eve's auth guide) — or, for a deliberately public demo, append `none()`.
 */
export default eveChannel({
  auth: [vercelOidc(), localDev()],
});
