import * as bril from "./bril";

const END_INSTRS = new Set(["jmp", "ret", "br"]);

export interface BasicBlock {
  id: number;
  instrs: (bril.Instruction | bril.Label)[];
  successors: Set<number>;
  predecessors: Set<number>;
}

export function createBasicBlocks(fn: bril.Function): BasicBlock[] {
  let blockId = 0;
  let currBlock: BasicBlock = {
    id: 0,
    instrs: [],
    successors: new Set(),
    predecessors: new Set(),
  };

  const blocks = fn.instrs.reduce<BasicBlock[]>((acc, instr) => {
    if ("op" in instr) {
      // Push the current instruction to the current block.
      currBlock.instrs.push(instr);

      // If we hit an end instruction, push the current block and start a new one.
      if (END_INSTRS.has(instr.op)) {
        acc.push(currBlock);
        blockId++;

        currBlock = {
          id: blockId,
          instrs: [],
          successors: new Set(),
          predecessors: new Set(),
        };
      }
      // If we hit a label, push the current block and start a new one beginning
      // with the label.
    } else if ("label" in instr) {
      if (currBlock.instrs.length > 0) {
        acc.push(currBlock);
        blockId++;
      }

      currBlock = {
        id: blockId,
        instrs: [instr],
        successors: new Set(),
        predecessors: new Set(),
      };
    }

    return acc;
  }, []);

  // If there are any instructions left in the current block after iterating
  // through all instructions, push the current block.
  if (currBlock.instrs.length > 0) {
    blocks.push(currBlock);
  }

  return blocks;
}
