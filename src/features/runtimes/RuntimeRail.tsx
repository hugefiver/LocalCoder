import {
  Activity,
  CircleCheck,
  CircleOff,
  LoaderCircle,
  Package,
  TriangleAlert,
} from "lucide-react";

import type {
  RuntimeRailItemModel,
  RuntimeStatusIconName,
} from "./runtime-view-model.js";

export function RuntimeRail({ items }: { items: readonly RuntimeRailItemModel[] }) {
  return (
    <section className="runtime-rail" aria-label="运行时状态">
      <span className="runtime-rail__label">本地运行时</span>
      <ul className="runtime-rail__list" aria-live="polite" aria-atomic="false">
        {items.map((item) => (
          <li
            className="runtime-rail__item"
            data-tone={item.tone}
            data-state={item.state}
            key={item.runtimeId}
            title={item.ariaLive}
          >
            <RuntimeStatusIcon name={item.icon} />
            <span>{item.label}</span>
            <span className="runtime-rail__status">{item.statusLabel}</span>
            <span className="sr-only">{item.ariaLive}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RuntimeStatusIcon({ name }: { name: RuntimeStatusIconName }) {
  const props = { className: "runtime-status-icon", "aria-hidden": true } as const;
  switch (name) {
    case "package":
      return <Package {...props} />;
    case "progress":
      return <LoaderCircle {...props} />;
    case "ready":
      return <CircleCheck {...props} />;
    case "running":
      return <Activity {...props} />;
    case "unavailable":
      return <CircleOff {...props} />;
    case "error":
      return <TriangleAlert {...props} />;
  }
}
