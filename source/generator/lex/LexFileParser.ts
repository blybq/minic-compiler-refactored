/**
 * 词法定义文件（.l）解析器
 * 解析.l文件，提取正则表达式规则和对应的动作代码
 */

import * as fs from 'fs'
import { requireCondition } from '../../core/utils'

/**
 * 词法规则动作
 */
export interface LexRuleAction {
  order: number // 优先级顺序
  code: string // 动作代码
}

/**
 * 词法定义文件解析器
 */
export class LexFileParser {
  private readonly _filePath: string
  private readonly _rawContent: string
  private _lines: string[] = []
  
  // .l文件的四个部分
  private _headerCode: string = '' // %{ %}之间的代码
  private _aliasDefinitions: string = '' // 正则别名定义部分
  private _ruleDefinitions: string = '' // 规则-动作部分
  private _footerCode: string = '' // %%之后的代码
  
  // 解析结果
  private _aliases: { [key: string]: string } = {} // 别名 -> 正则表达式
  private _rules: Map<string, LexRuleAction> = new Map() // 正则表达式 -> 动作

  get headerCode(): string {
    return this._headerCode
  }

  get footerCode(): string {
    return this._footerCode
  }

  get aliases(): { [key: string]: string } {
    return this._aliases
  }

  get rules(): Map<string, LexRuleAction> {
    return this._rules
  }

  constructor(filePath: string) {
    this._filePath = filePath
    this._rawContent = fs.readFileSync(this._filePath, 'utf-8').replace(/\r\n/g, '\n')
    this._parseFileStructure()
    this._parseAliases()
    this._parseRules()
  }

  /**
   * 解析文件结构，分离四个部分
   */
  private _parseFileStructure(): void {
    this._lines = this._rawContent.split('\n')
    
    let headerStart = -1
    let headerEnd = -1
    const sectionMarkers: number[] = []
    
    // 查找分界符
    this._lines.forEach((line, index) => {
      const trimmed = line.trimRight()
      switch (trimmed) {
        case '%{':
          requireCondition(headerStart === -1, '词法文件结构错误：发现重复的 %{')
          headerStart = index
          break
        case '%}':
          requireCondition(headerEnd === -1, '词法文件结构错误：发现重复的 %}')
          headerEnd = index
          break
        case '%%':
          requireCondition(sectionMarkers.length < 2, '词法文件结构错误：发现重复的 %%')
          sectionMarkers.push(index)
          break
      }
    })
    
    requireCondition(headerStart !== -1, '词法文件结构错误：未找到 %{')
    requireCondition(headerEnd !== -1, '词法文件结构错误：未找到 %}')
    requireCondition(sectionMarkers.length === 2, '词法文件结构错误：未找到足够的 %% 标记')
    
    // 提取四个部分
    this._footerCode = this._lines.slice(sectionMarkers[1] + 1).join('\n')
    this._headerCode = this._lines.slice(headerStart + 1, headerEnd).join('\n')
    this._ruleDefinitions = this._lines.slice(sectionMarkers[0] + 1, sectionMarkers[1]).join('\n')
    this._aliasDefinitions =
      this._lines.slice(0, headerStart).join('\n') +
      this._lines.slice(headerEnd + 1, sectionMarkers[0]).join('\n')
  }

  /**
   * 解析正则表达式别名定义
   */
  private _parseAliases(): void {
    this._aliasDefinitions.split('\n').forEach(line => {
      const trimmed = line.trim()
      if (trimmed === '') return
      
      const spaceMatch = /\s+/.exec(trimmed)
      requireCondition(spaceMatch !== null, `无效的别名定义行：${line}`)
      
      const alias = trimmed.substring(0, spaceMatch.index)
      requireCondition(
        (spaceMatch.index as number) < trimmed.length - 1,
        `无效的别名定义行：${line}`
      )
      
      const regex = trimmed.substring(spaceMatch.index as number).trimLeft()
      requireCondition(
        !(alias in this._aliases),
        `别名重复定义：${alias}`
      )
      
      this._aliases[alias] = regex
    })
  }

  /**
   * 解析规则和动作部分
   */
  private _parseRules(): void {
    let currentRegex = ''
    let currentAction = ''
    let regexList: string[] = []
    
    let readingRegex = true
    let waitingOr = false
    let inQuotes = false
    let escaped = false
    let inBrackets = false
    let braceDepth = 0
    let actionOrder = 0
    
    const chars = this._ruleDefinitions.split('')
    
    for (let i = 0; i < chars.length; i++) {
      const char = chars[i]
      
      if (readingRegex) {
        // 正在读取正则表达式
        if (waitingOr) {
          // 等待或运算符
          if (char.trim()) {
            waitingOr = false
            if (char !== '|') {
              readingRegex = false
            }
          }
        } else {
          // 读取正则表达式内容
          if (!inQuotes && !inBrackets && !char.trim() && currentRegex !== '') {
            // 正则表达式读取完毕，展开别名
            const expandedRegex = this._expandAliases(currentRegex)
            requireCondition(
              !this._rules.has(expandedRegex),
              `正则表达式重复定义：${expandedRegex}`
            )
            regexList.push(expandedRegex)
            currentRegex = ''
            escaped = false
            inQuotes = false
            inBrackets = false
            waitingOr = true
          } else {
            currentRegex += char.trim() ? char : currentRegex === '' ? '' : ' '
            if (char === '\\') {
              escaped = !escaped
            } else {
              if (char === '"' && !escaped && !inBrackets) {
                inQuotes = !inQuotes
              } else if (char === '[' && !escaped && !inQuotes) {
                inBrackets = true
              } else if (char === ']' && !escaped && inBrackets) {
                inBrackets = false
              }
              escaped = false
            }
          }
        }
      }
      
      // 读取动作代码
      if (!readingRegex) {
        currentAction += char.trim() ? char : ' '
        
        if (
          (!inQuotes && braceDepth === 0 && char === ';') ||
          (!inQuotes && char === '}' && braceDepth === 1)
        ) {
          // 动作读取完毕
          const normalizedAction = this._normalizeAction(currentAction.trim())
          
          regexList.forEach(regex => {
            this._rules.set(regex, {
              order: actionOrder++,
              code: normalizedAction,
            })
          })
          
          regexList = []
          escaped = false
          inQuotes = false
          inBrackets = false
          braceDepth = 0
          currentAction = ''
          readingRegex = true
        } else {
          if (char === '\\') {
            escaped = !escaped
          } else {
            if (!escaped && (char === "'" || char === '"')) {
              inQuotes = !inQuotes
            } else if (!inQuotes && char === '{') {
              braceDepth += 1
            } else if (!inQuotes && char === '}') {
              braceDepth = Math.max(0, braceDepth - 1)
            }
            escaped = false
          }
        }
      }
    }
  }

  /**
   * 展开正则表达式中的别名引用
   */
  private _expandAliases(regex: string): string {
    let result = regex
    let pos = 0
    let inQuotes = false
    let escaped = false
    let inBrackets = false
    
    while (pos < result.length) {
      const char = result[pos]
      
      if (!inQuotes && !escaped && !inBrackets && char === '{') {
        // 找到可能的别名开始
        let endPos = pos + 1
        let alias = ''
        
        while (endPos < result.length && result[endPos] !== '}') {
          alias += result[endPos]
          endPos++
        }
        
        if (endPos < result.length && alias in this._aliases) {
          // 找到别名，展开它
          result =
            result.substring(0, pos) +
            '(' +
            this._aliases[alias] +
            ')' +
            result.substring(endPos + 1)
          pos -= 1
        } else {
          pos = endPos
        }
      } else {
        if (char === '\\') {
          escaped = !escaped
        } else {
          if (char === '"' && !escaped && !inBrackets) {
            inQuotes = !inQuotes
          } else if (char === '[' && !escaped && !inQuotes) {
            inBrackets = true
          } else if (char === ']' && !escaped && inBrackets) {
            inBrackets = false
          }
          escaped = false
        }
        pos++
      }
    }
    
    return result
  }

  /**
   * 规范化动作代码
   */
  private _normalizeAction(action: string): string {
    if (action === ';') {
      return '' // 单独分号表示空动作
    }
    if (action[0] === '{' && action[action.length - 1] === '}') {
      return action.substring(1, action.length - 1).trim()
    }
    return action.trim()
  }
}
