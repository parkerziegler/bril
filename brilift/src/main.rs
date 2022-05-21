use bril_rs as bril;
use cranelift::frontend::{FunctionBuilder, FunctionBuilderContext, Variable};
use cranelift::codegen::{ir, isa, settings};
use cranelift::codegen::ir::InstBuilder;
use cranelift::codegen::entity::EntityRef;
use cranelift::codegen::verifier::verify_function;
use cranelift_object::{ObjectModule, ObjectBuilder};
use cranelift_module::{default_libcall_names, Module};
use cranelift_native;
use std::collections::HashMap;

struct RTSigs {
    print_int: ir::Signature
}

struct RTIds {
    print_int: cranelift_module::FuncId
}

fn tr_type(typ: &bril::Type) -> ir::Type {
    match typ {
        bril::Type::Int => ir::types::I64,
        bril::Type::Bool => ir::types::B1,
    }
}

fn tr_sig(func: &bril::Function) -> ir::Signature {
    let mut sig = ir::Signature::new(isa::CallConv::SystemV);
    if let Some(ret) = &func.return_type {
        sig.returns.push(ir::AbiParam::new(tr_type(ret)));
    }
    for arg in &func.args {
        sig.params.push(ir::AbiParam::new(tr_type(&arg.arg_type)));
    }
    sig
}

fn all_vars(func: &bril::Function) -> HashMap<&String, &bril::Type> {
    func.instrs.iter().filter_map(|inst| {
        match inst {
            bril::Code::Instruction(op) => {
                match op {
                    bril::Instruction::Constant { dest, op: _, const_type: typ, value: _ } => {
                        Some((dest, typ))
                    },
                    bril::Instruction::Value { args: _, dest, funcs: _, labels: _, op: _, op_type: typ } => {
                        Some((dest, typ))
                    },
                    _ => None
                }
            },
            _ => None
        }
    }).collect()
}

struct Translator<M: Module> {
    rt_sigs: RTSigs,
    rt_funcs: RTIds,
    module: M,
    context: cranelift::codegen::Context,
}

impl Translator<ObjectModule> {
    fn new() -> Self {
        // Make an object module.
        // TODO Optionally try out the JIT someday!
        let flag_builder = settings::builder();
        let isa_builder = cranelift_native::builder().unwrap();
        let isa = isa_builder
            .finish(settings::Flags::new(flag_builder))
            .unwrap();
        let mut module =
            ObjectModule::new(ObjectBuilder::new(isa, "foo", default_libcall_names()).unwrap());

        // Set up the runtime library.
        // TODO Maybe these should be hash tables or something?
        let rt_sigs = RTSigs {
            print_int: {
                let mut sig = ir::Signature::new(isa::CallConv::SystemV);
                sig.params.push(ir::AbiParam::new(ir::types::I64));
                sig
            }
        };
        let rt_funcs = RTIds {
            print_int: {
                module
                    .declare_function("print_int", cranelift_module::Linkage::Import, &rt_sigs.print_int)
                    .unwrap()
            }
        };

        let context = cranelift::codegen::Context::new();
        
        Self {
            rt_sigs,
            rt_funcs,
            module,
            context,
        }
    }
}

impl<M: Module> Translator<M> {
    fn compile_func(&mut self, func: bril::Function) -> ir::Function {
        // Build function signature.
        let sig = tr_sig(&func);

        // Create the function.
        // TODO Do something about the name.
        let mut fn_builder_ctx = FunctionBuilderContext::new();
        let mut cl_func = ir::Function::with_name_signature(ir::ExternalName::user(0, 0), sig);
        
        // Build the function body.
        {
            let mut builder = FunctionBuilder::new(&mut cl_func, &mut fn_builder_ctx);

            // Declare runtime functions.
            let print_int = self.module.declare_func_in_func(self.rt_funcs.print_int, builder.func);

            // Declare all variables.
            let mut vars = HashMap::<&String, Variable>::new();
            for (i, (name, typ)) in all_vars(&func).iter().enumerate() {
                let var = Variable::new(i);
                builder.declare_var(var, tr_type(typ));
                vars.insert(name, var);
            }

            // TODO just one block for now...
            let block = builder.create_block();
            builder.switch_to_block(block);

            // Insert instructions.
            for code in &func.instrs {
                match code {
                    bril::Code::Instruction(inst) => {
                        match inst {
                            bril::Instruction::Constant { dest, op: _, const_type: _, value } => {
                                let var = vars.get(&dest).unwrap();
                                let val = match value {
                                    bril::Literal::Int(i) => builder.ins().iconst(ir::types::I64, *i),
                                    bril::Literal::Bool(b) => builder.ins().bconst(ir::types::B1, *b),
                                };
                                builder.def_var(*var, val);
                            },
                            bril::Instruction::Effect { args, funcs: _, labels: _, op } => {
                                match op {
                                    bril::EffectOps::Print => {
                                        // TODO Target should depend on the type.
                                        // TODO Deal with multiple args somehow.
                                        let var = vars.get(&args[0]).unwrap();
                                        let arg = builder.use_var(*var);
                                        builder.ins().call(print_int, &[arg]);
                                    },
                                    _ => todo!(),
                                }
                            },
                            _ => (),  // TODO
                        }
                    },
                    _ => (),  // TODO
                }
            }

            builder.ins().return_(&[]);  // TODO
            builder.seal_block(block);
            
            builder.finalize();
        }

        // Verify and print.
        let flags = settings::Flags::new(settings::builder());
        let res = verify_function(&cl_func, &flags);
        println!("{}", cl_func.display());
        if let Err(errors) = res {
            panic!("{}", errors);
        }

        // Add to the module.
        // TODO Move to a separate function?
        let func_id = self.module
            .declare_function(&func.name, cranelift_module::Linkage::Export, &cl_func.signature)
            .unwrap();
        self.module
            .define_function(func_id, &mut self.context)
            .unwrap();
        
        cl_func
    }
}

fn main() {
    // Load the Bril program from stdin.
    let prog = bril::load_program();
    
    let mut trans = Translator::<ObjectModule>::new();
    
    for bril_func in prog.functions {
        trans.compile_func(bril_func);
    }
}
