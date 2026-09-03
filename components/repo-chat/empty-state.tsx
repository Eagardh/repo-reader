import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

const EXAMPLES = [
  {
    label: "Explain what vercel/eve does",
    prompt: "https://github.com/vercel/eve — what does this project actually do?",
  },
  {
    label: "How routing works in honojs/hono",
    prompt: "https://github.com/honojs/hono — how does routing work internally?",
  },
  {
    label: "Find type inference in zod/zod",
    prompt: "https://github.com/zod/zod — where is the type inference implemented?",
  },
];

export function EmptyState({
  children,
  onSelect,
}: {
  children: ReactNode;
  onSelect: (prompt: string) => void;
}) {
  return (
    <div className="flex flex-1 items-center justify-center py-12">
      <div className="w-full max-w-xl">
        <h1 className="text-center text-balance font-semibold text-xl tracking-tight">
          What repository can I help with?
        </h1>

        <div className="mt-5">{children}</div>

        <div className="mt-4">
          <p className="mb-1.5 text-[11px] text-muted-foreground">Examples</p>
          <div className="flex flex-col items-start gap-1">
            {EXAMPLES.map((example) => (
              <button
                className="group flex items-center gap-1 rounded-md px-1.5 py-1 text-left text-[11px] text-muted-foreground outline-none transition-colors hover:bg-background/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                key={example.label}
                onClick={() => onSelect(example.prompt)}
                type="button"
              >
                {example.label}
                <ChevronRightIcon className="size-3 transition-transform group-hover:translate-x-0.5" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
