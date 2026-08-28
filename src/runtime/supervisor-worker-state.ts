import { type RuntimeSlot, type WorkerLease } from "./supervisor-types.js";

export function releaseRuntimeWorker(slot: RuntimeSlot, lease: WorkerLease): void {
  if (!lease.terminated) {
    lease.terminated = true;
    lease.worker.terminate();
  }
  if (slot.worker === lease) delete slot.worker;
  slot.initialized = false;
  delete slot.identity;
  delete slot.initializePayload;
}
