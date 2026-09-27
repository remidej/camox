import { ButtonGroup } from "@camox/ui/button-group";
import { Toggle } from "@camox/ui/toggle";
import * as Tooltip from "@camox/ui/tooltip";
import { Monitor, Smartphone, Tablet } from "lucide-react";

type Device = "desktop" | "tablet" | "mobile";

interface DeviceSelectorProps {
  value: Device;
  onValueChange: (device: Device) => void;
  "aria-label"?: string;
  desktopLabel?: string;
  className?: string;
  size?: "default" | "sm";
}

export function DeviceSelector({
  value,
  onValueChange,
  "aria-label": ariaLabel = "Device",
  desktopLabel = "Desktop view",
  className,
  size = "default",
}: DeviceSelectorProps) {
  const options = [
    { value: "desktop", label: desktopLabel, icon: Monitor },
    { value: "tablet", label: "Tablet view", icon: Tablet },
    { value: "mobile", label: "Mobile view", icon: Smartphone },
  ] as const;

  return (
    <ButtonGroup aria-label={ariaLabel} className={className}>
      {options.map(({ value: device, label, icon: Icon }) => (
        <Tooltip.Tooltip key={device}>
          <Tooltip.TooltipTrigger
            render={
              <Toggle
                aria-label={label}
                data-state={value === device ? "on" : "off"}
                pressed={value === device}
                onPressedChange={() => {
                  if (value === device) return;
                  onValueChange(device);
                }}
                variant="outline"
                size={size}
              />
            }
          >
            <Icon />
          </Tooltip.TooltipTrigger>
          <Tooltip.TooltipContent>{label}</Tooltip.TooltipContent>
        </Tooltip.Tooltip>
      ))}
    </ButtonGroup>
  );
}
