import * as ts from 'typescript';
import * as bril from './bril';

class Builder {
  public program: bril.Program = { functions: [] };

  private curFunction: bril.Function | null = null;
  private nextFresh: number = 0;

  buildFunction(name: string) {
    let func: bril.Function = { name, instrs: [] };
    this.program.functions.push(func);
    this.curFunction = func;
    this.nextFresh = 0;
    return func;
  }

  buildOp(op: bril.OpCode, args: string[], dest?: string) {
    dest = dest || this.fresh();
    let instr: bril.Operation = { op, args, dest };
    this.insertInstr(instr);
    return instr;
  }

  buildConst(value: bril.ConstValue, dest?: string) {
    dest = dest || this.fresh();
    let instr: bril.Const = { op: "const", value, dest };
    this.insertInstr(instr);
    return instr;
  }

  /**
   * Insert an instruction at the end of the current function.
   */
  private insertInstr(instr: bril.Instruction) {
    if (!this.curFunction) {
      throw "cannot build instruction without a function";
    }
    this.curFunction.instrs.push(instr);
  }

  /**
   * Generate an unused variable name.
   */
  private fresh() {
    let out = '%' + this.nextFresh.toString();
    this.nextFresh += 1;
    return out;
  }
}

/**
 * Compile a complete TypeScript AST to a Bril program.
 */
function emitBril(prog: ts.Node): bril.Program {
  let builder = new Builder();
  builder.buildFunction("main");

  function emitExpr(expr: ts.Expression): bril.Instruction {
    switch (expr.kind) {
    case ts.SyntaxKind.NumericLiteral:
      let lit = expr as ts.NumericLiteral;
      let val = parseInt(lit.getText());
      return builder.buildConst(val);
    
    case ts.SyntaxKind.Identifier:
      let ident = expr as ts.Identifier;
      return builder.buildOp(bril.OpCode.id, [ident.getText()]);
    
    case ts.SyntaxKind.BinaryExpression:
      let bin = expr as ts.BinaryExpression;
      let lhs = emitExpr(bin.left);
      let rhs = emitExpr(bin.right);
      let op;
      switch (bin.operatorToken.kind) {
      case ts.SyntaxKind.PlusToken:
        op = bril.OpCode.add;
        break;
      default:
        throw "unhandled binary operator kind";
      }
      return builder.buildOp(op, [lhs.dest, rhs.dest]);
      
    default:
      throw "unsupported expression kind";
    }
  }

  function emit(node: ts.Node) {
    switch (node.kind) {
      // Descend through containers.
      case ts.SyntaxKind.SourceFile:
      case ts.SyntaxKind.Block:
      case ts.SyntaxKind.VariableStatement:
      case ts.SyntaxKind.VariableDeclarationList:
        ts.forEachChild(node, emit);
        break;

      // No-op.
      case ts.SyntaxKind.EndOfFileToken:
        break;

      // Emit declarations.
      case ts.SyntaxKind.VariableDeclaration:
        let decl = node as ts.VariableDeclaration;

        // Declarations without initializers are no-ops.
        if (decl.initializer) {
          let init = emitExpr(decl.initializer);
          builder.buildOp(bril.OpCode.id, [init.dest], decl.name.getText());
        }

        break;
      
      default:
        console.error('unhandled TypeScript AST node', node.kind);
        break;
    }
  }

  emit(prog);
  return builder.program;
}

/**
 * Read all the data from stdin as a string.
 */
function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let chunks: string[] = [];
    process.stdin.on("data", function (chunk: string) {
      chunks.push(chunk);
    }).on("end", function () {
      resolve(chunks.join(""))
    }).setEncoding("utf8");
  });
}

async function main() {
  let sf = ts.createSourceFile(
    '-',
    await readStdin(),
    ts.ScriptTarget.ES2015,
    true,
  );
  let prog = emitBril(sf);
  process.stdout.write(
    JSON.stringify(prog, undefined, 2)
  );
}

main();