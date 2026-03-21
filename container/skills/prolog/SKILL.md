---
name: prolog
description: Logic programming with SWI-Prolog (swipl). Solve constraint problems, run queries, and write Prolog programs. The swipl CLI is available via Bash.
allowed-tools: Bash(swipl:*)
---

# SWI-Prolog

## Quick start

```bash
# Run a query directly
swipl -g "member(X, [a,b,c]), write(X), nl, fail ; true" -t halt

# Run a script file
swipl -g main -t halt script.pl

# Interactive top-level (use for debugging)
swipl
```

## One-liner queries

```bash
# Arithmetic
swipl -g "X is 2**10, write(X), nl" -t halt

# List operations
swipl -g "append([1,2],[3,4],L), write(L), nl" -t halt

# Find all solutions
swipl -g "findall(X, between(1,10,X), L), write(L), nl" -t halt
```

## Running programs

```bash
# Write a Prolog file, then query it
cat > solve.pl << 'EOF'
parent(tom, bob).
parent(tom, liz).
parent(bob, ann).
ancestor(X, Y) :- parent(X, Y).
ancestor(X, Y) :- parent(X, Z), ancestor(Z, Y).

main :-
    findall(Y, ancestor(tom, Y), Descendants),
    format("Descendants of tom: ~w~n", [Descendants]),
    halt.
EOF
swipl -g main solve.pl
```

## Tips

- Use `-g Goal -t halt` for scripting (avoids interactive prompt)
- Use `findall/3`, `aggregate_all/3` to collect solutions
- SWI-Prolog includes constraint solvers: `use_module(library(clpfd))` for integers, `library(clpb)` for booleans
- Scripts are stored in `/workspace/group/` (per-group) or `/workspace/extra/` (shared)
