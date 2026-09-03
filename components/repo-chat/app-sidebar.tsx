import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { listChats } from "@/lib/chats";
import { PlusIcon } from "lucide-react";
import Link from "next/link";
import { ChatList, type ChatListEntry } from "./chat-list";

/** Server component: reads the chat index and hands the client plain strings. */
export async function AppSidebar() {
  let chats: ChatListEntry[] = [];
  let error: string | null = null;

  try {
    const rows = await listChats();
    chats = rows.map((chat) => ({
      sessionId: chat.sessionId,
      title: chat.title,
      repo: chat.repo,
      subtitle: relativeTime(chat.updatedAt),
    }));
  } catch (cause) {
    // A missing or unreachable database should not take the whole app down;
    // the agent still works, it just has no history to show.
    error =
      cause instanceof Error && cause.message.includes("DATABASE_URL")
        ? "No database configured."
        : "Could not load chat history.";
  }

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="p-3">
        <Button
          className="justify-start"
          nativeButton={false}
          render={<Link href="/" />}
          size="sm"
          variant="outline"
        >
          <PlusIcon className="size-4" />
          New conversation
        </Button>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="pt-1">
          <SidebarGroupContent>
            {error ? (
              <p className="px-2 py-1.5 text-muted-foreground text-xs">{error}</p>
            ) : (
              <ChatList chats={chats} />
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="items-start border-t p-3">
        <ThemeToggle />
      </SidebarFooter>

      {/* Makes the sidebar's edge a click target for collapsing it. */}
      <SidebarRail />
    </Sidebar>
  );
}

/** Rendered on the server, so the client never recomputes it and mismatches. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const minutes = Math.round((Date.now() - then) / 60_000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;

  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
