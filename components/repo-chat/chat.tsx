"use client";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import {
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { saveChat } from "@/app/actions";
import { useEveAgent } from "eve/react";
import type { EveMessage, EveMessagePart } from "eve/react";
import { GitBranchIcon } from "lucide-react";
import {
  type ComponentProps,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { EmptyState } from "./empty-state";
import { InputRequest } from "./input-request";
import {
  collectSourceReads,
  linkifySourceCitations,
  sourceCitationComponents,
  SourceCitationProvider,
  SourcePreviewPanel,
  type SourceRead,
} from "./source-citation";
import { ToolCall } from "./tool-call";
import { shortRepoName } from "./tool-summaries";

/** Derives a sidebar title from the first thing the user asked. */
function titleFrom(message: string): string {
  const withoutUrls = message
    .replace(/https?:\/\/\S+/g, (url) => {
      const match = /github\.com\/([\w.-]+\/[\w.-]+)/i.exec(url);
      return match ? match[1].replace(/\.git$/, "") : "";
    })
    .replace(/\s+/g, " ")
    .trim();
  const text = withoutUrls || message.trim();
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

/**
 * `sessionId` comes from the route (`/s/[sessionId]`). Reading it from the URL
 * rather than localStorage means the server and the first client render agree
 * on whether there is a session to resume — reading storage during render made
 * them disagree, and React threw away the tree.
 */
export function Chat({ sessionId }: { sessionId?: string }) {
  const [text, setText] = useState("");
  const pendingTitle = useRef<string | null>(null);
  const recordedSession = useRef<string | null>(sessionId ?? null);

  const agent = useEveAgent({
    initialSession: sessionId ? { sessionId, streamIndex: 0 } : undefined,
    resume: sessionId !== undefined,
    onSessionChange: (session) => {
      const id = session?.sessionId;
      if (!id || recordedSession.current === id) return;
      recordedSession.current = id;

      // Register the chat as soon as eve mints an id, so it shows up in the
      // sidebar (and survives a reload) before the answer finishes streaming.
      void saveChat({ sessionId: id, title: pendingTitle.current ?? undefined });

      // Move to the session URL without remounting: a router navigation here
      // would tear down the component and drop the in-flight stream.
      window.history.replaceState(null, "", `/s/${id}`);
    },
  });

  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const isResuming = agent.status === "resuming";
  const messages = agent.data.messages;

  // The repository the agent is actually working in, taken from the tool calls
  // rather than guessed from the prompt text.
  const activeRepo = findActiveRepo(messages);

  // Backfill the repo once the agent has actually opened one, so the sidebar
  // can show it under the title.
  const savedRepo = useRef<string | null>(null);
  useEffect(() => {
    const id = recordedSession.current;
    if (!id || !activeRepo || savedRepo.current === activeRepo) return;
    savedRepo.current = activeRepo;
    void saveChat({ sessionId: id, repo: activeRepo });
  }, [activeRepo]);

  const submit = useCallback(
    (value: string) => {
      const message = value.trim();
      if (!message || isResuming) return;
      setText("");
      if (!recordedSession.current) pendingTitle.current = titleFrom(message);
      void agent.send(message, isBusy ? { turnPolicy: "steer" } : undefined);
    },
    [agent, isBusy, isResuming],
  );

  const pendingRequests = useMemo(() => collectInputRequests(messages), [messages]);
  const sourceReads = useMemo(() => collectSourceReads(messages), [messages]);
  const isFreshChat = messages.length === 0 && !sessionId;
  const composer = (
    <Composer
      activeRepo={activeRepo}
      isBusy={isBusy}
      isResuming={isResuming}
      onCancel={() => void agent.cancel()}
      onSubmit={submit}
      onTextChange={setText}
      status={agent.status === "resuming" ? "submitted" : agent.status}
      text={text}
    />
  );

  return (
    <SourceCitationProvider sources={sourceReads}>
      <div className="flex h-dvh flex-col bg-background selection:bg-foreground selection:text-background">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger className="text-muted-foreground" />
          {activeRepo && (
            <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
              <GitBranchIcon className="size-3.5 shrink-0" />
              <span className="truncate">{activeRepo}</span>
            </div>
          )}
        </header>

        <ResizablePanelGroup
          className="min-h-0 flex-1"
          orientation="horizontal"
        >
          <ResizablePanel defaultSize="56%" minSize="30%">
            <div className="flex size-full min-w-0 flex-col">
            <Conversation>
              {isFreshChat && (
                <div aria-hidden className="repo-reader-glow absolute inset-0" />
              )}
              <ConversationContent className="relative z-[1] mx-auto min-h-full w-full max-w-3xl gap-8 px-5 pt-3 pb-3 md:px-8">
                {isFreshChat ? (
                  // Gated on the route prop, not on status: `sessionId` is known to
                  // the server, so this branch renders identically on both sides.
                  // Keying it off `isResuming` made the server show the empty state
                  // and the client hide it, which is what broke hydration.
                  <EmptyState onSelect={submit}>{composer}</EmptyState>
                ) : messages.length === 0 ? (
                  <ResumingSkeleton />
                ) : (
                  messages.map((message) => (
                    <MessageBlock
                      key={message.id}
                      message={message}
                      sources={sourceReads}
                    />
                  ))
                )}

                {pendingRequests.map((request) => (
                  <InputRequest
                    key={request.requestId}
                    onRespond={(response) => void agent.respond([response])}
                    request={request}
                  />
                ))}

                {agent.error && (
                  <div
                    className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm"
                    role="alert"
                  >
                    {agent.error.message}
                  </div>
                )}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>

            {!isFreshChat && (
              <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-4 md:px-6">
                {composer}
              </div>
            )}
            </div>
          </ResizablePanel>

          <SourcePreviewPanel disabled={isResuming} onAsk={submit} />
        </ResizablePanelGroup>
      </div>
    </SourceCitationProvider>
  );
}

function Composer({
  activeRepo,
  isBusy,
  isResuming,
  onCancel,
  onSubmit,
  onTextChange,
  status,
  text,
}: {
  activeRepo?: string;
  isBusy: boolean;
  isResuming: boolean;
  onCancel: () => void;
  onSubmit: (value: string) => void;
  onTextChange: (value: string) => void;
  status: ComponentProps<typeof PromptInputSubmit>["status"];
  text: string;
}) {
  return (
    <PromptInput
      className="[&_[data-slot=input-group]]:rounded-lg [&_[data-slot=input-group]]:border-border/80 [&_[data-slot=input-group]]:bg-background/90 [&_[data-slot=input-group]]:shadow-[0_10px_30px_-18px_color-mix(in_oklch,var(--foreground)_35%,transparent)] [&_[data-slot=input-group]]:backdrop-blur-xl"
      onSubmit={(payload) => onSubmit(payload.text ?? "")}
    >
      <PromptInputBody>
        <PromptInputTextarea
          className="min-h-16 px-3 pt-3"
          disabled={isResuming}
          onChange={(event) => onTextChange(event.currentTarget.value)}
          placeholder={
            activeRepo
              ? `Ask about ${activeRepo}…`
              : "Paste a GitHub repo URL and ask a question…"
          }
          value={text}
        />
      </PromptInputBody>
      <PromptInputFooter className="justify-end px-2 pb-2">
        <PromptInputSubmit
          disabled={!isBusy && text.trim().length === 0}
          onStop={onCancel}
          status={status}
        />
      </PromptInputFooter>
    </PromptInput>
  );
}

/** Placeholder while a session's transcript is replayed from eve. */
function ResumingSkeleton() {
  return (
    <div className="space-y-3 py-6" aria-hidden>
      {[70, 45, 60].map((width, index) => (
        <div
          className="h-4 animate-pulse rounded bg-muted"
          key={index}
          style={{ width: `${width}%` }}
        />
      ))}
    </div>
  );
}

function MessageBlock({
  message,
  sources,
}: {
  message: EveMessage;
  sources: readonly SourceRead[];
}) {
  const isStreaming = message.metadata?.status === "streaming";

  return (
    <Message from={message.role}>
      <MessageContent>
        {message.parts.map((part, index) => (
          <MessagePart
            isStreaming={isStreaming}
            key={`${message.id}-${index}`}
            part={part}
            sources={sources}
          />
        ))}
      </MessageContent>
    </Message>
  );
}

function MessagePart({
  part,
  isStreaming,
  sources,
}: {
  part: EveMessagePart;
  isStreaming: boolean;
  sources: readonly SourceRead[];
}) {
  switch (part.type) {
    case "text":
      return (
        <MessageResponse
          components={sourceCitationComponents}
          isAnimating={isStreaming && part.state === "streaming"}
        >
          {linkifySourceCitations(part.text, sources)}
        </MessageResponse>
      );

    case "reasoning":
      return (
        <Reasoning
          autoClose={false}
          defaultOpen
          isStreaming={isStreaming && part.state === "streaming"}
        >
          {/* Scaled to match the tool rows so the whole activity log reads as
              one quiet column beside the answer. */}
          <ReasoningTrigger className="text-xs [&_svg]:size-3.5" />
          <ReasoningContent className="text-xs">{part.text}</ReasoningContent>
        </Reasoning>
      );

    case "dynamic-tool":
      return <ToolCall part={part} />;

    case "authorization":
      return (
        <div className="rounded-md border px-3 py-2 text-sm">
          <p>{part.description}</p>
          {part.state === "required" && part.authorization?.url && (
            <a
              className="mt-1 inline-block underline underline-offset-2"
              href={part.authorization.url}
              rel="noreferrer"
              target="_blank"
            >
              Sign in to {part.displayName}
            </a>
          )}
        </div>
      );

    // `step-start` and user file attachments carry nothing worth rendering here.
    default:
      return null;
  }
}

type PendingRequest = NonNullable<
  NonNullable<
    Extract<EveMessagePart, { type: "dynamic-tool" }>["toolMetadata"]
  >["eve"]
>["inputRequest"];

/**
 * An approval or question can stay open while later turns add messages, so
 * every message is scanned rather than just the last one.
 */
function collectInputRequests(
  messages: readonly EveMessage[],
): NonNullable<PendingRequest>[] {
  return messages
    .flatMap((message) => message.parts)
    .flatMap((part) => {
      if (part.type !== "dynamic-tool" || part.state !== "approval-requested") {
        return [];
      }
      const request = part.toolMetadata?.eve?.inputRequest;
      return request ? [request] : [];
    });
}

function findActiveRepo(messages: readonly EveMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const part of messages[i].parts) {
      if (part.type !== "dynamic-tool" || !("input" in part)) continue;
      const input = part.input as { repo?: unknown } | undefined;
      if (typeof input?.repo === "string") return shortRepoName(input.repo);
    }
  }
  return undefined;
}
