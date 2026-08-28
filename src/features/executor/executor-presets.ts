import type { LanguageId } from "../../domain/language.js";

export const EXECUTOR_PRESETS: Readonly<Record<LanguageId, string>> = Object.freeze({
  javascript: `const values = [3, 5, 8, 13];
const total = values.reduce((sum, value) => sum + value, 0);

console.log("本地求和:", total);
return { total, doubled: values.map((value) => value * 2) };`,
  typescript: `const values: number[] = [3, 5, 8, 13];
const total: number = values.reduce((sum, value) => sum + value, 0);

console.log("本地求和:", total);
return { total, doubled: values.map((value) => value * 2) };`,
  python: `values = [3, 5, 8, 13]
total = sum(values)

print("本地求和:", total)
print("翻倍:", [value * 2 for value in values])`,
  racket: `#lang racket

(define values '(3 5 8 13))
(define total (apply + values))

(displayln (format "本地求和: ~a" total))
(displayln (format "翻倍: ~a" (map (lambda (value) (* value 2)) values)))`,
  haskell: `module Main where

values :: [Int]
values = [3, 5, 8, 13]

main :: IO ()
main = do
  putStrLn $ "本地求和: " ++ show (sum values)
  putStrLn $ "翻倍: " ++ show (map (* 2) values)`,
});
