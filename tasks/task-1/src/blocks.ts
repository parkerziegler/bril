import * as bril from "./bril";

const END_INSTRS = new Set(["jmp", "ret", "br"]);

export type BasicBlock = (bril.Instruction | bril.Label)[];

export function createBasicBlocks(fn: bril.Function): BasicBlock[] {
  let currBlock: BasicBlock = [];

  const blocks = fn.instrs.reduce<BasicBlock[]>((acc, instr) => {
    if ("op" in instr) {
      // Push the current instruction to the current block.
      currBlock.push(instr);

      // If we hit an end instruction, push the current block and start a new one.
      if (END_INSTRS.has(instr.op)) {
        acc.push(currBlock);
        currBlock = [];
      }
      // If we hit a label, push the current block and start a new one beginning
      // with the label.
    } else if ("label" in instr) {
      if (currBlock.length > 0) {
        acc.push(currBlock);
      }

      currBlock = [instr];
    }

    return acc;
  }, []);

  // If there are any instructions left in the current block after iterating
  // through all instructions, push the current block.
  if (currBlock.length > 0) {
    blocks.push(currBlock);
  }

  return blocks;
}
