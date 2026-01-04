export const problems = [
  {
    id: 1,
    title: 'Two Sum',
    difficulty: 'Easy' as const,
    description: 'Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target. You may assume that each input would have exactly one solution, and you may not use the same element twice.',
    examples: [
      {
        input: 'nums = [2,7,11,15], target = 9',
        output: '[0,1]',
        explanation: 'Because nums[0] + nums[1] == 9, we return [0, 1].',
      },
      {
        input: 'nums = [3,2,4], target = 6',
        output: '[1,2]',
      },
    ],
    constraints: [
      '2 <= nums.length <= 10^4',
      '-10^9 <= nums[i] <= 10^9',
      '-10^9 <= target <= 10^9',
    ],
    testCases: [
      { input: { nums: [2, 7, 11, 15], target: 9 }, expected: [0, 1] },
      { input: { nums: [3, 2, 4], target: 6 }, expected: [1, 2] },
      { input: { nums: [3, 3], target: 6 }, expected: [0, 1] },
    ],
  },
  {
    id: 2,
    title: 'Reverse String',
    difficulty: 'Easy' as const,
    description: 'Write a function that reverses a string. The input string is given as an array of characters s. You must do this by modifying the input array in-place with O(1) extra memory.',
    examples: [
      {
        input: 's = ["h","e","l","l","o"]',
        output: '["o","l","l","e","h"]',
      },
      {
        input: 's = ["H","a","n","n","a","h"]',
        output: '["h","a","n","n","a","H"]',
      },
    ],
    constraints: [
      '1 <= s.length <= 10^5',
      's[i] is a printable ascii character.',
    ],
    testCases: [
      { input: { s: ['h', 'e', 'l', 'l', 'o'] }, expected: ['o', 'l', 'l', 'e', 'h'] },
      { input: { s: ['H', 'a', 'n', 'n', 'a', 'h'] }, expected: ['h', 'a', 'n', 'n', 'a', 'H'] },
      { input: { s: ['A'] }, expected: ['A'] },
    ],
  },
  {
    id: 3,
    title: 'Valid Palindrome',
    difficulty: 'Easy' as const,
    description: 'A phrase is a palindrome if, after converting all uppercase letters into lowercase letters and removing all non-alphanumeric characters, it reads the same forward and backward. Given a string s, return true if it is a palindrome, or false otherwise.',
    examples: [
      {
        input: 's = "A man, a plan, a canal: Panama"',
        output: 'true',
        explanation: '"amanaplanacanalpanama" is a palindrome.',
      },
      {
        input: 's = "race a car"',
        output: 'false',
        explanation: '"raceacar" is not a palindrome.',
      },
    ],
    constraints: [
      '1 <= s.length <= 2 * 10^5',
      's consists only of printable ASCII characters.',
    ],
    testCases: [
      { input: { s: 'A man, a plan, a canal: Panama' }, expected: true },
      { input: { s: 'race a car' }, expected: false },
      { input: { s: ' ' }, expected: true },
    ],
  },
  {
    id: 4,
    title: 'Maximum Subarray',
    difficulty: 'Medium' as const,
    description: 'Given an integer array nums, find the contiguous subarray (containing at least one number) which has the largest sum and return its sum.',
    examples: [
      {
        input: 'nums = [-2,1,-3,4,-1,2,1,-5,4]',
        output: '6',
        explanation: '[4,-1,2,1] has the largest sum = 6.',
      },
      {
        input: 'nums = [1]',
        output: '1',
      },
    ],
    constraints: [
      '1 <= nums.length <= 10^5',
      '-10^4 <= nums[i] <= 10^4',
    ],
    testCases: [
      { input: { nums: [-2, 1, -3, 4, -1, 2, 1, -5, 4] }, expected: 6 },
      { input: { nums: [1] }, expected: 1 },
      { input: { nums: [5, 4, -1, 7, 8] }, expected: 23 },
    ],
  },
  {
    id: 5,
    title: 'Merge Two Sorted Lists',
    difficulty: 'Easy' as const,
    description: 'You are given the heads of two sorted linked lists list1 and list2. Merge the two lists into one sorted list. The list should be made by splicing together the nodes of the first two lists. Return the head of the merged linked list.',
    examples: [
      {
        input: 'list1 = [1,2,4], list2 = [1,3,4]',
        output: '[1,1,2,3,4,4]',
      },
      {
        input: 'list1 = [], list2 = []',
        output: '[]',
      },
    ],
    constraints: [
      'The number of nodes in both lists is in the range [0, 50].',
      '-100 <= Node.val <= 100',
    ],
    testCases: [
      { input: { list1: [1, 2, 4], list2: [1, 3, 4] }, expected: [1, 1, 2, 3, 4, 4] },
      { input: { list1: [], list2: [] }, expected: [] },
      { input: { list1: [], list2: [0] }, expected: [0] },
    ],
  },
  {
    id: 6,
    title: 'Longest Substring Without Repeating Characters',
    difficulty: 'Medium' as const,
    description: 'Given a string s, find the length of the longest substring without repeating characters.',
    examples: [
      {
        input: 's = "abcabcbb"',
        output: '3',
        explanation: 'The answer is "abc", with the length of 3.',
      },
      {
        input: 's = "bbbbb"',
        output: '1',
        explanation: 'The answer is "b", with the length of 1.',
      },
    ],
    constraints: [
      '0 <= s.length <= 5 * 10^4',
      's consists of English letters, digits, symbols and spaces.',
    ],
    testCases: [
      { input: { s: 'abcabcbb' }, expected: 3 },
      { input: { s: 'bbbbb' }, expected: 1 },
      { input: { s: 'pwwkew' }, expected: 3 },
    ],
  },
];

export const codeTemplates: Record<string, Record<string, string>> = {
  '1': {
    javascript: `function solution(input) {
  const { nums, target } = input;
  // Your code here
  
  return [];
}`,
    typescript: `function solution(input: { nums: number[], target: number }): number[] {
  const { nums, target } = input;
  // Your code here
  
  return [];
}`,
    python: `def solution(input):
    nums = input['nums']
    target = input['target']
    # Your code here
    
    return []`,
    racket: `#lang racket

(define (solution input)
  (let ([nums (hash-ref input 'nums)]
        [target (hash-ref input 'target)])
    ;; Your code here
    
    '()))`,
  },
  '2': {
    javascript: `function solution(input) {
  const { s } = input;
  // Modify the array in-place and return it
  
  return s;
}`,
    typescript: `function solution(input: { s: string[] }): string[] {
  const { s } = input;
  // Modify the array in-place and return it
  
  return s;
}`,
    python: `def solution(input):
    s = input['s']
    # Modify the list in-place and return it
    
    return s`,
    racket: `#lang racket

(define (solution input)
  (let ([s (hash-ref input 's)])
    ;; Your code here
    
    s))`,
  },
  '3': {
    javascript: `function solution(input) {
  const { s } = input;
  // Your code here
  
  return false;
}`,
    typescript: `function solution(input: { s: string }): boolean {
  const { s } = input;
  // Your code here
  
  return false;
}`,
    python: `def solution(input):
    s = input['s']
    # Your code here
    
    return False`,
    racket: `#lang racket

(define (solution input)
  (let ([s (hash-ref input 's)])
    ;; Your code here
    
    #f))`,
  },
  '4': {
    javascript: `function solution(input) {
  const { nums } = input;
  // Your code here
  
  return 0;
}`,
    typescript: `function solution(input: { nums: number[] }): number {
  const { nums } = input;
  // Your code here
  
  return 0;
}`,
    python: `def solution(input):
    nums = input['nums']
    # Your code here
    
    return 0`,
    racket: `#lang racket

(define (solution input)
  (let ([nums (hash-ref input 'nums)])
    ;; Your code here
    
    0))`,
  },
  '5': {
    javascript: `function solution(input) {
  const { list1, list2 } = input;
  // Your code here
  
  return [];
}`,
    typescript: `function solution(input: { list1: number[], list2: number[] }): number[] {
  const { list1, list2 } = input;
  // Your code here
  
  return [];
}`,
    python: `def solution(input):
    list1 = input['list1']
    list2 = input['list2']
    # Your code here
    
    return []`,
    racket: `#lang racket

(define (solution input)
  (let ([list1 (hash-ref input 'list1)]
        [list2 (hash-ref input 'list2)])
    ;; Your code here
    
    '()))`,
  },
  '6': {
    javascript: `function solution(input) {
  const { s } = input;
  // Your code here
  
  return 0;
}`,
    typescript: `function solution(input: { s: string }): number {
  const { s } = input;
  // Your code here
  
  return 0;
}`,
    python: `def solution(input):
    s = input['s']
    # Your code here
    
    return 0`,
    racket: `#lang racket

(define (solution input)
  (let ([s (hash-ref input 's)])
    ;; Your code here
    
    0))`,
  },
};

export const languageInfo = {
  javascript: {
    name: 'JavaScript',
    description: 'Run JavaScript code directly in the browser',
  },
  typescript: {
    name: 'TypeScript',
    description: 'TypeScript with basic type stripping',
  },
  python: {
    name: 'Python',
    description: 'CPython via Pyodide WebAssembly',
  },
  racket: {
    name: 'Racket',
    description: 'Racket Scheme (simulated)',
  },
};
