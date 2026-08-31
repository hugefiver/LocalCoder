"use strict";
(() => {
  var __typeError = (msg) => {
    throw TypeError(msg);
  };
  var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
  var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
  var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
  var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);

  // src/domain/json-value.ts
  var MAX_ISSUES = 8;
  var IDENTIFIER_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
  function addIssue(issues, code, path, message) {
    if (issues.length < MAX_ISSUES) issues.push({ code, path, message });
  }
  function propertyPath(path, key) {
    return IDENTIFIER_KEY.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
  }
  function isPlainObject(value) {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }
  function isArrayIndex(key, length) {
    const index = Number(key);
    return Number.isInteger(index) && index >= 0 && index < length && String(index) === key;
  }
  function enqueueArray(value, path, tasks, ancestors, issues) {
    const ownKeys = Reflect.ownKeys(value);
    const keys = Object.keys(value);
    const hasOnlyIndexes = ownKeys.every((key) => key === "length" || typeof key === "string" && isArrayIndex(key, value.length));
    if (!hasOnlyIndexes || keys.length !== value.length) {
      addIssue(issues, "unsupported-type", path, "JSON arrays must be dense enumerable values");
      return;
    }
    if (keys.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor === void 0 || !("value" in descriptor);
    })) {
      addIssue(issues, "unsupported-type", path, "JSON array entries must be data values");
      return;
    }
    ancestors.add(value);
    tasks.push({ kind: "leave", value });
    for (let index = value.length - 1; index >= 0; index -= 1) {
      tasks.push({ kind: "visit", value: value[index], path: `${path}[${index}]` });
    }
  }
  function enqueueObject(value, path, tasks, ancestors, issues) {
    const ownKeys = Reflect.ownKeys(value);
    const keys = Object.keys(value);
    if (ownKeys.length !== keys.length) {
      addIssue(issues, "unsupported-type", path, "JSON objects require enumerable string properties");
      return;
    }
    if (keys.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor === void 0 || !("value" in descriptor);
    })) {
      addIssue(issues, "unsupported-type", path, "JSON object properties must be data values");
      return;
    }
    ancestors.add(value);
    tasks.push({ kind: "leave", value });
    for (const key of [...keys].reverse()) {
      tasks.push({ kind: "visit", value: value[key], path: propertyPath(path, key) });
    }
  }
  function visitValue(value, path, tasks, ancestors, issues) {
    if (value === null || typeof value === "boolean" || typeof value === "string") return;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) addIssue(issues, "non-finite-number", path, "JSON numbers must be finite");
      return;
    }
    if (typeof value !== "object") {
      addIssue(issues, "unsupported-type", path, `Unsupported JSON value type: ${typeof value}`);
      return;
    }
    if (ancestors.has(value)) {
      addIssue(issues, "cyclic-value", path, "JSON values cannot contain cycles");
      return;
    }
    if (Array.isArray(value)) {
      enqueueArray(value, path, tasks, ancestors, issues);
      return;
    }
    if (!isPlainObject(value)) {
      addIssue(issues, "unsupported-type", path, "JSON objects must use a plain object prototype");
      return;
    }
    enqueueObject(value, path, tasks, ancestors, issues);
  }
  function validateTree(value) {
    const ancestors = /* @__PURE__ */ new WeakSet();
    const issues = [];
    const tasks = [{ kind: "visit", value, path: "$" }];
    while (tasks.length > 0 && issues.length < MAX_ISSUES) {
      const task = tasks.pop();
      if (task === void 0) break;
      if (task.kind === "leave") ancestors.delete(task.value);
      else visitValue(task.value, task.path, tasks, ancestors, issues);
    }
    return issues;
  }
  function jsonByteLength(value) {
    const chunks = [];
    const tasks = [{ kind: "value", value }];
    while (tasks.length > 0) {
      const task = tasks.pop();
      if (task === void 0) break;
      if (task.kind === "text") {
        chunks.push(task.value);
      } else if (task.value === null) {
        chunks.push("null");
      } else if (typeof task.value === "string") {
        chunks.push(JSON.stringify(task.value));
      } else if (typeof task.value === "number" || typeof task.value === "boolean") {
        chunks.push(String(task.value));
      } else if (Array.isArray(task.value)) {
        tasks.push({ kind: "text", value: "]" });
        for (let index = task.value.length - 1; index >= 0; index -= 1) {
          tasks.push({ kind: "value", value: task.value[index] });
          if (index > 0) tasks.push({ kind: "text", value: "," });
        }
        tasks.push({ kind: "text", value: "[" });
      } else {
        const keys = Object.keys(task.value);
        tasks.push({ kind: "text", value: "}" });
        for (const key of [...keys].reverse()) {
          tasks.push({ kind: "value", value: task.value[key] });
          tasks.push({ kind: "text", value: ":" });
          tasks.push({ kind: "text", value: JSON.stringify(key) });
          if (key !== keys[0]) tasks.push({ kind: "text", value: "," });
        }
        tasks.push({ kind: "text", value: "{" });
      }
    }
    return new TextEncoder().encode(chunks.join("")).byteLength;
  }
  function validateJsonValue(value, limits) {
    const issues = validateTree(value);
    if (issues.length > 0) return { ok: false, issues };
    const canonical = value;
    const bytes = jsonByteLength(canonical);
    if (limits?.maxBytes !== void 0 && bytes > limits.maxBytes) {
      return {
        ok: false,
        issues: [{
          code: "byte-limit",
          path: "$",
          message: `JSON value is ${bytes} UTF-8 bytes, exceeding limit of ${limits.maxBytes} bytes`
        }]
      };
    }
    return { ok: true, value: canonical, bytes };
  }
  function assertJsonValue(value, label, limits) {
    const validation = validateJsonValue(value, limits);
    if (validation.ok) return validation.value;
    const diagnostic = validation.issues.map((issue) => `${issue.path} [${issue.code}] ${issue.message}`).join("; ");
    throw new TypeError(`${label}: invalid canonical JSON value: ${diagnostic}`);
  }

  // src/domain/language.ts
  var RUNTIME_IDS = [
    "javascript-worker",
    "typescript-official",
    "python-pyodide",
    "python-rustpython",
    "racket-wasm",
    "haskell-ghc-wasi"
  ];

  // src/runtime/protocol.ts
  var MAX_SOURCE_BYTES = 262144;
  var MAX_CASE_COUNT = 100;
  var MAX_OUTPUT_BYTES = 65536;
  var textEncoder = new TextEncoder();
  var MAX_REQUEST_ID_BYTES = 256;
  var MAX_CASE_VALUE_BYTES = 65536;
  function protocolError(path, message) {
    throw new TypeError(`Worker protocol at ${path}: ${message}`);
  }
  function isPlainRecord(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }
  function hasOwn(record, key) {
    return Object.prototype.hasOwnProperty.call(record, key);
  }
  function propertyValue(record, key, path) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (descriptor === void 0) protocolError(path, "is missing a required field");
    if (!("value" in descriptor)) protocolError(path, "must be a data property");
    return descriptor.value;
  }
  function assertExactFields(record, allowed, required, path) {
    const allowedFields = new Set(allowed);
    const ownKeys = Reflect.ownKeys(record);
    if (ownKeys.some((key) => typeof key !== "string" || !allowedFields.has(key))) {
      protocolError(path, "contains an unknown field");
    }
    for (const key of required) {
      if (!hasOwn(record, key)) protocolError(`${path}.${key}`, "is missing a required field");
    }
    for (const key of ownKeys) {
      if (typeof key !== "string") continue;
      propertyValue(record, key, `${path}.${key}`);
    }
  }
  function assertString(value, path, maxBytes, nonBlank = false) {
    if (typeof value !== "string") protocolError(path, "must be a string");
    const byteLength = textEncoder.encode(value).byteLength;
    if (byteLength > maxBytes) protocolError(path, `must not exceed ${maxBytes} UTF-8 bytes`);
    if (nonBlank && value.trim().length === 0) protocolError(path, "must be non-blank");
    return value;
  }
  function assertNonNegativeInteger(value, path, maximum) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum) {
      protocolError(path, `must be a non-negative integer no greater than ${maximum}`);
    }
    return value;
  }
  function parseEnvelope(record, path) {
    const protocolVersion = propertyValue(record, "protocolVersion", `${path}.protocolVersion`);
    if (protocolVersion !== 1) {
      if (typeof protocolVersion === "number" && Number.isSafeInteger(protocolVersion)) {
        protocolError(`${path}.protocolVersion`, `unsupported protocolVersion ${protocolVersion}`);
      }
      protocolError(`${path}.protocolVersion`, "unsupported protocolVersion");
    }
    const requestId = assertString(
      propertyValue(record, "requestId", `${path}.requestId`),
      `${path}.requestId`,
      MAX_REQUEST_ID_BYTES,
      true
    );
    const runtimeIdValue = propertyValue(record, "runtimeId", `${path}.runtimeId`);
    if (typeof runtimeIdValue !== "string" || !RUNTIME_IDS.includes(runtimeIdValue)) {
      protocolError(`${path}.runtimeId`, "must be a known runtimeId");
    }
    return { protocolVersion: 1, requestId, runtimeId: runtimeIdValue };
  }
  function parseJsonValue(value, path) {
    const validation = validateJsonValue(value, { maxBytes: MAX_CASE_VALUE_BYTES });
    if (!validation.ok) protocolError(path, "must be a canonical JSON value within 65536 UTF-8 bytes");
    return validation.value;
  }
  function parseJudgeCaseRequest(value, path) {
    if (!isPlainRecord(value)) protocolError(path, "must be an object");
    assertExactFields(value, ["index", "input"], ["index", "input"], path);
    return {
      index: assertNonNegativeInteger(propertyValue(value, "index", `${path}.index`), `${path}.index`, Number.MAX_SAFE_INTEGER),
      input: parseJsonValue(propertyValue(value, "input", `${path}.input`), `${path}.input`)
    };
  }
  function parseJudgeCases(value, path) {
    if (!Array.isArray(value) || value.length > MAX_CASE_COUNT) {
      protocolError(path, `must be an array with at most ${MAX_CASE_COUNT} cases`);
    }
    const indexes = /* @__PURE__ */ new Set();
    const cases = value.map((item, index) => {
      const parsed = parseJudgeCaseRequest(item, `${path}[${index}]`);
      if (indexes.has(parsed.index)) protocolError(`${path}[${index}].index`, "must be unique");
      indexes.add(parsed.index);
      return parsed;
    });
    return cases;
  }
  function parseWorkerRequest(input) {
    if (!isPlainRecord(input)) protocolError("$", "must be an object");
    const type = propertyValue(input, "type", "$.type");
    if (type === "initialize") {
      assertExactFields(input, ["protocolVersion", "requestId", "runtimeId", "type"], ["protocolVersion", "requestId", "runtimeId", "type"], "$");
      return { ...parseEnvelope(input, "$"), type };
    }
    if (type === "execute") {
      assertExactFields(input, ["protocolVersion", "requestId", "runtimeId", "type", "source"], ["protocolVersion", "requestId", "runtimeId", "type", "source"], "$");
      return {
        ...parseEnvelope(input, "$"),
        type,
        source: assertString(propertyValue(input, "source", "$.source"), "$.source", MAX_SOURCE_BYTES)
      };
    }
    if (type === "judge") {
      assertExactFields(input, ["protocolVersion", "requestId", "runtimeId", "type", "source", "cases"], ["protocolVersion", "requestId", "runtimeId", "type", "source", "cases"], "$");
      return {
        ...parseEnvelope(input, "$"),
        type,
        source: assertString(propertyValue(input, "source", "$.source"), "$.source", MAX_SOURCE_BYTES),
        cases: parseJudgeCases(propertyValue(input, "cases", "$.cases"), "$.cases")
      };
    }
    if (type === "dispose") {
      assertExactFields(input, ["protocolVersion", "requestId", "runtimeId", "type"], ["protocolVersion", "requestId", "runtimeId", "type"], "$");
      return { ...parseEnvelope(input, "$"), type };
    }
    protocolError("$.type", "unknown request type");
  }

  // src/workers/shared/output-buffer.ts
  var encoder = new TextEncoder();
  var _remaining;
  var OutputBudget = class {
    constructor(limitBytes = MAX_OUTPUT_BYTES) {
      __privateAdd(this, _remaining);
      if (!Number.isSafeInteger(limitBytes) || limitBytes < 0) {
        throw new RangeError("Output limit must be a non-negative safe integer");
      }
      __privateSet(this, _remaining, limitBytes);
    }
    append(text) {
      let bytes = 0;
      let retained = "";
      for (const codePoint of text) {
        const codePointBytes = encoder.encode(codePoint).byteLength;
        if (bytes + codePointBytes > __privateGet(this, _remaining)) {
          __privateSet(this, _remaining, __privateGet(this, _remaining) - bytes);
          return { text: retained, truncated: true };
        }
        retained += codePoint;
        bytes += codePointBytes;
      }
      __privateSet(this, _remaining, __privateGet(this, _remaining) - bytes);
      return { text: retained, truncated: false };
    }
  };
  _remaining = new WeakMap();
  var _budget, _stdout, _stderr, _stdoutTruncated, _stderrTruncated;
  var OutputBuffer = class {
    constructor(budget = MAX_OUTPUT_BYTES) {
      __privateAdd(this, _budget);
      __privateAdd(this, _stdout, "");
      __privateAdd(this, _stderr, "");
      __privateAdd(this, _stdoutTruncated, false);
      __privateAdd(this, _stderrTruncated, false);
      __privateSet(this, _budget, typeof budget === "number" ? new OutputBudget(budget) : budget);
    }
    append(stream, text) {
      const result = __privateGet(this, _budget).append(text);
      if (stream === "stdout") {
        __privateSet(this, _stdout, __privateGet(this, _stdout) + result.text);
        __privateGet(this, _stdoutTruncated) || __privateSet(this, _stdoutTruncated, result.truncated);
        return;
      }
      __privateSet(this, _stderr, __privateGet(this, _stderr) + result.text);
      __privateGet(this, _stderrTruncated) || __privateSet(this, _stderrTruncated, result.truncated);
    }
    stdout() {
      return bounded(__privateGet(this, _stdout), __privateGet(this, _stdoutTruncated));
    }
    stderr() {
      return bounded(__privateGet(this, _stderr), __privateGet(this, _stderrTruncated));
    }
  };
  _budget = new WeakMap();
  _stdout = new WeakMap();
  _stderr = new WeakMap();
  _stdoutTruncated = new WeakMap();
  _stderrTruncated = new WeakMap();
  function bounded(text, truncated) {
    return { text, bytes: encoder.encode(text).byteLength, truncated };
  }

  // src/workers/shared/runtime-errors.ts
  var encoder2 = new TextEncoder();
  var MAX_DETAILS_BYTES = 8192;
  var RuntimeFailureError = class extends Error {
    constructor(failure2) {
      super(failure2.message);
      this.failure = failure2;
      this.name = "RuntimeFailureError";
    }
  };
  function compileFailure(code, message, details) {
    return failure("compile", code, message, false, details);
  }
  function runtimeFailure(code, message, details) {
    return failure("runtime", code, message, false, details);
  }
  function endpointFailure(error) {
    if (error instanceof RuntimeFailureError) return error.failure;
    return failure("infrastructure", "runtime-endpoint-failure", "Runtime endpoint operation failed", true, errorDetails(error));
  }
  function failure(kind, code, message, fatal, details) {
    return {
      kind,
      code,
      message,
      fatal,
      ...details === void 0 || details.length === 0 ? {} : { details: truncateUtf8(details, MAX_DETAILS_BYTES) }
    };
  }
  function errorDetails(error) {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return void 0;
  }
  function truncateUtf8(text, limit) {
    let bytes = 0;
    let result = "";
    for (const codePoint of text) {
      const codePointBytes = encoder2.encode(codePoint).byteLength;
      if (bytes + codePointBytes > limit) break;
      result += codePoint;
      bytes += codePointBytes;
    }
    return result;
  }

  // src/workers/rustpython/payload.ts
  function makeRustPythonPayload(payload) {
    if (typeof payload.source !== "string") throw new TypeError("RustPython source must be a string");
    if (payload.mode !== "execute" && payload.mode !== "judge") throw new TypeError("RustPython mode must be execute or judge");
    const input = payload.input === void 0 ? void 0 : assertJsonValue(payload.input, "RustPython input");
    return JSON.stringify({
      mode: payload.mode,
      source: payload.source,
      ...input === void 0 ? {} : { input }
    });
  }

  // src/workers/rustpython/host.ts
  var RUSTPYTHON_VERSION = "rustpython-wasi";
  function createRustPythonHost(options) {
    const outputBytes = options.outputBytes ?? MAX_OUTPUT_BYTES;
    const buildId = options.buildId ?? injectedBuildId();
    let wasm;
    const getWasm = () => {
      if (wasm === void 0) wasm = loadWasm(options.fetchBytes);
      return wasm;
    };
    const invoke = async (mode, source, input) => {
      const execution = await options.runWasi({
        wasm: await getWasm(),
        stdin: makeRustPythonPayload({ mode, source, ...input === void 0 ? {} : { input } }),
        args: [],
        env: {},
        outputBytes
      });
      if (execution.exitCode !== 0) {
        throw new RuntimeFailureError(runtimeFailure(
          "rustpython-nonzero-exit",
          "RustPython runner exited unsuccessfully",
          execution.stderr
        ));
      }
      if (execution.truncated) throw bridgeError("RustPython runner output exceeded the allowed size");
      return { bridge: parseBridgeResult(execution.stdout), wasiStderr: execution.stderr };
    };
    return {
      initialize: async () => {
        await getWasm();
        return { runtimeVersion: RUSTPYTHON_VERSION, buildId, capabilities: { execute: true, judge: true } };
      },
      execute: async (source) => {
        const result = await invoke("execute", source);
        const output = outputFor(result, outputBytes);
        if (!result.bridge.ok) throw bridgeFailure(result.bridge);
        return { stdout: output.stdout(), stderr: output.stderr(), value: null };
      },
      judge: async (source, cases) => {
        const budget = new OutputBudget(outputBytes);
        const results = [];
        for (const testCase of cases) results.push(await judgeCase(invoke, source, testCase, budget));
        return { cases: results };
      },
      dispose: async () => {
        wasm = void 0;
      }
    };
  }
  async function judgeCase(invoke, source, testCase, budget) {
    const output = new OutputBuffer(budget);
    try {
      const result = await invoke("judge", source, testCase.input);
      appendOutput(output, result);
      if (!result.bridge.ok) throw bridgeFailure(result.bridge);
      return { index: testCase.index, ok: true, actual: result.bridge.value, stdout: output.stdout(), stderr: output.stderr() };
    } catch (error) {
      return { index: testCase.index, ok: false, failure: operationFailure(error).failure, stdout: output.stdout(), stderr: output.stderr() };
    }
  }
  function outputFor(result, outputBytes) {
    const output = new OutputBuffer(outputBytes);
    appendOutput(output, result);
    return output;
  }
  function appendOutput(output, result) {
    output.append("stdout", result.bridge.stdout);
    output.append("stderr", result.bridge.stderr);
    output.append("stderr", result.wasiStderr);
  }
  async function loadWasm(fetchBytes) {
    try {
      const gzip = await fetchBytes("rustpython/runner.wasm.gz.bin");
      return await decompressGzip(gzip);
    } catch {
      try {
        return await fetchBytes("rustpython/runner.wasm");
      } catch {
        throw infrastructureError("rustpython-asset-missing", "Local RustPython WASI asset could not be loaded");
      }
    }
  }
  async function decompressGzip(bytes) {
    if (typeof DecompressionStream !== "function") throw new Error("DecompressionStream is unavailable");
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).arrayBuffer();
  }
  function parseBridgeResult(value) {
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw bridgeError("RustPython runner returned invalid JSON");
    }
    if (!isPlainRecord2(parsed) || typeof parsed.ok !== "boolean") throw bridgeError("RustPython runner returned an invalid result envelope");
    if (parsed.ok) {
      if (!hasExactKeys(parsed, ["ok", "value", "stdout", "stderr"]) || !hasTextStreams(parsed)) {
        throw bridgeError("RustPython runner returned an invalid success envelope");
      }
      try {
        return { ok: true, value: assertJsonValue(parsed.value, "RustPython result"), stdout: parsed.stdout, stderr: parsed.stderr };
      } catch (error) {
        throw bridgeError(errorMessage(error) ?? "RustPython result is not canonical JSON");
      }
    }
    if (!hasExactKeys(parsed, ["ok", "kind", "details", "stdout", "stderr"]) || !hasTextStreams(parsed) || parsed.kind !== "python-compile-error" && parsed.kind !== "python-runtime-error" && parsed.kind !== "json-bridge-error" || typeof parsed.details !== "string") {
      throw bridgeError("RustPython runner returned an invalid failure envelope");
    }
    return { ok: false, kind: parsed.kind, details: parsed.details, stdout: parsed.stdout, stderr: parsed.stderr };
  }
  function bridgeFailure(result) {
    if (result.kind === "python-compile-error") {
      return new RuntimeFailureError(compileFailure(result.kind, "Python source could not be compiled", result.details));
    }
    const message = result.kind === "json-bridge-error" ? "Python result is not JSON serializable" : "Python execution failed";
    return new RuntimeFailureError(runtimeFailure(result.kind, message, result.details));
  }
  function operationFailure(error) {
    if (error instanceof RuntimeFailureError) return error;
    return new RuntimeFailureError(runtimeFailure("python-runtime-error", "Python execution failed", errorMessage(error)));
  }
  function bridgeError(details) {
    return new RuntimeFailureError(runtimeFailure("json-bridge-error", "Python bridge could not produce canonical JSON", details));
  }
  function infrastructureError(code, message) {
    return new RuntimeFailureError({ kind: "infrastructure", code, message, fatal: true });
  }
  function isPlainRecord2(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }
  function hasExactKeys(record, keys) {
    const actual = Object.keys(record);
    return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(record, key));
  }
  function hasTextStreams(record) {
    return typeof record.stdout === "string" && typeof record.stderr === "string";
  }
  function errorMessage(error) {
    return error instanceof Error ? error.message : typeof error === "string" ? error : void 0;
  }
  function injectedBuildId() {
    return true ? "d257db92774c4cfc" : "development";
  }

  // src/workers/shared/endpoint.ts
  function createWorkerEndpoint(options) {
    return async (event) => {
      let request;
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
            fatal: true
          }
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
              payload: await options.runtime.initialize()
            });
            return;
          case "execute":
            options.post({ ...envelope(request), type: "status", phase: "executing", message: "Executing runtime" });
            options.post({
              ...envelope(request),
              type: "complete",
              operation: "execute",
              payload: await options.runtime.execute(request.source)
            });
            return;
          case "judge":
            options.post({ ...envelope(request), type: "status", phase: "executing", message: "Executing runtime" });
            options.post({
              ...envelope(request),
              type: "complete",
              operation: "judge",
              payload: await options.runtime.judge(request.source, request.cases)
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
  function envelope(request) {
    return {
      protocolVersion: request.protocolVersion,
      requestId: request.requestId,
      runtimeId: request.runtimeId
    };
  }

  // node_modules/.pnpm/@bjorn3+browser_wasi_shim@0.4.2/node_modules/@bjorn3/browser_wasi_shim/dist/wasi_defs.js
  var CLOCKID_REALTIME = 0;
  var CLOCKID_MONOTONIC = 1;
  var ERRNO_SUCCESS = 0;
  var ERRNO_BADF = 8;
  var ERRNO_EXIST = 20;
  var ERRNO_INVAL = 28;
  var ERRNO_ISDIR = 31;
  var ERRNO_NAMETOOLONG = 37;
  var ERRNO_NOENT = 44;
  var ERRNO_NOSYS = 52;
  var ERRNO_NOTDIR = 54;
  var ERRNO_NOTEMPTY = 55;
  var ERRNO_NOTSUP = 58;
  var ERRNO_PERM = 63;
  var ERRNO_NOTCAPABLE = 76;
  var RIGHTS_FD_DATASYNC = 1 << 0;
  var RIGHTS_FD_READ = 1 << 1;
  var RIGHTS_FD_SEEK = 1 << 2;
  var RIGHTS_FD_FDSTAT_SET_FLAGS = 1 << 3;
  var RIGHTS_FD_SYNC = 1 << 4;
  var RIGHTS_FD_TELL = 1 << 5;
  var RIGHTS_FD_WRITE = 1 << 6;
  var RIGHTS_FD_ADVISE = 1 << 7;
  var RIGHTS_FD_ALLOCATE = 1 << 8;
  var RIGHTS_PATH_CREATE_DIRECTORY = 1 << 9;
  var RIGHTS_PATH_CREATE_FILE = 1 << 10;
  var RIGHTS_PATH_LINK_SOURCE = 1 << 11;
  var RIGHTS_PATH_LINK_TARGET = 1 << 12;
  var RIGHTS_PATH_OPEN = 1 << 13;
  var RIGHTS_FD_READDIR = 1 << 14;
  var RIGHTS_PATH_READLINK = 1 << 15;
  var RIGHTS_PATH_RENAME_SOURCE = 1 << 16;
  var RIGHTS_PATH_RENAME_TARGET = 1 << 17;
  var RIGHTS_PATH_FILESTAT_GET = 1 << 18;
  var RIGHTS_PATH_FILESTAT_SET_SIZE = 1 << 19;
  var RIGHTS_PATH_FILESTAT_SET_TIMES = 1 << 20;
  var RIGHTS_FD_FILESTAT_GET = 1 << 21;
  var RIGHTS_FD_FILESTAT_SET_SIZE = 1 << 22;
  var RIGHTS_FD_FILESTAT_SET_TIMES = 1 << 23;
  var RIGHTS_PATH_SYMLINK = 1 << 24;
  var RIGHTS_PATH_REMOVE_DIRECTORY = 1 << 25;
  var RIGHTS_PATH_UNLINK_FILE = 1 << 26;
  var RIGHTS_POLL_FD_READWRITE = 1 << 27;
  var RIGHTS_SOCK_SHUTDOWN = 1 << 28;
  var Iovec = class _Iovec {
    static read_bytes(view, ptr) {
      const iovec = new _Iovec();
      iovec.buf = view.getUint32(ptr, true);
      iovec.buf_len = view.getUint32(ptr + 4, true);
      return iovec;
    }
    static read_bytes_array(view, ptr, len) {
      const iovecs = [];
      for (let i = 0; i < len; i++) {
        iovecs.push(_Iovec.read_bytes(view, ptr + 8 * i));
      }
      return iovecs;
    }
  };
  var Ciovec = class _Ciovec {
    static read_bytes(view, ptr) {
      const iovec = new _Ciovec();
      iovec.buf = view.getUint32(ptr, true);
      iovec.buf_len = view.getUint32(ptr + 4, true);
      return iovec;
    }
    static read_bytes_array(view, ptr, len) {
      const iovecs = [];
      for (let i = 0; i < len; i++) {
        iovecs.push(_Ciovec.read_bytes(view, ptr + 8 * i));
      }
      return iovecs;
    }
  };
  var WHENCE_SET = 0;
  var WHENCE_CUR = 1;
  var WHENCE_END = 2;
  var FILETYPE_CHARACTER_DEVICE = 2;
  var FILETYPE_DIRECTORY = 3;
  var FILETYPE_REGULAR_FILE = 4;
  var Dirent = class {
    head_length() {
      return 24;
    }
    name_length() {
      return this.dir_name.byteLength;
    }
    write_head_bytes(view, ptr) {
      view.setBigUint64(ptr, this.d_next, true);
      view.setBigUint64(ptr + 8, this.d_ino, true);
      view.setUint32(ptr + 16, this.dir_name.length, true);
      view.setUint8(ptr + 20, this.d_type);
    }
    write_name_bytes(view8, ptr, buf_len) {
      view8.set(this.dir_name.slice(0, Math.min(this.dir_name.byteLength, buf_len)), ptr);
    }
    constructor(next_cookie, d_ino, name, type) {
      const encoded_name = new TextEncoder().encode(name);
      this.d_next = next_cookie;
      this.d_ino = d_ino;
      this.d_namlen = encoded_name.byteLength;
      this.d_type = type;
      this.dir_name = encoded_name;
    }
  };
  var FDFLAGS_APPEND = 1 << 0;
  var FDFLAGS_DSYNC = 1 << 1;
  var FDFLAGS_NONBLOCK = 1 << 2;
  var FDFLAGS_RSYNC = 1 << 3;
  var FDFLAGS_SYNC = 1 << 4;
  var Fdstat = class {
    write_bytes(view, ptr) {
      view.setUint8(ptr, this.fs_filetype);
      view.setUint16(ptr + 2, this.fs_flags, true);
      view.setBigUint64(ptr + 8, this.fs_rights_base, true);
      view.setBigUint64(ptr + 16, this.fs_rights_inherited, true);
    }
    constructor(filetype, flags) {
      this.fs_rights_base = 0n;
      this.fs_rights_inherited = 0n;
      this.fs_filetype = filetype;
      this.fs_flags = flags;
    }
  };
  var FSTFLAGS_ATIM = 1 << 0;
  var FSTFLAGS_ATIM_NOW = 1 << 1;
  var FSTFLAGS_MTIM = 1 << 2;
  var FSTFLAGS_MTIM_NOW = 1 << 3;
  var OFLAGS_CREAT = 1 << 0;
  var OFLAGS_DIRECTORY = 1 << 1;
  var OFLAGS_EXCL = 1 << 2;
  var OFLAGS_TRUNC = 1 << 3;
  var Filestat = class {
    write_bytes(view, ptr) {
      view.setBigUint64(ptr, this.dev, true);
      view.setBigUint64(ptr + 8, this.ino, true);
      view.setUint8(ptr + 16, this.filetype);
      view.setBigUint64(ptr + 24, this.nlink, true);
      view.setBigUint64(ptr + 32, this.size, true);
      view.setBigUint64(ptr + 38, this.atim, true);
      view.setBigUint64(ptr + 46, this.mtim, true);
      view.setBigUint64(ptr + 52, this.ctim, true);
    }
    constructor(ino, filetype, size) {
      this.dev = 0n;
      this.nlink = 0n;
      this.atim = 0n;
      this.mtim = 0n;
      this.ctim = 0n;
      this.ino = ino;
      this.filetype = filetype;
      this.size = size;
    }
  };
  var EVENTTYPE_CLOCK = 0;
  var EVENTRWFLAGS_FD_READWRITE_HANGUP = 1 << 0;
  var SUBCLOCKFLAGS_SUBSCRIPTION_CLOCK_ABSTIME = 1 << 0;
  var Subscription = class _Subscription {
    static read_bytes(view, ptr) {
      return new _Subscription(view.getBigUint64(ptr, true), view.getUint8(ptr + 8), view.getUint32(ptr + 16, true), view.getBigUint64(ptr + 24, true), view.getUint16(ptr + 36, true));
    }
    constructor(userdata, eventtype, clockid, timeout, flags) {
      this.userdata = userdata;
      this.eventtype = eventtype;
      this.clockid = clockid;
      this.timeout = timeout;
      this.flags = flags;
    }
  };
  var Event = class {
    write_bytes(view, ptr) {
      view.setBigUint64(ptr, this.userdata, true);
      view.setUint16(ptr + 8, this.error, true);
      view.setUint8(ptr + 10, this.eventtype);
    }
    constructor(userdata, error, eventtype) {
      this.userdata = userdata;
      this.error = error;
      this.eventtype = eventtype;
    }
  };
  var RIFLAGS_RECV_PEEK = 1 << 0;
  var RIFLAGS_RECV_WAITALL = 1 << 1;
  var ROFLAGS_RECV_DATA_TRUNCATED = 1 << 0;
  var SDFLAGS_RD = 1 << 0;
  var SDFLAGS_WR = 1 << 1;
  var PREOPENTYPE_DIR = 0;
  var PrestatDir = class {
    write_bytes(view, ptr) {
      view.setUint32(ptr, this.pr_name.byteLength, true);
    }
    constructor(name) {
      this.pr_name = new TextEncoder().encode(name);
    }
  };
  var Prestat = class _Prestat {
    static dir(name) {
      const prestat = new _Prestat();
      prestat.tag = PREOPENTYPE_DIR;
      prestat.inner = new PrestatDir(name);
      return prestat;
    }
    write_bytes(view, ptr) {
      view.setUint32(ptr, this.tag, true);
      this.inner.write_bytes(view, ptr + 4);
    }
  };

  // node_modules/.pnpm/@bjorn3+browser_wasi_shim@0.4.2/node_modules/@bjorn3/browser_wasi_shim/dist/debug.js
  var Debug = class Debug2 {
    enable(enabled) {
      this.log = createLogger(enabled === void 0 ? true : enabled, this.prefix);
    }
    get enabled() {
      return this.isEnabled;
    }
    constructor(isEnabled) {
      this.isEnabled = isEnabled;
      this.prefix = "wasi:";
      this.enable(isEnabled);
    }
  };
  function createLogger(enabled, prefix) {
    if (enabled) {
      const a = console.log.bind(console, "%c%s", "color: #265BA0", prefix);
      return a;
    } else {
      return () => {
      };
    }
  }
  var debug = new Debug(false);

  // node_modules/.pnpm/@bjorn3+browser_wasi_shim@0.4.2/node_modules/@bjorn3/browser_wasi_shim/dist/wasi.js
  var WASIProcExit = class extends Error {
    constructor(code) {
      super("exit with exit code " + code);
      this.code = code;
    }
  };
  var WASI = class WASI2 {
    start(instance) {
      this.inst = instance;
      try {
        instance.exports._start();
        return 0;
      } catch (e) {
        if (e instanceof WASIProcExit) {
          return e.code;
        } else {
          throw e;
        }
      }
    }
    initialize(instance) {
      this.inst = instance;
      if (instance.exports._initialize) {
        instance.exports._initialize();
      }
    }
    constructor(args, env, fds, options = {}) {
      this.args = [];
      this.env = [];
      this.fds = [];
      debug.enable(options.debug);
      this.args = args;
      this.env = env;
      this.fds = fds;
      const self = this;
      this.wasiImport = { args_sizes_get(argc, argv_buf_size) {
        const buffer = new DataView(self.inst.exports.memory.buffer);
        buffer.setUint32(argc, self.args.length, true);
        let buf_size = 0;
        for (const arg of self.args) {
          buf_size += arg.length + 1;
        }
        buffer.setUint32(argv_buf_size, buf_size, true);
        debug.log(buffer.getUint32(argc, true), buffer.getUint32(argv_buf_size, true));
        return 0;
      }, args_get(argv, argv_buf) {
        const buffer = new DataView(self.inst.exports.memory.buffer);
        const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
        const orig_argv_buf = argv_buf;
        for (let i = 0; i < self.args.length; i++) {
          buffer.setUint32(argv, argv_buf, true);
          argv += 4;
          const arg = new TextEncoder().encode(self.args[i]);
          buffer8.set(arg, argv_buf);
          buffer.setUint8(argv_buf + arg.length, 0);
          argv_buf += arg.length + 1;
        }
        if (debug.enabled) {
          debug.log(new TextDecoder("utf-8").decode(buffer8.slice(orig_argv_buf, argv_buf)));
        }
        return 0;
      }, environ_sizes_get(environ_count, environ_size) {
        const buffer = new DataView(self.inst.exports.memory.buffer);
        buffer.setUint32(environ_count, self.env.length, true);
        let buf_size = 0;
        for (const environ of self.env) {
          buf_size += new TextEncoder().encode(environ).length + 1;
        }
        buffer.setUint32(environ_size, buf_size, true);
        debug.log(buffer.getUint32(environ_count, true), buffer.getUint32(environ_size, true));
        return 0;
      }, environ_get(environ, environ_buf) {
        const buffer = new DataView(self.inst.exports.memory.buffer);
        const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
        const orig_environ_buf = environ_buf;
        for (let i = 0; i < self.env.length; i++) {
          buffer.setUint32(environ, environ_buf, true);
          environ += 4;
          const e = new TextEncoder().encode(self.env[i]);
          buffer8.set(e, environ_buf);
          buffer.setUint8(environ_buf + e.length, 0);
          environ_buf += e.length + 1;
        }
        if (debug.enabled) {
          debug.log(new TextDecoder("utf-8").decode(buffer8.slice(orig_environ_buf, environ_buf)));
        }
        return 0;
      }, clock_res_get(id, res_ptr) {
        let resolutionValue;
        switch (id) {
          case CLOCKID_MONOTONIC: {
            resolutionValue = 5000n;
            break;
          }
          case CLOCKID_REALTIME: {
            resolutionValue = 1000000n;
            break;
          }
          default:
            return ERRNO_NOSYS;
        }
        const view = new DataView(self.inst.exports.memory.buffer);
        view.setBigUint64(res_ptr, resolutionValue, true);
        return ERRNO_SUCCESS;
      }, clock_time_get(id, precision, time) {
        const buffer = new DataView(self.inst.exports.memory.buffer);
        if (id === CLOCKID_REALTIME) {
          buffer.setBigUint64(time, BigInt((/* @__PURE__ */ new Date()).getTime()) * 1000000n, true);
        } else if (id == CLOCKID_MONOTONIC) {
          let monotonic_time;
          try {
            monotonic_time = BigInt(Math.round(performance.now() * 1e6));
          } catch (e) {
            monotonic_time = 0n;
          }
          buffer.setBigUint64(time, monotonic_time, true);
        } else {
          buffer.setBigUint64(time, 0n, true);
        }
        return 0;
      }, fd_advise(fd, offset, len, advice) {
        if (self.fds[fd] != void 0) {
          return ERRNO_SUCCESS;
        } else {
          return ERRNO_BADF;
        }
      }, fd_allocate(fd, offset, len) {
        if (self.fds[fd] != void 0) {
          return self.fds[fd].fd_allocate(offset, len);
        } else {
          return ERRNO_BADF;
        }
      }, fd_close(fd) {
        if (self.fds[fd] != void 0) {
          const ret = self.fds[fd].fd_close();
          self.fds[fd] = void 0;
          return ret;
        } else {
          return ERRNO_BADF;
        }
      }, fd_datasync(fd) {
        if (self.fds[fd] != void 0) {
          return self.fds[fd].fd_sync();
        } else {
          return ERRNO_BADF;
        }
      }, fd_fdstat_get(fd, fdstat_ptr) {
        if (self.fds[fd] != void 0) {
          const { ret, fdstat } = self.fds[fd].fd_fdstat_get();
          if (fdstat != null) {
            fdstat.write_bytes(new DataView(self.inst.exports.memory.buffer), fdstat_ptr);
          }
          return ret;
        } else {
          return ERRNO_BADF;
        }
      }, fd_fdstat_set_flags(fd, flags) {
        if (self.fds[fd] != void 0) {
          return self.fds[fd].fd_fdstat_set_flags(flags);
        } else {
          return ERRNO_BADF;
        }
      }, fd_fdstat_set_rights(fd, fs_rights_base, fs_rights_inheriting) {
        if (self.fds[fd] != void 0) {
          return self.fds[fd].fd_fdstat_set_rights(fs_rights_base, fs_rights_inheriting);
        } else {
          return ERRNO_BADF;
        }
      }, fd_filestat_get(fd, filestat_ptr) {
        if (self.fds[fd] != void 0) {
          const { ret, filestat } = self.fds[fd].fd_filestat_get();
          if (filestat != null) {
            filestat.write_bytes(new DataView(self.inst.exports.memory.buffer), filestat_ptr);
          }
          return ret;
        } else {
          return ERRNO_BADF;
        }
      }, fd_filestat_set_size(fd, size) {
        if (self.fds[fd] != void 0) {
          return self.fds[fd].fd_filestat_set_size(size);
        } else {
          return ERRNO_BADF;
        }
      }, fd_filestat_set_times(fd, atim, mtim, fst_flags) {
        if (self.fds[fd] != void 0) {
          return self.fds[fd].fd_filestat_set_times(atim, mtim, fst_flags);
        } else {
          return ERRNO_BADF;
        }
      }, fd_pread(fd, iovs_ptr, iovs_len, offset, nread_ptr) {
        const buffer = new DataView(self.inst.exports.memory.buffer);
        const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
        if (self.fds[fd] != void 0) {
          const iovecs = Iovec.read_bytes_array(buffer, iovs_ptr, iovs_len);
          let nread = 0;
          for (const iovec of iovecs) {
            const { ret, data } = self.fds[fd].fd_pread(iovec.buf_len, offset);
            if (ret != ERRNO_SUCCESS) {
              buffer.setUint32(nread_ptr, nread, true);
              return ret;
            }
            buffer8.set(data, iovec.buf);
            nread += data.length;
            offset += BigInt(data.length);
            if (data.length != iovec.buf_len) {
              break;
            }
          }
          buffer.setUint32(nread_ptr, nread, true);
          return ERRNO_SUCCESS;
        } else {
          return ERRNO_BADF;
        }
      }, fd_prestat_get(fd, buf_ptr) {
        const buffer = new DataView(self.inst.exports.memory.buffer);
        if (self.fds[fd] != void 0) {
          const { ret, prestat } = self.fds[fd].fd_prestat_get();
          if (prestat != null) {
            prestat.write_bytes(buffer, buf_ptr);
          }
          return ret;
        } else {
          return ERRNO_BADF;
        }
      }, fd_prestat_dir_name(fd, path_ptr, path_len) {
        if (self.fds[fd] != void 0) {
          const { ret, prestat } = self.fds[fd].fd_prestat_get();
          if (prestat == null) {
            return ret;
          }
          const prestat_dir_name = prestat.inner.pr_name;
          const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
          buffer8.set(prestat_dir_name.slice(0, path_len), path_ptr);
          return prestat_dir_name.byteLength > path_len ? ERRNO_NAMETOOLONG : ERRNO_SUCCESS;
        } else {
          return ERRNO_BADF;
        }
      }, fd_pwrite(fd, iovs_ptr, iovs_len, offset, nwritten_ptr) {
        const buffer = new DataView(self.inst.exports.memory.buffer);
        const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
        if (self.fds[fd] != void 0) {
          const iovecs = Ciovec.read_bytes_array(buffer, iovs_ptr, iovs_len);
          let nwritten = 0;
          for (const iovec of iovecs) {
            const data = buffer8.slice(iovec.buf, iovec.buf + iovec.buf_len);
            const { ret, nwritten: nwritten_part } = self.fds[fd].fd_pwrite(data, offset);
            if (ret != ERRNO_SUCCESS) {
              buffer.setUint32(nwritten_ptr, nwritten, true);
              return ret;
            }
            nwritten += nwritten_part;
            offset += BigInt(nwritten_part);
            if (nwritten_part != data.byteLength) {
              break;
            }
          }
          buffer.setUint32(nwritten_ptr, nwritten, true);
          return ERRNO_SUCCESS;
        } else {
          return ERRNO_BADF;
        }
      }, fd_read(fd, iovs_ptr, iovs_len, nread_ptr) {
        const buffer = new DataView(self.inst.exports.memory.buffer);
        const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
        if (self.fds[fd] != void 0) {
          const iovecs = Iovec.read_bytes_array(buffer, iovs_ptr, iovs_len);
          let nread = 0;
          for (const iovec of iovecs) {
            const { ret, data } = self.fds[fd].fd_read(iovec.buf_len);
            if (ret != ERRNO_SUCCESS) {
              buffer.setUint32(nread_ptr, nread, true);
              return ret;
            }
            buffer8.set(data, iovec.buf);
            nread += data.length;
            if (data.length != iovec.buf_len) {
              break;
            }
          }
          buffer.setUint32(nread_ptr, nread, true);
          return ERRNO_SUCCESS;
        } else {
          return ERRNO_BADF;
        }
      }, fd_readdir(fd, buf, buf_len, cookie, bufused_ptr) {
        const buffer = new DataView(self.inst.exports.memory.buffer);
        const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
        if (self.fds[fd] != void 0) {
          let bufused = 0;
          while (true) {
            const { ret, dirent } = self.fds[fd].fd_readdir_single(cookie);
            if (ret != 0) {
              buffer.setUint32(bufused_ptr, bufused, true);
              return ret;
            }
            if (dirent == null) {
              break;
            }
            if (buf_len - bufused < dirent.head_length()) {
              bufused = buf_len;
              break;
            }
            const head_bytes = new ArrayBuffer(dirent.head_length());
            dirent.write_head_bytes(new DataView(head_bytes), 0);
            buffer8.set(new Uint8Array(head_bytes).slice(0, Math.min(head_bytes.byteLength, buf_len - bufused)), buf);
            buf += dirent.head_length();
            bufused += dirent.head_length();
            if (buf_len - bufused < dirent.name_length()) {
              bufused = buf_len;
              break;
            }
            dirent.write_name_bytes(buffer8, buf, buf_len - bufused);
            buf += dirent.name_length();
            bufused += dirent.name_length();
            cookie = dirent.d_next;
          }
          buffer.setUint32(bufused_ptr, bufused, true);
          return 0;
        } else {
          return ERRNO_BADF;
        }
      }, fd_renumber(fd, to) {
        if (self.fds[fd] != void 0 && self.fds[to] != void 0) {
          const ret = self.fds[to].fd_close();
          if (ret != 0) {
            return ret;
          }
          self.fds[to] = self.fds[fd];
          self.fds[fd] = void 0;
          return 0;
        } else {
          return ERRNO_BADF;
        }
      }, fd_seek(fd, offset, whence, offset_out_ptr) {
        const buffer = new DataView(self.inst.exports.memory.buffer);
        if (self.fds[fd] != void 0) {
          const { ret, offset: offset_out } = self.fds[fd].fd_seek(offset, whence);
          buffer.setBigInt64(offset_out_ptr, offset_out, true);
          return ret;
        } else {
          return ERRNO_BADF;
        }
      }, fd_sync(fd) {
        if (self.fds[fd] != void 0) {
          return self.fds[fd].fd_sync();
        } else {
          return ERRNO_BADF;
        }
      }, fd_tell(fd, offset_ptr) {
        const buffer = new DataView(self.inst.exports.memory.buffer);
        if (self.fds[fd] != void 0) {
          const { ret, offset } = self.fds[fd].fd_tell();
          buffer.setBigUint64(offset_ptr, offset, true);
          return ret;
        } else {
          return ERRNO_BADF;
        }
      }, fd_write(fd, iovs_ptr, iovs_len, nwritten_ptr) {
        const buffer = new DataView(self.inst.exports.memory.buffer);
        const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
        if (self.fds[fd] != void 0) {
          const iovecs = Ciovec.read_bytes_array(buffer, iovs_ptr, iovs_len);
          let nwritten = 0;
          for (const iovec of iovecs) {
            const data = buffer8.slice(iovec.buf, iovec.buf + iovec.buf_len);
            const { ret, nwritten: nwritten_part } = self.fds[fd].fd_write(data);
            if (ret != ERRNO_SUCCESS) {
              buffer.setUint32(nwritten_ptr, nwritten, true);
              return ret;
            }
            nwritten += nwritten_part;
            if (nwritten_part != data.byteLength) {
              break;
            }
          }
          buffer.setUint32(nwritten_ptr, nwritten, true);
          return ERRNO_SUCCESS;
        } else {
          return ERRNO_BADF;
        }
      }, path_create_directory(fd, path_ptr, path_len) {
        const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
        if (self.fds[fd] != void 0) {
          const path = new TextDecoder("utf-8").decode(buffer8.slice(path_ptr, path_ptr + path_len));
          return self.fds[fd].path_create_directory(path);
        } else {
          return ERRNO_BADF;
        }
      }, path_filestat_get(fd, flags, path_ptr, path_len, filestat_ptr) {
        const buffer = new DataView(self.inst.exports.memory.buffer);
        const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
        if (self.fds[fd] != void 0) {
          const path = new TextDecoder("utf-8").decode(buffer8.slice(path_ptr, path_ptr + path_len));
          const { ret, filestat } = self.fds[fd].path_filestat_get(flags, path);
          if (filestat != null) {
            filestat.write_bytes(buffer, filestat_ptr);
          }
          return ret;
        } else {
          return ERRNO_BADF;
        }
      }, path_filestat_set_times(fd, flags, path_ptr, path_len, atim, mtim, fst_flags) {
        const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
        if (self.fds[fd] != void 0) {
          const path = new TextDecoder("utf-8").decode(buffer8.slice(path_ptr, path_ptr + path_len));
          return self.fds[fd].path_filestat_set_times(flags, path, atim, mtim, fst_flags);
        } else {
          return ERRNO_BADF;
        }
      }, path_link(old_fd, old_flags, old_path_ptr, old_path_len, new_fd, new_path_ptr, new_path_len) {
        const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
        if (self.fds[old_fd] != void 0 && self.fds[new_fd] != void 0) {
          const old_path = new TextDecoder("utf-8").decode(buffer8.slice(old_path_ptr, old_path_ptr + old_path_len));
          const new_path = new TextDecoder("utf-8").decode(buffer8.slice(new_path_ptr, new_path_ptr + new_path_len));
          const { ret, inode_obj } = self.fds[old_fd].path_lookup(old_path, old_flags);
          if (inode_obj == null) {
            return ret;
          }
          return self.fds[new_fd].path_link(new_path, inode_obj, false);
        } else {
          return ERRNO_BADF;
        }
      }, path_open(fd, dirflags, path_ptr, path_len, oflags, fs_rights_base, fs_rights_inheriting, fd_flags, opened_fd_ptr) {
        const buffer = new DataView(self.inst.exports.memory.buffer);
        const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
        if (self.fds[fd] != void 0) {
          const path = new TextDecoder("utf-8").decode(buffer8.slice(path_ptr, path_ptr + path_len));
          debug.log(path);
          const { ret, fd_obj } = self.fds[fd].path_open(dirflags, path, oflags, fs_rights_base, fs_rights_inheriting, fd_flags);
          if (ret != 0) {
            return ret;
          }
          self.fds.push(fd_obj);
          const opened_fd = self.fds.length - 1;
          buffer.setUint32(opened_fd_ptr, opened_fd, true);
          return 0;
        } else {
          return ERRNO_BADF;
        }
      }, path_readlink(fd, path_ptr, path_len, buf_ptr, buf_len, nread_ptr) {
        const buffer = new DataView(self.inst.exports.memory.buffer);
        const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
        if (self.fds[fd] != void 0) {
          const path = new TextDecoder("utf-8").decode(buffer8.slice(path_ptr, path_ptr + path_len));
          debug.log(path);
          const { ret, data } = self.fds[fd].path_readlink(path);
          if (data != null) {
            const data_buf = new TextEncoder().encode(data);
            if (data_buf.length > buf_len) {
              buffer.setUint32(nread_ptr, 0, true);
              return ERRNO_BADF;
            }
            buffer8.set(data_buf, buf_ptr);
            buffer.setUint32(nread_ptr, data_buf.length, true);
          }
          return ret;
        } else {
          return ERRNO_BADF;
        }
      }, path_remove_directory(fd, path_ptr, path_len) {
        const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
        if (self.fds[fd] != void 0) {
          const path = new TextDecoder("utf-8").decode(buffer8.slice(path_ptr, path_ptr + path_len));
          return self.fds[fd].path_remove_directory(path);
        } else {
          return ERRNO_BADF;
        }
      }, path_rename(fd, old_path_ptr, old_path_len, new_fd, new_path_ptr, new_path_len) {
        const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
        if (self.fds[fd] != void 0 && self.fds[new_fd] != void 0) {
          const old_path = new TextDecoder("utf-8").decode(buffer8.slice(old_path_ptr, old_path_ptr + old_path_len));
          const new_path = new TextDecoder("utf-8").decode(buffer8.slice(new_path_ptr, new_path_ptr + new_path_len));
          let { ret, inode_obj } = self.fds[fd].path_unlink(old_path);
          if (inode_obj == null) {
            return ret;
          }
          ret = self.fds[new_fd].path_link(new_path, inode_obj, true);
          if (ret != ERRNO_SUCCESS) {
            if (self.fds[fd].path_link(old_path, inode_obj, true) != ERRNO_SUCCESS) {
              throw "path_link should always return success when relinking an inode back to the original place";
            }
          }
          return ret;
        } else {
          return ERRNO_BADF;
        }
      }, path_symlink(old_path_ptr, old_path_len, fd, new_path_ptr, new_path_len) {
        const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
        if (self.fds[fd] != void 0) {
          const old_path = new TextDecoder("utf-8").decode(buffer8.slice(old_path_ptr, old_path_ptr + old_path_len));
          const new_path = new TextDecoder("utf-8").decode(buffer8.slice(new_path_ptr, new_path_ptr + new_path_len));
          return ERRNO_NOTSUP;
        } else {
          return ERRNO_BADF;
        }
      }, path_unlink_file(fd, path_ptr, path_len) {
        const buffer8 = new Uint8Array(self.inst.exports.memory.buffer);
        if (self.fds[fd] != void 0) {
          const path = new TextDecoder("utf-8").decode(buffer8.slice(path_ptr, path_ptr + path_len));
          return self.fds[fd].path_unlink_file(path);
        } else {
          return ERRNO_BADF;
        }
      }, poll_oneoff(in_ptr, out_ptr, nsubscriptions) {
        if (nsubscriptions === 0) {
          return ERRNO_INVAL;
        }
        if (nsubscriptions > 1) {
          debug.log("poll_oneoff: only a single subscription is supported");
          return ERRNO_NOTSUP;
        }
        const buffer = new DataView(self.inst.exports.memory.buffer);
        const s = Subscription.read_bytes(buffer, in_ptr);
        const eventtype = s.eventtype;
        const clockid = s.clockid;
        const timeout = s.timeout;
        if (eventtype !== EVENTTYPE_CLOCK) {
          debug.log("poll_oneoff: only clock subscriptions are supported");
          return ERRNO_NOTSUP;
        }
        let getNow = void 0;
        if (clockid === CLOCKID_MONOTONIC) {
          getNow = () => BigInt(Math.round(performance.now() * 1e6));
        } else if (clockid === CLOCKID_REALTIME) {
          getNow = () => BigInt((/* @__PURE__ */ new Date()).getTime()) * 1000000n;
        } else {
          return ERRNO_INVAL;
        }
        const endTime = (s.flags & SUBCLOCKFLAGS_SUBSCRIPTION_CLOCK_ABSTIME) !== 0 ? timeout : getNow() + timeout;
        while (endTime > getNow()) {
        }
        const event = new Event(s.userdata, ERRNO_SUCCESS, eventtype);
        event.write_bytes(buffer, out_ptr);
        return ERRNO_SUCCESS;
      }, proc_exit(exit_code) {
        throw new WASIProcExit(exit_code);
      }, proc_raise(sig) {
        throw "raised signal " + sig;
      }, sched_yield() {
      }, random_get(buf, buf_len) {
        const buffer8 = new Uint8Array(self.inst.exports.memory.buffer).subarray(buf, buf + buf_len);
        if ("crypto" in globalThis && (typeof SharedArrayBuffer === "undefined" || !(self.inst.exports.memory.buffer instanceof SharedArrayBuffer))) {
          for (let i = 0; i < buf_len; i += 65536) {
            crypto.getRandomValues(buffer8.subarray(i, i + 65536));
          }
        } else {
          for (let i = 0; i < buf_len; i++) {
            buffer8[i] = Math.random() * 256 | 0;
          }
        }
      }, sock_recv(fd, ri_data, ri_flags) {
        throw "sockets not supported";
      }, sock_send(fd, si_data, si_flags) {
        throw "sockets not supported";
      }, sock_shutdown(fd, how) {
        throw "sockets not supported";
      }, sock_accept(fd, flags) {
        throw "sockets not supported";
      } };
    }
  };

  // node_modules/.pnpm/@bjorn3+browser_wasi_shim@0.4.2/node_modules/@bjorn3/browser_wasi_shim/dist/fd.js
  var Fd = class {
    fd_allocate(offset, len) {
      return ERRNO_NOTSUP;
    }
    fd_close() {
      return 0;
    }
    fd_fdstat_get() {
      return { ret: ERRNO_NOTSUP, fdstat: null };
    }
    fd_fdstat_set_flags(flags) {
      return ERRNO_NOTSUP;
    }
    fd_fdstat_set_rights(fs_rights_base, fs_rights_inheriting) {
      return ERRNO_NOTSUP;
    }
    fd_filestat_get() {
      return { ret: ERRNO_NOTSUP, filestat: null };
    }
    fd_filestat_set_size(size) {
      return ERRNO_NOTSUP;
    }
    fd_filestat_set_times(atim, mtim, fst_flags) {
      return ERRNO_NOTSUP;
    }
    fd_pread(size, offset) {
      return { ret: ERRNO_NOTSUP, data: new Uint8Array() };
    }
    fd_prestat_get() {
      return { ret: ERRNO_NOTSUP, prestat: null };
    }
    fd_pwrite(data, offset) {
      return { ret: ERRNO_NOTSUP, nwritten: 0 };
    }
    fd_read(size) {
      return { ret: ERRNO_NOTSUP, data: new Uint8Array() };
    }
    fd_readdir_single(cookie) {
      return { ret: ERRNO_NOTSUP, dirent: null };
    }
    fd_seek(offset, whence) {
      return { ret: ERRNO_NOTSUP, offset: 0n };
    }
    fd_sync() {
      return 0;
    }
    fd_tell() {
      return { ret: ERRNO_NOTSUP, offset: 0n };
    }
    fd_write(data) {
      return { ret: ERRNO_NOTSUP, nwritten: 0 };
    }
    path_create_directory(path) {
      return ERRNO_NOTSUP;
    }
    path_filestat_get(flags, path) {
      return { ret: ERRNO_NOTSUP, filestat: null };
    }
    path_filestat_set_times(flags, path, atim, mtim, fst_flags) {
      return ERRNO_NOTSUP;
    }
    path_link(path, inode, allow_dir) {
      return ERRNO_NOTSUP;
    }
    path_unlink(path) {
      return { ret: ERRNO_NOTSUP, inode_obj: null };
    }
    path_lookup(path, dirflags) {
      return { ret: ERRNO_NOTSUP, inode_obj: null };
    }
    path_open(dirflags, path, oflags, fs_rights_base, fs_rights_inheriting, fd_flags) {
      return { ret: ERRNO_NOTDIR, fd_obj: null };
    }
    path_readlink(path) {
      return { ret: ERRNO_NOTSUP, data: null };
    }
    path_remove_directory(path) {
      return ERRNO_NOTSUP;
    }
    path_rename(old_path, new_fd, new_path) {
      return ERRNO_NOTSUP;
    }
    path_unlink_file(path) {
      return ERRNO_NOTSUP;
    }
  };
  var Inode = class _Inode {
    static issue_ino() {
      return _Inode.next_ino++;
    }
    static root_ino() {
      return 0n;
    }
    constructor() {
      this.ino = _Inode.issue_ino();
    }
  };
  Inode.next_ino = 1n;

  // node_modules/.pnpm/@bjorn3+browser_wasi_shim@0.4.2/node_modules/@bjorn3/browser_wasi_shim/dist/fs_mem.js
  var OpenFile = class extends Fd {
    fd_allocate(offset, len) {
      if (this.file.size > offset + len) {
      } else {
        const new_data = new Uint8Array(Number(offset + len));
        new_data.set(this.file.data, 0);
        this.file.data = new_data;
      }
      return ERRNO_SUCCESS;
    }
    fd_fdstat_get() {
      return { ret: 0, fdstat: new Fdstat(FILETYPE_REGULAR_FILE, 0) };
    }
    fd_filestat_set_size(size) {
      if (this.file.size > size) {
        this.file.data = new Uint8Array(this.file.data.buffer.slice(0, Number(size)));
      } else {
        const new_data = new Uint8Array(Number(size));
        new_data.set(this.file.data, 0);
        this.file.data = new_data;
      }
      return ERRNO_SUCCESS;
    }
    fd_read(size) {
      const slice = this.file.data.slice(Number(this.file_pos), Number(this.file_pos + BigInt(size)));
      this.file_pos += BigInt(slice.length);
      return { ret: 0, data: slice };
    }
    fd_pread(size, offset) {
      const slice = this.file.data.slice(Number(offset), Number(offset + BigInt(size)));
      return { ret: 0, data: slice };
    }
    fd_seek(offset, whence) {
      let calculated_offset;
      switch (whence) {
        case WHENCE_SET:
          calculated_offset = offset;
          break;
        case WHENCE_CUR:
          calculated_offset = this.file_pos + offset;
          break;
        case WHENCE_END:
          calculated_offset = BigInt(this.file.data.byteLength) + offset;
          break;
        default:
          return { ret: ERRNO_INVAL, offset: 0n };
      }
      if (calculated_offset < 0) {
        return { ret: ERRNO_INVAL, offset: 0n };
      }
      this.file_pos = calculated_offset;
      return { ret: 0, offset: this.file_pos };
    }
    fd_tell() {
      return { ret: 0, offset: this.file_pos };
    }
    fd_write(data) {
      if (this.file.readonly) return { ret: ERRNO_BADF, nwritten: 0 };
      if (this.file_pos + BigInt(data.byteLength) > this.file.size) {
        const old = this.file.data;
        this.file.data = new Uint8Array(Number(this.file_pos + BigInt(data.byteLength)));
        this.file.data.set(old);
      }
      this.file.data.set(data, Number(this.file_pos));
      this.file_pos += BigInt(data.byteLength);
      return { ret: 0, nwritten: data.byteLength };
    }
    fd_pwrite(data, offset) {
      if (this.file.readonly) return { ret: ERRNO_BADF, nwritten: 0 };
      if (offset + BigInt(data.byteLength) > this.file.size) {
        const old = this.file.data;
        this.file.data = new Uint8Array(Number(offset + BigInt(data.byteLength)));
        this.file.data.set(old);
      }
      this.file.data.set(data, Number(offset));
      return { ret: 0, nwritten: data.byteLength };
    }
    fd_filestat_get() {
      return { ret: 0, filestat: this.file.stat() };
    }
    constructor(file) {
      super();
      this.file_pos = 0n;
      this.file = file;
    }
  };
  var OpenDirectory = class extends Fd {
    fd_seek(offset, whence) {
      return { ret: ERRNO_BADF, offset: 0n };
    }
    fd_tell() {
      return { ret: ERRNO_BADF, offset: 0n };
    }
    fd_allocate(offset, len) {
      return ERRNO_BADF;
    }
    fd_fdstat_get() {
      return { ret: 0, fdstat: new Fdstat(FILETYPE_DIRECTORY, 0) };
    }
    fd_readdir_single(cookie) {
      if (debug.enabled) {
        debug.log("readdir_single", cookie);
        debug.log(cookie, this.dir.contents.keys());
      }
      if (cookie == 0n) {
        return { ret: ERRNO_SUCCESS, dirent: new Dirent(1n, this.dir.ino, ".", FILETYPE_DIRECTORY) };
      } else if (cookie == 1n) {
        return { ret: ERRNO_SUCCESS, dirent: new Dirent(2n, this.dir.parent_ino(), "..", FILETYPE_DIRECTORY) };
      }
      if (cookie >= BigInt(this.dir.contents.size) + 2n) {
        return { ret: 0, dirent: null };
      }
      const [name, entry] = Array.from(this.dir.contents.entries())[Number(cookie - 2n)];
      return { ret: 0, dirent: new Dirent(cookie + 1n, entry.ino, name, entry.stat().filetype) };
    }
    path_filestat_get(flags, path_str) {
      const { ret: path_err, path } = Path.from(path_str);
      if (path == null) {
        return { ret: path_err, filestat: null };
      }
      const { ret, entry } = this.dir.get_entry_for_path(path);
      if (entry == null) {
        return { ret, filestat: null };
      }
      return { ret: 0, filestat: entry.stat() };
    }
    path_lookup(path_str, dirflags) {
      const { ret: path_ret, path } = Path.from(path_str);
      if (path == null) {
        return { ret: path_ret, inode_obj: null };
      }
      const { ret, entry } = this.dir.get_entry_for_path(path);
      if (entry == null) {
        return { ret, inode_obj: null };
      }
      return { ret: ERRNO_SUCCESS, inode_obj: entry };
    }
    path_open(dirflags, path_str, oflags, fs_rights_base, fs_rights_inheriting, fd_flags) {
      const { ret: path_ret, path } = Path.from(path_str);
      if (path == null) {
        return { ret: path_ret, fd_obj: null };
      }
      let { ret, entry } = this.dir.get_entry_for_path(path);
      if (entry == null) {
        if (ret != ERRNO_NOENT) {
          return { ret, fd_obj: null };
        }
        if ((oflags & OFLAGS_CREAT) == OFLAGS_CREAT) {
          const { ret: ret2, entry: new_entry } = this.dir.create_entry_for_path(path_str, (oflags & OFLAGS_DIRECTORY) == OFLAGS_DIRECTORY);
          if (new_entry == null) {
            return { ret: ret2, fd_obj: null };
          }
          entry = new_entry;
        } else {
          return { ret: ERRNO_NOENT, fd_obj: null };
        }
      } else if ((oflags & OFLAGS_EXCL) == OFLAGS_EXCL) {
        return { ret: ERRNO_EXIST, fd_obj: null };
      }
      if ((oflags & OFLAGS_DIRECTORY) == OFLAGS_DIRECTORY && entry.stat().filetype !== FILETYPE_DIRECTORY) {
        return { ret: ERRNO_NOTDIR, fd_obj: null };
      }
      return entry.path_open(oflags, fs_rights_base, fd_flags);
    }
    path_create_directory(path) {
      return this.path_open(0, path, OFLAGS_CREAT | OFLAGS_DIRECTORY, 0n, 0n, 0).ret;
    }
    path_link(path_str, inode, allow_dir) {
      const { ret: path_ret, path } = Path.from(path_str);
      if (path == null) {
        return path_ret;
      }
      if (path.is_dir) {
        return ERRNO_NOENT;
      }
      const { ret: parent_ret, parent_entry, filename, entry } = this.dir.get_parent_dir_and_entry_for_path(path, true);
      if (parent_entry == null || filename == null) {
        return parent_ret;
      }
      if (entry != null) {
        const source_is_dir = inode.stat().filetype == FILETYPE_DIRECTORY;
        const target_is_dir = entry.stat().filetype == FILETYPE_DIRECTORY;
        if (source_is_dir && target_is_dir) {
          if (allow_dir && entry instanceof Directory) {
            if (entry.contents.size == 0) {
            } else {
              return ERRNO_NOTEMPTY;
            }
          } else {
            return ERRNO_EXIST;
          }
        } else if (source_is_dir && !target_is_dir) {
          return ERRNO_NOTDIR;
        } else if (!source_is_dir && target_is_dir) {
          return ERRNO_ISDIR;
        } else if (inode.stat().filetype == FILETYPE_REGULAR_FILE && entry.stat().filetype == FILETYPE_REGULAR_FILE) {
        } else {
          return ERRNO_EXIST;
        }
      }
      if (!allow_dir && inode.stat().filetype == FILETYPE_DIRECTORY) {
        return ERRNO_PERM;
      }
      parent_entry.contents.set(filename, inode);
      return ERRNO_SUCCESS;
    }
    path_unlink(path_str) {
      const { ret: path_ret, path } = Path.from(path_str);
      if (path == null) {
        return { ret: path_ret, inode_obj: null };
      }
      const { ret: parent_ret, parent_entry, filename, entry } = this.dir.get_parent_dir_and_entry_for_path(path, true);
      if (parent_entry == null || filename == null) {
        return { ret: parent_ret, inode_obj: null };
      }
      if (entry == null) {
        return { ret: ERRNO_NOENT, inode_obj: null };
      }
      parent_entry.contents.delete(filename);
      return { ret: ERRNO_SUCCESS, inode_obj: entry };
    }
    path_unlink_file(path_str) {
      const { ret: path_ret, path } = Path.from(path_str);
      if (path == null) {
        return path_ret;
      }
      const { ret: parent_ret, parent_entry, filename, entry } = this.dir.get_parent_dir_and_entry_for_path(path, false);
      if (parent_entry == null || filename == null || entry == null) {
        return parent_ret;
      }
      if (entry.stat().filetype === FILETYPE_DIRECTORY) {
        return ERRNO_ISDIR;
      }
      parent_entry.contents.delete(filename);
      return ERRNO_SUCCESS;
    }
    path_remove_directory(path_str) {
      const { ret: path_ret, path } = Path.from(path_str);
      if (path == null) {
        return path_ret;
      }
      const { ret: parent_ret, parent_entry, filename, entry } = this.dir.get_parent_dir_and_entry_for_path(path, false);
      if (parent_entry == null || filename == null || entry == null) {
        return parent_ret;
      }
      if (!(entry instanceof Directory) || entry.stat().filetype !== FILETYPE_DIRECTORY) {
        return ERRNO_NOTDIR;
      }
      if (entry.contents.size !== 0) {
        return ERRNO_NOTEMPTY;
      }
      if (!parent_entry.contents.delete(filename)) {
        return ERRNO_NOENT;
      }
      return ERRNO_SUCCESS;
    }
    fd_filestat_get() {
      return { ret: 0, filestat: this.dir.stat() };
    }
    fd_filestat_set_size(size) {
      return ERRNO_BADF;
    }
    fd_read(size) {
      return { ret: ERRNO_BADF, data: new Uint8Array() };
    }
    fd_pread(size, offset) {
      return { ret: ERRNO_BADF, data: new Uint8Array() };
    }
    fd_write(data) {
      return { ret: ERRNO_BADF, nwritten: 0 };
    }
    fd_pwrite(data, offset) {
      return { ret: ERRNO_BADF, nwritten: 0 };
    }
    constructor(dir) {
      super();
      this.dir = dir;
    }
  };
  var PreopenDirectory = class extends OpenDirectory {
    fd_prestat_get() {
      return { ret: 0, prestat: Prestat.dir(this.prestat_name) };
    }
    constructor(name, contents) {
      super(new Directory(contents));
      this.prestat_name = name;
    }
  };
  var File = class extends Inode {
    path_open(oflags, fs_rights_base, fd_flags) {
      if (this.readonly && (fs_rights_base & BigInt(RIGHTS_FD_WRITE)) == BigInt(RIGHTS_FD_WRITE)) {
        return { ret: ERRNO_PERM, fd_obj: null };
      }
      if ((oflags & OFLAGS_TRUNC) == OFLAGS_TRUNC) {
        if (this.readonly) return { ret: ERRNO_PERM, fd_obj: null };
        this.data = new Uint8Array([]);
      }
      const file = new OpenFile(this);
      if (fd_flags & FDFLAGS_APPEND) file.fd_seek(0n, WHENCE_END);
      return { ret: ERRNO_SUCCESS, fd_obj: file };
    }
    get size() {
      return BigInt(this.data.byteLength);
    }
    stat() {
      return new Filestat(this.ino, FILETYPE_REGULAR_FILE, this.size);
    }
    constructor(data, options) {
      super();
      this.data = new Uint8Array(data);
      this.readonly = !!options?.readonly;
    }
  };
  var Path = class Path2 {
    static from(path) {
      const self = new Path2();
      self.is_dir = path.endsWith("/");
      if (path.startsWith("/")) {
        return { ret: ERRNO_NOTCAPABLE, path: null };
      }
      if (path.includes("\0")) {
        return { ret: ERRNO_INVAL, path: null };
      }
      for (const component of path.split("/")) {
        if (component === "" || component === ".") {
          continue;
        }
        if (component === "..") {
          if (self.parts.pop() == void 0) {
            return { ret: ERRNO_NOTCAPABLE, path: null };
          }
          continue;
        }
        self.parts.push(component);
      }
      return { ret: ERRNO_SUCCESS, path: self };
    }
    to_path_string() {
      let s = this.parts.join("/");
      if (this.is_dir) {
        s += "/";
      }
      return s;
    }
    constructor() {
      this.parts = [];
      this.is_dir = false;
    }
  };
  var Directory = class _Directory extends Inode {
    parent_ino() {
      if (this.parent == null) {
        return Inode.root_ino();
      }
      return this.parent.ino;
    }
    path_open(oflags, fs_rights_base, fd_flags) {
      return { ret: ERRNO_SUCCESS, fd_obj: new OpenDirectory(this) };
    }
    stat() {
      return new Filestat(this.ino, FILETYPE_DIRECTORY, 0n);
    }
    get_entry_for_path(path) {
      let entry = this;
      for (const component of path.parts) {
        if (!(entry instanceof _Directory)) {
          return { ret: ERRNO_NOTDIR, entry: null };
        }
        const child = entry.contents.get(component);
        if (child !== void 0) {
          entry = child;
        } else {
          debug.log(component);
          return { ret: ERRNO_NOENT, entry: null };
        }
      }
      if (path.is_dir) {
        if (entry.stat().filetype != FILETYPE_DIRECTORY) {
          return { ret: ERRNO_NOTDIR, entry: null };
        }
      }
      return { ret: ERRNO_SUCCESS, entry };
    }
    get_parent_dir_and_entry_for_path(path, allow_undefined) {
      const filename = path.parts.pop();
      if (filename === void 0) {
        return { ret: ERRNO_INVAL, parent_entry: null, filename: null, entry: null };
      }
      const { ret: entry_ret, entry: parent_entry } = this.get_entry_for_path(path);
      if (parent_entry == null) {
        return { ret: entry_ret, parent_entry: null, filename: null, entry: null };
      }
      if (!(parent_entry instanceof _Directory)) {
        return { ret: ERRNO_NOTDIR, parent_entry: null, filename: null, entry: null };
      }
      const entry = parent_entry.contents.get(filename);
      if (entry === void 0) {
        if (!allow_undefined) {
          return { ret: ERRNO_NOENT, parent_entry: null, filename: null, entry: null };
        } else {
          return { ret: ERRNO_SUCCESS, parent_entry, filename, entry: null };
        }
      }
      if (path.is_dir) {
        if (entry.stat().filetype != FILETYPE_DIRECTORY) {
          return { ret: ERRNO_NOTDIR, parent_entry: null, filename: null, entry: null };
        }
      }
      return { ret: ERRNO_SUCCESS, parent_entry, filename, entry };
    }
    create_entry_for_path(path_str, is_dir) {
      const { ret: path_ret, path } = Path.from(path_str);
      if (path == null) {
        return { ret: path_ret, entry: null };
      }
      let { ret: parent_ret, parent_entry, filename, entry } = this.get_parent_dir_and_entry_for_path(path, true);
      if (parent_entry == null || filename == null) {
        return { ret: parent_ret, entry: null };
      }
      if (entry != null) {
        return { ret: ERRNO_EXIST, entry: null };
      }
      debug.log("create", path);
      let new_child;
      if (!is_dir) {
        new_child = new File(new ArrayBuffer(0));
      } else {
        new_child = new _Directory(/* @__PURE__ */ new Map());
      }
      parent_entry.contents.set(filename, new_child);
      entry = new_child;
      return { ret: ERRNO_SUCCESS, entry };
    }
    constructor(contents) {
      super();
      this.parent = null;
      if (contents instanceof Array) {
        this.contents = new Map(contents);
      } else {
        this.contents = contents;
      }
      for (const entry of this.contents.values()) {
        if (entry instanceof _Directory) {
          entry.parent = this;
        }
      }
    }
  };
  var ConsoleStdout = class _ConsoleStdout extends Fd {
    fd_filestat_get() {
      const filestat = new Filestat(this.ino, FILETYPE_CHARACTER_DEVICE, BigInt(0));
      return { ret: 0, filestat };
    }
    fd_fdstat_get() {
      const fdstat = new Fdstat(FILETYPE_CHARACTER_DEVICE, 0);
      fdstat.fs_rights_base = BigInt(RIGHTS_FD_WRITE);
      return { ret: 0, fdstat };
    }
    fd_write(data) {
      this.write(data);
      return { ret: 0, nwritten: data.byteLength };
    }
    static lineBuffered(write) {
      const dec = new TextDecoder("utf-8", { fatal: false });
      let line_buf = "";
      return new _ConsoleStdout((buffer) => {
        line_buf += dec.decode(buffer, { stream: true });
        const lines = line_buf.split("\n");
        for (const [i, line] of lines.entries()) {
          if (i < lines.length - 1) {
            write(line);
          } else {
            line_buf = line;
          }
        }
      });
    }
    constructor(write) {
      super();
      this.ino = Inode.issue_ino();
      this.write = write;
    }
  };

  // src/workers/wasi/io.ts
  function createWasiIo(options) {
    const output = new OutputBuffer(options.outputBytes);
    const stdoutDecoder = new TextDecoder();
    const stderrDecoder = new TextDecoder();
    const append = (stream, decoder) => (bytes) => {
      output.append(stream, decoder.decode(bytes, { stream: true }));
    };
    const preopened = new Map(Object.entries(options.preopenedFiles ?? {}).map(([name, bytes]) => [name, new File(bytes)]));
    const fds = [
      new OpenFile(new File(new TextEncoder().encode(options.stdin))),
      new ConsoleStdout(append("stdout", stdoutDecoder)),
      new ConsoleStdout(append("stderr", stderrDecoder)),
      new PreopenDirectory("/", preopened)
    ];
    return {
      fds,
      finish: () => {
        output.append("stdout", stdoutDecoder.decode());
        output.append("stderr", stderrDecoder.decode());
        const stdout = output.stdout();
        const stderr = output.stderr();
        return { stdout: stdout.text, stderr: stderr.text, truncated: stdout.truncated || stderr.truncated };
      }
    };
  }

  // src/workers/wasi/runner.ts
  async function runWasiModule(options) {
    const io = createWasiIo(options);
    const wasi = new WASI(
      ["rustpython-runner", ...options.args],
      Object.entries(options.env).map(([name, value]) => `${name}=${value}`),
      [...io.fds]
    );
    const module = await WebAssembly.compile(options.wasm);
    const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi.wasiImport });
    if (!isWasiStartable(instance)) throw new TypeError("WASI module does not export memory and _start");
    const exitCode = wasi.start(instance);
    return { ...io.finish(), exitCode };
  }
  function isWasiStartable(instance) {
    return instance.exports.memory instanceof WebAssembly.Memory && typeof instance.exports._start === "function";
  }

  // src/workers/rustpython.worker.ts
  function createLocalRustPythonFetcher(scope) {
    return async (url) => {
      const response = await scope.fetch(new URL(url, new URL("./", scope.location.href)));
      if (!response.ok) throw new Error(`RustPython asset request failed with ${response.status}`);
      return response.arrayBuffer();
    };
  }
  function installRustPythonWorker(scope) {
    const endpoint = createWorkerEndpoint({
      runtimeId: "python-rustpython",
      runtime: createRustPythonHost({
        fetchBytes: createLocalRustPythonFetcher(scope),
        runWasi: runWasiModule,
        outputBytes: MAX_OUTPUT_BYTES,
        buildId: injectedBuildId2()
      }),
      post: (message) => scope.postMessage(message)
    });
    scope.addEventListener("message", (event) => {
      void endpoint(event);
    });
  }
  function injectedBuildId2() {
    return true ? "d257db92774c4cfc" : "development";
  }
  var workerScope = globalThis;
  if (isRustPythonWorkerScope(workerScope)) {
    installRustPythonWorker(workerScope);
  }
  function isRustPythonWorkerScope(scope) {
    const location = Reflect.get(scope, "location");
    return typeof Reflect.get(scope, "addEventListener") === "function" && typeof Reflect.get(scope, "postMessage") === "function" && typeof Reflect.get(scope, "fetch") === "function" && location !== null && typeof location === "object" && typeof Reflect.get(location, "href") === "string";
  }
})();
