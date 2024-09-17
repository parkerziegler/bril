import type { BasicBlock } from "./blocks.js";

/**
 * Apply the local value numbering algorithm to a basic block.
 *
 * @param block – The basic block to analyze.
 * @returns – The basic block with instructions replaced by their value numbers.
 */
export function lvn(block: BasicBlock): BasicBlock {
  const valueToNumber = new Map<string, number>();
  const numberToValue = new Map<number, string>();
  const varToNumber = new Map<string, number>();
  const numberToVar = new Map<number, string[]>();

  let counter = 0;

  function addValue(valueNumber: number, value: string) {
    valueToNumber.set(value, valueNumber);
    numberToValue.set(valueNumber, value);
  }

  const instrs = block.map((instr) => {
    if ("op" in instr && "dest" in instr) {
      // Canonicalize the instruction's arguments, if any.
      const args = (
        "args" in instr
          ? instr.args
          : instr.op === "const"
            ? [instr.value.toString()]
            : []
      ).map((arg) => varToNumber.get(arg) ?? arg);

      // Create the canonicalized value for the instruction.
      const value = `${instr.op} ${args.join(" ")}`;

      // Look up the value number of this value.
      let valueNumber = valueToNumber.get(value);

      if (typeof valueNumber === "undefined") {
        // If we haven't seen this value before, assign it a new value number.
        valueNumber = counter;
        addValue(valueNumber, value);
        counter++;
      } else {
        // We have seen this value number before. Update the instruction.
        //
        // If we have a constant operation, replace it with an id operation.
        // Otherwise, just overwrite the op and args fields.
        if (instr.op === "const") {
          instr = {
            op: "id",
            dest: instr.dest,
            type: instr.type,
            args: [numberToVar.get(valueNumber)![0]],
            pos: instr.pos,
          };
        } else if (instr.op !== "call") {
          instr.op = "id";
          instr.args = [numberToVar.get(valueNumber)![0]];
        }
      }

      if ("dest" in instr && varToNumber.get(instr.dest)) {
        // The destination variable already has a value number. We need to re-
        // move all references to this variable / value / value number combina-
        // tion from the maps.
        const assocNum = varToNumber.get(instr.dest)!;
        const assocValue = numberToValue.get(assocNum)!;

        numberToValue.delete(assocNum);
        valueToNumber.delete(assocValue);
        addValue(valueNumber, value);

        varToNumber.delete(instr.dest);
        varToNumber.set(instr.dest, valueNumber);

        numberToVar.delete(assocNum);
        numberToVar.set(
          valueNumber,
          numberToVar.get(valueNumber)?.concat([instr.dest]) ?? [instr.dest],
        );
      } else if ("dest" in instr) {
        varToNumber.set(instr.dest, valueNumber);
        numberToVar.set(
          valueNumber,
          numberToVar.get(valueNumber)?.concat([instr.dest]) ?? [instr.dest],
        );
      }
    }

    return instr;
  });

  return instrs;
}
