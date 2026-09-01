import { useState, type ReactElement } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog.js";
import { useRuntimeRegistry } from "../../hooks/use-runtime-registry.js";
import { useAppServices } from "../../hooks/use-app-services.js";
import type { RuntimeCapability, RuntimeCapabilityState } from "../../runtime/registry.js";
import type { RuntimeVerification } from "../../runtime/optional-verification.js";
import { Button } from "../../components/ui/button.js";
import { RuntimeStatusIcon } from "./RuntimeRail.js";
import { canVerifyOptionalRuntime, toRuntimeRailItem } from "./runtime-view-model.js";

export function RuntimeDetailsDialog({ trigger }: { trigger: ReactElement }) {
  const capabilities = useRuntimeRegistry();

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="runtime-details-dialog">
        <DialogHeader>
          <DialogTitle>本地运行时详情</DialogTitle>
          <DialogDescription>
            状态直接来自运行时注册表；未打包或不兼容的运行时不会被伪装为可用。
          </DialogDescription>
        </DialogHeader>
        <div className="runtime-details" role="list">
          {capabilities.map((capability) => {
            const model = toRuntimeRailItem(capability);
            return (
              <article className="runtime-details__item" key={capability.runtimeId} role="listitem">
                <div className="runtime-details__heading">
                  <span data-tone={model.tone}><RuntimeStatusIcon name={model.icon} /></span>
                  <div>
                    <h3>{model.label}</h3>
                    <p className="runtime-details__id">{capability.runtimeId}</p>
                  </div>
                  <span className="runtime-details__status" data-tone={model.tone}>
                    {model.statusLabel}
                  </span>
                </div>
                <dl className="runtime-details__facts">
                  <div><dt>打包</dt><dd>{capability.packaged ? "已打包" : "未打包"}</dd></div>
                  <div><dt>版本</dt><dd>{capability.runtimeVersion}</dd></div>
                  <div><dt>用途</dt><dd>{purposeLabel(capability.capabilities)}</dd></div>
                </dl>
                <p className="runtime-details__message">{stateDetail(capability.state)}</p>
                <OptionalVerificationAction capability={capability} />
              </article>
            );
          })}
        </div>
        <p className="runtime-details__boundary">
          Web Worker 提供本地执行隔离与可终止边界，但不是安全隔离环境。浏览器内的测试数据可被检查，不提供竞赛保密或反作弊保证。
        </p>
      </DialogContent>
    </Dialog>
  );
}

function OptionalVerificationAction({ capability }: { capability: RuntimeCapability }) {
  const { optionalRuntimes } = useAppServices();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RuntimeVerification | undefined>();
  const canVerify = canVerifyOptionalRuntime(capability);
  if (!canVerify && result === undefined) return null;

  const verify = async (): Promise<void> => {
    setLoading(true);
    try {
      setResult(await optionalRuntimes.verify(capability.runtimeId));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="runtime-details__verification">
      {canVerify ? (
        <Button type="button" variant="outline" size="sm" loading={loading} onClick={() => { void verify(); }}>
          验证运行时
        </Button>
      ) : null}
      {result === undefined ? null : (
        <p aria-live="polite" className="runtime-details__message">
          {verificationDetail(result)}
        </p>
      )}
    </div>
  );
}

function verificationDetail(result: RuntimeVerification): string {
  if (result.state === "verified") return `验证完成：${result.runtimeVersion}。`;
  if (result.state === "unavailable") return result.reason;
  return `${result.code}：${result.message}`;
}

function purposeLabel(capabilities: { execute: boolean; judge: boolean }): string {
  if (capabilities.execute && capabilities.judge) return "本地运行、判题";
  if (capabilities.execute) return "仅本地运行";
  if (capabilities.judge) return "仅本地判题";
  return "当前不提供运行或判题";
}

function stateDetail(state: RuntimeCapabilityState): string {
  switch (state.kind) {
    case "not-packaged":
      return state.reason;
    case "loadable":
      return "运行时文件已打包，将在首次使用时初始化。";
    case "initializing":
      return state.message ?? "正在初始化运行时。";
    case "verifying":
      return "正在验证运行时；验证完成前不可选择。";
    case "ready":
      return "初始化完成，可以在浏览器中本地执行。";
    case "running":
      return `正在执行请求 ${state.requestId}。`;
    case "failed":
      return `${state.code}：${state.message}`;
    case "incompatible":
      return `协议版本不兼容：需要 ${state.expected}，收到 ${state.received}。`;
  }
}
