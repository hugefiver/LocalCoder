---
schemaVersion: 2
id: 3
slug: valid-palindrome
title: Valid Palindrome
difficulty: Easy
summary: Check whether a string is a palindrome after ignoring case and non-alphanumeric characters.
tags:
  - string
  - two-pointers
examples:
  - input: "s = \"A man, a plan, a canal: Panama\""
    output: "true"
    explanation: "\"amanaplanacanalpanama\" reads the same in either direction."
  - input: "s = \"race a car\""
    output: "false"
constraints:
  - "1 <= s.length <= 2 * 10^5"
  - "s consists only of printable ASCII characters"
entrypoint: solution
contract: json-function-v1
templates:
  javascript: |
    function solution(input) {
      const { s } = input;
      // Your code here
      return false;
    }
  typescript: |
    function solution(input: { s: string }): boolean {
      const { s } = input;
      // Your code here
      return false;
    }
  python: |
    def solution(input):
        s = input['s']
        # Your code here
        return False
  racket: |
    #lang racket

    (define (solution input)
      (let ([s (hash-ref input 's)])
        ;; Your code here
        #f))
tests:
  public:
    - input: { s: "A man, a plan, a canal: Panama" }
      expected: true
    - input: { s: "race a car" }
      expected: false
  judge:
    - input: { s: " " }
      expected: true
---

## 题目

如果一个字符串在 **转换为小写** 并 **移除所有非字母数字字符** 后，正着读和反着读一样，则它是回文串。

给定字符串 `s`，返回它是否是回文串。
