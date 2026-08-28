import assert from "node:assert/strict";
import test from "node:test";

import type { RuntimeId } from "../../src/domain/language.js";
import type {
  RuntimeCapability,
  RuntimeCapabilityState,
  RuntimeVerificationState,
} from "../../src/runtime/registry.js";
import {
  toRuntimeOption,
  toRuntimeRailItem,
  toStorageBanner,
} from "../../src/features/runtimes/runtime-view-model.js";

function capability(
  state: RuntimeCapabilityState,
  options: {
    runtimeId?: RuntimeId;
    execute?: boolean;
    judge?: boolean;
    verification?: RuntimeVerificationState;
  } = {},
): RuntimeCapability {
  const runtimeId = options.runtimeId ?? "javascript-worker";
  return {
    runtimeId,
    languageId: runtimeId === "racket-wasm" ? "racket" : "javascript",
    protocolVersion: 1,
    runtimeVersion: "test-runtime",
    worker: { url: "runtime.worker.js", type: "module" },
    assets: [],
    required: runtimeId === "javascript-worker",
    packaged: state.kind !== "not-packaged",
    verification: options.verification ?? (runtimeId === "javascript-worker" ? "not-required" : "unverified"),
    ...(state.kind === "not-packaged" ? { unavailableReason: state.reason } : {}),
    reuse: "session",
    capabilities: {
      execute: options.execute ?? true,
      judge: options.judge ?? true,
    },
    timeouts: { initializeMs: 1_000, executeMs: 1_000 },
    limits: { sourceBytes: 1_024, caseCount: 10, outputBytes: 1_024 },
    state,
  };
}

test("runtime rail maps every registry state to honest status, tone, icon, and copy", () => {
  const cases = [
    {
      state: { kind: "not-packaged", reason: "缺少 racket/racket.js, racket/racket.wasm" } as const,
      runtimeId: "racket-wasm" as const,
      expected: {
        statusLabel: "不可用",
        tone: "error",
        icon: "unavailable",
        ariaLive: "Racket 不可用：缺少 racket/racket.js, racket/racket.wasm",
      },
    },
    {
      state: { kind: "loadable" } as const,
      expected: {
        statusLabel: "可加载",
        tone: "info",
        icon: "package",
        ariaLive: "JavaScript 可加载，将在首次使用时初始化",
      },
    },
    {
      state: { kind: "initializing", message: "正在加载运行时文件" } as const,
      expected: {
        statusLabel: "初始化中",
        tone: "warning",
        icon: "progress",
        ariaLive: "JavaScript 正在初始化：正在加载运行时文件",
      },
    },
    {
      state: { kind: "ready" } as const,
      expected: {
        statusLabel: "就绪",
        tone: "success",
        icon: "ready",
        ariaLive: "JavaScript 已就绪，可在本地执行",
      },
    },
    {
      state: { kind: "running", requestId: "request-1" } as const,
      expected: {
        statusLabel: "执行中",
        tone: "info",
        icon: "running",
        ariaLive: "JavaScript 正在本地执行",
      },
    },
    {
      state: { kind: "failed", code: "worker-crash", message: "Worker 已退出" } as const,
      expected: {
        statusLabel: "失败",
        tone: "error",
        icon: "error",
        ariaLive: "JavaScript 运行时失败（worker-crash）：Worker 已退出",
      },
    },
    {
      state: { kind: "incompatible", expected: 1, received: 2 } as const,
      expected: {
        statusLabel: "不兼容",
        tone: "error",
        icon: "error",
        ariaLive: "JavaScript 协议不兼容：需要版本 1，收到版本 2",
      },
    },
  ];

  for (const item of cases) {
    const model = toRuntimeRailItem(capability(
      item.state,
      item.runtimeId === undefined ? {} : { runtimeId: item.runtimeId },
    ));
    assert.equal(model.state, item.state.kind);
    assert.equal(model.statusLabel, item.expected.statusLabel);
    assert.equal(model.tone, item.expected.tone);
    assert.equal(model.icon, item.expected.icon);
    assert.equal(model.ariaLive, item.expected.ariaLive);
  }
});

test("runtime options distinguish execute and judge capability without inventing availability", () => {
  const executeOnly = capability(
    { kind: "ready" },
    { execute: true, judge: false },
  );
  assert.deepEqual(toRuntimeOption(executeOnly, "execute"), {
    value: "javascript-worker",
    label: "JavaScript",
    statusLabel: "就绪",
    disabled: false,
  });
  assert.deepEqual(toRuntimeOption(executeOnly, "judge"), {
    value: "javascript-worker",
    label: "JavaScript",
    statusLabel: "不支持判题",
    disabled: true,
    reason: "此运行时不提供本地判题能力",
  });

  const notPackagedRacket = capability(
    { kind: "not-packaged", reason: "缺少 racket/racket.js, racket/racket.wasm" },
    { runtimeId: "racket-wasm", execute: false, judge: false },
  );
  assert.deepEqual(toRuntimeOption(notPackagedRacket, "execute"), {
    value: "racket-wasm",
    label: "Racket",
    statusLabel: "不可用",
    disabled: true,
    reason: "缺少 racket/racket.js, racket/racket.wasm",
  });

  for (const state of [
    { kind: "loadable" } as const,
    { kind: "initializing" } as const,
    { kind: "ready" } as const,
    { kind: "running", requestId: "request-2" } as const,
  ]) {
    assert.equal(toRuntimeOption(capability(state), "execute").disabled, false);
  }
});

test("unverified optional runtimes are disabled while verified optional runtimes retain lazy loading", () => {
  const unverified = capability({ kind: "loadable" }, { runtimeId: "racket-wasm" });
  assert.deepEqual(toRuntimeOption(unverified, "execute"), {
    value: "racket-wasm",
    label: "Racket",
    statusLabel: "待验证",
    disabled: true,
    reason: "可选运行时必须完成验证后才能使用",
  });

  const verified = capability(
    { kind: "loadable" },
    { runtimeId: "racket-wasm", verification: "verified" },
  );
  assert.equal(toRuntimeOption(verified, "execute").disabled, false);
});

test("terminal runtime option reasons include exact registry diagnostics", () => {
  assert.deepEqual(toRuntimeOption(capability({
    kind: "failed",
    code: "asset-load",
    message: "缺少 worker 文件",
  }), "execute"), {
    value: "javascript-worker",
    label: "JavaScript",
    statusLabel: "失败",
    disabled: true,
    reason: "asset-load：缺少 worker 文件",
  });

  assert.deepEqual(toRuntimeOption(capability({
    kind: "incompatible",
    expected: 1,
    received: 3,
  }), "judge"), {
    value: "javascript-worker",
    label: "JavaScript",
    statusLabel: "不兼容",
    disabled: true,
    reason: "协议版本不兼容：需要 1，收到 3",
  });
});

test("memory storage state creates a persistent unsaved banner", () => {
  assert.equal(toStorageBanner({ kind: "persistent" }), null);
  assert.deepEqual(toStorageBanner({ kind: "memory", message: "未保存", reason: "quota" }), {
    label: "未保存",
    reason: "quota",
    persistent: true,
  });
});

test("runtime and storage copy avoids forbidden trust claims", () => {
  const models = [
    toRuntimeOption(capability({ kind: "not-packaged", reason: "运行时文件未打包" }, {
      runtimeId: "racket-wasm",
      execute: false,
      judge: false,
    }), "execute"),
    toRuntimeRailItem(capability({ kind: "ready" })),
    toStorageBanner({ kind: "memory", message: "未保存", reason: "浏览器存储不可用" }),
  ];
  const copy = JSON.stringify(models);
  assert.doesNotMatch(copy, /sandbox|沙箱|hidden tests|隐藏测试/i);
  assert.doesNotMatch(JSON.stringify(models[0]), /就绪|支持/);
});
