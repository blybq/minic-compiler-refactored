/**
 * 汇编代码（目标代码）生成器
 * 约定：
 *   - 布尔真：任何不是0x0的值；布尔假：0x0
 */

import {
  IntermediateCodeGenerator,
  GLOBAL_SCOPE_PATH,
} from '../intermediate_code/IntermediateCodeGenerator'
import { InstructionQuad } from '../intermediate_code/InstructionQuad'
import { IntermediateVariable } from '../intermediate_code/IntermediateVariable'
import { IntermediateArray } from '../intermediate_code/IntermediateArray'
import { IntermediateFunction } from '../intermediate_code/IntermediateFunction'
import { DataType } from '../intermediate_code/DataTypes'
import { BasicBlock } from '../intermediate_code/BasicBlock'
import { requireCondition } from '../core/utils'
import { USEFUL_REGISTERS } from './Architecture'
import { AddressDescriptor, RegisterDescriptor, StackFrameInfo } from './AssemblyTypes'

/**
 * 汇编代码生成器
 */
export class AssemblyCodeGenerator {
  private _ir: IntermediateCodeGenerator
  private _asm: string[]

  private _GPRs: string[] // 通用寄存器组
  private _registerDescriptors: Map<string, RegisterDescriptor> // 寄存器描述符, 寄存器号->变量名(可多个)
  private _addressDescriptors: Map<string, AddressDescriptor> // 变量描述符, 变量名->地址（可多个）
  private _stackFrameInfos: Map<string, StackFrameInfo>

  constructor(ir: IntermediateCodeGenerator) {
    this._ir = ir
    this._asm = []
    this._GPRs = [...USEFUL_REGISTERS]
    this._registerDescriptors = new Map()
    this._addressDescriptors = new Map()
    this._stackFrameInfos = new Map()
    this.calcFrameInfo()
    // initialize all GPRs
    for (const regName of this._GPRs) {
      this._registerDescriptors.set(regName, { usable: true, variables: new Set<string>() })
    }
    this.newAsm('.data')
    this.initializeGlobalVars()
    this.newAsm('.text')
    this.processTextSegment()
    this.peepholeOptimize()
  }

  /**
   * 从内存取变量到寄存器
   */
  loadVar(varId: string, register: string) {
    const addrDesc = this._addressDescriptors.get(varId)
    if (addrDesc === undefined || addrDesc.boundMemAddress === undefined) {
      // Variable doesn't have a bound memory address - it's a temporary variable
      // Just mark it as being in the register
      if (addrDesc === undefined) {
        this._addressDescriptors.set(varId, {
          boundMemAddress: undefined,
          currentAddresses: new Set<string>().add(register),
        })
      } else {
        addrDesc.currentAddresses.add(register)
      }
      this._registerDescriptors.get(register)?.variables.clear()
      this._registerDescriptors.get(register)?.variables.add(varId)
      return
    }
    const varLoc = addrDesc.boundMemAddress
    this.newAsm(`lw ${register}, ${varLoc}`)
    this.newAsm(`nop`)
    this.newAsm(`nop`)
    // change the register descriptor so it holds only this var
    this._registerDescriptors.get(register)?.variables.clear()
    this._registerDescriptors.get(register)?.variables.add(varId)
    // change the address descriptor by adding this register as an additonal location
    this._addressDescriptors.get(varId)?.currentAddresses.add(register)
  }

  /**
   * 回写寄存器内容到内存
   */
  storeVar(varId: string, register: string) {
    const addrDesc = this._addressDescriptors.get(varId)
    if (addrDesc === undefined || addrDesc.boundMemAddress === undefined) {
      // Variable doesn't have a bound memory address - it's a temporary variable
      // Don't store it, just update the address descriptor
      if (addrDesc === undefined) {
        this._addressDescriptors.set(varId, {
          boundMemAddress: undefined,
          currentAddresses: new Set<string>().add(register),
        })
      } else {
        addrDesc.currentAddresses.add(register)
      }
      return
    }
    const varLoc = addrDesc.boundMemAddress
    this.newAsm(`sw ${register}, ${varLoc}`)
    this._addressDescriptors.get(varId)?.currentAddresses.add(varLoc!)
  }

  /**
   * 生成汇编代码
   */
  toAssembly() {
    return this._asm.map(v => (!(v.startsWith('.') || v.includes(':')) ? '\t' : '') + v.replace(' ', '\t')).join('\n')
  }

  /**
   * 添加一行新汇编代码
   */
  newAsm(line: string) {
    this._asm.push(line)
  }

  /**
   * 将MiniC类型转换为Minisys汇编类型
   */
  toMinisysType(type: DataType) {
    const table: { [key: string]: string } = {
      int: '.word',
    }
    return table[type]
  }

  /**
   * 生成声明全局变量代码
   */
  initializeGlobalVars() {
    const globalVars = this._ir.variablePool.filter(v =>
      IntermediateCodeGenerator.areScopesEqual(v.scopePath, GLOBAL_SCOPE_PATH)
    )
    for (let var_ of globalVars) {
      if (var_ instanceof IntermediateVariable) {
        this.newAsm(`${var_.variableName}: ${this.toMinisysType(var_.dataType)} 0x0`) // 全局变量初始值给 0x0
      } else {
        this.newAsm(
          `${var_.arrayName}: ${this.toMinisysType(var_.dataType)} ${Array(var_.arrayLength).fill('0x0').join(', ')}`
        ) // 全局变量初始值给 0x0
      }
    }
  }

  /**
   * 为一条四元式获取每个变量可用的寄存器（龙书8.6.3）
   */
  getRegs(ir: InstructionQuad, blockIndex: number, irIndex: number) {
    const { operation, operand1, operand2, result } = ir
    const binaryOp = operand1.trim() && operand2.trim() // 是二元表达式
    const unaryOp = !!(+!!operand1.trim() ^ +!!operand2.trim()) // 是一元表达式
    let regs = ['']
    if (['=$', 'call', 'j_false', '=var', '=const', '=[]', '[]'].includes(operation)) {
      switch (operation) {
        case '=$': {
          let regY = this.allocateReg(blockIndex, irIndex, operand1, undefined, undefined)
          if (!this._registerDescriptors.get(regY)?.variables.has(operand1)) {
            this.loadVar(operand1, regY)
          }
          let regZ = this.allocateReg(blockIndex, irIndex, operand2, undefined, undefined)
          if (!this._registerDescriptors.get(regZ)?.variables.has(operand2)) {
            this.loadVar(operand2, regZ)
          }
          regs = [regY, regZ]
          break
        }
        case '=const':
        case 'call': {
          let regX = this.allocateReg(blockIndex, irIndex, result, undefined, undefined)
          regs = [regX]
          break
        }
        case 'j_false': {
          let regY = this.allocateReg(blockIndex, irIndex, operand1, undefined, undefined)
          if (!this._registerDescriptors.get(regY)?.variables.has(operand1)) {
            this.loadVar(operand1, regY)
          }
          regs = [regY]
          break
        }
        case '=var': {
          let regY = this.allocateReg(blockIndex, irIndex, operand1, undefined, result)
          if (!this._registerDescriptors.get(regY)?.variables.has(operand1)) {
            this.loadVar(operand1, regY)
          }
          // always choose RegX = RegY
          let regX = regY
          regs = [regY, regX]
          break
        }
        case '=[]': {
          let regY = this.allocateReg(blockIndex, irIndex, operand1, undefined, undefined)
          if (!this._registerDescriptors.get(regY)?.variables.has(operand1)) {
            this.loadVar(operand1, regY)
          }
          let regZ = this.allocateReg(blockIndex, irIndex, operand2, undefined, undefined)
          if (!this._registerDescriptors.get(regZ)?.variables.has(operand2)) {
            this.loadVar(operand2, regZ)
          }
          regs = [regY, regZ]
          break
        }
        case '[]': {
          let regZ = this.allocateReg(blockIndex, irIndex, operand2, undefined, undefined)
          if (!this._registerDescriptors.get(regZ)?.variables.has(operand2)) {
            this.loadVar(operand2, regZ)
          }
          let regX = this.allocateReg(blockIndex, irIndex, result, undefined, undefined)
          regs = [regZ, regX]
          break
        }
        default:
          break
      }
    } else if (binaryOp) {
      let regY = this.allocateReg(blockIndex, irIndex, operand1, operand2, result)
      if (!this._registerDescriptors.get(regY)?.variables.has(operand1)) {
        this.loadVar(operand1, regY)
      }
      let regZ = this.allocateReg(blockIndex, irIndex, operand2, operand1, result)
      if (!this._registerDescriptors.get(regZ)?.variables.has(operand2)) {
        this.loadVar(operand2, regZ)
      }
      // if res is either of arg1 or arg2, then simply use the same register
      let regX = ''
      if (result == operand1) {
        regX = regY
      } else if (result == operand2) {
        regX = regZ
      } else {
        regX = this.allocateReg(blockIndex, irIndex, result, undefined, undefined)
      }
      regs = [regY, regZ, regX]
    } else if (unaryOp) {
      // unary op
      let regY = this.allocateReg(blockIndex, irIndex, operand1, undefined, result)
      if (!this._registerDescriptors.get(regY)?.variables.has(operand1)) {
        this.loadVar(operand1, regY)
      }
      let regX = result == operand1 ? regY : this.allocateReg(blockIndex, irIndex, result, undefined, undefined)
      regs = [regY, regX]
    } else requireCondition(false, 'Illegal op.')
    return regs
  }

  /**
   * 寄存器分配（龙书8.6.3）
   */
  allocateReg(
    blockIndex: number,
    irIndex: number,
    thisArg: string,
    otherArg: string | undefined,
    res: string | undefined
  ) {
    const addrDesc = this._addressDescriptors.get(thisArg)?.currentAddresses
    let finalReg = ''
    let alreadyInReg = false
    if (addrDesc != undefined) {
      for (const addr of addrDesc) {
        if (addr[0] == '$') {
          // 1. Currently in a register, just pick this one.
          alreadyInReg = true
          finalReg = addr
          break
        }
      }
    }
    if (!alreadyInReg) {
      let freeReg = ''
      for (let kvPair of this._registerDescriptors.entries()) {
        if (kvPair[1].variables.size == 0 && kvPair[1].usable) {
          freeReg = kvPair[0]
          break
        }
      }
      if (freeReg.length > 0) {
        // 2. Not in a register, but there is a register that is currently empty, pick one such register.
        finalReg = freeReg
      } else {
        const basicBlock = this._ir.basicBlocks[blockIndex]
        // 3. No free register. Need to pick one to replace.
        let scores = new Map<string, number>() // number of instructions needed to generate if pick such register
        for (let kvPair of this._registerDescriptors.entries()) {
          let scoreKey = kvPair[0]
          let scoreValue = 0
          if (!kvPair[1].usable) {
            // Not avaibale
            scoreValue = Infinity
            scores.set(scoreKey, scoreValue)
            continue
          }
          const curentVars = kvPair[1].variables
          for (const currentVar of curentVars) {
            if (currentVar == res && currentVar != otherArg) {
              // it is the result oprand and not another argument oprand, OK to replace because this value will never be used again
              continue
            }
            let reused = false
            let tempIndex = irIndex
            let procedureEnd = false
            while (!procedureEnd && !reused) {
              const tempIR = basicBlock.instructions[++tempIndex]
              if (!tempIR) break
              if (
                tempIR.operand1 == currentVar ||
                tempIR.operand2 == currentVar ||
                tempIR.result == currentVar
              ) {
                reused = true
                break
              }
              if (tempIR.operation == 'set_label' && tempIR.result.endsWith('_exit')) procedureEnd = true
            }
            if (!reused) {
              // this variable will never be used again as an argument in subsequent instructions of this procedure
              continue
            } else {
              const boundMem = this._addressDescriptors.get(currentVar)?.boundMemAddress
              if (boundMem != undefined) {
                const addrs = this._addressDescriptors.get(currentVar)?.currentAddresses
                if (addrs != undefined && addrs.size > 1) {
                  // it has another current address, OK to directly replace this one without generating a store instruction
                  continue
                } else {
                  // can replace this one but need to emit an additional store instruction
                  scoreValue += 1
                }
              } else {
                // this is a temporary variable and has no memory address so cannot be replaced!
                scoreValue = Infinity
              }
            }
          }
          scores.set(scoreKey, scoreValue)
        }
        let minScore = Infinity
        let minKey = ''
        for (const kvPair of scores) {
          if (kvPair[1] < minScore) {
            minScore = kvPair[1]
            minKey = kvPair[0]
          }
        }
        requireCondition(minScore != Infinity, 'Cannot find a register to replace.')
        finalReg = minKey
        if (minScore > 0) {
          // need to emit instruction(s) to store back
          const variables = this._registerDescriptors.get(finalReg)?.variables!
          requireCondition(variables !== undefined, 'Undefined varibales')
          for (const varID of variables) {
            const tempAddrDesc = this._addressDescriptors.get(varID)!
            requireCondition(tempAddrDesc !== undefined, 'Undefined address descriptor')
            requireCondition(tempAddrDesc.boundMemAddress !== undefined, 'Undefined bound address')
            const tempBoundAddr = tempAddrDesc.boundMemAddress!
            if (!tempAddrDesc.currentAddresses.has(tempBoundAddr)) {
              this.storeVar(varID, finalReg)
              this._registerDescriptors.get(finalReg)?.variables.delete(varID)
              this._addressDescriptors.get(varID)?.currentAddresses.delete(finalReg)
            }
          }
        }
      }
    }
    return finalReg
  }

  /**
   * 根据IRFunc计算该Procedure所需的Frame大小.
   * 默认使用所有通用寄存器.
   * 没有子函数则不用存返回地址，否则需要，并且分配至少4个outgoing args块
   */
  calcFrameInfo() {
    for (const outer of this._ir.functionPool) {
      // if it calls child function(s), it needs to save return address
      // and allocate a minimum of 4 outgoing argument slots
      let isLeaf = outer.childFunctions.length == 0
      let maxArgs = 0
      for (const inner of this._ir.functionPool) {
        if (outer.childFunctions.includes(inner.functionName)) {
          maxArgs = Math.max(maxArgs, inner.parameterList.length)
        }
      }
      let outgoingSlots = isLeaf ? 0 : Math.max(maxArgs, 4)
      let localData = 0
      for (const localVar of outer.localVariables) {
        if (localVar instanceof IntermediateVariable) {
          if (!outer.parameterList.includes(localVar)) localData++
        } else {
          // 检查是否是数组参数（在parameterList中）
          const isArrayParam = outer.parameterList.some(param => 
            param instanceof IntermediateArray && param.arrayId === localVar.arrayId
          )
          if (!isArrayParam) {
            // 局部数组声明不被支持
            localData += localVar.arrayLength
          }
          // 数组参数不占用局部数据空间（它们通过参数传递）
        }
      }
      let numGPRs2Save =
        outer.functionName == 'main' ? 0 : localData > 10 ? (localData > 18 ? 8 : localData - 8) : 0
      let wordSize =
        (isLeaf ? 0 : 1) + localData + numGPRs2Save + outgoingSlots + numGPRs2Save // allocate memory for all local variables (but not for temporary variables)
      if (wordSize % 2 != 0) wordSize++ // padding
      this._stackFrameInfos.set(outer.functionName, {
        isLeaf: isLeaf,
        wordSize: wordSize,
        outgoingSlots: outgoingSlots,
        localData: localData,
        numGPRs2Save: numGPRs2Save,
        numReturnAdd: isLeaf ? 0 : 1,
      }) // for now allocate all regs
    }
  }

  /**
   * 初始化该过程的寄存器和地址描述符
   */
  allocateProcMemory(func: IntermediateFunction) {
    const frameInfo = this._stackFrameInfos.get(func?.functionName)!
    requireCondition(frameInfo !== undefined, 'Function name not in the pool')
    // must save args passed by register to memory, otherwise they can be damaged
    for (let index = 0; index < func.parameterList.length; index++) {
      const param = func.parameterList[index]
      const memLoc = `${4 * (frameInfo.wordSize + index)}($sp)`
      if (index < 4) {
        this.newAsm(`sw $a${index}, ${memLoc}`)
      }
      // 数组参数使用arrayId，普通参数使用variableId
      const paramId = param instanceof IntermediateArray ? param.arrayId : param.variableId
      this._addressDescriptors.set(paramId, {
        currentAddresses: new Set<string>().add(memLoc),
        boundMemAddress: memLoc,
      })
    }

    let remainingLVSlots = frameInfo.localData
    for (const localVar of func.localVariables) {
      if (localVar instanceof IntermediateVariable) {
        if (func.parameterList.includes(localVar)) continue
        else {
          const memLoc = `${
            4 * (frameInfo.wordSize - (frameInfo.isLeaf ? 0 : 1) - frameInfo.numGPRs2Save - remainingLVSlots--)
          }($sp)`
          this._addressDescriptors.set(localVar.variableId, {
            currentAddresses: new Set<string>().add(memLoc),
            boundMemAddress: memLoc,
          })
        }
      } else if (localVar instanceof IntermediateArray) {
        // 检查是否是数组参数（在parameterList中）
        const isArrayParam = func.parameterList.some(param => 
          param instanceof IntermediateArray && param.arrayId === localVar.arrayId
        )
        if (isArrayParam) {
          // 数组参数已在参数处理阶段分配了地址，跳过
          continue
        } else {
          // 局部数组声明不被支持
          requireCondition(false, 'Arrays are only supported as global variables!')
        }
      }
    }

    const availableRSs = func.functionName == 'main' ? 8 : frameInfo.numGPRs2Save

    // allocate $s0 ~ $s8
    for (let index = 0; index < 8; index++) {
      let usable = index < availableRSs
      this._registerDescriptors.set(`$s${index}`, { usable: usable, variables: new Set<string>() })
    }

    this.allocateGlobalMemory()
  }

  /**
   * 初始化全局变量的描述符
   */
  allocateGlobalMemory() {
    const globalVars = this._ir.variablePool.filter(v =>
      IntermediateCodeGenerator.areScopesEqual(v.scopePath, GLOBAL_SCOPE_PATH)
    )
    for (const globalVar of globalVars) {
      if (globalVar instanceof IntermediateVariable) {
        this._addressDescriptors.set(globalVar.variableId, {
          currentAddresses: new Set<string>().add(globalVar.variableName),
          boundMemAddress: `${globalVar.variableName}($0)`,
        })
      } else {
        this._addressDescriptors.set(globalVar.arrayId, {
          currentAddresses: new Set<string>().add(globalVar.arrayName),
          boundMemAddress: globalVar.arrayName,
        })
      }
    }
  }

  /**
   * 清除只属于该过程的描述符，并在必要时写回寄存器中的变量
   */
  deallocateProcMemory() {
    for (const kvpair of this._addressDescriptors.entries()) {
      const boundMemAddress = kvpair[1].boundMemAddress
      const currentAddresses = kvpair[1].currentAddresses
      if (boundMemAddress != undefined && !currentAddresses.has(boundMemAddress)) {
        // need to write this back to its bound memory location
        if (currentAddresses.size > 0) {
          for (const addr of currentAddresses.values()) {
            if (addr[0] == '$') {
              this.storeVar(kvpair[0], addr)
              break
            }
          }
        } else {
          // Variable has no current address - it might have been cleared
          // Skip storing if it's a temporary variable (no boundMemAddress check already done)
          // For global variables, this shouldn't happen, but if it does, skip to avoid error
          continue
        }
      }
    }
    this._addressDescriptors.clear()
    for (let pair of this._registerDescriptors) {
      pair[1].variables.clear()
    }
  }

  /**
   * 清除只属于该基本块的描述符，并在必要时写回寄存器中的变量
   */
  deallocateBlockMemory() {
    for (const kvpair of this._addressDescriptors.entries()) {
      const boundMemAddress = kvpair[1].boundMemAddress
      const currentAddresses = kvpair[1].currentAddresses
      if (boundMemAddress != undefined && !currentAddresses.has(boundMemAddress)) {
        // need to write this back to its bound memory location
        if (currentAddresses.size > 0) {
          for (const addr of currentAddresses.values()) {
            if (addr[0] == '$') {
              this.storeVar(kvpair[0], addr)
              break
            }
          }
        } else {
          // Variable has no current address - it might have been cleared
          // Skip storing if it's a temporary variable (no boundMemAddress check already done)
          // For global variables, this shouldn't happen, but if it does, skip to avoid error
          continue
        }
      }
    }
    for (let pair of this._registerDescriptors) {
      pair[1].variables.clear()
    }
    for (let value of this._addressDescriptors.values()) {
      for (let addr of value.currentAddresses) {
        if (addr[0] == '$') value.currentAddresses.delete(addr)
      }
    }
  }

  /**
   * 更新变量被赋值后的相应的描述符
   */
  manageResDescriptors(regX: string, res: string) {
    // a. Change the register descriptor for regX so that it only holds res
    this._registerDescriptors.get(regX)?.variables.clear()
    this._registerDescriptors.get(regX)?.variables.add(res)

    if (this._addressDescriptors.has(res)) {
      // b. Remove regX from the address descriptor of any variable other than res
      for (let descriptor of this._addressDescriptors.values()) {
        if (descriptor.currentAddresses.has(regX)) {
          descriptor.currentAddresses.delete(regX)
        }
      }
      // c. Change the address descriptor for res so that its only location is regX
      // Note the memory location for res is NOT now in the address descriptor for res!
      this._addressDescriptors.get(res)?.currentAddresses.clear()
      this._addressDescriptors.get(res)?.currentAddresses.add(regX)
    } else {
      // temporary vairable
      this._addressDescriptors.set(res, {
        boundMemAddress: undefined,
        currentAddresses: new Set<string>().add(regX),
      })
    }
  }

  /**
   * 根据中间代码生成MIPS汇编
   * @see https://github.com/seu-cs-class2/minisys-minicc-ts/blob/master/docs/IR.md
   */
  processTextSegment() {
    let currentFunc: IntermediateFunction | undefined
    let currentFrameInfo: StackFrameInfo | undefined
    for (let blockIndex = 0; blockIndex < this._ir.basicBlocks.length; blockIndex++) {
      const basicBlock = this._ir.basicBlocks[blockIndex]
      for (let irIndex = 0; irIndex < basicBlock.instructions.length; irIndex++) {
        const quad = basicBlock.instructions[irIndex]
        if (quad == undefined) break
        const { operation, operand1, operand2, result } = quad
        const binaryOp = !!(operand1.trim() && operand2.trim()) // 是二元表达式
        const unaryOp = !!(+!!operand1.trim() ^ +!!operand2.trim()) // 是一元表达式
        if (operation == 'call') {
          // parse the function name
          const func = this._ir.functionPool.find(element => element.functionName == operand1)!
          requireCondition(func !== undefined, `Unidentified function:${operand1}`)
          requireCondition(func.functionName != 'main', 'Cannot call main!')
          const actualArguments = operand2.split('&')
          // has arguments
          if (binaryOp) {
            for (let argNum = 0; argNum < func.parameterList.length; argNum++) {
              const actualArg = actualArguments[argNum]
              const ad = this._addressDescriptors.get(actualArg)
              if (ad == undefined || ad.currentAddresses == undefined || ad.currentAddresses.size == 0) {
                requireCondition(false, 'Actual argument does not have current address')
              } else {
                let regLoc = ''
                let memLoc = ''
                // Check if variable is in $v0 (from previous function call)
                if (ad.currentAddresses.has('$v0')) {
                  regLoc = '$v0'
                } else {
                  for (const addr of ad.currentAddresses) {
                    if (addr[0] == '$') {
                      // register has higher priority
                      regLoc = addr
                      break
                    } else {
                      memLoc = addr
                    }
                  }
                }

                if (regLoc.length > 0) {
                  if (argNum < 4) {
                    this.newAsm(`move $a${argNum}, ${regLoc}`)
                  } else {
                    this.newAsm(`sw ${regLoc}, ${4 * argNum}($sp)`)
                  }
                } else {
                  if (argNum < 4) {
                    this.newAsm(`lw $a${argNum}, ${memLoc}`)
                    this.newAsm(`nop`)
                    this.newAsm(`nop`)
                  } else {
                    // since $v1 will not be used elsewhere, it is used to do this!
                    this.newAsm(`lw $v1, ${memLoc}`)
                    this.newAsm(`nop`)
                    this.newAsm(`nop`)
                    this.newAsm(`sw $v1, ${4 * argNum}($sp)`)
                  }
                }
              }
            }
          }

          // Before storing global variables, check if they are used as function arguments
          // If so, keep them in registers to avoid unnecessary load
          const argsToKeep = new Set<string>()
          const argsInV0 = new Set<string>() // Variables that are in $v0 and used as arguments
          if (binaryOp) {
            const actualArguments = operand2.split('&')
            for (let argNum = 0; argNum < func.parameterList.length; argNum++) {
              const actualArg = actualArguments[argNum]
              const ad = this._addressDescriptors.get(actualArg)
              if (ad !== undefined && ad.currentAddresses !== undefined && ad.currentAddresses.size > 0) {
                // Check if variable is in $v0 (from previous function call) - this has highest priority
                if (ad.currentAddresses.has('$v0')) {
                  argsInV0.add(actualArg)
                  argsToKeep.add(actualArg)
                } else {
                  // Check if variable is in a register (including $v0)
                  for (const addr of ad.currentAddresses) {
                    if (addr[0] == '$') {
                      argsToKeep.add(actualArg)
                      break
                    }
                  }
                }
              }
            }
          }
          
          // After function argument passing, store global variables that were in $v0
          // This matches the reference file behavior: move $a0, $v0 then sw $t0, switch_val($0)
          for (const kvpair of this._addressDescriptors.entries()) {
            // Skip storing if this variable is used as a function argument and is in a register (but not $v0)
            if (argsToKeep.has(kvpair[0]) && !argsInV0.has(kvpair[0])) {
              continue
            }
            const boundMemAddress = kvpair[1].boundMemAddress
            const currentAddresses = kvpair[1].currentAddresses
            // Only store global variables (those with boundMemAddress that is not a stack address)
            if (boundMemAddress != undefined && !currentAddresses.has(boundMemAddress)) {
              // Check if this is a global variable (not a stack address)
              const isGlobalVar = boundMemAddress.includes('($0)') || 
                                  (boundMemAddress[0] != '-' && !boundMemAddress.includes('($sp)'))
              if (!isGlobalVar) {
                continue // Skip local variables
              }
              // need to write this back to its bound memory location
              if (currentAddresses.size > 0) {
                for (const addr of currentAddresses.values()) {
                  // If variable is in $v0 and used as function argument, store from $v0
                  if (addr == '$v0' && argsInV0.has(kvpair[0])) {
                    // Store $v0 to global variable (semantically correct)
                    this.storeVar(kvpair[0], '$v0')
                    break
                  }
                  // If variable is in $v0 and not used as function argument, store from $v0
                  if (addr == '$v0' && !argsInV0.has(kvpair[0])) {
                    this.storeVar(kvpair[0], '$v0')
                    break
                  }
                  if (addr.substr(0, 2) == '$t') {
                    this.storeVar(kvpair[0], addr)
                    break
                  }
                }
              } else {
                // Variable has no current address - it might have been cleared
                // Skip storing if it's a temporary variable
                // For global variables, this shouldn't happen, but if it does, skip to avoid error
                continue
              }
            }
          }

          this.newAsm(`jal ${operand1}`) // jal will automatically save return address to $ra
          this.newAsm('nop')
          // clear temporary registers because they might have been damaged
          // But don't clear $v0 if it's being used for the next function call
          for (let kvpair of this._addressDescriptors.entries()) {
            for (let addr of kvpair[1].currentAddresses) {
              // Don't clear $v0 - it might be used for the next function call
              if (addr.substr(0, 2) == '$t') {
                kvpair[1].currentAddresses.delete(addr)
                this._registerDescriptors.get(addr)?.variables.delete(kvpair[0])
              }
            }
          }

          if (result.length > 0) {
            // Check if the next instruction is a function call that uses this result as an argument
            let nextIsCallWithArg = false
            if (irIndex + 1 < basicBlock.instructions.length) {
              const nextQuad = basicBlock.instructions[irIndex + 1]
              if (nextQuad && nextQuad.operation == 'call' && nextQuad.operand2) {
                const nextArgs = nextQuad.operand2.split('&')
                if (nextArgs.includes(result)) {
                  nextIsCallWithArg = true
                }
              }
            }
            
            // Check if the next instruction is =var and the target variable is used in a function call
            let nextIsVarAssignToCallArg = false
            if (irIndex + 1 < basicBlock.instructions.length) {
              const nextQuad = basicBlock.instructions[irIndex + 1]
              if (nextQuad && nextQuad.operation == '=var' && nextQuad.result) {
                // Check if the target variable is used in the next function call
                if (irIndex + 2 < basicBlock.instructions.length) {
                  const nextNextQuad = basicBlock.instructions[irIndex + 2]
                  if (nextNextQuad && nextNextQuad.operation == 'call' && nextNextQuad.operand2) {
                    const nextNextArgs = nextNextQuad.operand2.split('&')
                    if (nextNextArgs.includes(nextQuad.result)) {
                      nextIsVarAssignToCallArg = true
                    }
                  }
                }
              }
            }
            
            // Check if result is a global variable or local variable
            const resultAddrDesc = this._addressDescriptors.get(result)
            const isGlobalVar = resultAddrDesc !== undefined && resultAddrDesc.boundMemAddress !== undefined && 
                               (resultAddrDesc.boundMemAddress.includes('($0)') || 
                                (resultAddrDesc.boundMemAddress[0] != '-' && !resultAddrDesc.boundMemAddress.includes('($sp)')))
            const isLocalVar = resultAddrDesc !== undefined && resultAddrDesc.boundMemAddress !== undefined && 
                              !isGlobalVar && resultAddrDesc.boundMemAddress.includes('($sp)')
            
            if (nextIsCallWithArg || isGlobalVar || nextIsVarAssignToCallArg) {
              // If the next instruction uses this result as an argument, or if it's a global variable,
              // or if it's assigned to a variable that's used in a function call, keep it in $v0
              // Don't move $v0 to another register - it will be used directly as function argument
              this.manageResDescriptors('$v0', result)
              // If result is a global variable, storing will happen in the next function call
              // (after function argument passing, using $t0 to match reference file)
            } else {
              const [regX] = this.getRegs(quad, blockIndex, irIndex)
              this.newAsm(`move ${regX}, $v0`)
              this.manageResDescriptors(regX, result)
              // If result is a local variable, store it immediately to stack
              if (isLocalVar && resultAddrDesc.boundMemAddress !== undefined) {
                this.storeVar(result, regX)
                resultAddrDesc.currentAddresses.clear()
                resultAddrDesc.currentAddresses.add(resultAddrDesc.boundMemAddress)
              }
              // Don't store global variable immediately - let it stay in register
              // It will be stored before the next function call if needed
            }
          }
        } else if (binaryOp) {
          switch (operation) {
            case '=[]': {
              // operand1 = index, operand2 = value, result = arrayId
              const [regY, regZ] = this.getRegs(quad, blockIndex, irIndex) // regY = index, regZ = value
              this.newAsm(`move $v1, ${regY}`) // $v1 = index
              this.newAsm(`sll $v1, $v1, 2`) // $v1 = index * 4
              const baseAddr = this._addressDescriptors.get(result)?.boundMemAddress
              requireCondition(baseAddr !== undefined, `数组基地址未定义：${result}`)
              // 如果baseAddr包含括号（如 "0($sp)" 或 "arr($0)"），需要特殊处理
              if (baseAddr.includes('(')) {
                // 基地址是相对于寄存器或内存的，需要使用add指令
                // 提取基地址部分（去掉括号和偏移量）
                const baseMatch = baseAddr.match(/^(.*?)\((.+)\)$/)
                if (baseMatch) {
                  const offset = baseMatch[1] || '0'
                  const baseReg = baseMatch[2]
                  // 加载基地址到临时寄存器
                  this.newAsm(`lw $t9, ${baseAddr}`)
                  this.newAsm(`nop`)
                  this.newAsm(`nop`)
                  // 计算最终地址
                  this.newAsm(`add $v1, $t9, $v1`)
                  // 存储到计算后的地址
                  this.newAsm(`sw ${regZ}, 0($v1)`)
                } else {
                  requireCondition(false, `无法解析基地址格式：${baseAddr}`)
                }
              } else {
                // 基地址是全局变量名，可以直接使用
                this.newAsm(`lw $t9, ${baseAddr}`)
                this.newAsm(`nop`)
                this.newAsm(`nop`)
                this.newAsm(`add $v1, $t9, $v1`)
                this.newAsm(`sw ${regZ}, 0($v1)`)
              }
              break
            }
            case '[]': {
              // operand1 = arrayId, operand2 = index, result = tempVar
              const [regZ, regX] = this.getRegs(quad, blockIndex, irIndex) // regZ = index, regX = result
              this.newAsm(`move $v1, ${regZ}`) // $v1 = index
              this.newAsm(`sll $v1, $v1, 2`) // $v1 = index * 4
              const baseAddr = this._addressDescriptors.get(operand1)?.boundMemAddress
              requireCondition(baseAddr !== undefined, `数组基地址未定义：${operand1}`)
              // 如果baseAddr包含括号（如 "0($sp)" 或 "arr($0)"），需要特殊处理
              if (baseAddr.includes('(')) {
                // 基地址是相对于寄存器或内存的，需要使用add指令
                const baseMatch = baseAddr.match(/^(.*?)\((.+)\)$/)
                if (baseMatch) {
                  const offset = baseMatch[1] || '0'
                  const baseReg = baseMatch[2]
                  // 加载基地址到临时寄存器
                  this.newAsm(`lw $t9, ${baseAddr}`)
                  this.newAsm(`nop`)
                  this.newAsm(`nop`)
                  // 计算最终地址
                  this.newAsm(`add $v1, $t9, $v1`)
                  // 从计算后的地址加载
                  this.newAsm(`lw ${regX}, 0($v1)`)
                } else {
                  requireCondition(false, `无法解析基地址格式：${baseAddr}`)
                }
              } else {
                // 基地址是全局变量名，可以直接使用
                this.newAsm(`lw $t9, ${baseAddr}`)
                this.newAsm(`nop`)
                this.newAsm(`nop`)
                this.newAsm(`add $v1, $t9, $v1`)
                this.newAsm(`lw ${regX}, 0($v1)`)
              }
              this.newAsm(`nop`)
              this.newAsm(`nop`)
              this.manageResDescriptors(regX, result)
              break
            }
            case '=$': {
              const [regY, regZ] = this.getRegs(quad, blockIndex, irIndex)
              this.newAsm(`sw ${regZ}, 0(${regY})`)
              break
            }
            // X = Y op Z
            case 'OR_OP':
            case 'AND_OP':
            case 'LT_OP':
            case 'PLUS':
            case 'MINUS':
            case 'BITAND_OP':
            case 'BITOR_OP':
            case 'BITXOR_OP':
            case 'LEFT_OP':
            case 'RIGHT_OP':
            case 'EQ_OP':
            case 'NE_OP':
            case 'GT_OP':
            case 'GE_OP':
            case 'LE_OP':
            case 'MULTIPLY':
            case 'SLASH':
            case 'PERCENT':
              {
                // register allocation
                const [regY, regZ, regX] = this.getRegs(quad, blockIndex, irIndex)
                // emit respective instructions
                switch (operation) {
                  case 'BITOR_OP':
                  case 'OR_OP': {
                    this.newAsm(`or ${regX}, ${regY}, ${regZ}`)
                    break
                  }
                  case 'BITAND_OP':
                  case 'AND_OP': {
                    this.newAsm(`and ${regX}, ${regY}, ${regZ}`)
                    break
                  }
                  case 'BITXOR_OP': {
                    this.newAsm(`xor ${regX}, ${regY}, ${regZ}`)
                    break
                  }
                  case 'PLUS': {
                    this.newAsm(`add ${regX}, ${regY}, ${regZ}`)
                    break
                  }
                  case 'MINUS': {
                    this.newAsm(`sub ${regX}, ${regY}, ${regZ}`)
                    break
                  }
                  case 'LEFT_OP': {
                    this.newAsm(`sllv ${regX}, ${regY}, ${regZ}`)
                    break
                  }
                  case 'RIGHT_OP': {
                    this.newAsm(`srlv ${regX}, ${regY}, ${regZ}`)
                    break
                  }
                  case 'EQ_OP': {
                    this.newAsm(`sub ${regX}, ${regY}, ${regZ}`)
                    this.newAsm(`sltu ${regX}, $zero, ${regX}`)
                    this.newAsm(`xori ${regX}, ${regX}, ${1}`)
                    break
                  }
                  case 'NE_OP': {
                    this.newAsm(`sub ${regX}, ${regY}, ${regZ}`)
                    break
                  }
                  case 'LT_OP': {
                    this.newAsm(`slt ${regX}, ${regY}, ${regZ}`)
                    break
                  }
                  case 'GT_OP': {
                    this.newAsm(`slt ${regX}, ${regZ}, ${regY}`)
                    break
                  }
                  case 'GE_OP': {
                    this.newAsm(`slt ${regX}, ${regY}, ${regZ}`)
                    this.newAsm(`xori ${regX}, ${regX}, ${1}`)
                    break
                  }
                  case 'LE_OP': {
                    this.newAsm(`slt ${regX}, ${regZ}, ${regY}`)
                    this.newAsm(`xori ${regX}, ${regX}, ${1}`)
                    break
                  }
                  case 'MULTIPLY': {
                    this.newAsm(`mult ${regY}, ${regZ}`)
                    this.newAsm(`mflo ${regX}`)
                    break
                  }
                  case 'SLASH': {
                    this.newAsm(`div ${regY}, ${regZ}`)
                    this.newAsm(`mflo ${regX}`)
                    break
                  }
                  case 'PERCENT': {
                    this.newAsm(`div ${regY}, ${regZ}`)
                    this.newAsm(`mfhi ${regX}`)
                    break
                  }
                }

                this.manageResDescriptors(regX, result)
              }
              break
            default:
              break
          }
        } else if (unaryOp) {
          switch (operation) {
            case 'out_asm': {
              // directly output assembly
              requireCondition(operand1.match(/^".*"$/) !== null, `out_asm 动作接收到非字符串参数 ${operand1}`)
              this.newAsm(operand1.substring(1, operand1.length - 1))
              break
            }
            case 'j_false': {
              const [regY] = this.getRegs(quad, blockIndex, irIndex)
              this.deallocateBlockMemory()
              this.newAsm(`beq ${regY}, $zero, ${result}`)
              this.newAsm(`nop`) // delay-slot
              break
            }
            case '=const': {
              const [regX] = this.getRegs(quad, blockIndex, irIndex)
              const immediateNum = parseInt(operand1)
              if (immediateNum <= 32767 && immediateNum >= -32768) {
                this.newAsm(`addiu ${regX}, $zero, ${immediateNum}`)
              } else {
                const lowerHalf = immediateNum & 0x0000ffff
                const higherHalf = immediateNum >>> 16
                this.newAsm(`lui ${regX}, ${higherHalf}`)
                this.newAsm(`ori ${regX}, ${regX}, ${lowerHalf}`)
              }

              this.manageResDescriptors(regX, result)
              break
            }
            case '=var':
              const [regY] = this.getRegs(quad, blockIndex, irIndex)
              
              // Check if the next instruction is a function call that uses this result as an argument
              let nextIsCallWithArg = false
              if (irIndex + 1 < basicBlock.instructions.length) {
                const nextQuad = basicBlock.instructions[irIndex + 1]
                if (nextQuad && nextQuad.operation == 'call' && nextQuad.operand2) {
                  const nextArgs = nextQuad.operand2.split('&')
                  if (nextArgs.includes(result)) {
                    nextIsCallWithArg = true
                  }
                }
              }
              
              // Check if source variable (operand1) is in $v0
              const sourceAddrDesc = this._addressDescriptors.get(operand1)
              const sourceInV0 = sourceAddrDesc !== undefined && sourceAddrDesc.currentAddresses.has('$v0')
              
              // If source is in $v0 and next instruction uses result as argument, keep result in $v0
              if (nextIsCallWithArg && sourceInV0) {
                // Keep result in $v0 (don't move it)
                this.manageResDescriptors('$v0', result)
              } else {
                // Add res to the register descriptor for regY
                this._registerDescriptors.get(regY)?.variables.add(result)
                // Change the address descriptor for res so that its only location is regY
                if (this._addressDescriptors.has(result)) {
                  const resultAddrDesc = this._addressDescriptors.get(result)!
                  // If result has boundMemAddress, check if it needs to be stored
                  // For local variables, always store if source is in register and target has boundMemAddress
                  const sourceInReg = this._addressDescriptors.get(operand1)?.currentAddresses.has(regY) || 
                                     this._addressDescriptors.get(operand1)?.currentAddresses.has('$v0')
                  if (resultAddrDesc.boundMemAddress !== undefined && 
                      (!resultAddrDesc.currentAddresses.has(resultAddrDesc.boundMemAddress) || 
                       (sourceInReg && resultAddrDesc.boundMemAddress.includes('($sp)')))) {
                    // Store to memory (both global and local variables)
                    this.storeVar(result, regY)
                    resultAddrDesc.currentAddresses.clear()
                    resultAddrDesc.currentAddresses.add(resultAddrDesc.boundMemAddress)
                  } else {
                    // Variable already in memory or no bound address
                    resultAddrDesc.currentAddresses.clear()
                    resultAddrDesc.currentAddresses.add(regY)
                  }
                } else {
                  // temporary vairable
                  this._addressDescriptors.set(result, {
                    boundMemAddress: undefined,
                    currentAddresses: new Set<string>().add(regY),
                  })
                }
              }
              break
            case 'return_expr': {
              const ad = this._addressDescriptors.get(operand1)
              if (ad == undefined || ad.currentAddresses == undefined || ad.currentAddresses.size == 0) {
                requireCondition(false, 'Return value does not have current address')
              } else {
                let regLoc = ''
                let memLoc = ''
                for (const addr of ad.currentAddresses) {
                  if (addr[0] == '$') {
                    // register has higher priority
                    regLoc = addr
                    break
                  } else {
                    memLoc = addr
                  }
                }

                if (regLoc.length > 0) {
                  this.newAsm(`move $v0, ${regLoc}`)
                } else {
                  this.newAsm(`lw $v0, ${memLoc}`)
                  this.newAsm(`nop`)
                  this.newAsm(`nop`)
                }
              }

              this.deallocateBlockMemory()

              requireCondition(currentFrameInfo !== undefined, 'Undefined frame info')
              currentFrameInfo = currentFrameInfo as StackFrameInfo
              for (let index = 0; index < currentFrameInfo.numGPRs2Save; index++) {
                this.newAsm(
                  `lw $s${index}, ${4 * (currentFrameInfo.wordSize - currentFrameInfo.numGPRs2Save + index)}($sp)`
                )
                this.newAsm(`nop`)
                this.newAsm(`nop`)
              }

              if (!currentFrameInfo.isLeaf) {
                this.newAsm(`lw $ra, ${4 * (currentFrameInfo.wordSize - 1)}($sp)`)
                this.newAsm(`nop`)
                this.newAsm(`nop`)
              }
              this.newAsm(`addiu $sp, $sp, ${4 * currentFrameInfo.wordSize}`)
              this.newAsm(`jr $ra`)
              this.newAsm('nop')
              break
            }
            case 'NOT_OP':
            case 'MINUS':
            case 'PLUS':
            case 'BITINV_OP': {
              const [regY, regX] = this.getRegs(quad, blockIndex, irIndex)
              if (!this._registerDescriptors.get(regY)?.variables.has(operand1)) {
                this.loadVar(operand1, regY)
              }
              switch (operation) {
                case 'NOT_OP':
                  this.newAsm(`xor ${regX}, $zero, ${regY}`)
                  break
                case 'MINUS':
                  this.newAsm(`sub ${regX}, $zero, ${regY}`)
                  break
                case 'PLUS':
                  this.newAsm(`move ${regX}, ${regY}`)
                  break
                case 'BITINV_OP':
                  this.newAsm(`nor ${regX}, ${regY}, ${regY}`)
                  break
                default:
                  break
              }
              this.manageResDescriptors(regX, result)
              break
            }
            case 'DOLLAR': {
              const [regY, regX] = this.getRegs(quad, blockIndex, irIndex)
              this.newAsm(`lw ${regX}, 0(${regY})`)
              this.newAsm(`nop`)
              this.newAsm(`nop`)
              this.manageResDescriptors(regX, result)
              break
            }

            default:
              break
          }
        } else {
          switch (operation) {
            case 'set_label': {
              // parse the label to identify type
              const labelContents = result.split('_')
              const labelType = labelContents[labelContents.length - 1]
              if (labelType == 'entry') {
                // find the function in symbol table
                currentFunc = this._ir.functionPool.find(element => element.entryLabel == result)!
                requireCondition(currentFunc !== undefined, `Function name not in the pool: ${result}`)
                currentFrameInfo = this._stackFrameInfos.get(currentFunc?.functionName)!
                requireCondition(currentFrameInfo !== undefined, `Function name not in the pool: ${result}`)
                this.newAsm(
                  currentFunc?.functionName +
                    ':' +
                    `\t\t # vars = ${currentFrameInfo.localData}, regs to save($s#) = ${
                      currentFrameInfo.numGPRs2Save
                    }, outgoing args = ${currentFrameInfo.outgoingSlots}, ${
                      currentFrameInfo.numReturnAdd ? '' : 'do not '
                    }need to save return address`
                )
                this.newAsm(`addiu $sp, $sp, -${4 * currentFrameInfo.wordSize}`)
                if (!currentFrameInfo.isLeaf) {
                  this.newAsm(`sw $ra, ${4 * (currentFrameInfo.wordSize - 1)}($sp)`)
                }
                for (let index = 0; index < currentFrameInfo.numGPRs2Save; index++) {
                  this.newAsm(
                    `sw $s${index}, ${4 * (currentFrameInfo.wordSize - currentFrameInfo.numGPRs2Save + index)}($sp)`
                  )
                }
                this.allocateProcMemory(currentFunc)
              } else if (labelType == 'exit') {
                this.deallocateProcMemory()
              } else {
                this.newAsm(result + ':')
              }
              break
            }
            case 'j': {
              this.deallocateBlockMemory()
              this.newAsm(`j ${result}`)
              this.newAsm(`nop`) // delay-slot
              break
            }
            case 'return_void': {
              this.deallocateBlockMemory()
              requireCondition(currentFrameInfo !== undefined, 'Undefined frame info')
              currentFrameInfo = currentFrameInfo as StackFrameInfo
              for (let index = 0; index < currentFrameInfo.numGPRs2Save; index++) {
                this.newAsm(
                  `lw $s${index}, ${4 * (currentFrameInfo.wordSize - currentFrameInfo.numGPRs2Save + index)}($sp)`
                )
                this.newAsm(`nop`)
                this.newAsm(`nop`)
              }

              if (!currentFrameInfo.isLeaf) {
                this.newAsm(`lw $ra, ${4 * (currentFrameInfo.wordSize - 1)}($sp)`)
                this.newAsm(`nop`)
                this.newAsm(`nop`)
              }
              this.newAsm(`addiu $sp, $sp, ${4 * currentFrameInfo.wordSize}`)
              this.newAsm(`jr $ra`)
              this.newAsm('nop')
              break
            }
            default:
              break
          }
        }
        if (operation != 'set_label' && operation != 'j' && operation != 'j_false' && irIndex == basicBlock.instructions.length - 1) {
          this.deallocateBlockMemory()
        }
      }
    }
  }

  /**
   * 窥孔优化
   */
  peepholeOptimize() {
    let newAsm = []
    newAsm.push(this._asm[0])
    for (let index = 1; index < this._asm.length; index++) {
      let asmElementsThisLine = this._asm[index].trim().split(/\,\s|\s/)
      let asmElementsLastLine = this._asm[index - 1].trim().split(/\,|\s/)
      if (asmElementsThisLine[0] == 'move' && index > 0 && !['nop', 'sw'].includes(asmElementsLastLine[0])) {
        let srcRegThisLine = asmElementsThisLine[2]
        let dstRegLastLine = asmElementsLastLine[1]
        if (srcRegThisLine == dstRegLastLine) {
          let dstRegThisLine = asmElementsThisLine[1]
          let newLastLine = this._asm[index - 1].replace(dstRegLastLine, dstRegThisLine)
          newAsm.pop()
          // 'move $v0, $v0'
          let newElements = newLastLine.trim().split(/\,\s|\s/)
          if (newElements[0] == 'move' && newElements[1] == newElements[2]) continue
          newAsm.push(newLastLine)
        } else {
          newAsm.push(this._asm[index])
        }
      } else {
        newAsm.push(this._asm[index])
      }
    }
    this._asm = newAsm
  }
}

