import { type RuntimeId } from "../../domain/language.js";
import {
  type ExecutePayload,
  type InitializePayload,
  type JudgeCaseRequest,
  type JudgePayload,
  parseWorkerRequest,
  type WorkerRequest,
  type WorkerResponse,
} from "../../runtime/protocol.js";
import { endpointFailure } from "./runtime-errors.js";

export interface WorkerRuntime {
  initialize(): Promise<InitializePayload>;
  execute(source: string): Promise<ExecutePayload>;
  judge(source: string, cases: readonly JudgeCaseRequest[]): Promise<JudgePayload>;
  dispose(): Promise<void>;
}

export function createWorkerEndpoint(options: {
  runtimeId: RuntimeId;
  runtime: WorkerRuntime;
  post: (message: WorkerResponse) => void;
}): (event: MessageEvent<unknown>) => Promise<void> {
  return async (event: MessageEvent<unknown>): Promise<void> => {
    let request: WorkerRequest;
    try {
      request = parseWorkerRequest(event.data);
    } catch {
      return;
    }

    if (request.runtimeId !== options.runtimeId) {
      options.post({
        ...envelope(request),
        type: "failure",
        error: {
          kind: "protocol",
          code: "runtime-mismatch",
          message: "Worker received a request for another runtime",
          fatal: true,
        },
      });
      return;
    }

    try {
      switch (request.type) {
        case "initialize":
          options.post({ ...envelope(request), type: "status", phase: "initializing", message: "Initializing runtime" });
          options.post({
            ...envelope(request),
            type: "complete",
            operation: "initialize",
            payload: await options.runtime.initialize(),
          });
          return;
        case "execute":
          options.post({ ...envelope(request), type: "status", phase: "executing", message: "Executing runtime" });
          options.post({
            ...envelope(request),
            type: "complete",
            operation: "execute",
            payload: await options.runtime.execute(request.source),
          });
          return;
        case "judge":
          options.post({ ...envelope(request), type: "status", phase: "executing", message: "Executing runtime" });
          options.post({
            ...envelope(request),
            type: "complete",
            operation: "judge",
            payload: await options.runtime.judge(request.source, request.cases),
          });
          return;
        case "dispose":
          await options.runtime.dispose();
          options.post({ ...envelope(request), type: "complete", operation: "dispose", payload: { disposed: true } });
          return;
      }
    } catch (error) {
      options.post({ ...envelope(request), type: "failure", error: endpointFailure(error) });
    }
  };
}

function envelope(request: WorkerRequest) {
  return {
    protocolVersion: request.protocolVersion,
    requestId: request.requestId,
    runtimeId: request.runtimeId,
  } as const;
}
