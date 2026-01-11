/**
 * 语法分析器：使用LALR分析表进行语法分析
 */

import { Token } from '../tokenizer/Token'
import { SyntaxTreeNode } from '../intermediate/SyntaxTreeNode'
import { SymbolStackEntry, createNonterminalNode } from './SymbolStackEntry'
import { ILALRAnalyzer } from '../core/grammar/LALRAnalyzerInterface'
import {
  COMMENT_TOKEN_NAME,
  UNMATCHED_TOKEN_NAME,
  WHITESPACE_TOKEN_NAME,
  requireCondition,
} from '../core/utils'

export const WHITESPACE_SYMBOL_ID = -10

/**
 * 分析表格子
 */
interface ParsingTableCell {
  action: 'nonterminal' | 'shift' | 'reduce' | 'acc' | 'default'
  target: number
}

/**
 * 使用LALR分析表对Token序列进行语法分析，返回语法树根节点
 * @param tokens Token序列
 * @param analyzer LALR分析器
 * @param errorCollector 错误收集器（可选）
 * @returns 语法树根节点，如果分析失败返回null
 */
export function parseTokenSequence(
  tokens: Token[],
  analyzer: ILALRAnalyzer,
  errorCollector?: any
): SyntaxTreeNode | null {
  // 预处理Token序列
  // 检查未匹配符号
  requireCondition(
    tokens.every(token => token.name !== UNMATCHED_TOKEN_NAME),
    `Token序列中存在未匹配的非法符号 ${JSON.stringify(
      tokens.filter(token => token.name === UNMATCHED_TOKEN_NAME).map(token => token.literal)
    )}`
  )

  // 移除注释（保留换行符用于行号统计）
  tokens = tokens.map(token => {
    if (token.name === COMMENT_TOKEN_NAME && token.literal.endsWith('\n')) {
      return { name: WHITESPACE_TOKEN_NAME, literal: '\n' }
    }
    return token
  })
  tokens = tokens.filter(token => token.name !== COMMENT_TOKEN_NAME)

  // 移除无用的空白符（保留换行符）
  tokens = tokens.filter(
    token => !(token.name === WHITESPACE_TOKEN_NAME && token.literal !== '\n')
  )

  let lineNumber = 1

  // 构建Token名称到符号索引的映射表
  const tokenIdMap = (function () {
    const map = new Map<string, number>()
    for (let i = 0; i < analyzer.symbols.length; i++) {
      const symbol = analyzer.symbols[i]
      if (symbol.type === 'sptoken' || symbol.type === 'token') {
        map.set(symbol.content, i)
      }
    }
    map.set(WHITESPACE_TOKEN_NAME, WHITESPACE_SYMBOL_ID)
    return map
  })()

  // 构建合并的分析表（ACTION和GOTO）
  // parsingTable[state][symbol]表示在state状态下遇到symbol时的动作
  // 注意：状态数量由ACTIONTable的行数决定
  const parsingTable = (function () {
    const table: ParsingTableCell[][] = []
    const stateCount = analyzer.ACTIONTable.length
    for (let state = 0; state < stateCount; state++) {
      let nonTerminalCount = 0
      let nonNonTerminalCount = 0 // 非非终结符计数（包括终结符和特殊符号）
      const row: ParsingTableCell[] = []

      for (let symbolIndex = 0; symbolIndex < analyzer.symbols.length; symbolIndex++) {
        const symbol = analyzer.symbols[symbolIndex]
        let action: string
        let target = 0

        if (symbol.type === 'nonterminal') {
          // 非终结符：查GOTO表
          action = 'nonterminal'
          target = analyzer.GOTOTable[state][nonTerminalCount++]
        } else {
          // 非非终结符（终结符或特殊符号）：查ACTION表
          // 注意：ACTION表的索引是按照非非终结符的顺序，而不是终结符的顺序
          const actionCell = analyzer.ACTIONTable[state]?.[nonNonTerminalCount]
          if (!actionCell) {
            // ACTION 表条目不存在，使用 default
            action = 'default'
          } else {
            switch (actionCell.type) {
              case 'shift':
                action = 'shift'
                target = actionCell.data
                break
              case 'reduce':
                action = 'reduce'
                target = actionCell.data
                break
              case 'acc':
                action = 'acc'
                break
              case 'none':
                // 'none' 类型表示错误（无法转移）
                action = 'default'
                break
              default:
                action = 'default'
            }
          }
          nonNonTerminalCount++
        }

        row.push({ action: action as any, target })
      }
      table.push(row)
    }
    return table
  })()

  // 符号栈和状态栈
  const symbolStack: SymbolStackEntry[] = []
  const stateStack: number[] = [analyzer.startStateId]

  let currentRightHandSideLength = 0
  let currentSymbol: SymbolStackEntry

  // 读取Token的索引（需要在processSymbol中使用，所以声明在这里）
  let currentTokenIndex = 0

  /**
   * 获取当前归约产生式右侧符号的属性值
   * @param index 符号在产生式右侧的序号（从1开始）
   */
  function getRightHandSideSymbol(index: number): SymbolStackEntry {
    requireCondition(
      index > 0 && index <= currentRightHandSideLength,
      `动作代码中存在错误的属性值引用：$${index}`
    )
    return symbolStack.slice(index - currentRightHandSideLength - 1)[0]
  }

  /**
   * 设置当前产生式左侧符号的属性值（即$$）
   */
  function setLeftHandSideValue(symbolName: string, node: SyntaxTreeNode): void {
    currentSymbol = {
      elementType: 'nonterminal',
      symbolName: symbolName,
      syntaxNode: node,
    }
  }

  /**
   * 处理当前状态遇到符号的情况
   * @param symbolIndex 符号索引
   * @returns 返回符号索引（移进或非终结符），产生式左部索引（归约），或-1（接受）
   */
  function processSymbol(symbolIndex: number): number {
    if (symbolIndex === WHITESPACE_SYMBOL_ID) {
      lineNumber++
      return symbolIndex
    }

    const currentState = stateStack[stateStack.length - 1]
    const cell = parsingTable[currentState]?.[symbolIndex]
    
    if (!cell) {
      requireCondition(
        false,
        `语法分析表访问错误：状态${currentState}下符号索引${symbolIndex}（${analyzer.symbols[symbolIndex]?.content}）不存在，推测行号为${lineNumber}`
      )
      return -1
    }

    switch (cell.action) {
      case 'shift':
        // 移进：将Token入栈
        const previousToken = tokens[currentTokenIndex - 1]
        symbolStack.push({
          elementType: 'token',
          symbolName: previousToken.name,
          syntaxNode: new SyntaxTreeNode(previousToken.name, 'token', previousToken.literal),
        })
        // 继续执行，没有break（原代码的设计）
      case 'nonterminal':
        // 非终结符：移进状态栈（shift后也会执行到这里）
        stateStack.push(cell.target)
        return symbolIndex

      case 'reduce':
        // 归约：执行语义动作，构建AST节点
        const production = analyzer.producers[cell.target]
        currentRightHandSideLength = production.rhs.length
        currentSymbol = symbolStack.slice(-currentRightHandSideLength)[0]

        // 准备语义动作执行的上下文
        const createNode = createNonterminalNode
        const newNode = createNonterminalNode // 别名，兼容原项目的语义动作代码
        const getDollar = getRightHandSideSymbol
        let $$: any

        // 执行语义动作代码
        const executeAction = () => {
          let actionCode = production.action
          // 将$1, $2等替换为getDollar(1), getDollar(2)等
          actionCode = actionCode.replace(/\$(\d+)/g, 'getDollar($1)')
          // 使用eval执行动作代码
          // 动作代码执行后，$$会被设置为结果对象（包含node属性）
          // eslint-disable-next-line no-eval
          eval(actionCode)
                    const lhsName = analyzer.getLeftHandSide(cell.target) + '_DOLLAR2'
                    // 注意：原项目使用$$.node，但我们的实现使用$$.syntaxNode
                    // 为了兼容，我们需要检查$$.node或$$.syntaxNode
                    const nodeValue = ($$ as any)?.node || ($$ as any)?.syntaxNode
                    setLeftHandSideValue(lhsName, nodeValue)
        }
        executeAction()

        // 弹出栈
        for (let i = 0; i < currentRightHandSideLength; i++) {
          stateStack.pop()
          symbolStack.pop()
        }
        symbolStack.push(currentSymbol)

        return production.lhs

      case 'acc':
        // 接受
        return -1

      default: {
        const symbolContent = analyzer.symbols[symbolIndex]?.content || 'unknown'
        const errorMsg = `语法分析表中存在未定义行为：在状态${currentState}下收到${symbolContent}时进行${cell.action}`
        if (errorCollector) {
          // 获取当前Token的行号信息
          const currentToken = tokens[currentTokenIndex - 1]
          const tokenLineNumber = currentToken ? currentToken.lineNumber : lineNumber
          const tokenPosition = currentToken ? currentToken.position : 0
          errorCollector.addSyntaxError(errorMsg, tokenLineNumber, tokenPosition)
          // 跳过当前符号，尝试继续分析
          return -1
        } else {
          requireCondition(false, `${errorMsg}，推测行号为${lineNumber}`)
          return -1
        }
      }
    }
  }

  /**
   * 读取下一个Token
   */
  function readNextToken(): Token | null {
    if (currentTokenIndex >= tokens.length) {
      return null
    }
    return tokens[currentTokenIndex++]
  }

  // 开始分析
  // 使用类似原项目的逻辑：在循环中读取token
  function _yylex(): Token | null {
    return readNextToken()
  }
  
  let token = (function() {
    const tok = _yylex()
    if (!tok) return null
    return tokenIdMap.get(tok.name)
  })()
  
  let iterationCount = 0
  const MAX_ITERATIONS = 10000 // 防止死循环
  
  // 使用 while (token) 来匹配原项目的逻辑
  // 注意：当token为0时，这个循环也会继续（因为0是falsy但我们需要处理它）
  // 但原项目使用while(token)，所以我们也使用它
  while (token !== undefined && token !== null) {
    iterationCount++
    requireCondition(iterationCount < MAX_ITERATIONS, `语法分析可能进入死循环，已执行${iterationCount}次迭代，当前token索引=${currentTokenIndex - 1}，总token数=${tokens.length}`)
    
    let result = processSymbol(token)
    let innerIterationCount = 0
    
    while (token !== result) {
      innerIterationCount++
      requireCondition(
        innerIterationCount < MAX_ITERATIONS,
        `语法分析内层循环可能进入死循环，已执行${innerIterationCount}次迭代，当前token=${token}(${analyzer.symbols[token]?.content})，result=${result}(${analyzer.symbols[result]?.content})，当前状态=${stateStack[stateStack.length - 1]}，符号栈长度=${symbolStack.length}`
      )
      
      if (result === -1) {
        // 接受
        requireCondition(symbolStack.length === 1, '接受时符号栈元素过多')
        return symbolStack[0].syntaxNode
      }
      
      // 先处理 result（可能是非终结符）
      // 如果 result 是非终结符索引，processSymbol 会查找 GOTO 表并返回 result 本身
      // 所以我们需要继续处理，直到 result 等于 token 或 -1
      result = processSymbol(result)
      
      // 如果 result 是 -1，说明接受，应该在上面的 if 中处理
      // 如果 result 等于 token，循环会退出
      // 如果 result 不等于 token 且不等于 -1，继续处理 token
      if (result !== token && result !== -1) {
        result = processSymbol(token)
      }
    }
    // 读取下一个token（类似原项目的逻辑）
    const nextTok = _yylex()
    if (!nextTok) {
      // 没有更多 token，检查是否已经接受
      // 如果符号栈只有一个元素且是开始符号，说明已经接受
      if (symbolStack.length === 1) {
        return symbolStack[0].syntaxNode
      }
      // 没有更多 token，但还没有接受，说明语法分析失败
      requireCondition(
        false,
        `语法分析失败：已处理完所有token但未到达接受状态，当前状态=${stateStack[stateStack.length - 1]}，符号栈长度=${symbolStack.length}，剩余token数=${tokens.length - currentTokenIndex}`
      )
    }
    token = tokenIdMap.get(nextTok.name)
    if (token === undefined) {
      // token 不在映射表中
      // 检查是否是 SP_END（SP_END 应该被映射，但如果未映射，说明有问题）
      if (nextTok.name === 'SP_END') {
        // SP_END 应该在映射表中，如果没有，说明构建映射表时有问题
        // 但是，如果确实没有，我们可以尝试直接使用符号索引
        const spEndIndex = analyzer.symbols.findIndex(s => s.content === 'SP_END')
        if (spEndIndex !== -1) {
          token = spEndIndex
        } else {
          requireCondition(false, `语法分析失败：SP_END token 未映射且符号表中不存在`)
        }
        } else {
          // 其他未映射的 token，报告错误
          const errorMsg = `语法分析失败：遇到未映射的token：${nextTok.name}，字面量：${nextTok.literal}`
          if (errorCollector) {
            errorCollector.addSyntaxError(errorMsg, nextTok.lineNumber, nextTok.position)
            // 跳过该token，继续分析
            token = undefined
            continue
          } else {
            requireCondition(false, errorMsg)
          }
        }
    }
  }

  // 如果循环正常退出，说明没有遇到接受状态
  const lastToken = currentTokenIndex > 0 ? tokens[currentTokenIndex - 1] : null
  const lastTokenName = lastToken ? lastToken.name : 'none'
  const errorMsg = `语法分析失败：循环正常退出但未到达接受状态，当前状态=${stateStack[stateStack.length - 1]}，符号栈长度=${symbolStack.length}，已处理token数=${currentTokenIndex}，总token数=${tokens.length}，最后一个token=${lastTokenName}`
  if (errorCollector) {
    const tokenLineNumber = lastToken ? lastToken.lineNumber : lineNumber
    const tokenPosition = lastToken ? lastToken.position : 0
    errorCollector.addSyntaxError(errorMsg, tokenLineNumber, tokenPosition)
    return null
  } else {
    requireCondition(false, errorMsg)
    return null
  }
}

