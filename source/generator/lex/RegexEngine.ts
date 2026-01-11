/**
 * 正则表达式处理引擎
 * 将正则表达式转换为后缀形式，用于构建NFA
 */

import {
  PRINTABLE_ASCII_MIN,
  PRINTABLE_ASCII_MAX,
  SUPPORTED_ESCAPE_SEQUENCES,
  QUOTED_STRING_PATTERN,
  RANGE_DEFINITION_PATTERN,
  ESCAPE_TO_CHAR,
  charInString,
  valueInRanges,
  getAllMatchRanges,
  requireCondition,
  splitStringKeepDelimiters,
} from '../../core/utils'

/**
 * 正则表达式处理结果
 */
export interface ProcessedRegex {
  original: string // 原始正则表达式
  escapeExpanded: string // 转义展开后
  rangeExpanded: string // 范围展开后
  segments: string[] // 隐式加点后的片段
  postfix: string // 后缀表达式
}

/**
 * 正则表达式处理引擎
 */
export class RegexEngine {
  private readonly _original: string
  private _escapeExpanded: string = ''
  private _rangeExpanded: string = ''
  private _segments: string[] = []
  private _postfix: string = ''

  get original(): string {
    return this._original
  }

  get escapeExpanded(): string {
    return this._escapeExpanded
  }

  get rangeExpanded(): string {
    return this._rangeExpanded
  }

  get segments(): string[] {
    return this._segments
  }

  get postfix(): string {
    return this._postfix
  }

  get result(): ProcessedRegex {
    return {
      original: this._original,
      escapeExpanded: this._escapeExpanded,
      rangeExpanded: this._rangeExpanded,
      segments: this._segments,
      postfix: this._postfix,
    }
  }

  constructor(regex: string) {
    this._original = regex
    this._expandEscapeSequences()
    this._expandCharacterRanges()
    this._addImplicitConcatenation()
    this._convertToPostfix()
  }

  /**
   * 展开转义序列（如\d -> [0-9]）
   */
  private _expandEscapeSequences(): void {
    const quoteRanges = getAllMatchRanges(QUOTED_STRING_PATTERN, this._original)
    const rangeRanges = getAllMatchRanges(RANGE_DEFINITION_PATTERN, this._original)

    const shouldSkip = (index: number): boolean => {
      return valueInRanges(quoteRanges, index) || valueInRanges(rangeRanges, index)
    }

    this._escapeExpanded = this._original

    for (let i = 0; i < this._escapeExpanded.length - 1; i++) {
      if (shouldSkip(i)) continue

      if (this._escapeExpanded[i] === '\\' && this._escapeExpanded[i + 1] !== '\\') {
        // 计算前面的反斜杠数量（用于判断是否是转义）
        let backslashCount = 0
        for (let j = i; j >= 0; j--) {
          if (this._escapeExpanded[j] === '\\') {
            backslashCount++
          } else {
            break
          }
        }

        // 奇数个反斜杠表示转义
        if (backslashCount % 2 !== 0) {
          const escapeChar = this._escapeExpanded[i + 1]
          requireCondition(
            charInString(escapeChar, SUPPORTED_ESCAPE_SEQUENCES),
            `不支持的转义字符：${escapeChar}`
          )

          if (charInString(escapeChar, 'ds')) {
            let expanded: string
            switch (escapeChar) {
              case 'd':
                expanded = '[0-9]'
                break
              case 's':
                expanded = '[" "\\t\\r\\n]'
                break
              default:
                expanded = ''
            }
            this._escapeExpanded =
              this._escapeExpanded.substring(0, i) +
              expanded +
              this._escapeExpanded.substring(i + 2)
          }
        }
      }
    }
  }

  /**
   * 展开字符范围（如[0-9] -> (0|1|2|...|9)）
   */
  private _expandCharacterRanges(): void {
    const quoteRanges = getAllMatchRanges(QUOTED_STRING_PATTERN, this._escapeExpanded)
    const rangeRanges = getAllMatchRanges(RANGE_DEFINITION_PATTERN, this._escapeExpanded)

    const shouldSkip = (index: number): boolean => {
      return valueInRanges(quoteRanges, index) && !valueInRanges(rangeRanges, index)
    }

    const bracketRanges = getAllMatchRanges(RANGE_DEFINITION_PATTERN, this._escapeExpanded)

    // 检查范围是否重叠
    const axis = Array(this._escapeExpanded.length).fill(0)
    bracketRanges.forEach(range => {
      for (let i = range[0]; i <= range[1]; i++) {
        requireCondition(axis[i] <= 0, '字符范围定义重叠')
        if (axis[i] === 0) axis[i] = 1
      }
    })

    // 展开每个范围
    const replacements: string[] = []
    bracketRanges.forEach(range => {
      let content = this._escapeExpanded.substring(range[0] + 1, range[1])

      if (shouldSkip(range[0]) || shouldSkip(range[1])) {
        replacements.push(`[${content}]`)
        return
      }

      // 处理取反 [^...]
      let isNegated = false
      if (content[0] === '^') {
        isNegated = true
        content = content.substring(1)
      }

      // 处理范围对（如 a-z）
      const rangePairPattern = /\S-\S/g
      const rangePairs: [string, string][] = []
      const expanded: string[] = []

      content = content.replace(rangePairPattern, pair => {
        rangePairs.push([pair[0], pair[2]])
        return ''
      })

      // 展开范围对
      rangePairs.forEach(([left, right]) => {
        requireCondition(
          left.charCodeAt(0) <= right.charCodeAt(0),
          `范围定义错误：左边界大于右边界`
        )
        const charCount = right.charCodeAt(0) - left.charCodeAt(0) + 1
        for (let i = 0; i < charCount; i++) {
          expanded.push(String.fromCharCode(left.charCodeAt(0) + i))
        }
      })

      // 处理剩余的转义字符
      let foundEscape = true
      while (foundEscape) {
        foundEscape = false
        for (let i = 0; i < content.length - 1; i++) {
          if (content[i] === '\\') {
            expanded.push('\\' + content[i + 1])
            content = content.substring(0, i) + content.substring(i + 2)
            foundEscape = true
            break
          }
        }
      }

      // 处理空格
      if (content.includes('" "')) {
        content = content.replace(/" "/g, '')
        expanded.push(' ')
      }

      // 添加剩余字符
      expanded.push(...content.split(''))

      // 去重
      const uniqueExpanded = [...new Set(expanded)]

      // 处理取反
      if (isNegated) {
        const negated: string[] = []
        for (let ascii = PRINTABLE_ASCII_MIN; ascii <= PRINTABLE_ASCII_MAX; ascii++) {
          const char = String.fromCharCode(ascii)
          if (!uniqueExpanded.includes(char) && charInString(char, `\\[]*?+()|".`)) {
            negated.push(`\\${char}`)
          } else {
            if (!uniqueExpanded.includes(`\\${char}`) && charInString(char, 'trn')) {
              negated.push(`\\${char}`)
            }
            if (!uniqueExpanded.includes(char)) {
              negated.push(char)
            }
          }
        }
        replacements.push(`(${negated.join('|')})`)
      } else {
        replacements.push(`(${uniqueExpanded.join('|')})`)
      }
    })

    // 替换原字符串中的范围定义
    let replacementIndex = 0
    this._rangeExpanded = this._escapeExpanded.replace(RANGE_DEFINITION_PATTERN, () => {
      return replacements[replacementIndex++]
    })
  }

  /**
   * 添加隐式连接符（加点处理）
   */
  private _addImplicitConcatenation(): void {
    const result: string[] = []
    let currentPart = ''
    let inQuotes = false

    const quoteRanges = getAllMatchRanges(QUOTED_STRING_PATTERN, this._rangeExpanded)

    for (let i = 0; i < this._rangeExpanded.length; i++) {
      const char = this._rangeExpanded[i]
      const nextChar = i === this._rangeExpanded.length - 1 ? null : this._rangeExpanded[i + 1]

      // 检查是否在引号内
      if (quoteRanges.some(range => i === range[1]) && inQuotes) {
        inQuotes = false
        result.push(`"${currentPart}"`)
        currentPart = ''
      } else if (valueInRanges(quoteRanges, i)) {
        if (!inQuotes) inQuotes = true
        else currentPart += char
      } else {
        // 非引号内的一般情况
        currentPart += char

        // 计算前面的反斜杠数量
        let backslashCount = 0
        for (let j = i - 1; j >= 0; j--) {
          if (this._rangeExpanded[j] === '\\') {
            backslashCount++
          } else {
            break
          }
        }

        // 判断是否需要添加连接符
        const shouldNotAddDot =
          (char === '\\' && backslashCount % 2 === 0) ||
          i === this._rangeExpanded.length - 1 ||
          (charInString(char, '|(') && (i === 0 || backslashCount % 2 === 0)) ||
          (nextChar !== null && charInString(nextChar, '|)*+?]'))

        if (!shouldNotAddDot) {
          result.push(currentPart)
          currentPart = ''
        }
      }
    }

    if (currentPart) result.push(currentPart)
    this._segments = result
  }

  /**
   * 转换为后缀表达式
   */
  private _convertToPostfix(): void {
    const result: string[] = []
    const stack: string[] = []
    const parts: string[] = []

    // 处理引号内容
    for (let i = 0; i < this._segments.length; i++) {
      const segment = this._segments[i]
      if (segment.match(/".+"/)) {
        // 引号中的内容
        for (let j = 1; j < segment.length - 1; j++) {
          const char = segment[j]
          if (charInString(char, '?*+.()|[]\\')) {
            parts.push('\\', char, '[dot]')
          } else if (char.trim() === '') {
            parts.push(...Array(char.length).fill('[ws]'), '[dot]')
          } else {
            parts.push(char, '[dot]')
          }
        }
      } else {
        parts.push(...segment.split(''), '[dot]')
      }
    }

    // 移除最后一个多余的[dot]
    parts.splice(parts.length - 1, 1)
    const normalizedParts = parts.map(v => (v.trim().length === 0 ? '[ws]' : v))

    let waitingEscape = false

    for (let i = 0; i < normalizedParts.length; i++) {
      const part = normalizedParts[i].trim()

      if (waitingEscape) {
        result.push(part[0])
        waitingEscape = false
        continue
      }

      if (part.length === 0) {
        continue
      } else if (part[0] === '|') {
        while (stack.length && charInString(stack[stack.length - 1], '.*')) {
          result.push(stack.pop()!)
        }
        stack.push('|')
      } else if (part === '[dot]') {
        while (stack.length && stack[stack.length - 1] === '[dot]') {
          result.push(stack.pop()!)
        }
        stack.push('[dot]')
      } else if (part[0] === '*') {
        result.push('*')
      } else if (part[0] === '+') {
        result.push('+')
      } else if (part[0] === '?') {
        result.push('?')
      } else if (part[0] === '(') {
        stack.push('(')
      } else if (part[0] === ')') {
        while (stack.length && !charInString(stack[stack.length - 1], '(')) {
          result.push(stack.pop()!)
        }
        stack.pop()
      } else if (part[0] === '\\') {
        result.push(part[0])
        waitingEscape = true
      } else {
        result.push(part)
      }
    }

    // 处理栈中剩余元素
    while (stack.length) {
      result.push(stack.pop()!)
    }

    this._postfix = result.join(' ')
  }
}
