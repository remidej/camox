import * as React from "react";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Id } from "camox/_generated/dataModel";

const DebouncedFieldEditor = ({
  fileId,
  label,
  placeholder,
  initialValue,
  onSave,
  disabled,
  rows,
}: {
  fileId: Id<"files">;
  label: string;
  placeholder: string;
  initialValue: string;
  onSave: (args: { fileId: Id<"files">; value: string }) => void;
  disabled?: boolean;
  rows?: number;
}) => {
  const [value, setValue] = React.useState(initialValue);
  const timerRef = React.useRef<number | null>(null);
  const inputId = React.useId();

  React.useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  const handleChange = (newValue: string) => {
    if (disabled) return;
    if (rows) newValue = newValue.replace(/\n/g, " ");
    setValue(newValue);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      onSave({ fileId, value: newValue });
    }, 500);
  };

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className="space-y-2">
      <Label htmlFor={inputId}>{label}</Label>
      {rows ? (
        <Textarea
          id={inputId}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          rows={rows}
          className="resize-none"
        />
      ) : (
        <Input
          id={inputId}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
        />
      )}
    </div>
  );
};

export { DebouncedFieldEditor };
