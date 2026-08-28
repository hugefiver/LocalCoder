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

  // src/workers/shared/runtime-errors.ts
  var encoder = new TextEncoder();
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
      const codePointBytes = encoder.encode(codePoint).byteLength;
      if (bytes + codePointBytes > limit) break;
      result += codePoint;
      bytes += codePointBytes;
    }
    return result;
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

  // src/workers/shared/output-buffer.ts
  var encoder2 = new TextEncoder();
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
        const codePointBytes = encoder2.encode(codePoint).byteLength;
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
    return { text, bytes: encoder2.encode(text).byteLength, truncated };
  }

  // src/workers/python/python-bridge.ts
  var PYODIDE_BRIDGE_GLOBALS = Object.freeze({
    source: "__localcoder_source_json",
    input: "__localcoder_input_json",
    mode: "__localcoder_mode_json"
  });
  var PYODIDE_BRIDGE_PROGRAM = `
import json as __localcoder_json
import sys as __localcoder_sys
from io import StringIO as __localcoder_StringIO

def __localcoder_bridge_run():
    __localcoder_stdout = __localcoder_StringIO()
    __localcoder_stderr = __localcoder_StringIO()
    __localcoder_original_stdout = __localcoder_sys.stdout
    __localcoder_original_stderr = __localcoder_sys.stderr
    try:
        __localcoder_sys.stdout = __localcoder_stdout
        __localcoder_sys.stderr = __localcoder_stderr
        __localcoder_source = __localcoder_json.loads(__localcoder_source_json)
        __localcoder_input = __localcoder_json.loads(__localcoder_input_json)
        __localcoder_mode = __localcoder_json.loads(__localcoder_mode_json)
        __localcoder_namespace = {'__name__': '__main__'}
        exec(__localcoder_source, __localcoder_namespace)
        if __localcoder_mode == 'judge':
            __localcoder_solution = __localcoder_namespace.get('solution')
            if not callable(__localcoder_solution):
                raise NameError('Python source must define solution(input)')
            __localcoder_value = __localcoder_solution(__localcoder_input)
        else:
            __localcoder_value = None
    except SyntaxError as __localcoder_error:
        return __localcoder_json.dumps({
            'ok': False,
            'kind': 'python-compile-error',
            'details': f'{type(__localcoder_error).__name__}: {__localcoder_error}',
            'stdout': __localcoder_stdout.getvalue(),
            'stderr': __localcoder_stderr.getvalue(),
        }, ensure_ascii=False, allow_nan=False)
    except BaseException as __localcoder_error:
        return __localcoder_json.dumps({
            'ok': False,
            'kind': 'python-runtime-error',
            'details': f'{type(__localcoder_error).__name__}: {__localcoder_error}',
            'stdout': __localcoder_stdout.getvalue(),
            'stderr': __localcoder_stderr.getvalue(),
        }, ensure_ascii=False, allow_nan=False)
    finally:
        __localcoder_sys.stdout = __localcoder_original_stdout
        __localcoder_sys.stderr = __localcoder_original_stderr

    try:
        __localcoder_value = __localcoder_json.loads(
            __localcoder_json.dumps(__localcoder_value, ensure_ascii=False, allow_nan=False)
        )
    except (TypeError, ValueError) as __localcoder_error:
        return __localcoder_json.dumps({
            'ok': False,
            'kind': 'json-bridge-error',
            'details': f'{type(__localcoder_error).__name__}: {__localcoder_error}',
            'stdout': __localcoder_stdout.getvalue(),
            'stderr': __localcoder_stderr.getvalue(),
        }, ensure_ascii=False, allow_nan=False)

    return __localcoder_json.dumps({
        'ok': True,
        'value': __localcoder_value,
        'stdout': __localcoder_stdout.getvalue(),
        'stderr': __localcoder_stderr.getvalue(),
    }, ensure_ascii=False, allow_nan=False)

__localcoder_bridge_run()
`;

  // src/workers/python/pyodide-host.ts
  function createPyodideHost(options) {
    const outputBytes = options.outputBytes ?? MAX_OUTPUT_BYTES;
    const buildId = options.buildId ?? injectedBuildId();
    let loaded;
    let loading;
    const getPyodide = async () => {
      if (loaded !== void 0) return loaded;
      if (loading === void 0) {
        loading = options.load().then((candidate) => {
          if (!isPyodideLike(candidate)) {
            throw infrastructureError("pyodide-api-incompatible", "Local Pyodide asset has an incompatible API");
          }
          loaded = candidate;
          return candidate;
        }).catch((error) => {
          loading = void 0;
          if (error instanceof RuntimeFailureError) throw error;
          throw infrastructureError("pyodide-initialization-failed", "Local Pyodide runtime could not initialize");
        });
      }
      return loading;
    };
    return {
      initialize: async () => {
        const pyodide = await getPyodide();
        return {
          runtimeVersion: pyodide.version ?? "pyodide",
          buildId,
          capabilities: { execute: true, judge: true }
        };
      },
      execute: async (source) => execute(await getPyodide(), source, outputBytes),
      judge: async (source, cases) => judge(await getPyodide(), source, cases, outputBytes),
      dispose: async () => void 0
    };
  }
  function isPyodideLike(value) {
    if (value === null || typeof value !== "object") return false;
    const candidate = value;
    const globals = candidate.globals;
    return typeof candidate.runPythonAsync === "function" && globals !== null && typeof globals === "object" && typeof globals.set === "function" && typeof globals.delete === "function";
  }
  async function execute(pyodide, source, outputBytes) {
    const output = new OutputBuffer(outputBytes);
    try {
      const result = await runBridge(pyodide, source, null, "execute");
      appendOutput(output, result);
      if (!result.ok) throw bridgeFailure(result);
      return { stdout: output.stdout(), stderr: output.stderr(), value: null };
    } catch (error) {
      throw pythonOperationFailure(error);
    }
  }
  async function judge(pyodide, source, cases, outputBytes) {
    const budget = new OutputBudget(outputBytes);
    const results = [];
    for (const testCase of cases) {
      results.push(await judgeCase(pyodide, source, testCase, budget));
    }
    return { cases: results };
  }
  async function judgeCase(pyodide, source, testCase, budget) {
    const output = new OutputBuffer(budget);
    try {
      const result = await runBridge(pyodide, source, testCase.input, "judge");
      appendOutput(output, result);
      if (!result.ok) throw bridgeFailure(result);
      return {
        index: testCase.index,
        ok: true,
        actual: result.value,
        stdout: output.stdout(),
        stderr: output.stderr()
      };
    } catch (error) {
      return {
        index: testCase.index,
        ok: false,
        failure: pythonOperationFailure(error).failure,
        stdout: output.stdout(),
        stderr: output.stderr()
      };
    }
  }
  async function runBridge(pyodide, source, input, mode) {
    let rawResult;
    try {
      pyodide.globals.set(PYODIDE_BRIDGE_GLOBALS.source, JSON.stringify(source));
      pyodide.globals.set(PYODIDE_BRIDGE_GLOBALS.input, JSON.stringify(input));
      pyodide.globals.set(PYODIDE_BRIDGE_GLOBALS.mode, JSON.stringify(mode));
      rawResult = await pyodide.runPythonAsync(PYODIDE_BRIDGE_PROGRAM);
      return parseBridgeResult(rawResult);
    } finally {
      destroyPyProxy(rawResult);
      pyodide.globals.delete(PYODIDE_BRIDGE_GLOBALS.source);
      pyodide.globals.delete(PYODIDE_BRIDGE_GLOBALS.input);
      pyodide.globals.delete(PYODIDE_BRIDGE_GLOBALS.mode);
    }
  }
  function parseBridgeResult(value) {
    if (typeof value !== "string") {
      throw bridgeError("Python bridge did not return a JSON string");
    }
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw bridgeError("Python bridge returned invalid JSON");
    }
    if (!isPlainRecord2(parsed) || typeof parsed.ok !== "boolean") {
      throw bridgeError("Python bridge returned an invalid result envelope");
    }
    if (parsed.ok) {
      if (!hasExactKeys(parsed, ["ok", "value", "stdout", "stderr"]) || !hasTextStreams(parsed)) {
        throw bridgeError("Python bridge returned an invalid success envelope");
      }
      try {
        return {
          ok: true,
          value: assertJsonValue(parsed.value, "Python bridge result"),
          stdout: parsed.stdout,
          stderr: parsed.stderr
        };
      } catch (error) {
        throw bridgeError(errorMessage(error) ?? "Python result is not canonical JSON");
      }
    }
    if (!hasExactKeys(parsed, ["ok", "kind", "details", "stdout", "stderr"]) || !hasTextStreams(parsed) || parsed.kind !== "python-compile-error" && parsed.kind !== "python-runtime-error" && parsed.kind !== "json-bridge-error" || typeof parsed.details !== "string") {
      throw bridgeError("Python bridge returned an invalid failure envelope");
    }
    return {
      ok: false,
      kind: parsed.kind,
      details: parsed.details,
      stdout: parsed.stdout,
      stderr: parsed.stderr
    };
  }
  function appendOutput(output, result) {
    output.append("stdout", result.stdout);
    output.append("stderr", result.stderr);
  }
  function bridgeFailure(result) {
    if (result.kind === "python-compile-error") {
      return new RuntimeFailureError(compileFailure(
        result.kind,
        "Python source could not be compiled",
        result.details
      ));
    }
    const message = result.kind === "json-bridge-error" ? "Python result is not JSON serializable" : "Python execution failed";
    return new RuntimeFailureError(runtimeFailure(result.kind, message, result.details));
  }
  function pythonOperationFailure(error) {
    if (error instanceof RuntimeFailureError) return error;
    return new RuntimeFailureError(runtimeFailure(
      "python-runtime-error",
      "Python execution failed",
      errorMessage(error)
    ));
  }
  function bridgeError(details) {
    return new RuntimeFailureError(runtimeFailure(
      "json-bridge-error",
      "Python bridge could not produce canonical JSON",
      details
    ));
  }
  function infrastructureError(code, message) {
    return new RuntimeFailureError({ kind: "infrastructure", code, message, fatal: true });
  }
  function destroyPyProxy(value) {
    if (value !== null && typeof value === "object" && typeof value.destroy === "function") {
      value.destroy();
    }
  }
  function isPlainRecord2(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }
  function hasExactKeys(record, requiredKeys) {
    const keys = Object.keys(record);
    return keys.length === requiredKeys.length && requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(record, key));
  }
  function hasTextStreams(record) {
    return typeof record.stdout === "string" && typeof record.stderr === "string";
  }
  function errorMessage(error) {
    return error instanceof Error ? error.message : typeof error === "string" ? error : void 0;
  }
  function injectedBuildId() {
    return true ? "9f4fade77f53b374" : "development";
  }

  // src/workers/pyodide.worker.ts
  function createLocalPyodideLoader(scope) {
    let scriptImported = false;
    return async () => {
      const indexURL = new URL("pyodide/", new URL("./", scope.location.href)).href;
      if (!scriptImported) {
        try {
          scope.importScripts(new URL("pyodide.js", indexURL).href);
          scriptImported = true;
        } catch {
          throw infrastructureError2("pyodide-asset-missing", "Local Pyodide asset could not be loaded");
        }
      }
      if (typeof scope.loadPyodide !== "function") {
        throw infrastructureError2("pyodide-api-incompatible", "Local Pyodide asset did not expose loadPyodide");
      }
      let pyodide;
      try {
        pyodide = await scope.loadPyodide({ indexURL });
      } catch (error) {
        if (error instanceof RuntimeFailureError) throw error;
        throw infrastructureError2("pyodide-initialization-failed", "Local Pyodide runtime could not initialize");
      }
      if (!isPyodideLike(pyodide) || typeof pyodide.version !== "string" || pyodide.version.trim().length === 0) {
        throw infrastructureError2("pyodide-api-incompatible", "Local Pyodide asset has an incompatible API");
      }
      return pyodide;
    };
  }
  function installPyodideWorker(scope) {
    const endpoint = createWorkerEndpoint({
      runtimeId: "python-pyodide",
      runtime: createPyodideHost({
        load: createLocalPyodideLoader(scope),
        outputBytes: MAX_OUTPUT_BYTES,
        buildId: injectedBuildId2()
      }),
      post: (message) => scope.postMessage(message)
    });
    scope.addEventListener("message", (event) => {
      void endpoint(event);
    });
  }
  function infrastructureError2(code, message) {
    return new RuntimeFailureError({ kind: "infrastructure", code, message, fatal: true });
  }
  function injectedBuildId2() {
    return true ? "9f4fade77f53b374" : "development";
  }
  var workerScope = globalThis;
  if (typeof workerScope.addEventListener === "function" && typeof workerScope.postMessage === "function" && typeof workerScope.importScripts === "function" && workerScope.location !== void 0) {
    installPyodideWorker(workerScope);
  }
})();
