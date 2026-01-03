/**
 * 正则表达式接口定义
 * 用于 NondeterministicAutomaton.buildFromRegex 方法
 */

/**
 * 正则表达式接口
 * 提供后缀形式的正则表达式字符串
 */
export interface RegexInterface {
  /**
   * 原始正则表达式字符串
   */
  readonly raw: string

  /**
   * 后缀形式的正则表达式字符串
   */
  readonly postFix: string
}

