# Constant Propagation with Conditional Branches

_Wegman, Mark N., and F. Kenneth Zadeck. ACM Transactions on Programming Languages and Systems, Vol. 13, No. 2, April 1991, Pages 181-210._

## Commentary

While reading this paper, I was struck by how the core structure of the four algorithms presented resembled other static analysis techniques I've seen before, including abstract interpretation and symbolic execution. It's a funny thing, three years into a PL PhD, to realize that a lot of our tools share the same general framework while specializing on details—the domain of the lattice, propagation of values from ⊥ to ⊤ or vice-versa, the strategy for joining / meeting values from multiple entry paths. The discussion of ɸ-functions and their role in SSC in particular felt analagous to ɸ-functions I've seen in symbolic execution and concolic testing as we're trying to reason about possible execution paths through a program.

With that said, I did find lots of interesting new nuggets in this paper.

1. **Impact of the choice of LatticeCell initialization value.** I loved the discussion around the choice to use ⊤ rather than ⊥ as the initialization value for LatticeCells and the way this choice shifts the authors' algorithms from being pessimistic to optimistic. While it seems like a subtle distinction, the choice of ⊤ in some sense provides _the potential_ for all values to flow to a constant; in contrast, ⊥ _requires certainty_ that a value can only be a constant before promotion in the lattice. While the choice to use an optimistic flavor to these algorithms does impose the burden of running to natural termination, it's neat to see how this flip in framing can yield a more aggressive analysis.
2. **Minimal SSA Form and ɸ-functions.** The discussion of SSC and the role of SSA and the SSA graph in the algorithm was pretty neat! Figures 7 and 8 really show off how the SSA graph makes construction and insertion of ɸ-functions easier to reason about. It was interesting—though not necessarily surprising—that the set of nodes that require ɸ-functions stabilizes over time; again, it feels more or less like symbolic execution run to a fixed point. Still, the idea of finding the _minimal_ number of ɸ-functions to achieve minimal SSA form (and that this is computable) is just cool!
  - The discussion of asymptotic complexity here was also nice, specifically the bit about how each SSA edge must be examined at least once and at most twice, corresponding to the potential lowerings in the lattice to 𝓵 or ⊥.
3. **SCC and utilizing SSA**. I loved this observation from the paper:

> CC may be impractically slow and, consequently, was ignored for a long time. Many workers in code optimization had tried to derive practical sparse algorithms that achieved CC’s results. However, they started from the sparse representation then prevailing, def-use chains without SSA form.

This seems like the crux of the argument for why their algorithm is better than past approaches—they exploit the ability to mark SSA edges as executable _and only_ apply the meet operator to operands of corresponding ɸ-functions. It's lovely how movement of the problem to a new representation (SSA vs. sparse representation from CC) allows them to solve the performance problems of prior approaches while preserving the qualities that make those approaches successful.
