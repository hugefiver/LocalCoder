import { TriangleAlert } from "lucide-react";

import type { StorageBannerModel } from "../../features/runtimes/runtime-view-model.js";

export function StorageStatus({ model }: { model: StorageBannerModel | null }) {
  if (model === null) return null;
  return (
    <div className="storage-status" role="status" aria-live="polite">
      <TriangleAlert aria-hidden="true" />
      <strong>{model.label}</strong>
      <span>{model.reason}</span>
    </div>
  );
}
