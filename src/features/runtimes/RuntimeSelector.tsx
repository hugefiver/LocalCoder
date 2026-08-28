import { useId } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.js";
import type { LanguageId, RuntimeId } from "../../domain/language.js";
import { useAppServices } from "../../hooks/use-app-services.js";
import { useRuntimeRegistry } from "../../hooks/use-runtime-registry.js";
import {
  toRuntimeOption,
  type RuntimePurpose,
} from "./runtime-view-model.js";

interface RuntimeSelectorProps {
  languageId: LanguageId;
  purpose: RuntimePurpose;
  value?: RuntimeId;
  onValueChange: (runtimeId: RuntimeId) => void;
  label?: string;
}

export function RuntimeSelector({
  languageId,
  purpose,
  value,
  onValueChange,
  label = "运行时",
}: RuntimeSelectorProps) {
  const labelId = useId();
  const reasonId = useId();
  const { registry } = useAppServices();
  useRuntimeRegistry();
  const options = registry
    .forLanguage(languageId)
    .map((capability) => toRuntimeOption(capability, purpose));
  const unavailable = options.filter((option) => option.disabled && option.reason !== undefined);

  return (
    <div className="runtime-selector">
      <span className="runtime-selector__label" id={labelId}>{label}</span>
      <Select
        disabled={options.length === 0}
        onValueChange={(nextValue) => onValueChange(nextValue as RuntimeId)}
        value={value ?? ""}
      >
        <SelectTrigger
          aria-describedby={unavailable.length === 0 ? undefined : reasonId}
          aria-labelledby={labelId}
          className="w-full"
        >
          <SelectValue placeholder="选择本地运行时" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem disabled={option.disabled} key={option.value} value={option.value}>
              <span>{option.label}</span>
              <span className="runtime-selector__status">{option.statusLabel}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {unavailable.length > 0 ? (
        <ul className="runtime-selector__reasons" id={reasonId}>
          {unavailable.map((option) => (
            <li key={option.value}>
              <strong>{option.label}：</strong>{option.reason}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
