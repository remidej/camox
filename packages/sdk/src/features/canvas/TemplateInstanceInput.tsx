import { Button } from "@camox/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@camox/ui/input-group";
import * as React from "react";

import { matchDerivedLayout, routeSegments } from "../../core/derivedRoutes";
import { useCamoxApp } from "../provider/components/CamoxAppContext";
import type { CanvasPage } from "./canvasPages";

type Props = {
  page: CanvasPage;
  pathname: string | null;
  onChange: (pathname: string) => void;
};

export function TemplateInstanceInput(props: Props) {
  // A newly selected instance starts a fresh draft, including externally selected paths.
  return <InstanceForm key={JSON.stringify([props.page.templateId, props.pathname])} {...props} />;
}

function InstanceForm({ page, pathname, onChange }: Props) {
  const app = useCamoxApp();
  const [values, setValues] = React.useState<Record<string, string>>(() => {
    if (!pathname || /[?#]/.test(pathname)) return {};
    const match = matchDerivedLayout(app.getLayouts(), pathname);
    return match && match.layout._internal.id === page.templateId ? match.params : {};
  });
  const [invalid, setInvalid] = React.useState(false);
  const errorId = React.useId();
  const segments = routeSegments(page.templateId ?? "");
  const params = [
    ...new Set(
      segments.filter((segment) => segment.startsWith("$")).map((segment) => segment.slice(1)),
    ),
  ];
  const resolved = segments.map((segment) =>
    segment.startsWith("$")
      ? encodeURIComponent(values[segment.slice(1)]?.trim() ?? "")
      : encodeURIComponent(segment),
  );
  const path = `/${resolved.join("/")}`;
  const validParams = params.every((param) => {
    const value = values[param]?.trim();
    return value && !value.includes("/") && value !== "." && value !== "..";
  });
  const matches =
    Boolean(page.templateId) &&
    validParams &&
    !/[?#]/.test(path) &&
    matchDerivedLayout(app.getLayouts(), path)?.layout._internal.id === page.templateId;

  return (
    <form
      aria-label={`Instance path for ${page.title}`}
      className="flex min-w-0 flex-1 flex-wrap items-center gap-1"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setInvalid(!matches);
        if (!matches) return;
        onChange(path);
      }}
    >
      {params.map((param) => {
        const index = segments.indexOf(`$${param}`);
        const prefix = resolved.slice(0, index).join("/");
        const suffix = segments.slice(index + 1).every((segment) => !segment.startsWith("$"))
          ? resolved.slice(index + 1).join("/")
          : "";
        return (
          <InputGroup key={param} className="bg-background/80 h-7 min-w-0 flex-1 basis-48">
            <InputGroupAddon className="max-w-1/2 overflow-hidden">
              <InputGroupText className="truncate font-mono text-xs">
                /{prefix && `${prefix}/`}
              </InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              aria-label={`${param} for ${page.title}`}
              aria-invalid={invalid}
              aria-describedby={invalid ? errorId : undefined}
              className="h-7 min-w-0 px-1 text-xs"
              placeholder={param}
              required
              value={values[param] ?? ""}
              onChange={(event) => {
                setValues((previous) => ({ ...previous, [param]: event.target.value }));
                setInvalid(false);
              }}
            />
            {suffix && (
              <InputGroupAddon align="inline-end">
                <InputGroupText className="font-mono text-xs">/{suffix}</InputGroupText>
              </InputGroupAddon>
            )}
          </InputGroup>
        );
      })}
      {params.length === 0 && (
        <InputGroup className="bg-background/80 h-7 min-w-0 flex-1">
          <InputGroupAddon>
            <InputGroupText className="font-mono text-xs">{path}</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
      )}
      <Button type="submit" variant="outline" size="sm" className="h-7 text-xs">
        View
      </Button>
      {invalid && (
        <span id={errorId} role="alert" className="text-destructive basis-full text-xs">
          Enter values matching {page.pattern ?? page.templateId}.
        </span>
      )}
    </form>
  );
}
