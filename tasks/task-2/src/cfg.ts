import { BasicBlock } from "./blocks.js";
import * as bril from "./bril";

function isBranchInstr(
  instr: bril.Instruction | bril.Label
): instr is bril.Instruction {
  return "op" in instr && instr.op === "br";
}

function isJumpInstr(
  instr: bril.Instruction | bril.Label
): instr is bril.Instruction {
  return "op" in instr && instr.op === "jmp";
}

function isTerminatingInstr(
  instr: bril.Instruction | bril.Label
): instr is bril.Instruction {
  return "op" in instr && ["jmp", "ret", "br"].includes(instr.op);
}

export function findBlockByLabel(
  blocks: BasicBlock[],
  label: string
): BasicBlock | undefined {
  return blocks.find((block) => {
    const firstInstr = block.instrs[0];

    return "label" in firstInstr && firstInstr.label === label;
  });
}

export function createCFG(blocks: BasicBlock[]): BasicBlock[] {
  return blocks.map((block) => {
    const lastInstr = block.instrs[block.instrs.length - 1];

    // If we have a branch instruction, mark the labels as successors.
    // Additionally, mark this block as a predecessor of the target block.
    if (isBranchInstr(lastInstr) && "labels" in lastInstr) {
      for (const targetLabel of lastInstr.labels) {
        const targetBlock = findBlockByLabel(blocks, targetLabel);
        block.successors.add(targetBlock.id);
        targetBlock.predecessors.add(block.id);
      }

      // If we have a jump instruction, mark the target label as a successor.
      // Additionally, mark this block as a predecessor of the target block.
    } else if (isJumpInstr(lastInstr) && "labels" in lastInstr) {
      const targetLabel = lastInstr.labels[0];
      const targetBlock = findBlockByLabel(blocks, targetLabel);
      block.successors.add(targetBlock.id);
      targetBlock.predecessors.add(block.id);

      // If the last instruction is not a terminating instruction, mark the
      // following block as a successor. Additionally, mark this block as a
      // predecessor of the following block.
    } else if (!isTerminatingInstr(lastInstr) && block.id < blocks.length - 1) {
      const nextBlock = blocks[block.id + 1];
      block.successors.add(nextBlock.id);
      nextBlock.predecessors.add(block.id);
    }

    return block;
  });
}
