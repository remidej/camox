import * as React from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/* -------------------------------------------------------------------------------------------------
 * LinkFieldEditor
 * -----------------------------------------------------------------------------------------------*/

interface LinkFieldEditorProps {
  fieldName: string;
  label: string;
  linkValue: { text: string; href: string; newTab: boolean };
  onSave: (
    fieldName: string,
    value: { text: string; href: string; newTab: boolean },
  ) => void;
}

const LinkFieldEditor = ({
  fieldName,
  label,
  linkValue,
  onSave,
}: LinkFieldEditorProps) => {
  const timerRef = React.useRef<number | null>(null);
  const [text, setText] = React.useState(linkValue.text);
  const [href, setHref] = React.useState(linkValue.href);
  const linkValueRef = React.useRef(linkValue);

  React.useEffect(() => {
    linkValueRef.current = linkValue;
  }, [linkValue]);

  React.useEffect(() => {
    setText(linkValue.text);
  }, [linkValue.text]);

  React.useEffect(() => {
    setHref(linkValue.href);
  }, [linkValue.href]);

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleChange = (subField: string, value: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      onSave(fieldName, { ...linkValueRef.current, [subField]: value });
    }, 500);
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label
            htmlFor={`${fieldName}-text`}
            className="text-xs text-muted-foreground"
          >
            Text
          </Label>
          <Input
            id={`${fieldName}-text`}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              handleChange("text", e.target.value);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label
            htmlFor={`${fieldName}-href`}
            className="text-xs text-muted-foreground"
          >
            URL
          </Label>
          <Input
            id={`${fieldName}-href`}
            type="url"
            value={href}
            onChange={(e) => {
              setHref(e.target.value);
              handleChange("href", e.target.value);
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id={`${fieldName}-newtab`}
            checked={linkValue.newTab}
            onCheckedChange={(checked) => {
              onSave(fieldName, { ...linkValueRef.current, newTab: checked });
            }}
          />
          <Label htmlFor={`${fieldName}-newtab`}>Open in new tab</Label>
        </div>
      </div>
    </div>
  );
};

export { LinkFieldEditor };
