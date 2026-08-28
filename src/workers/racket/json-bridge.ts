import { assertJsonValue, type JsonValue } from "../../domain/json-value.js";

export interface RacketBridgeRequest {
  readonly source: string;
  readonly input: JsonValue;
  readonly mode: "execute" | "judge";
}

export function createRacketBridgeProgram(request: RacketBridgeRequest): string {
  const source = sourceBody(request.source);
  const input = JSON.stringify(JSON.stringify(assertJsonValue(request.input, "Racket bridge input")));
  const invoke = request.mode === "judge" ? "(solution __lc_input)" : "'null";
  return `#lang racket
(require json)
(define __lc_input (string->jsexpr ${input}))
(define __lc_stdout (open-output-string))
(define __lc_stderr (open-output-string))
(define __lc_result
  (with-handlers ([exn:fail?
                   (lambda (error)
                     (hasheq 'ok #f
                             'kind "racket-runtime-error"
                             'details (exn-message error)
                             'stdout (get-output-string __lc_stdout)
                             'stderr (get-output-string __lc_stderr)))])
    (parameterize ([current-output-port __lc_stdout]
                   [current-error-port __lc_stderr])
      ${source}
      (hasheq 'ok #t
              'value ${invoke}
              'stdout (get-output-string __lc_stdout)
              'stderr (get-output-string __lc_stderr)))))
(define __lc_payload
  (with-handlers ([exn:fail?
                   (lambda (error)
                     (jsexpr->string
                      (hasheq 'ok #f
                              'kind "json-bridge-error"
                              'details (exn-message error)
                              'stdout (get-output-string __lc_stdout)
                              'stderr (get-output-string __lc_stderr))))])
    (jsexpr->string __lc_result)))
(display __lc_payload)
`;
}

function sourceBody(source: string): string {
  return source.replace(/^\s*#lang\s+racket(?:\/base)?\s*(?:\r?\n|$)/, "");
}
