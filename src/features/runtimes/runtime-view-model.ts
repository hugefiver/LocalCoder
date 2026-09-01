import type { RuntimeId } from "../../domain/language.js";
import type {
  RuntimeCapability,
  RuntimeCapabilityState,
} from "../../runtime/registry.js";
import { isRuntimeExecutionEligible } from "../../runtime/registry.js";
import type { StorageState } from "../../storage/schema.js";

export type RuntimePurpose = "execute" | "judge";
export type RuntimeStatusTone = "neutral" | "info" | "success" | "warning" | "error";
export type RuntimeStatusIconName = "package" | "progress" | "ready" | "running" | "unavailable" | "error";

export interface RuntimeOptionModel {
  value: RuntimeId;
  label: string;
  statusLabel: string;
  disabled: boolean;
  reason?: string;
}

export interface RuntimeRailItemModel {
  runtimeId: RuntimeId;
  label: string;
  state: RuntimeCapabilityState["kind"];
  statusLabel: string;
  tone: RuntimeStatusTone;
  icon: RuntimeStatusIconName;
  ariaLive: string;
}

export interface StorageBannerModel {
  label: "未保存";
  reason: string;
  persistent: true;
}

const RUNTIME_LABELS: Readonly<Record<RuntimeId, string>> = Object.freeze({
  "javascript-worker": "JavaScript",
  "typescript-official": "TypeScript",
  "python-pyodide": "Python · Pyodide",
  "python-rustpython": "Python · RustPython",
  "racket-wasm": "Racket",
  "haskell-ghc-wasi": "Haskell",
});

export function runtimeLabel(runtimeId: RuntimeId): string {
  return RUNTIME_LABELS[runtimeId];
}

export function toRuntimeOption(
  capability: RuntimeCapability,
  purpose: RuntimePurpose,
): RuntimeOptionModel {
  const base = {
    value: capability.runtimeId,
    label: runtimeLabel(capability.runtimeId),
  };
  if (capability.state.kind !== "failed") {
    const unavailable = unavailableState(capability.state);
    if (unavailable !== null) {
      return { ...base, statusLabel: unavailable.statusLabel, disabled: true, reason: unavailable.reason };
    }
  }
  if (!capability.capabilities[purpose]) {
    return {
      ...base,
      statusLabel: purpose === "execute" ? "不支持运行" : "不支持判题",
      disabled: true,
      reason: purpose === "execute"
        ? "此运行时不提供本地执行能力"
        : "此运行时不提供本地判题能力",
    };
  }
  if (capability.state.kind === "failed") {
    if (isRuntimeExecutionEligible(capability, { allowFailed: true })) {
      return { ...base, statusLabel: "失败，可重试", disabled: false };
    }
    return {
      ...base,
      statusLabel: "失败",
      disabled: true,
      reason: `${capability.state.code}：${capability.state.message}`,
    };
  }
  if (!isRuntimeExecutionEligible(capability)) {
    return {
      ...base,
      statusLabel: "待验证",
      disabled: true,
      reason: "可选运行时必须完成验证后才能使用",
    };
  }
  return {
    ...base,
    statusLabel: statusFor(capability).label,
    disabled: false,
  };
}

export function canVerifyOptionalRuntime(capability: RuntimeCapability): boolean {
  return !capability.required
    && capability.packaged
    && capability.verification === "unverified"
    && (capability.state.kind === "loadable" || capability.state.kind === "failed");
}

export function toRuntimeRailItem(capability: RuntimeCapability): RuntimeRailItemModel {
  const label = runtimeLabel(capability.runtimeId);
  const status = statusFor(capability);
  return {
    runtimeId: capability.runtimeId,
    label,
    state: capability.state.kind,
    statusLabel: status.label,
    tone: status.tone,
    icon: status.icon,
    ariaLive: ariaLiveFor(label, capability),
  };
}

export function toStorageBanner(state: StorageState): StorageBannerModel | null {
  if (state.kind === "persistent") return null;
  return { label: state.message, reason: state.reason, persistent: true };
}

function statusFor(capability: RuntimeCapability): {
  label: string;
  tone: RuntimeStatusTone;
  icon: RuntimeStatusIconName;
} {
  const { state } = capability;
  if (!isRuntimeExecutionEligible(capability) && !capability.required && capability.verification === "unverified"
    && state.kind !== "not-packaged" && state.kind !== "failed" && state.kind !== "incompatible" && state.kind !== "verifying") {
    return { label: "待验证", tone: "warning", icon: "progress" };
  }
  switch (state.kind) {
    case "not-packaged":
      return { label: "不可用", tone: "error", icon: "unavailable" };
    case "loadable":
      return { label: "可加载", tone: "info", icon: "package" };
    case "initializing":
      return { label: "初始化中", tone: "warning", icon: "progress" };
    case "verifying":
      return { label: "验证中", tone: "warning", icon: "progress" };
    case "ready":
      return { label: "就绪", tone: "success", icon: "ready" };
    case "running":
      return { label: "执行中", tone: "info", icon: "running" };
    case "failed":
      return { label: "失败", tone: "error", icon: "error" };
    case "incompatible":
      return { label: "不兼容", tone: "error", icon: "error" };
  }
}

function unavailableState(state: RuntimeCapabilityState): { statusLabel: string; reason: string } | null {
  switch (state.kind) {
    case "not-packaged":
      return { statusLabel: "不可用", reason: state.reason };
    case "failed":
      return { statusLabel: "失败", reason: `${state.code}：${state.message}` };
    case "incompatible":
      return {
        statusLabel: "不兼容",
        reason: `协议版本不兼容：需要 ${state.expected}，收到 ${state.received}`,
      };
    case "verifying":
      return { statusLabel: "验证中", reason: "运行时正在验证，验证完成前不可选择" };
    case "loadable":
    case "initializing":
    case "ready":
    case "running":
      return null;
  }
}

function ariaLiveFor(label: string, capability: RuntimeCapability): string {
  const { state } = capability;
  if (!isRuntimeExecutionEligible(capability) && !capability.required && capability.verification === "unverified"
    && state.kind !== "not-packaged" && state.kind !== "failed" && state.kind !== "incompatible" && state.kind !== "verifying") {
    return `${label} 尚未验证，验证完成前不可选择`;
  }
  switch (state.kind) {
    case "not-packaged":
      return `${label} 不可用：${state.reason}`;
    case "loadable":
      return `${label} 可加载，将在首次使用时初始化`;
    case "initializing":
      return state.message === undefined
        ? `${label} 正在初始化`
        : `${label} 正在初始化：${state.message}`;
    case "verifying":
      return `${label} 正在验证，验证完成前不可选择`;
    case "ready":
      return `${label} 已就绪，可在本地执行`;
    case "running":
      return `${label} 正在本地执行`;
    case "failed":
      return `${label} 运行时失败（${state.code}）：${state.message}`;
    case "incompatible":
      return `${label} 协议不兼容：需要版本 ${state.expected}，收到版本 ${state.received}`;
  }
}
