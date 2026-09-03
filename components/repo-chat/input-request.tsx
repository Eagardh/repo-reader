"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EveMessagePart } from "eve/react";
import { useState } from "react";

type DynamicToolPart = Extract<EveMessagePart, { type: "dynamic-tool" }>;
type Request = NonNullable<
  NonNullable<DynamicToolPart["toolMetadata"]>["eve"]
>["inputRequest"];

type Response = { requestId: string; optionId?: string; text?: string };

/**
 * Renders a human-in-the-loop prompt: a tool waiting on approval, or the
 * agent's own `ask_question` call.
 */
export function InputRequest({
  request,
  onRespond,
}: {
  request: NonNullable<Request>;
  onRespond: (response: Response) => void;
}) {
  const [freeform, setFreeform] = useState("");

  return (
    <div className="rounded-lg border bg-muted/40 p-4">
      <p className="text-sm">{request.prompt}</p>

      {request.options && request.options.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {request.options.map((option) => (
            <Button
              key={option.id}
              onClick={() =>
                onRespond({ requestId: request.requestId, optionId: option.id })
              }
              size="sm"
              variant={option.style === "danger" ? "destructive" : "outline"}
            >
              {option.label}
            </Button>
          ))}
        </div>
      )}

      {request.allowFreeform && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = freeform.trim();
            if (!value) return;
            setFreeform("");
            onRespond({ requestId: request.requestId, text: value });
          }}
        >
          <Input
            onChange={(event) => setFreeform(event.currentTarget.value)}
            placeholder="Type your answer…"
            value={freeform}
          />
          <Button size="sm" type="submit">
            Send
          </Button>
        </form>
      )}
    </div>
  );
}
