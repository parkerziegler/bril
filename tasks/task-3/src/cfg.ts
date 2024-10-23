import type { BasicBlock } from "./blocks";
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

function freshLabel(prefix: string, labels: string[]): string {
  let i = 0;

  while (labels.includes(`${prefix}.${i}`)) {
    i++;
  }

  return `${prefix}.${i}`;
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

function createDistinguishedEntryBlock(blocks: BasicBlock[]): BasicBlock[] {
  // Check if the first label in the program is the target of a control flow
  // instruction. If it is, we need to create a distinguished entry block that
  // precedes it.
  const labels = blocks.flatMap((block) =>
    block.instrs.filter((instr) => "label" in instr).map((instr) => instr.label)
  );
  const firstLabel = labels[0];

  const instrs = blocks.flatMap((block) => block.instrs);

  let isFirstLabelTarget = false;
  for (const instr of instrs) {
    if (
      "op" in instr &&
      instr.op === "jmp" &&
      "labels" in instr &&
      instr.labels.includes(firstLabel)
    ) {
      isFirstLabelTarget = true;
      break;
    }
  }

  if (!isFirstLabelTarget) {
    return blocks;
  }

  // Create a new distinguished entry block.
  const entryBlock: BasicBlock = {
    id: -1,
    instrs: [
      {
        label: freshLabel("entry", labels),
      },
      {
        op: "jmp",
        labels: [firstLabel],
      },
    ],
    successors: new Set(),
    predecessors: new Set(),
  };

  blocks.unshift(entryBlock);

  return blocks;
}

export function createCFG(blocks: BasicBlock[]): BasicBlock[] {
  // First, ensure we have a distinguished entry block.
  const bbsWithEntry = createDistinguishedEntryBlock(blocks);

  // Now, create control flow edges.
  const bbs = bbsWithEntry.map((block) => {
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

      // Add an explicit jmp.
      const nextBlockLabel =
        "label" in nextBlock.instrs[0] ? nextBlock.instrs[0].label : "";

      block.instrs.push({ op: "jmp", labels: [nextBlockLabel] });
    }

    return block;
  });

  return bbs;
}
