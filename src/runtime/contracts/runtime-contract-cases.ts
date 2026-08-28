import { type JsonValue } from "../../domain/json-value.js";
import { type RuntimeId } from "../../domain/language.js";

export interface RuntimeContractCase {
  readonly input: JsonValue;
  readonly expected: JsonValue;
}

export interface RuntimeContractCases {
  readonly smokeSource: string;
  readonly judgeSource: string;
  readonly judgeCases: readonly RuntimeContractCase[];
}

const racketNestedValue: JsonValue = { greeting: "こんにちは", nested: [true, { café: null }] };
const racketJudgeCases: readonly RuntimeContractCase[] = Object.freeze([
  { input: null, expected: null },
  { input: racketNestedValue, expected: racketNestedValue },
]);

const RACKET_CONTRACT_CASES: RuntimeContractCases = Object.freeze({
  smokeSource: "#lang racket\n(displayln \"runtime smoke\")",
  judgeSource: "#lang racket\n(define (solution input) input)",
  judgeCases: racketJudgeCases,
});

const PYTHON_RUSTPYTHON_CONTRACT_CASES: RuntimeContractCases = Object.freeze({
  smokeSource: "print('runtime smoke')",
  judgeSource: "def solution(input):\n    return input",
  judgeCases: Object.freeze([
    { input: null, expected: null },
    { input: racketNestedValue, expected: racketNestedValue },
  ]),
});

const HASKELL_CONTRACT_CASES: RuntimeContractCases = Object.freeze({
  smokeSource: "main :: IO ()\nmain = putStr \"runtime smoke\"",
  judgeSource: "solution :: String -> String\nsolution = id",
  judgeCases: Object.freeze([
    { input: null, expected: null },
    { input: { greeting: "こんにちは", nested: [true, { café: null }] }, expected: { greeting: "こんにちは", nested: [true, { café: null }] } },
  ]),
});

export function runtimeContractCases(runtimeId: RuntimeId): RuntimeContractCases {
  if (runtimeId === "racket-wasm") return RACKET_CONTRACT_CASES;
  if (runtimeId === "python-rustpython") return PYTHON_RUSTPYTHON_CONTRACT_CASES;
  if (runtimeId === "haskell-ghc-wasi") return HASKELL_CONTRACT_CASES;
  throw new RangeError(`Optional runtime ${runtimeId} has no verification contract`);
}
