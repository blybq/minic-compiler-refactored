/**
 * 中间代码生成器：从语法树生成中间代码（四元式）
 */

import { SyntaxTreeNode } from '../intermediate/SyntaxTreeNode'
import { InstructionQuad } from './InstructionQuad'
import { IntermediateVariable } from './IntermediateVariable'
import { IntermediateArray } from './IntermediateArray'
import { IntermediateFunction } from './IntermediateFunction'
import { DataType } from './DataTypes'
import { BasicBlock } from './BasicBlock'
import { requireCondition, CompilerError } from '../core/utils'

export const GLOBAL_SCOPE_PATH = [0] // 0号作用域是全局作用域
export const LABEL_PREFIX = '_label_'
export const VARIABLE_PREFIX = '_var_'

/**
 * 后置检查接口
 */
interface PostCheck {
  checker: () => boolean
  hint: string
}

/**
 * 循环上下文（用于break和continue）
 */
interface LoopContext {
  loopLabel: string
  breakLabel: string
}

/**
 * 函数调用上下文
 */
interface FunctionCallContext {
  scopePath: number[]
  functionName: string
}

/**
 * 函数执行上下文
 */
interface FunctionExecutionContext {
  entryLabel: string
  exitLabel: string
  functionName: string
}

/**
 * 中间代码生成器
 */
export class IntermediateCodeGenerator {
  private _functionPool: IntermediateFunction[] // 所有函数
  private _instructionList: InstructionQuad[] // 所有四元式
  private _variablePool: (IntermediateVariable | IntermediateArray)[] // 所有变量
  private _variableCounter: number // 变量计数
  private _labelCounter: number // 标号计数
  private _scopeCounter: number // 作用域计数
  private _scopePath: number[] // 当前作用域路径
  private _loopStack: LoopContext[] // break、continue辅助栈
  private _postChecks: PostCheck[] // 后置检查
  private _callsInScope: FunctionCallContext[] // 各个作用域下进行的函数调用
  private _basicBlocks!: BasicBlock[] // 经过基本块划分的四元式

  get functionPool(): IntermediateFunction[] {
    return this._functionPool
  }

  get instructionList(): InstructionQuad[] {
    return this._instructionList
  }

  get variablePool(): (IntermediateVariable | IntermediateArray)[] {
    return this._variablePool
  }

  get basicBlocks(): BasicBlock[] {
    return this._basicBlocks
  }

  constructor(root: SyntaxTreeNode) {
    this._scopePath = GLOBAL_SCOPE_PATH
    this._variablePool = []
    this._functionPool = []
    this._instructionList = []
    this._variableCounter = 0
    this._labelCounter = 0
    this._scopeCounter = 0
    this._loopStack = []
    this._postChecks = []
    this._callsInScope = []

    // 开始遍历
    this.processProgram(root)

    // 添加内置函数__asm
    this.enterScope()
    this._functionPool.push(
      new IntermediateFunction(
        '__asm',
        'void',
        [new IntermediateVariable(this.allocateVariableId(), 'asm', 'string', this._scopePath, true)],
        this.allocateLabel('__asm_entry'),
        this.allocateLabel('__asm_exit'),
        this._scopePath,
        true
      )
    )
    this.exitScope()

    // 后置检查与处理
    this.performPostProcessing1()
    this.performPostCheck()
    this.performPostProcessing2()
    this.generateBasicBlocks()
  }

  /**
   * 分配一个新的变量ID
   */
  private allocateVariableId(): string {
    return VARIABLE_PREFIX + this._variableCounter++
  }

  /**
   * 分配一个新的标号
   */
  private allocateLabel(description: string = ''): string {
    return LABEL_PREFIX + this._labelCounter++ + '_' + description
  }

  /**
   * 新增一条四元式并将其返回
   */
  private createInstruction(operation: string, operand1: string, operand2: string, result: string): InstructionQuad {
    const instruction = new InstructionQuad(operation, operand1, operand2, result)
    this._instructionList.push(instruction)
    return instruction
  }

  /**
   * 新增一个变量
   */
  private addVariable(variable: IntermediateVariable | IntermediateArray): void {
    this._variablePool.push(variable)
  }

  /**
   * 进一层作用域
   */
  private enterScope(): void {
    this._scopePath.push(++this._scopeCounter)
  }

  /**
   * 退出当前作用域
   */
  private exitScope(): number | undefined {
    return this._scopePath.pop()
  }

  /**
   * 判断两个作用域是否相同
   */
  static areScopesEqual(scope1: number[], scope2: number[]): boolean {
    return scope1.join('/') === scope2.join('/')
  }

  /**
   * 判断作用域包含关系
   */
  static isScopeContained(bigScope: number[], smallScope: number[]): boolean {
    if (bigScope.length > smallScope.length) return false
    for (let i = 0; i < bigScope.length; i++) {
      if (smallScope[i] !== bigScope[i]) return false
    }
    return true
  }

  /**
   * 结合当前所在的作用域寻找最近的名字相符的变量
   */
  private findVariable(variableName: string): IntermediateVariable | IntermediateArray | null {
    const validScopes: number[][] = []
    const currentScope = [...this._scopePath]
    while (currentScope.length > 0) {
      validScopes.push([...currentScope])
      currentScope.pop()
    }
    // validScopes由近及远
    for (const scope of validScopes) {
      for (const variable of this._variablePool) {
        const varName = variable instanceof IntermediateVariable ? variable.variableName : variable.arrayName
        if (varName === variableName && IntermediateCodeGenerator.areScopesEqual(variable.scopePath, scope)) {
          return variable
        }
      }
    }
    return null
  }

  /**
   * 检查变量是否重复
   */
  private isVariableDuplicate(v1: IntermediateVariable | IntermediateArray, v2: IntermediateVariable | IntermediateArray): boolean {
    const name1 = v1 instanceof IntermediateVariable ? v1.variableName : v1.arrayName
    const name2 = v2 instanceof IntermediateVariable ? v2.variableName : v2.arrayName
    return name1 === name2 && v1.scopePath.join('/') === v2.scopePath.join('/')
  }

  /**
   * 处理程序根节点
   */
  private processProgram(node: SyntaxTreeNode): void {
    requireCondition(node !== null, 'AST根节点为null')
    requireCondition(node !== undefined, 'AST根节点为undefined')
    requireCondition(node.childNodes.length > 0, `AST根节点没有子节点，节点名称：${node.nodeName}，子节点数量：${node.childNodes.length}`)
    const child1 = node.getChild(1)
    requireCondition(child1 !== undefined && child1 !== null, `AST根节点的第一个子节点为null或undefined，节点名称：${node.nodeName}，子节点数量：${node.childNodes.length}`)
    this.processDeclarationList(child1)
  }

  /**
   * 处理声明列表
   */
  private processDeclarationList(node: SyntaxTreeNode): void {
    if (node.getChild(1).nodeName === 'decl_list') {
      this.processDeclarationList(node.getChild(1))
      this.processDeclaration(node.getChild(2))
    }
    if (node.getChild(1).nodeName === 'decl') {
      this.processDeclaration(node.getChild(1))
    }
  }

  /**
   * 处理声明
   */
  private processDeclaration(node: SyntaxTreeNode): void {
    if (node.getChild(1).nodeName === 'var_decl') {
      this.processVariableDeclaration(node.getChild(1))
    }
    if (node.getChild(1).nodeName === 'fun_decl') {
      this.processFunctionDeclaration(node.getChild(1))
    }
  }

  /**
   * 处理变量声明
   */
  private processVariableDeclaration(node: SyntaxTreeNode): void {
    // 全局变量声明：type_spec IDENTIFIER
    if (node.matchesSequence('type_spec IDENTIFIER')) {
      const type = this.processTypeSpecifier(node.getChild(1))
      const name = node.getChild(2).literalValue
      requireCondition(type !== 'void', `不可以声明void型变量：${name}`)
      this._scopePath = GLOBAL_SCOPE_PATH
      requireCondition(
        !this._variablePool.some(v => {
          const varName = v instanceof IntermediateVariable ? v.variableName : v.arrayName
          return IntermediateCodeGenerator.areScopesEqual(v.scopePath, GLOBAL_SCOPE_PATH) && varName === name
        }),
        `全局变量重复声明：${name}`
      )
      this.addVariable(new IntermediateVariable(this.allocateVariableId(), name, type, this._scopePath, false))
    }
    // 全局数组声明：type_spec IDENTIFIER CONSTANT
    if (node.matchesSequence('type_spec IDENTIFIER CONSTANT')) {
      const type = this.processTypeSpecifier(node.getChild(1))
      const name = node.getChild(2).literalValue
      const len = Number(node.getChild(3).literalValue)
      this._scopePath = GLOBAL_SCOPE_PATH
      requireCondition(
        !isNaN(len) && len > 0 && Math.floor(len) === len,
        `数组长度必须为正整数字面量，但取到 ${node.getChild(3).literalValue}`
      )
      this.addVariable(new IntermediateArray(this.allocateVariableId(), type, name, len, this._scopePath))
    }
  }

  /**
   * 处理类型说明符
   */
  private processTypeSpecifier(node: SyntaxTreeNode): DataType {
    // 取类型字面值
    requireCondition(node !== null && node !== undefined, 'processTypeSpecifier: type_spec节点为null或undefined')
    requireCondition(node.nodeName === 'type_spec', `processTypeSpecifier: 节点不是type_spec，实际是：${node.nodeName}`)
    requireCondition(node.childNodes.length > 0, `processTypeSpecifier: type_spec节点没有子节点，节点名：${node.nodeName}，子节点数：${node.childNodes.length}`)
    const typeToken = node.getChild(1)
    requireCondition(typeToken !== null && typeToken !== undefined, 'processTypeSpecifier: type_spec的子节点为null或undefined')
    requireCondition(typeToken.nodeName === 'INT' || typeToken.nodeName === 'VOID' || typeToken.nodeName === 'STRING', `processTypeSpecifier: 类型token不是INT/VOID/STRING，实际是：${typeToken.nodeName}`)
    return typeToken.literalValue as DataType
  }

  /**
   * 处理函数声明
   */
  private processFunctionDeclaration(node: SyntaxTreeNode): void {
    // 规定所有的函数都在全局作用域
    const retType = this.processTypeSpecifier(node.getChild(1))
    const funcName = node.getChild(2).literalValue
    requireCondition(!this._functionPool.some(v => v.functionName === funcName), `函数重复定义：${funcName}`)
    
    // 检查是否为中断函数（interruptServer0-4）
    const isInterruptFunction = /^interruptServer[0-4]$/.test(funcName)
    if (isInterruptFunction) {
      requireCondition(retType === 'void', `中断函数 ${funcName} 必须返回 void`)
      // 中断函数必须没有参数或参数列表为void
      const paramsNode = node.getChild(3)
      requireCondition(
        paramsNode.getChild(1).nodeName === 'VOID',
        `中断函数 ${funcName} 必须没有参数（参数列表必须为void）`
      )
    }
    
    // 参数列表在processParameters时会填上
    const entryLabel = this.allocateLabel(funcName + '_entry')
    const exitLabel = this.allocateLabel(funcName + '_exit')
    // 进一层作用域
    this.enterScope()
    // 添加新函数
    this._functionPool.push(new IntermediateFunction(funcName, retType, [], entryLabel, exitLabel, [...this._scopePath], false, isInterruptFunction))
    this.createInstruction('set_label', '', '', entryLabel) // 函数入口
    // 解析函数参数
    this.processParameters(node.getChild(3), funcName)
    // 解析函数体
    if (node.childNodes.length === 5) {
      this.processLocalDeclarations(node.getChild(4))
      this.processStatementList(node.getChild(5), { entryLabel, exitLabel, functionName: funcName })
    } else if (node.childNodes.length === 4) {
      // 没有局部变量
      this.processStatementList(node.getChild(4), { entryLabel, exitLabel, functionName: funcName })
    }
    // 对于void函数，如果没有显式的return语句，需要在函数结束前生成return_void
    const func = this._functionPool.find(v => v.functionName === funcName)!
    if (retType === 'void' && !func.hasReturnStatement) {
      this.createInstruction('return_void', '', '', exitLabel)
    }
    this.createInstruction('set_label', '', '', exitLabel) // 函数出口
    // 退一层作用域
    this.exitScope()
  }

  /**
   * 处理参数列表
   */
  private processParameters(node: SyntaxTreeNode, funcName: string): void {
    if (node.getChild(1).nodeName === 'VOID') {
      this._functionPool.find(v => v.functionName === funcName)!.parameterList = []
    }
    if (node.getChild(1).nodeName === 'param_list') {
      this.processParameterList(node.getChild(1), funcName)
    }
  }

  /**
   * 处理参数列表（递归）
   */
  private processParameterList(node: SyntaxTreeNode, funcName: string): void {
    if (node.getChild(1).nodeName === 'param_list') {
      // 左递归文法加上这里的递归顺序使得参数列表保序
      this.processParameterList(node.getChild(1), funcName)
      this.processParameter(node.getChild(2), funcName)
    }
    if (node.getChild(1).nodeName === 'param') {
      this.processParameter(node.getChild(1), funcName)
    }
  }

  /**
   * 处理单个参数
   */
  private processParameter(node: SyntaxTreeNode, funcName: string): void {
    // 调试信息：打印节点结构
    const childNames = node.childNodes.map((child, idx) => `${idx + 1}:${child.nodeName}`).join(', ')
    
    requireCondition(node.childNodes.length >= 2, `参数节点子节点数量不足：${node.childNodes.length}（${childNames}），函数：${funcName}`)
    
    // 获取type_spec节点（第1个子节点）
    const typeSpecNode = node.getChild(1)
    requireCondition(typeSpecNode && typeSpecNode.childNodes.length > 0, `type_spec节点无效，函数：${funcName}，type_spec子节点数：${typeSpecNode ? typeSpecNode.childNodes.length : 0}`)
    
    const type = this.processTypeSpecifier(typeSpecNode)
    requireCondition(type !== 'void', '不可以用void作参数类型。函数：' + funcName)
    
    // 获取IDENTIFIER节点（第2个子节点）
    const identifierNode = node.getChild(2)
    requireCondition(identifierNode && identifierNode.nodeName === 'IDENTIFIER', `参数名必须是IDENTIFIER，函数：${funcName}，实际节点：${identifierNode ? identifierNode.nodeName : 'null'}`)
    requireCondition(identifierNode.literalValue !== undefined && identifierNode.literalValue !== null, `参数名不能为空，函数：${funcName}`)
    const name = identifierNode.literalValue
    
    // 检查是否为数组参数（param节点有3个子节点：type_spec, IDENTIFIER, CONSTANT）
    // 根据MiniC.y: param: type_spec IDENTIFIER LBRACKET CONSTANT RBRACKET { $$ = newNode('param', $1, $2, $4); }
    if (node.childNodes.length === 3) {
      // 数组参数：第3个子节点应该是CONSTANT（数组大小）
      const arraySizeNode = node.getChild(3)
      requireCondition(arraySizeNode && arraySizeNode.nodeName === 'CONSTANT', `数组参数大小必须是常量：${name}，实际节点：${arraySizeNode ? arraySizeNode.nodeName : 'null'}`)
      const arraySize = parseInt(arraySizeNode.literalValue)
      requireCondition(!isNaN(arraySize) && arraySize > 0, `数组参数大小必须为正整数：${name}`)
      const array = new IntermediateArray(this.allocateVariableId(), type, name, arraySize, this._scopePath)
      this.addVariable(array)
      // 将数组参数添加到函数参数列表
      this._functionPool.find(v => v.functionName === funcName)!.parameterList.push(array)
    } else if (node.childNodes.length === 2) {
      // 普通参数：type_spec IDENTIFIER（只有2个子节点）
      const variable = new IntermediateVariable(this.allocateVariableId(), name, type, this._scopePath, true)
      this.addVariable(variable)
      // 将形参送给函数
      this._functionPool.find(v => v.functionName === funcName)!.parameterList.push(variable)
    } else {
      requireCondition(false, `参数节点子节点数量异常：${node.childNodes.length}（${childNames}），函数：${funcName}`)
    }
  }

  /**
   * 处理局部声明列表
   */
  private processLocalDeclarations(node: SyntaxTreeNode): void {
    if (node.getChild(1).nodeName === 'local_decls') {
      this.processLocalDeclarations(node.getChild(1))
      this.processLocalDeclaration(node.getChild(2))
    }
    if (node.getChild(1).nodeName === 'local_decl') {
      this.processLocalDeclaration(node.getChild(1))
    }
  }

  /**
   * 处理局部声明
   */
  private processLocalDeclaration(node: SyntaxTreeNode): void {
    if (node.childNodes.length === 2) {
      // 单个变量声明
      const type = this.processTypeSpecifier(node.getChild(1))
      const name = node.getChild(2).literalValue
      const variable = new IntermediateVariable(this.allocateVariableId(), name, type, this._scopePath, false)
      requireCondition(
        !this._variablePool.some(v => this.isVariableDuplicate(v, variable)),
        '局部变量重复声明：' + name
      )
      this.addVariable(variable)
    }
    if (node.childNodes.length === 3) {
      // 数组声明
      requireCondition(false, `数组只能声明在全局作用域，而 ${node.getChild(2).literalValue} 不符合。`)
    }
  }

  /**
   * 处理语句列表
   */
  private processStatementList(node: SyntaxTreeNode, context?: FunctionExecutionContext): void {
    if (node.getChild(1).nodeName === 'stmt_list') {
      this.processStatementList(node.getChild(1), context)
      this.processStatement(node.getChild(2), context)
    }
    if (node.getChild(1).nodeName === 'stmt') {
      this.processStatement(node.getChild(1), context)
    }
  }

  /**
   * 处理语句
   */
  private processStatement(node: SyntaxTreeNode, context?: FunctionExecutionContext): void {
    if (node.getChild(1).nodeName === 'expr_stmt') {
      this.processExpressionStatement(node.getChild(1))
    }
    if (node.getChild(1).nodeName === 'compound_stmt') {
      this.processCompoundStatement(node.getChild(1), context)
    }
    if (node.getChild(1).nodeName === 'if_stmt') {
      this.processIfStatement(node.getChild(1), context)
    }
    if (node.getChild(1).nodeName === 'while_stmt') {
      this.processWhileStatement(node.getChild(1), context)
    }
    if (node.getChild(1).nodeName === 'return_stmt') {
      this.processReturnStatement(node.getChild(1), context)
    }
    if (node.getChild(1).nodeName === 'continue_stmt') {
      this.processContinueStatement(node.getChild(1))
    }
    if (node.getChild(1).nodeName === 'break_stmt') {
      this.processBreakStatement(node.getChild(1))
    }
  }

  /**
   * 处理复合语句
   */
  private processCompoundStatement(node: SyntaxTreeNode, context?: FunctionExecutionContext): void {
    this.enterScope()
    if (node.childNodes.length === 2) {
      this.processLocalDeclarations(node.getChild(1))
      this.processStatementList(node.getChild(2), context)
    } else if (node.childNodes.length === 1) {
      // 没有局部变量
      this.processStatementList(node.getChild(1), context)
    }
    this.exitScope()
  }

  /**
   * 处理if语句
   */
  private processIfStatement(node: SyntaxTreeNode, context?: FunctionExecutionContext): void {
    const expr = this.processExpression(node.getChild(1))
    const trueLabel = this.allocateLabel('true') // if 分支入口标号
    const falseLabel = this.allocateLabel('false') // else 分支入口标号（或 if 语句结束）
    const endLabel = this.allocateLabel('end') // if-else 语句结束标号
    
    this.createInstruction('set_label', '', '', trueLabel)
    this.createInstruction('j_false', expr, '', falseLabel) // 条件为假时跳转到 else 或结束
    
    // 处理 if 分支
    this.processStatement(node.getChild(2), context)
    
    // 如果有 else 分支（3个子节点：expr, if_stmt, else_stmt）
    if (node.childNodes.length === 3) {
      this.createInstruction('j', '', '', endLabel) // if 分支执行完后跳转到结束
      this.createInstruction('set_label', '', '', falseLabel)
      this.processStatement(node.getChild(3), context) // 处理 else 分支
      this.createInstruction('set_label', '', '', endLabel)
    } else {
      // 没有 else 分支，falseLabel 就是结束标签
      this.createInstruction('set_label', '', '', falseLabel)
    }
  }

  /**
   * 处理while语句
   */
  private processWhileStatement(node: SyntaxTreeNode, context?: FunctionExecutionContext): void {
    const loopLabel = this.allocateLabel('loop') // 入口标号
    const breakLabel = this.allocateLabel('break') // 出口标号
    this._loopStack.push({ loopLabel, breakLabel })
    this.createInstruction('set_label', '', '', loopLabel)
    const expr = this.processExpression(node.getChild(1))
    this.createInstruction('j_false', expr, '', breakLabel)
    this.processStatement(node.getChild(2), context)
    this.createInstruction('j', '', '', loopLabel)
    this.createInstruction('set_label', '', '', breakLabel)
    this._loopStack.pop()
  }

  /**
   * 处理continue语句
   */
  private processContinueStatement(node: SyntaxTreeNode): void {
    requireCondition(this._loopStack.length > 0, '产生continue时没有足够的上下文')
    this.createInstruction('j', '', '', this._loopStack[this._loopStack.length - 1].loopLabel)
  }

  /**
   * 处理break语句
   */
  private processBreakStatement(node: SyntaxTreeNode): void {
    requireCondition(this._loopStack.length > 0, '产生break时没有足够的上下文')
    this.createInstruction('j', '', '', this._loopStack[this._loopStack.length - 1].breakLabel)
  }

  /**
   * 处理return语句
   */
  private processReturnStatement(node: SyntaxTreeNode, context?: FunctionExecutionContext): void {
    requireCondition(context !== undefined, 'return语句需要函数上下文')
    this._functionPool.find(v => v.functionName === context!.functionName)!.hasReturnStatement = true
    // return;
    if (node.childNodes.length === 0) {
      this._postChecks.push({
        checker: (funcName => () => this._functionPool.find(v => v.functionName === funcName)!.returnType === 'void')(
          context!.functionName
        ),
        hint: `函数 ${context!.functionName} 没有返回值`,
      })
      this.createInstruction('return_void', '', '', context!.exitLabel)
    }
    // return expr;
    if (node.childNodes.length === 1) {
      this._postChecks.push({
        checker: (funcName => () => this._functionPool.find(v => v.functionName === funcName)!.returnType !== 'void')(
          context!.functionName
        ),
        hint: `函数 ${context!.functionName} 声明返回值类型是 void，却有返回值`,
      })
      const expr = this.processExpression(node.getChild(1))
      this.createInstruction('return_expr', expr, '', context!.exitLabel)
    }
  }

  /**
   * 处理表达式语句
   */
  private processExpressionStatement(node: SyntaxTreeNode): void {
    // 变量赋值：IDENTIFIER ASSIGN expr
    if (node.matchesSequence('IDENTIFIER ASSIGN expr')) {
      const varName = node.getChild(1).literalValue
      const varOrArray = this.findVariable(varName)
      requireCondition(varOrArray !== null && varOrArray !== undefined, `变量未定义：${varName}`)
      requireCondition(varOrArray instanceof IntermediateVariable, `不能对数组进行赋值，必须使用数组元素赋值`)
      const variable = varOrArray as IntermediateVariable
      variable.isInitialized = true
      const rhs = this.processExpression(node.getChild(3))
      this.createInstruction('=var', rhs, '', variable.variableId)
    }
    // 数组赋值：IDENTIFIER expr ASSIGN expr
    if (node.matchesSequence('IDENTIFIER expr ASSIGN expr')) {
      const arrName = node.getChild(1).literalValue
      const varOrArray = this.findVariable(arrName)
      requireCondition(varOrArray !== null && varOrArray !== undefined, `数组未定义：${arrName}`)
      requireCondition(varOrArray instanceof IntermediateArray, `不是数组：${arrName}`)
      const arr = varOrArray as IntermediateArray
      const index = this.processExpression(node.getChild(2))
      const rhs = this.processExpression(node.getChild(4))
      this.createInstruction('=[]', index, rhs, arr.arrayId)
    }
    // 访地址：DOLLAR expr ASSIGN expr
    if (node.matchesSequence('DOLLAR expr ASSIGN expr')) {
      const addr = this.processExpression(node.getChild(2))
      const rhs = this.processExpression(node.getChild(4))
      this.createInstruction('=$', addr, rhs, '')
    }
    // 调函数（有参）：IDENTIFIER args
    if (node.matchesSequence('IDENTIFIER args')) {
      const args = this.processArguments(node.getChild(2))
      const funcName = node.getChild(1).literalValue
      requireCondition(funcName !== 'main', '禁止手动或递归调用main函数')

      this._postChecks.push({
        checker: (funcName => () => !!this._functionPool.find(v => v.functionName === funcName))(funcName),
        hint: `未声明就调用了函数 ${funcName}`,
      })
      this._postChecks.push({
        checker: ((args, funcName) => () => args.length === this._functionPool.find(v => v.functionName === funcName)!.parameterList.length)(
          args,
          funcName
        ),
        hint: `函数 ${funcName} 调用参数数量不匹配`,
      })
      this.createInstruction('call', funcName, args.join('&'), '')
      this._callsInScope.push({ scopePath: [...this._scopePath], functionName: funcName })
    }
    // 调函数（无参）：IDENTIFIER LPAREN RPAREN
    if (node.matchesSequence('IDENTIFIER LPAREN RPAREN')) {
      const funcName = node.getChild(1).literalValue
      requireCondition(funcName !== 'main', '禁止手动或递归调用main函数')
      this._postChecks.push({
        checker: (funcName => () => !!this._functionPool.find(v => v.functionName === funcName))(funcName),
        hint: `未声明就调用了函数 ${funcName}`,
      })
      this._postChecks.push({
        checker: (funcName => () => 0 === this._functionPool.find(v => v.functionName === funcName)!.parameterList.length)(funcName),
        hint: `函数 ${funcName} 调用参数数量不匹配`,
      })
      this.createInstruction('call', funcName, '', '')
      this._callsInScope.push({ scopePath: [...this._scopePath], functionName: funcName })
    }
  }

  /**
   * 处理表达式，返回指代表达式结果的变量ID
   */
  private processExpression(node: SyntaxTreeNode): string {
    // 处理特殊情况
    // 括号表达式：LPAREN expr RPAREN
    if (node.matchesSequence('LPAREN expr RPAREN')) {
      const operand = this.processExpression(node.getChild(2))
      const result = this.allocateVariableId()
      this.createInstruction('=var', operand, '', result)
      return result
    }
    // 访问变量：IDENTIFIER
    if (node.matchesSequence('IDENTIFIER')) {
      const varName = node.getChild(1).literalValue
      const varOrArray = this.findVariable(varName)
      requireCondition(varOrArray !== null && varOrArray !== undefined, `变量未定义：${varName}`)
      if (varOrArray instanceof IntermediateArray) {
        // 数组参数：直接返回数组ID（不需要访问元素）
        return varOrArray.arrayId
      } else {
        // 普通变量
        const variable = varOrArray as IntermediateVariable
        requireCondition(variable !== null && variable !== undefined, `变量未定义：${varName}`)
        requireCondition(variable.variableName !== undefined && variable.variableName !== null, `变量名未定义：${varName}，变量对象：${JSON.stringify({variableId: variable.variableId, variableName: variable.variableName, dataType: variable.dataType})}`)
        requireCondition(variable.isInitialized, `在初始化前使用了变量：${variable.variableName}`)
        return variable.variableId
      }
    }
    // 访问数组元素：IDENTIFIER expr
    if (node.matchesSequence('IDENTIFIER expr')) {
      const index = this.processExpression(node.getChild(2))
      const name = node.getChild(1).literalValue
      const varOrArray = this.findVariable(name)
      requireCondition(varOrArray !== null && varOrArray !== undefined, `变量未定义：${name}`)
      const arrayId = varOrArray instanceof IntermediateArray ? varOrArray.arrayId : (varOrArray as IntermediateVariable).variableId
      const result = this.allocateVariableId()
      this.createInstruction('[]', arrayId, index, result)
      return result
    }
    // 调用函数（有参）：IDENTIFIER args
    if (node.matchesSequence('IDENTIFIER args')) {
      const funcName = node.getChild(1).literalValue
      requireCondition(funcName !== 'main', '禁止手动或递归调用main函数')
      // 作为表达式的函数调用应该有返回值
      this._postChecks.push({
        checker: (funcName => () => this._functionPool.find(v => v.functionName === funcName)!.returnType !== 'void')(funcName),
        hint: `函数 ${funcName} 没有返回值，其调用不能作为表达式`,
      })
      const args = this.processArguments(node.getChild(2))
      const result = this.allocateVariableId()
      requireCondition(
        args.length === this._functionPool.find(v => v.functionName === funcName)!.parameterList.length,
        `函数 ${funcName} 调用参数数量不匹配`
      )
      this.createInstruction('call', funcName, args.join('&'), result)
      this._callsInScope.push({ scopePath: [...this._scopePath], functionName: funcName })
      return result
    }
    // 调用函数（无参）：IDENTIFIER LPAREN RPAREN
    if (node.matchesSequence('IDENTIFIER LPAREN RPAREN')) {
      const funcName = node.getChild(1).literalValue
      requireCondition(funcName !== 'main', '禁止手动或递归调用main函数')
      // 作为表达式的函数调用应该有返回值
      this._postChecks.push({
        checker: (funcName => () => this._functionPool.find(v => v.functionName === funcName)!.returnType !== 'void')(funcName),
        hint: `函数 ${funcName} 没有返回值，其调用不能作为表达式`,
      })
      const result = this.allocateVariableId()
      this.createInstruction('call', funcName, '', result)
      this._callsInScope.push({ scopePath: [...this._scopePath], functionName: funcName })
      return result
    }
    // 常量：CONSTANT
    if (node.matchesSequence('CONSTANT')) {
      const result = this.allocateVariableId()
      this.createInstruction('=const', node.getChild(1).literalValue, '', result)
      return result
    }
    // 字符串字面：STRING_LITERAL
    if (node.matchesSequence('STRING_LITERAL')) {
      const result = this.allocateVariableId()
      this.createInstruction('=string', node.getChild(1).literalValue, '', result)
      return result
    }
    // 处理所有二元表达式：expr op expr
    if (node.childNodes.length === 3 && node.getChild(1).nodeName === 'expr' && node.getChild(3).nodeName === 'expr') {
      // OR_OP, AND_OP, EQ_OP, NE_OP, GT_OP, LT_OP, GE_OP, LE_OP, PLUS, MINUS, MULTIPLY,
      // SLASH, PERCENT, BITAND_OP, BITOR_OP, LEFT_OP, RIGHT_OP
      const operand1 = this.processExpression(node.getChild(1))
      const operand2 = this.processExpression(node.getChild(3))
      const result = this.allocateVariableId()
      this.createInstruction(node.getChild(2).nodeName, operand1, operand2, result)
      return result
    }
    // 处理所有一元表达式：op expr
    if (node.childNodes.length === 2) {
      // NOT_OP, MINUS, PLUS, DOLLAR, BITINV_OP
      const operand = this.processExpression(node.getChild(2))
      const result = this.allocateVariableId()
      this.createInstruction(node.getChild(1).nodeName, operand, '', result)
      return result
    }
    requireCondition(false, 'processExpression兜底失败')
    return '-1'
  }

  /**
   * 处理函数参数列表，按参数顺序返回变量ID数组
   */
  private processArguments(node: SyntaxTreeNode): string[] {
    if (node.getChild(1).nodeName === 'args') {
      return [...this.processArguments(node.getChild(1)), this.processExpression(node.getChild(2))]
    }
    if (node.getChild(1).nodeName === 'expr') {
      return [this.processExpression(node.getChild(1))]
    }
    return []
  }

  /**
   * 后处理1：补充函数信息，供汇编生成使用
   */
  private performPostProcessing1(): void {
    for (const func of this._functionPool) {
      // 填充函数的局部变量
      func.localVariables.push(...this._variablePool.filter(v => IntermediateCodeGenerator.isScopeContained(func.scopePath, v.scopePath)))
      // 填充函数内部调用的其他函数
      func.childFunctions.push(
        ...new Set(
          this._callsInScope.filter(v => IntermediateCodeGenerator.isScopeContained(func.scopePath, v.scopePath)).map(x => x.functionName)
        )
      )
    }
  }

  /**
   * 后检查：语义检查
   */
  private performPostCheck(): void {
    for (const check of this._postChecks) {
      requireCondition(check.checker(), check.hint)
    }
    requireCondition(
      this._functionPool.some(v => v.functionName === 'main'),
      '程序没有 main 函数'
    )
    for (const func of this._functionPool) {
      // void函数可以不包含return语句
      // 非void函数必须有return语句（除非通过内联汇编自行处理了return）
      if (func.returnType !== 'void') {
        requireCondition(
          func.hasReturnStatement || func.childFunctions.includes('__asm'),
          `函数 ${func.functionName} 没有 return 语句`
        )
      }
    }
  }

  /**
   * 后处理2：折叠 __asm
   */
  private performPostProcessing2(): void {
    // 折叠 __asm
    // (=const, "str", , _var_0), (call, __asm, _var_0, ) --> (out_asm, "str", ,)
    for (let i = 0; i < this._instructionList.length; i++) {
      const instruction = this._instructionList[i]
      if (instruction.operation === 'call' && instruction.operand1 === '__asm') {
        requireCondition(i >= 1, '对 __asm 的调用出现在不正确的位置')
        const prev = this._instructionList[i - 1]
        requireCondition(instruction.operand2.split('&').length === 1, '__asm 只接受一个字符串字面参数')
        requireCondition(prev.operation === '=string' && prev.result === instruction.operand2, '未找到 __asm 的调用参数')
        requireCondition(prev.operand1.match(/^".*"$/), '__asm 只接受一个字符串字面参数')
        this._instructionList[i] = new InstructionQuad('out_asm', prev.operand1, '', '')
        // @ts-ignore
        this._instructionList[i - 1] = undefined
      }
    }
    this._instructionList = this._instructionList.filter(Boolean) as InstructionQuad[]
  }

  /**
   * 对四元式进行基本块划分（龙书算法8.5）
   */
  private generateBasicBlocks(): void {
    const leaders: number[] = [] // 首指令下标
    let nextIsLeader = false

    for (let i = 0; i < this._instructionList.length; i++) {
      if (i === 0) {
        // 中间代码的第一个四元式是一个首指令
        leaders.push(i)
        continue
      }
      if (this._instructionList[i].operation === 'set_label' && this._instructionList[i].result.includes('entry')) {
        leaders.push(i)
        continue
      }
      if (this._instructionList[i].operation === 'j' || this._instructionList[i].operation === 'j_false') {
        // 条件或无条件转移指令的目标指令是一个首指令
        const targetIndex = this._instructionList.findIndex(
          v => v.operation === 'set_label' && v.result === this._instructionList[i].result
        )
        if (targetIndex !== -1) {
          leaders.push(targetIndex)
        }
        nextIsLeader = true
        continue
      }
      if (nextIsLeader) {
        // 紧跟在一个条件或无条件转移指令之后的指令是一个首指令
        leaders.push(i)
        nextIsLeader = false
        continue
      }
    }

    const uniqueLeaders = [...new Set(leaders)].sort((a, b) => a - b)
    if (uniqueLeaders[uniqueLeaders.length - 1] !== this._instructionList.length) {
      uniqueLeaders.push(this._instructionList.length)
    }

    // 每个首指令左闭右开地划分了四元式
    const blocks: BasicBlock[] = []
    let blockId = 0
    for (let i = 0; i < uniqueLeaders.length - 1; i++) {
      blocks.push({
        blockId: blockId++,
        instructions: this._instructionList.slice(uniqueLeaders[i], uniqueLeaders[i + 1]),
      })
    }

    this._basicBlocks = blocks
  }

  /**
   * 将中间代码转换为字符串表示
   */
  toIntermediateCodeString(): string {
    let result = ''
    // 函数定义
    result += '[FUNCTIONS]\n'
    for (const func of this._functionPool) {
      result += '\tname: ' + func.functionName + '\n'
      result += '\tretType: ' + func.returnType + '\n'
      result += '\tparamList: ' + func.parameterList.map(v => `${v.variableId}(${v.dataType})`).join('; ') + '\n'
      result += '\n'
    }
    result += '\n'
    // 全局变量
    result += '[GLOBALVARS]\n'
    for (const v of this._variablePool.filter(x => IntermediateCodeGenerator.areScopesEqual(x.scopePath, GLOBAL_SCOPE_PATH))) {
      const typeStr = v instanceof IntermediateArray ? 'arr' : 'var'
      const varId = v instanceof IntermediateVariable ? v.variableId : v.arrayId
      result += '\t' + `${varId}(${v.dataType}, ${typeStr})` + '\n'
    }
    result += '\n'
    // 变量池
    result += '[VARPOOL]\n'
    for (const v of this._variablePool) {
      const typeStr = v instanceof IntermediateArray ? 'arr' : 'var'
      const varName = v instanceof IntermediateVariable ? v.variableName : v.arrayName
      const varId = v instanceof IntermediateVariable ? v.variableId : v.arrayId
      result += '\t' + `${varId}, ${varName}, ${v.dataType}, ${typeStr}, ${v.scopePath.join('/')}` + '\n'
    }
    result += '\n'
    // 四元式
    result += '[QUADS]\n'
    for (const instruction of this._instructionList) {
      result += '\t' + instruction.toString() + '\n'
    }
    result += '\n'
    return result
  }
}

