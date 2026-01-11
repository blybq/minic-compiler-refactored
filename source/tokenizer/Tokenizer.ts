/**
 * 词法分析器：使用DFA对源代码进行词法分析
 */

import { DeterministicAutomaton } from '../core/automata/DeterministicAutomaton'
import { SpecialSymbol } from '../core/automata/StateMachine'
import { requireCondition, COMMENT_TOKEN_NAME } from '../core/utils'
import { Token } from './Token'
import { ErrorCollector } from '../core/ErrorCollector'

/**
 * 使用DFA对源代码进行词法分析，返回Token序列
 * @param sourceCode 源代码字符串
 * @param dfa 确定有限状态自动机
 * @param errorCollector 错误收集器（可选）
 * @returns Token序列
 */
export function tokenizeSourceCode(
  sourceCode: string,
  dfa: DeterministicAutomaton,
  errorCollector?: ErrorCollector
): Token[] {
  requireCondition(
    dfa.initialStates.length === 1,
    'DFA必须有且仅有一个初始状态'
  )

  // 标准化源代码：统一换行符
  sourceCode = sourceCode.replace(/\r\n/g, '\n')

  // 词法分析使用的变量
  const initialState = dfa.stateList.indexOf(dfa.initialStates[0])
  let currentLineNumber = 1 // 当前行号
  let currentLineStartPosition = 0 // 当前行的起始位置（字符索引）
  let matchedText = '' // 当前匹配的文本
  let currentCharacter = '' // 当前字符
  let currentBuffer = '' // 当前匹配缓冲区
  let currentStateIndex = initialState // 当前状态索引
  let currentPosition = 0 // 当前源代码位置（字符索引）
  let lastAcceptStateIndex = -1 // 最近的接受状态索引
  let lastAcceptPosition = 0 // 最近的接受位置（字符索引）

  const tokens: Token[] = []

  // 生成状态转移矩阵
  // transitionMatrix[i][charCode]: 在状态i下读取字符charCode时转移到的状态索引
  const transitionMatrix = (function () {
    const matrix: number[][] = []
    for (let i = 0; i < dfa.transitionTable.length; i++) {
      const targets = new Array(128).fill(-1) // -1表示没有此转移
      let fallbackTarget = -1 // OTHER_CHAR或ANY_CHAR的目标状态

      for (const transition of dfa.transitionTable[i]) {
        if (transition.inputSymbol === SpecialSymbol.OTHER_CHAR || transition.inputSymbol === SpecialSymbol.ANY_CHAR) {
          fallbackTarget = transition.targetStateIndex
        } else if (transition.inputSymbol >= 0 && transition.inputSymbol < dfa.symbolSet.length) {
          // 普通字符
          const charCode = dfa.symbolSet[transition.inputSymbol].charCodeAt(0)
          if (charCode < 128) {
            targets[charCode] = transition.targetStateIndex
          }
        }
      }

      // 如果设置了fallback，填充未设置的字符
      if (fallbackTarget !== -1) {
        for (let j = 0; j < 128; j++) {
          if (targets[j] === -1) {
            targets[j] = fallbackTarget
          }
        }
      }

      matrix.push(targets)
    }
    return matrix
  })()

  // 生成接受状态标记列表
  // acceptStateFlags[i]: 如果状态i是接受状态，则值为true，否则为false
  const acceptStateFlags = (function () {
    const flags: boolean[] = []
    for (let i = 0; i < dfa.stateList.length; i++) {
      flags.push(dfa.acceptingStates.includes(dfa.stateList[i]))
    }
    return flags
  })()

  // 生成接受状态对应的Token名称映射（用于判断是否是注释状态）
  const acceptStateTokenNames = (function () {
    const tokenNames: (string | null)[] = []
    for (let i = 0; i < dfa.stateList.length; i++) {
      if (dfa.acceptingStates.includes(dfa.stateList[i])) {
        const action = dfa.acceptingStateActions.get(dfa.stateList[i])
        if (action) {
          const tokenName = action.code
            .replace(/\s+/g, '')
            .replace('return', '')
            .replace(';', '')
            .replace(/[\(\)]/g, '')
            .trim()
          tokenNames[i] = tokenName
        } else {
          tokenNames[i] = null
        }
      } else {
        tokenNames[i] = null
      }
    }
    return tokenNames
  })()

  // 从动作代码中提取Token名称
  function extractTokenName(actionCode: string): string {
    return actionCode
      .replace(/\s+/g, '')
      .replace('return', '')
      .replace(';', '')
      .replace(/[\(\)]/g, '')
      .trim()
  }

  // 判断当前状态是否是注释的接受状态
  function isCommentAcceptState(stateIndex: number): boolean {
    if (stateIndex < 0 || stateIndex >= acceptStateTokenNames.length) {
      return false
    }
    return acceptStateTokenNames[stateIndex] === COMMENT_TOKEN_NAME
  }

  // 词法分析主函数
  // 返回值：0表示到达源代码末尾，1表示还有更多字符
  function performTokenization(): number {
    let lineRollbackCount = 0
    if (currentPosition === sourceCode.length) {
      return 0 // 到达源代码末尾
    }

    // 重置状态
    lastAcceptStateIndex = -1
    lastAcceptPosition = 0
    currentBuffer = ''
    currentStateIndex = initialState

    // 状态转移循环
    while (currentStateIndex !== -1 && currentPosition < sourceCode.length) {
      // 读取下一个字符
      currentCharacter = sourceCode[currentPosition]
      currentBuffer += currentCharacter
      currentPosition += 1

      // 如果是换行符，增加行号
      if (currentCharacter === '\n') {
        currentLineNumber += 1
        currentLineStartPosition = currentPosition
        lineRollbackCount += 1
      }

      // 尝试状态转移
      const charCode = currentCharacter.charCodeAt(0)
      if (charCode < 128) {
        currentStateIndex = transitionMatrix[currentStateIndex][charCode]
      } else {
        // 超出ASCII范围
        // 检查是否在注释中（通过检查buffer是否以"//"开头）
        const isInComment = currentBuffer.startsWith('//')
        if (isInComment) {
          // 在注释中，允许非ASCII字符，保持当前状态不变（继续累积到buffer）
          // 不需要状态转移，继续循环
          // 如果当前状态是接受状态，记录它
          if (currentStateIndex !== -1 && acceptStateFlags[currentStateIndex]) {
            lastAcceptStateIndex = currentStateIndex
            lastAcceptPosition = currentPosition - 1
            lineRollbackCount = 0
          }
          // 继续循环，不进行状态转移
        } else {
          // 不在注释中，无法匹配
          currentStateIndex = -1
          break
        }
      }

      // 如果当前状态是接受状态，记录它（实现最长匹配）
      if (currentStateIndex !== -1 && acceptStateFlags[currentStateIndex]) {
        lastAcceptStateIndex = currentStateIndex
        lastAcceptPosition = currentPosition - 1
        lineRollbackCount = 0 // 重置行号回退计数
      }

      if (currentPosition >= sourceCode.length) {
        break
      }
    }

    // 处理接受状态
    if (lastAcceptStateIndex !== -1) {
      // 回退到最近的接受位置
      const rollbackLength = currentPosition - lastAcceptPosition - 1
      currentPosition = lastAcceptPosition + 1
      currentLineNumber -= lineRollbackCount
      currentBuffer = currentBuffer.substring(0, currentBuffer.length - rollbackLength)

      // 重置状态
      currentStateIndex = initialState
      matchedText = currentBuffer
      currentBuffer = ''

      // 获取Token名称
      const acceptState = dfa.stateList[lastAcceptStateIndex]
      const action = dfa.acceptingStateActions.get(acceptState)
      requireCondition(action !== undefined, `接受状态没有对应的动作代码`)
      const tokenName = extractTokenName(action!.code)

      // 计算Token的位置（在当前行中的位置，从1开始）
      // Token的起始位置：lastAcceptPosition - matchedText.length + 1
      // 由于行号已被回退（currentLineNumber -= lineRollbackCount），Token所在行就是currentLineNumber
      // 需要找到Token所在行的起始位置
      // 简化方法：从Token起始位置向前查找最近的换行符
      const tokenStartPos = lastAcceptPosition - matchedText.length + 1
      let tokenLineStart = 0
      for (let i = tokenStartPos - 1; i >= 0; i--) {
        if (sourceCode[i] === '\n') {
          tokenLineStart = i + 1
          break
        }
      }
      const tokenPosition = tokenStartPos - tokenLineStart + 1

      tokens.push({
        name: tokenName,
        literal: matchedText,
        lineNumber: currentLineNumber,
        position: tokenPosition > 0 ? tokenPosition : 1,
      })

      // 重置相关状态
      lastAcceptPosition = 0
      lastAcceptStateIndex = -1
    } else {
      // 无法匹配，检查是否是空白字符
      // currentCharacter 是导致无法匹配的字符，它已经被添加到 currentBuffer 中
      // currentPosition 已经指向下一个字符
      const isWhitespace = /^\s$/.test(currentCharacter)
      if (isWhitespace) {
        // 跳过空白字符：清除 buffer，重置状态，位置已经在下一个字符了
        currentBuffer = ''
        currentStateIndex = initialState
        // 如果已经到达源代码末尾，返回0
        if (currentPosition >= sourceCode.length) {
          return 0
        }
        return 1 // 继续处理下一个字符
      }
      // 非空白字符无法匹配
      // 需要回退到导致错误的字符位置
      const errorPosition = currentPosition - 1
      const errorChar = sourceCode[errorPosition]
      const charCode = errorChar.charCodeAt(0)
      
      // 检查是否是非ASCII字符（可能是中文等）
      if (charCode >= 128) {
        // 非ASCII字符，不在注释中，记录错误但跳过该字符
        if (errorCollector) {
          const positionInLine = errorPosition - currentLineStartPosition + 1
          errorCollector.addLexicalError(
            `无法识别的字符："${errorChar}"（非ASCII字符，charCode=${charCode}）`,
            currentLineNumber,
            positionInLine > 0 ? positionInLine : 1
          )
        }
        // 跳过该字符，继续处理下一个字符
        currentBuffer = ''
        currentStateIndex = initialState
        if (currentPosition >= sourceCode.length) {
          return 0
        }
        return 1 // 继续处理下一个字符
      } else {
        // ASCII范围内的无法识别字符
        if (errorCollector) {
          const positionInLine = errorPosition - currentLineStartPosition + 1
          errorCollector.addLexicalError(
            `无法识别的字符："${errorChar}"`,
            currentLineNumber,
            positionInLine > 0 ? positionInLine : 1
          )
        } else {
          // 如果没有错误收集器，使用原来的方式抛出错误
          requireCondition(
            false,
            `词法分析错误：无法识别的字符。行号=${currentLineNumber}，位置=${errorPosition + 1}，字符="${errorChar}"`
          )
        }
        // 跳过该字符，继续处理下一个字符
        currentBuffer = ''
        currentStateIndex = initialState
        if (currentPosition >= sourceCode.length) {
          return 0
        }
        return 1 // 继续处理下一个字符
      }
    }

    return 1 // 继续处理
  }

  // 执行词法分析
  while (performTokenization() === 1) {
    // 循环直到处理完所有字符
  }

  // 手动添加结束Token
  tokens.push({
    name: 'SP_END',
    literal: '',
    lineNumber: currentLineNumber,
    position: 0,
  })

  return tokens
}

