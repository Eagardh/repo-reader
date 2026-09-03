"use client";

import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteChatAction, renameChatAction } from "@/app/actions";
import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * `subtitle` is preformatted on the server. Computing a relative timestamp
 * here instead would render differently on server and client and trip a
 * hydration mismatch.
 */
export type ChatListEntry = {
  sessionId: string;
  title: string;
  repo: string | null;
  subtitle: string;
};

export function ChatList({ chats }: { chats: ChatListEntry[] }) {
  const params = useParams<{ sessionId?: string }>();
  const activeId = params?.sessionId;

  if (chats.length === 0) {
    return (
      <p className="px-2 py-1.5 text-muted-foreground text-xs">
        No conversations yet.
      </p>
    );
  }

  return (
    <SidebarMenu>
      {chats.map((chat) => (
        <ChatRow chat={chat} isActive={chat.sessionId === activeId} key={chat.sessionId} />
      ))}
    </SidebarMenu>
  );
}

function ChatRow({ chat, isActive }: { chat: ChatListEntry; isActive: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isRenaming, setIsRenaming] = useState(false);
  const [draft, setDraft] = useState(chat.title);

  if (isRenaming) {
    return (
      <SidebarMenuItem>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setIsRenaming(false);
            const next = draft.trim();
            if (next && next !== chat.title) {
              startTransition(() => renameChatAction(chat.sessionId, next));
            }
          }}
        >
          <input
            autoFocus
            className="w-full rounded-md bg-sidebar-accent px-2 py-1.5 text-sm outline-none ring-1 ring-sidebar-ring"
            onBlur={() => setIsRenaming(false)}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setDraft(chat.title);
                setIsRenaming(false);
              }
            }}
            value={draft}
          />
        </form>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        className="h-auto py-2"
        isActive={isActive}
        render={<Link href={`/s/${chat.sessionId}`} />}
        title={chat.title}
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm leading-tight">{chat.title}</span>
          <span className="truncate text-muted-foreground text-xs leading-tight">
            {chat.repo ? `${chat.repo} · ${chat.subtitle}` : chat.subtitle}
          </span>
        </span>
      </SidebarMenuButton>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <SidebarMenuAction disabled={isPending} showOnHover>
              <MoreHorizontalIcon className="size-4" />
              <span className="sr-only">Chat options</span>
            </SidebarMenuAction>
          }
        />
        <DropdownMenuContent align="end" side="right">
          <DropdownMenuItem
            onSelect={() => {
              setDraft(chat.title);
              setIsRenaming(true);
            }}
          >
            <PencilIcon className="mr-2 size-4" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              startTransition(async () => {
                await deleteChatAction(chat.sessionId);
                // Leaving the deleted chat open would 404 on the next reload.
                if (isActive) router.push("/");
              });
            }}
            variant="destructive"
          >
            <Trash2Icon className="mr-2 size-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}
