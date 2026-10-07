import { createBlock } from "camox/createBlock";
import { CheckCircle2, CircleAlert, Code2 } from "lucide-react";
import { type ChangeEvent, type KeyboardEvent, useState } from "react";

import { BlockContainer } from "@/components/BlockContainer";
import { Pill } from "@/components/Pill";
import { cn } from "@/lib/utils";

const demoFields = [
  { name: "title", defaultValue: "A type-safe block" },
  { name: "description", defaultValue: "Component 🤝 schema" },
] as const;

const typeSafeBlockDemo = createBlock({
  id: "type-safe-block-demo",
  title: "Type-safe Block Demo",
  description:
    "Use this interactive code demonstration to explain how createBlock infers valid Field names from a block's content schema. It works best near developer-focused product or framework content. Keep the heading concise and let visitors type in the field-name input to experience suggestions and validation.",
  content: (field) => ({
    pill: field.string({
      default: "Type-safe by design",
      title: "Pill label",
    }),
    title: field.string({
      default: "Your schema becomes your API.",
      title: "Title",
    }),
    description: field.string({
      default:
        "Field names are inferred directly from your block definition, with autocomplete and errors wherever you use them.",
      title: "Description",
    }),
  }),
  component: TypeSafeBlockDemoComponent,
  toMarkdown: (c) => [c.pill, `## ${c.title}`, c.description],
});

function getSuggestions(value: string) {
  const query = value.trim().toLowerCase();
  if (!query) return demoFields;

  const prefixMatches = demoFields.filter((field) => field.name.startsWith(query));
  if (prefixMatches.length > 0) return prefixMatches;

  return demoFields;
}

function TypeSafeBlockDemoComponent() {
  const [fieldName, setFieldName] = useState("titel");
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const suggestions = getSuggestions(fieldName);
  const isValid = demoFields.some((field) => field.name === fieldName);

  const selectSuggestion = (name: string) => {
    setFieldName(name);
    setIsSuggestionsOpen(false);
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setFieldName(event.target.value);
    setActiveSuggestion(0);
    setIsSuggestionsOpen(true);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setIsSuggestionsOpen(false);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSuggestion((current) => (current + 1) % suggestions.length);
      setIsSuggestionsOpen(true);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggestion((current) => (current - 1 + suggestions.length) % suggestions.length);
      setIsSuggestionsOpen(true);
      return;
    }

    if (event.key !== "Enter" || !isSuggestionsOpen) return;

    event.preventDefault();
    const suggestion = suggestions[activeSuggestion];
    if (!suggestion) return;
    selectSuggestion(suggestion.name);
  };

  return (
    <BlockContainer className="bg-popover/30">
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(36rem,1.2fr)] lg:gap-16">
        <div className="max-w-xl lg:sticky lg:top-28">
          <typeSafeBlockDemo.Field name="pill">
            {(props) => <Pill {...props} className="mb-6" />}
          </typeSafeBlockDemo.Field>
          <typeSafeBlockDemo.Field name="title">
            {(props) => (
              <h2
                {...props}
                className="text-foreground text-3xl leading-tight font-semibold tracking-tight sm:text-4xl"
              />
            )}
          </typeSafeBlockDemo.Field>
          <typeSafeBlockDemo.Field name="description">
            {(props) => (
              <p
                {...props}
                className="text-muted-foreground mt-4 text-base leading-relaxed sm:text-lg"
              />
            )}
          </typeSafeBlockDemo.Field>
        </div>

        <div className="border-border bg-background overflow-hidden rounded-2xl border shadow-2xl shadow-black/5">
          <div className="border-border bg-muted/40 flex items-center justify-between border-b px-4 py-3 sm:px-5">
            <div className="flex items-center gap-2">
              <Code2 aria-hidden className="text-muted-foreground size-4" />
              <span className="text-foreground font-mono text-xs">feature.tsx</span>
            </div>
            <span className="text-muted-foreground ml-4 text-right text-[0.7rem] sm:text-xs">
              Edit the highlighted field name
            </span>
          </div>

          <div className="overflow-x-auto py-5 text-[0.78rem] leading-7 sm:py-6 sm:text-sm">
            <div className="min-w-[36rem] font-mono">
              <CodeLine number={1}>
                <SyntaxToken tone="purple">import</SyntaxToken> {"{ "}createBlock{" } "}
                <SyntaxToken tone="purple">from</SyntaxToken>{" "}
                <SyntaxToken tone="green">&quot;camox/createBlock&quot;</SyntaxToken>;
              </CodeLine>
              <CodeLine number={2} />
              <CodeLine number={3}>
                <SyntaxToken tone="purple">const</SyntaxToken> feature = createBlock({"{"}
              </CodeLine>
              <CodeLine number={4} indent={1}>
                content: (field) =&gt; ({"{"}
              </CodeLine>
              {demoFields.map((field, index) => (
                <CodeLine key={field.name} number={index + 5} indent={2}>
                  <SyntaxToken tone="blue">{field.name}</SyntaxToken>: field.string({"{"} default:{" "}
                  <SyntaxToken tone="green">&quot;{field.defaultValue}&quot;</SyntaxToken> {"}"}),
                </CodeLine>
              ))}
              <CodeLine number={7} indent={1}>
                {"}"}),
              </CodeLine>
              <CodeLine number={8} indent={1}>
                component:{" "}
                <span className="group/component relative inline-block">
                  <button
                    type="button"
                    aria-describedby="component-reference-explanation"
                    className="cursor-help text-sky-600 underline decoration-dotted underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50 dark:text-sky-400"
                  >
                    Feature
                  </button>
                  <span
                    id="component-reference-explanation"
                    role="tooltip"
                    className="border-border bg-popover text-popover-foreground pointer-events-none absolute top-full left-1/2 z-30 mt-2 w-72 -translate-x-1/2 rounded-lg border px-3 py-2.5 text-left font-sans text-xs leading-relaxed whitespace-normal opacity-0 shadow-xl transition-opacity group-focus-within/component:opacity-100 group-hover/component:opacity-100"
                  >
                    The component is defined below instead of inline. That is so it can infer types
                    from the block content schema.
                  </span>
                </span>
                {","}
              </CodeLine>
              <CodeLine number={9}>{"}"});</CodeLine>
              <CodeLine number={10} />
              <CodeLine number={11}>
                <SyntaxToken tone="purple">function</SyntaxToken>{" "}
                <SyntaxToken tone="blue">Feature</SyntaxToken>() {"{"}
              </CodeLine>
              <CodeLine number={12} indent={1}>
                <SyntaxToken tone="purple">return</SyntaxToken> (
              </CodeLine>
              <CodeLine number={13} indent={2}>
                <span className="text-sky-600 dark:text-sky-400">&lt;feature.Field</span>{" "}
                <span className="text-violet-600 dark:text-violet-400">name</span>=
                <span className="text-emerald-600 dark:text-emerald-400">&quot;</span>
                <span className="relative inline-flex align-baseline">
                  <input
                    aria-activedescendant={
                      isSuggestionsOpen ? `field-suggestion-${activeSuggestion}` : undefined
                    }
                    aria-autocomplete="list"
                    aria-controls="field-name-suggestions"
                    aria-expanded={isSuggestionsOpen}
                    aria-label="Field name"
                    className={cn(
                      "bg-primary/8 selection:bg-primary/25 h-6 min-w-12 border-0 px-0.5 font-mono text-inherit outline-none",
                      isValid
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-destructive decoration-destructive underline decoration-wavy underline-offset-4",
                    )}
                    onBlur={() => setIsSuggestionsOpen(false)}
                    onChange={handleChange}
                    onFocus={() => setIsSuggestionsOpen(true)}
                    onKeyDown={handleKeyDown}
                    role="combobox"
                    spellCheck={false}
                    style={{ width: `${Math.max(fieldName.length, 2) + 0.5}ch` }}
                    value={fieldName}
                  />
                  {isSuggestionsOpen ? (
                    <div
                      id="field-name-suggestions"
                      className="border-border bg-popover absolute top-8 left-0 z-20 w-52 overflow-hidden rounded-lg border py-1 text-left shadow-xl"
                      role="listbox"
                    >
                      {suggestions.map((field, index) => (
                        <button
                          key={field.name}
                          id={`field-suggestion-${index}`}
                          type="button"
                          className={cn(
                            "flex w-full items-center justify-between px-3 py-1.5 text-left",
                            index === activeSuggestion && "bg-primary/10",
                          )}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => selectSuggestion(field.name)}
                          role="option"
                          aria-selected={index === activeSuggestion}
                        >
                          <span className="text-foreground">{field.name}</span>
                          <span className="text-muted-foreground text-[0.65rem]">String</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </span>
                <span className="text-emerald-600 dark:text-emerald-400">&quot;</span>
                <span className="text-sky-600 dark:text-sky-400">&gt;</span>
              </CodeLine>
              <CodeLine number={14} indent={3}>
                {"{("}props{`) => `}
                <span className="text-sky-600 dark:text-sky-400">&lt;h2</span> {"{"}...props{"}"}{" "}
                <span className="text-sky-600 dark:text-sky-400">/&gt;</span>
                {"}"}
              </CodeLine>
              <CodeLine number={15} indent={2}>
                <span className="text-sky-600 dark:text-sky-400">&lt;/feature.Field&gt;</span>
              </CodeLine>
              <CodeLine number={16} indent={1}>
                );
              </CodeLine>
              <CodeLine number={17}>{"}"}</CodeLine>
            </div>
          </div>

          <div
            aria-live="polite"
            className={cn(
              "border-border flex min-h-14 items-start gap-3 border-t px-4 py-3 text-sm sm:px-5",
              isValid ? "bg-emerald-500/5" : "bg-destructive/5",
            )}
          >
            {isValid ? (
              <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            ) : (
              <CircleAlert aria-hidden className="text-destructive mt-0.5 size-4 shrink-0" />
            )}
            <div>
              <p
                className={cn(
                  "font-mono text-xs",
                  isValid ? "text-emerald-700" : "text-destructive",
                )}
              >
                {isValid
                  ? `Field resolves to content.${fieldName}`
                  : `“${fieldName || "(empty)"}” is not a field in this block.`}
              </p>
              {!isValid ? (
                <p className="text-muted-foreground mt-1 text-xs">
                  Expected <code>&quot;title&quot; | &quot;description&quot;</code>.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </BlockContainer>
  );
}

type CodeLineProps = {
  children?: React.ReactNode;
  indent?: number;
  number: number;
};

function CodeLine({ children, indent = 0, number }: CodeLineProps) {
  return (
    <div className="grid grid-cols-[2.75rem_1fr] sm:grid-cols-[3.25rem_1fr]">
      <span aria-hidden className="text-muted-foreground/45 pr-4 text-right select-none">
        {number}
      </span>
      <span
        className="text-foreground whitespace-pre"
        style={{ paddingLeft: `${indent * 1.25}rem` }}
      >
        {children}
      </span>
    </div>
  );
}

type SyntaxTokenProps = {
  children: React.ReactNode;
  tone: "blue" | "green" | "purple";
};

function SyntaxToken({ children, tone }: SyntaxTokenProps) {
  return (
    <span
      className={cn({
        "text-sky-600 dark:text-sky-400": tone === "blue",
        "text-emerald-600 dark:text-emerald-400": tone === "green",
        "text-violet-600 dark:text-violet-400": tone === "purple",
      })}
    >
      {children}
    </span>
  );
}

export { typeSafeBlockDemo as block };
