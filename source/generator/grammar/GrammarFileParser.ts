/**
 * 语法定义文件（.y）解析器
 * 解析.y文件，提取语法规则、token声明、运算符优先级等
 */

import * as fs from 'fs'
import { requireCondition, processEscapeSequences, BLOCK_PRODUCTION_PATTERN, INITIAL_PRODUCTION_PATTERN, CONTINUED_PRODUCTION_PATTERN } from '../../core/utils'
import { ProductionDefinition, OperatorDefinition } from './GrammarTypes'

/**
 * 语法定义文件解析器
 */
export class GrammarFileParser {
  private readonly _filePath: string
  private readonly _rawContent: string
  private _lines: string[] = []

  // .y文件的四个部分
  private _headerCode: string = '' // %{ %}之间的代码
  private _declarations: string = '' // 各种%xxx声明
  private _productions: string = '' // 产生式部分
  private _footerCode: string = '' // %%之后的代码

  // 解析结果
  private _tokenDeclarations: string[] = [] // 定义的Token
  private _operatorDeclarations: OperatorDefinition[] = [] // 定义的运算符
  private _productionDefinitions: ProductionDefinition[] = [] // 定义的产生式
  private _nonTerminals: string[] = [] // 非终结符列表
  private _startSymbol: string = '' // 开始符号

  get headerCode(): string {
    return this._headerCode
  }

  get footerCode(): string {
    return this._footerCode
  }

  get tokenDeclarations(): string[] {
    return this._tokenDeclarations
  }

  get operatorDeclarations(): OperatorDefinition[] {
    return this._operatorDeclarations
  }

  get productionDefinitions(): ProductionDefinition[] {
    return this._productionDefinitions
  }

  get nonTerminals(): string[] {
    return this._nonTerminals
  }

  get startSymbol(): string {
    return this._startSymbol
  }

  constructor(filePath: string) {
    this._filePath = filePath
    this._rawContent = fs.readFileSync(this._filePath, 'utf-8').replace(/\r\n/g, '\n')
    this._parseFileStructure()
    this._parseProductions()
    this._parseDeclarations()
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
          requireCondition(headerStart === -1, '语法文件结构错误：发现重复的 %{')
          headerStart = index
          break
        case '%}':
          requireCondition(headerEnd === -1, '语法文件结构错误：发现重复的 %}')
          headerEnd = index
          break
        case '%%':
          requireCondition(sectionMarkers.length < 2, '语法文件结构错误：发现重复的 %%')
          sectionMarkers.push(index)
          break
      }
    })

    requireCondition(headerStart !== -1, '语法文件结构错误：未找到 %{')
    requireCondition(headerEnd !== -1, '语法文件结构错误：未找到 %}')
    requireCondition(sectionMarkers.length === 2, '语法文件结构错误：未找到足够的 %% 标记')

    // 提取四个部分
    this._footerCode = this._lines.slice(sectionMarkers[1] + 1).join('\n')
    this._headerCode = this._lines.slice(headerStart + 1, headerEnd).join('\n')
    this._productions = this._lines.slice(sectionMarkers[0] + 1, sectionMarkers[1]).join('\n')
    this._declarations =
      this._lines.slice(0, headerStart).join('\n') +
      this._lines.slice(headerEnd + 1, sectionMarkers[0]).join('\n')
  }

  /**
   * 解析产生式部分
   */
  private _parseProductions(): void {
    let match: RegExpExecArray | null
    const blockPattern = new RegExp(BLOCK_PRODUCTION_PATTERN)

    while ((match = blockPattern.exec(this._productions)) !== null) {
      const block = match[0]
      let leftHandSide: string
      const rightHandSides: string[] = []
      const actions: string[] = []

      // 解析第一个产生式
      const initialMatch = new RegExp(INITIAL_PRODUCTION_PATTERN).exec(block) as RegExpExecArray
      leftHandSide = initialMatch[1]
      this._nonTerminals.push(leftHandSide)
      rightHandSides.push(initialMatch[3])
      actions.push(initialMatch[4] ? initialMatch[4].substring(1, initialMatch[4].length - 1).trim() : '')

      // 解析后续的产生式（使用|分隔的）
      const continuedPattern = new RegExp(CONTINUED_PRODUCTION_PATTERN)
      let continuedMatch: RegExpExecArray | null
      while ((continuedMatch = continuedPattern.exec(block)) !== null) {
        rightHandSides.push(continuedMatch[2])
        actions.push(continuedMatch[3] ? continuedMatch[3].substring(1, continuedMatch[3].length - 1).trim() : '')
      }

      leftHandSide = leftHandSide.trim()
      const trimmedRightHandSides = rightHandSides.map(rhs => rhs.trim())

      this._productionDefinitions.push(
        new ProductionDefinition(leftHandSide, trimmedRightHandSides, actions)
      )
    }
  }

  /**
   * 解析声明部分（%token, %left, %right, %start等）
   */
  private _parseDeclarations(): void {
    let currentPrecedence = 0

    this._declarations.split('\n').forEach(line => {
      const trimmed = line.trim()
      if (trimmed === '') return

      const words = trimmed.split(/\s+/)
      const declarationType = words[0]

      switch (declarationType) {
        case '%token':
          // 解析token声明
          for (let i = 1; i < words.length; i++) {
            const token = words[i]
            if (!this._tokenDeclarations.includes(token)) {
              this._tokenDeclarations.push(token)
            }
          }
          break

        case '%left':
        case '%right':
          // 解析运算符声明
          currentPrecedence += 1
          const associativity = declarationType.substring(1) as 'left' | 'right'
          for (let i = 1; i < words.length; i++) {
            let tokenName = words[i]
            // 处理引号包围的字符（如 '+'）
            if (tokenName[0] === "'") {
              requireCondition(
                tokenName[tokenName.length - 1] === "'",
                `引号未闭合：${tokenName}`
              )
              tokenName = processEscapeSequences(tokenName.substring(1, tokenName.length - 1))
            }
            requireCondition(
              !this._operatorDeclarations.some(op => op.tokenName === tokenName),
              `运算符重复定义：${tokenName}`
            )
            this._operatorDeclarations.push({
              tokenName,
              associativity,
              precedence: currentPrecedence,
            })
          }
          break

        case '%start':
          // 解析开始符号声明
          for (let i = 1; i < words.length; i++) {
            const symbol = words[i]
            requireCondition(
              !this._startSymbol.trim(),
              `开始符号重复定义：${symbol}`
            )
            requireCondition(
              this._nonTerminals.includes(symbol),
              `未知的开始符号：${symbol}`
            )
            this._startSymbol = symbol
          }
          break

        default:
          requireCondition(false, `未知的声明类型：${declarationType}`)
      }
    })

    requireCondition(this._startSymbol.trim() !== '', '开始符号未定义')
  }
}
