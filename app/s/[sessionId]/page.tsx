import { Chat } from "@/components/repo-chat/chat";

/**
 * An existing conversation. The session id comes from the URL, so the server
 * and the client agree on it before the first render — which is what keeps
 * resumption from causing a hydration mismatch.
 */
export default async function ChatSession({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <Chat sessionId={sessionId} />;
}
