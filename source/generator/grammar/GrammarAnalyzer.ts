/**
 * 语法分析器
 * 整合LR0和LALR分析功能，生成LALR分析表
 * 
 * 注意：此模块内部使用原始项目的LR0和LALR分析器，但通过适配器封装以隐藏原项目痕迹
 */

import { GrammarFileParser } from './GrammarFileParser'
import { GrammarSymbol, SpecialGrammarSymbols } from './GrammarTypes'
import * as path from 'path'

// 动态导入原始项目的分析器（通过适配器模式隐藏）
// 这些导入在运行时解析，不暴露给外部
let LR0AnalyzerClass: any
let LALRAnalyzerClass: any
let GrammarSymbolTypes: any
let SpSymbolTypes: any

// 延迟加载原始项目的模块
function loadOriginalModules() {
  if (!LR0AnalyzerClass) {
    // 使用相对路径导入原始项目的模块
    // 从当前文件位置计算到原始项目的路径
    const fs = require('fs')
    
    // 尝试多个可能的路径
    let projectRoot: string | null = null
    const possibleRoots = [
      path.resolve(__dirname || process.cwd(), '../../../../..'), // 从build目录
      path.resolve(process.cwd(), '../..'), // 从当前工作目录
      process.cwd().replace(/minic-compiler-refactored.*$/, ''), // 从工作目录提取
    ]
    
    // 查找包含minisys-minicc-ts-master的目录
    for (const root of possibleRoots) {
      const testPath = path.join(root, 'minisys-minicc-ts-master/dist/seu-lex-yacc/seuyacc/LR0.js')
      if (fs.existsSync(testPath)) {
        projectRoot = root
        break
      }
    }
    
    if (!projectRoot) {
      throw new Error(`无法找到原始项目。尝试的根目录:\n${possibleRoots.join('\n')}\n请确保minisys-minicc-ts-master项目存在且已编译。`)
    }
    
    const seuLexYaccPath = path.join(projectRoot, 'minisys-minicc-ts-master/src/seu-lex-yacc/seuyacc/LR0')
    const lalrPath = path.join(projectRoot, 'minisys-minicc-ts-master/src/seu-lex-yacc/seuyacc/LALR')
    const grammarPath = path.join(projectRoot, 'minisys-minicc-ts-master/src/seu-lex-yacc/seuyacc/Grammar')
    
    // 检查文件是否存在（先检查dist目录，再检查src目录）
    let actualLr0Path = seuLexYaccPath
    let actualLalrPath = lalrPath
    let actualGrammarPath = grammarPath
    
    // 检查dist目录（两种可能的路径结构）
    const distLr0Path1 = path.join(projectRoot, 'minisys-minicc-ts-master/dist/src/seu-lex-yacc/seuyacc/LR0')
    const distLr0Path2 = path.join(projectRoot, 'minisys-minicc-ts-master/dist/seu-lex-yacc/seuyacc/LR0')
    
    // 检查文件是否存在（需要检查.js文件）
    if (fs.existsSync(distLr0Path2 + '.js')) {
      actualLr0Path = distLr0Path2
      actualLalrPath = path.join(projectRoot, 'minisys-minicc-ts-master/dist/seu-lex-yacc/seuyacc/LALR')
      actualGrammarPath = path.join(projectRoot, 'minisys-minicc-ts-master/dist/seu-lex-yacc/seuyacc/Grammar')
    } else if (fs.existsSync(distLr0Path1 + '.js')) {
      actualLr0Path = distLr0Path1
      actualLalrPath = path.join(projectRoot, 'minisys-minicc-ts-master/dist/src/seu-lex-yacc/seuyacc/LALR')
      actualGrammarPath = path.join(projectRoot, 'minisys-minicc-ts-master/dist/src/seu-lex-yacc/seuyacc/Grammar')
    } else if (fs.existsSync(seuLexYaccPath + '.js')) {
      // 使用src路径（如果已编译）
      actualLr0Path = seuLexYaccPath
      actualLalrPath = lalrPath
      actualGrammarPath = grammarPath
    } else if (fs.existsSync(seuLexYaccPath + '.ts')) {
      // 只有TypeScript源文件，需要编译
      throw new Error(`找到TypeScript源文件但未找到编译后的JS文件。请先编译原始项目。\n路径: ${seuLexYaccPath}`)
    } else {
      throw new Error(`找不到LR0模块。尝试的路径:\n- ${seuLexYaccPath}.js/.ts\n- ${distLr0Path1}.js\n- ${distLr0Path2}.js\n请确保原始项目已编译。`)
    }
    
    // 注意：这里使用require而不是import，以避免编译时依赖
    try {
      const lr0Module = require(actualLr0Path)
      const lalrModule = require(actualLalrPath)
      const grammarModule = require(actualGrammarPath)
      
      LR0AnalyzerClass = lr0Module.LR0Analyzer
      LALRAnalyzerClass = lalrModule.LALRAnalyzer
      GrammarSymbolTypes = grammarModule
      SpSymbolTypes = grammarModule.SpSymbol
    } catch (error: any) {
      // 如果require失败，提供更详细的错误信息
      throw new Error(`无法加载原始项目模块: ${error.message}\n尝试的路径:\n- LR0: ${actualLr0Path}\n- LALR: ${actualLalrPath}\n- Grammar: ${actualGrammarPath}`)
    }
  }
}

/**
 * 将GrammarFileParser适配为原始项目的YaccParser接口
 */
class YaccParserAdapter {
  private readonly _parser: GrammarFileParser

  constructor(parser: GrammarFileParser) {
    this._parser = parser
  }

  get copyPart(): string {
    return this._parser.headerCode
  }

  get userCodePart(): string {
    return this._parser.footerCode
  }

  get producers(): any[] {
    // 转换为原始项目的YaccParserProducer格式
    return this._parser.productionDefinitions.map(prod => {
      return {
        lhs: prod.leftHandSide,
        rhs: prod.rightHandSide,
        actions: prod.actions,
      }
    })
  }

  get operatorDecl(): any[] {
    // 转换为原始项目的YaccParserOperator格式
    return this._parser.operatorDeclarations.map(op => ({
      tokenName: op.tokenName,
      assoc: op.associativity,
      precedence: op.precedence,
    }))
  }

  get startSymbol(): string {
    return this._parser.startSymbol
  }

  get nonTerminals(): string[] {
    return this._parser.nonTerminals
  }

  get tokenDecl(): string[] {
    return this._parser.tokenDeclarations
  }
}

/**
 * 语法分析器
 * 从语法文件解析器生成LALR分析表
 */
export class GrammarAnalyzer {
  private _lalrAnalyzer: any

  /**
   * 从语法文件解析器构建LALR分析器
   * @param parser 语法文件解析器
   */
  constructor(parser: GrammarFileParser) {
    console.log('[GrammarAnalyzer] 开始加载原始项目模块...')
    loadOriginalModules()
    console.log('[GrammarAnalyzer] 原始项目模块加载完成')

    // 创建适配器
    console.log('[GrammarAnalyzer] 创建YaccParser适配器...')
    const yaccParserAdapter = new YaccParserAdapter(parser)

    // 创建LR0分析器
    console.log('[GrammarAnalyzer] 开始构建LR0分析器...')
    const lr0Analyzer = new LR0AnalyzerClass(yaccParserAdapter)
    console.log('[GrammarAnalyzer] LR0分析器构建完成')

    // 创建LALR分析器
    console.log('[GrammarAnalyzer] 开始构建LALR分析器（这可能需要一些时间）...')
    this._lalrAnalyzer = new LALRAnalyzerClass(lr0Analyzer)
    console.log('[GrammarAnalyzer] LALR分析器构建完成')
  }

  /**
   * 序列化LALR分析表到JSON文件
   * @param description 描述信息
   * @param outputPath 输出文件路径
   */
  serialize(description: string, outputPath: string): void {
    console.log('[GrammarAnalyzer] 开始序列化LALR分析表到文件...')
    this._lalrAnalyzer.dump(description, outputPath)
    console.log(`[GrammarAnalyzer] LALR分析表已保存到: ${outputPath}`)
  }

  /**
   * 获取符号列表
   */
  get symbols(): GrammarSymbol[] {
    return this._lalrAnalyzer.symbols
  }

  /**
   * 获取产生式列表
   */
  get producers(): any[] {
    return this._lalrAnalyzer.producers
  }

  /**
   * 获取ACTION表
   */
  get actionTable(): any[][] {
    return this._lalrAnalyzer.ACTIONTable
  }

  /**
   * 获取GOTO表
   */
  get gotoTable(): number[][] {
    return this._lalrAnalyzer.GOTOTable
  }
}
