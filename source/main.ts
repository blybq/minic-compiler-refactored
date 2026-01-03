/**
 * MiniC编译器主入口文件
 * 用法: node main.js <path_to_c_code> [options]
 * 选项:
 *   -o <output_path>  指定输出路径
 *   -i                 一并输出中间代码
 *   -v                 显示编译过程详细信息
 */

import * as path from 'path'
import * as fs from 'fs'
import { requireCondition, CompilerError } from './core/utils'
import { tokenizeSourceCode } from './tokenizer/Tokenizer'
import { DeterministicAutomaton } from './core/automata/DeterministicAutomaton'
import { parseTokenSequence } from './syntax_analyzer/SyntaxAnalyzer'
import { loadLALRAnalyzer } from './core/grammar/LALRAnalyzerLoader'
import { IntermediateCodeGenerator } from './intermediate_code/IntermediateCodeGenerator'
import { AssemblyCodeGenerator } from './codegen/AssemblyCodeGenerator'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const args = require('minimist')(process.argv.slice(2))

// 检查参数
requireCondition(args._.length === 1, '[用法]: node main.js <path_to_c_code> [-o <output_path>] [-i] [-v]')

// 整理参数
const codePath = args._[0]
const outputPath = args.o || path.dirname(args._[0])
const outputName = path.basename(args._[0], path.extname(args._[0]))
const withIR = !!args.i
const verbose = !!args.v

// 输出函数
const print = (message: string) => {
  if (verbose) {
    console.log(message)
  }
}

try {
  const startTime = new Date().getTime()

  print('====================================')
  print('  ===== [minic-compiler-core] =====')
  print('====================================')
  print('')
  print('*** 基本信息 ***')
  print(`  源文件: ${codePath}`)
  print(`  输出路径: ${outputPath}`)
  print(`  输出IR: ${String(withIR)}`)
  print('')

  print('*** 开始前端处理... ***')

  // 读入C源码
  print('  读取源文件...')
  const rawCCode = fs.readFileSync(codePath, 'utf-8')
  requireCondition(rawCCode.trim().length > 0, '源文件为空!')
  print('  源文件读取完成。')

  // 预编译（处理include）
  print('  开始预编译...')
  const { processIncludeDirectives } = require('./preprocessing/IncludeProcessor')
  const processedCode = processIncludeDirectives(rawCCode, path.dirname(codePath))
  print('  预编译完成。')

  // 词法分析
  print('  加载词法分析DFA...')
  const lexDFAPath = path.join(__dirname, '../syntax/MiniC/MiniC-Lex.json')
  requireCondition(fs.existsSync(lexDFAPath), `找不到词法分析DFA文件: ${lexDFAPath}`)
  const lexDFA = DeterministicAutomaton.deserialize(lexDFAPath)
  print(`  词法分析DFA已从 ${lexDFAPath} 加载`)
  print('  开始词法分析...')
  const tokens = tokenizeSourceCode(processedCode, lexDFA)
  print(`  词法分析完成。获得 ${tokens.length} 个Token。`)

  // 语法分析
  print('  加载语法分析表...')
  const lalrPath = path.join(__dirname, '../syntax/MiniC/MiniC-LALRParse.json')
  requireCondition(fs.existsSync(lalrPath), `找不到语法分析表文件: ${lalrPath}`)
  const lalrAnalyzer = loadLALRAnalyzer(lalrPath)
  print(`  语法分析表已从 ${lalrPath} 加载`)
  print('  开始语法分析...')
  print(`  Token序列: ${tokens.slice(0, 10).map(t => `${t.name}(${t.literal})`).join(', ')}...`)
  const astRoot = parseTokenSequence(tokens, lalrAnalyzer)
  if (astRoot === null || astRoot === undefined) {
    print(`  语法分析返回null或undefined，tokens数量=${tokens.length}`)
    print(`  前10个token: ${tokens.slice(0, 10).map(t => `${t.name}:${t.literal}`).join(', ')}`)
    requireCondition(false, '语法分析失败，AST根节点为null或undefined')
  }
  print('  语法分析完成。')

  print('*** 开始后端处理... ***')

  // 中间代码生成
  print('  生成中间代码...')
  const ir = new IntermediateCodeGenerator(astRoot!)
  print('  中间代码生成完成。')

  // 汇编代码生成
  print('  生成目标代码（汇编代码）...')
  const asmGenerator = new AssemblyCodeGenerator(ir)
  print('  目标代码生成完成。')

  // 输出
  print('  开始输出...')
  const asmCode = asmGenerator.toAssembly()
  
  // 确保输出目录存在
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true })
  }
  
  fs.writeFileSync(path.join(outputPath, outputName + '.asm'), asmCode)
  print('  目标代码输出成功。')
  
  if (withIR) {
    // 注意：IntermediateCodeGenerator需要实现toIRString方法
    // 这里暂时跳过IR输出，如果需要可以后续添加
    print('  IR输出功能暂未实现。')
  }
  
  print('  输出完成。')

  const endTime = new Date().getTime()

  print('')
  print('*** 总结 ***')
  print(`  编译成功完成，耗时 ${((endTime - startTime) / 1000).toFixed(2)} 秒。`)
} catch (ex) {
  if (ex instanceof CompilerError) {
    console.error(`[编译错误] ${ex.message}`)
    process.exit(1)
  } else {
    throw ex
  }
}

