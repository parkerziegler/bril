# Strictly Declarative Specification of Sophisticated Points-to Analyses

_Martin Bravenboer and Yannis Smaragdakis. ACM SIGPLAN Notices, Volume 44, Issue 10, Pages 243-262._

## Commentary

As my foray into being a Datalog-curious researcher progresses, I found this paper to be quite a bit of fun! The core theme that resonated for me was just _how much_ you really can model in Datalog's declarative paradigm, and how the declarative style makes implementing points to analysis (and other derivative analyses) much more tractable in an extremely feature rich language like Java. This snippet in particular stood out:

> In the past, researchers have questioned whether it is even possible to express purely declaratively a full-featured points-to analysis (comparable to Paddle, which uses imperative code with support for relations [17]). Lhotak [15] writes: _“[E]ncoding all the details of a complicated program analysis problem (such as the interrelated analyses [on-the-fly call graph construction, handling of Java features]) purely in terms of subset constraints [i.e., Datalog] may be difficult or impossible.”_ Doop demonstrates that an elegant declarative specification is possible and even easy.

Along this line, the core feature of Section 3 that stood out to me was on-the-fly call graph construction. Between Figures 1 and 2, we have this incredibly elegant, declarative constraint system for defining a `CallGraphEdge` and specifying `MethodLookup`s, both of which read more or less like language specifications. For example, it's quite clear from Figure 2 that a `MethodLookup` corresponds to 1 of 3 cases:

1. A `MethodImpl` exists with the same `name`, `descriptor`, and return `type`.
2. A `DirectSuperclass` exists whose return `supertype` matches the query `type`, the recursive `MethodLookup` call holds (case 1), and a `MethodImpl` does not exist with the same `name`, `descriptor`, and return `type`.
3. A `MethodDecl` exists with the same `name`, `descriptor`, and return `type` and the method is not `abstract`.

I loved how Figure 3—discussing the `Checkcast` implementation in Doop—echoes this almost 1-for-1 translation of the Java language specification into the Datalog rules themselves. I've seen Datalog probably two or three times at this point, and this was probably the first instance where its expressiveness for describing complex language features and data structures really made concrete sense. Truly, I found it extremely impressive that they don't seem to rely on interfacing with _any_ imperative Java application code for their analyses while simultaneously achieving markedly better performance over prior work.

I'll also briefly comment on how neat some of the optimizations discussed in Section 4 are. The standout to me was index construction and its correspondence to variable order in a relation. The fact that you can reconstruct the major indices of a B-tree just by _reordering variables in a relation_ feels wild (in a good way). While part of me finds this concerning (whoops, I'm a new Doop user and I didn't consider variable ordering when defining my relations—why are all my joins slow?), I also love the idea that squeezing more performance out of the system is something that can happen through _program transformation_ rather than mucking about in the database itself. It reminds me of some of the best elements of the declarative infrastructure-as-code (IAC) frameworks like Terraform, where many concrete performance gains for large, distributed systems can be achieved through very small program transformations. Extremely cool!
