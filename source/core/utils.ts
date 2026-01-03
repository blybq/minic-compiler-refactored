/**
 * 核心工具函数模块
 */

export const PRINTABLE_ASCII_MIN = 32
export const PRINTABLE_ASCII_MAX = 126
export const SUPPORTED_ESCAPE_SEQUENCES = `dstrn\\[]*?+()|".`

// 词法分析使用的正则表达式模式
export const QUOTED_STRING_PATTERN = /(?=[^\\]|^)(\"[^\"]*[^\\]\")/g
export const RANGE_DEFINITION_PATTERN = /(?=[^\\]|^)\[(([^\[\]]+)[^\\])\]/g

// 语法分析使用的正则表达式模式
export const BLOCK_PRODUCTION_PATTERN = /(\w+)\s*\n\s+:(\s+(.+?)({[\s\S]*?})?\n)(\s+\|\s+(.+?)({[\s\S]*?})?\n)*\s+;/g
export const INITIAL_PRODUCTION_PATTERN = /(\w+)\n\s+:(\s+(.+?)({[\s\S]*?})?\n)/g
export const CONTINUED_PRODUCTION_PATTERN = /(\s+\|\s+(.+?)({[\s\S]*?})?\n)/g
export const PRODUCTION_END_PATTERN = /\s+;/g

// 转义字符映射表（从转义形式到实际字符）
export const ESCAPE_TO_CHAR: { [key: string]: string } = {
  '\\n': '\n',
  '\\t': '\t',
  '\\r': '\r',
  '\\(': '(',
  '\\)': ')',
  '\\[': '[',
  '\\]': ']',
  '\\+': '+',
  '\\-': '-',
  '\\*': '*',
  '\\?': '?',
  '\\"': '"',
  '\\.': '.',
  "\\'": "'",
  '\\|': '|',
  '\\\\': '\\',
}

// 转义字符映射表（从实际字符到转义形式）
export const CHAR_TO_ESCAPE: { [key: string]: string } = (function () {
  const result: { [key: string]: string } = {}
  const keys = Object.keys(ESCAPE_TO_CHAR)
  const values = Object.values(ESCAPE_TO_CHAR)
  for (let i = 0; i < values.length; i++) {
    result[values[i]] = keys[i]
  }
  return result
})()

// 特殊Token名称
export const WHITESPACE_TOKEN_NAME = '_WHITESPACE'
export const UNMATCHED_TOKEN_NAME = '_UNMATCH'
export const COMMENT_TOKEN_NAME = '_COMMENT'

export class CompilerError extends Error {}

/**
 * 断言函数，如果条件为假则抛出错误
 */
export function requireCondition(condition: unknown, message: string): void {
  if (!condition) throw new CompilerError(message)
}

/**
 * 直接输出到标准输出
 */
export function writeToStdout(content: string): void {
  process.stdout.write(content)
}

/**
 * 检查字符是否在字符串中
 */
export function charInString(ch: string, str: string): boolean {
  return str.indexOf(ch) !== -1
}

/**
 * 检查目标值是否在某个范围内
 * @param ranges 范围列表，每个范围是 [起始, 结束] 的闭区间
 */
export function valueInRanges(ranges: [number, number][], target: number): boolean {
  return ranges.some(range => target >= range[0] && target <= range[1])
}

/**
 * 获取正则表达式匹配的所有范围
 * @param regex 带全局标志的正则表达式
 * @param str 要匹配的字符串
 * @param resultGroup 结果组索引
 */
export function getAllMatchRanges(regex: RegExp, str: string, resultGroup = 0): [number, number][] {
  const ranges: [number, number][] = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(str)) !== null) {
    match = match as RegExpExecArray
    ranges.push([match.index, match.index + match[resultGroup].length - 1])
  }
  return ranges
}

/**
 * 使用分隔符分割字符串，但保留分隔符
 */
export function splitStringKeepDelimiters(str: string, delimiters: string): string[] {
  const result: string[] = []
  let currentPart = ''
  for (let i = 0; i < str.length; i++) {
    if (charInString(str[i], delimiters)) {
      if (currentPart) result.push(currentPart)
      currentPart = ''
      result.push(str[i])
    } else {
      currentPart += str[i]
    }
  }
  if (currentPart.length > 0) result.push(currentPart)
  return result
}

/**
 * 检查字符是否为英文字母
 */
export function isLetter(ch: string): boolean {
  return ch.length === 1 && !!ch.match(/[A-Za-z]/)
}

/**
 * 处理转义字符串，将转义序列转换为实际字符
 */
export function processEscapeSequences(str: string): string {
  let result = ''
  let escapeFlag = false
  for (const char of str) {
    if (escapeFlag) {
      const escapeSeq = '\\' + char
      result += ESCAPE_TO_CHAR.hasOwnProperty(escapeSeq) ? ESCAPE_TO_CHAR[escapeSeq] : escapeSeq
      escapeFlag = false
    } else if (char === '\\') {
      escapeFlag = true
    } else {
      result += char
    }
  }
  return result
}

