---
name: good-tests
description: What makes a test worth keeping. Use when writing, changing, or reviewing tests, whether test-first or after the code.
---

# Good tests

A good test verifies behaviour through a module's interface and fails when that behaviour breaks. Code can change entirely; the test shouldn't. It reads like a specification: "user can checkout with valid cart" says what capability exists, and survives refactors because it doesn't care about internal structure.

Read `GLOSSARY.md` so test names use the project's domain language. For the module, interface and seam vocabulary, call the Skill tool with "codebase-design". See [tests.md](tests.md) for examples and [mocking.md](mocking.md) for where mocks belong.

## Before writing a test

- **Name the behaviour** it protects, and the credible regression that would turn it red.
- **Find the existing proof.** Each behaviour has one primary test, at the strongest seam that observes it. When a test already covers it, extend that test or its table instead of adding a second one at another layer. A bug fix gets one regression test, at the module that owned the bug.
- **Test through the real interface.** When a test seems to need a new export, flag, getter, or injection parameter that production never uses, that is a hypothetical seam with the test as its only adapter: move the test to the interface production calls.

## Anti-patterns

Each is a test that can't tell working code from broken code. Check every test against both lists.

**Tautological**: the test passes by construction, so it can never disagree with the code. Expected values come from an independent source of truth: a known-good literal, a worked example, the spec. Its forms:

- The expected value is recomputed the way the code computes it (`expect(add(a, b)).toBe(a + b)`), or produced by the code under test itself.
- Constants asserted against themselves or each other (`release > capture`): that tests config, not behaviour.
- A mock or fixture supplies the very value the test then asserts.
- A copied inventory: a hand-maintained list of exports, files, or keys that only restates the source.
- A negative test that passes because some other guard rejects the input, or a rejection the code never reaches.
- An assertion-free test, or a name that promises behaviour the assertions never check.

**Implementation-coupled**: the test breaks when you refactor but behaviour hasn't changed. Its forms:

- Mocks internal collaborators, or asserts call counts, call order, or the arguments passed to them.
- Tests private functions, or a helper again at every caller instead of once at its own interface.
- Verifies through a side channel (querying the database, grepping the source) instead of through the interface.
- Hardcodes tuning values (pixel edges, timeouts) the behaviour doesn't depend on; place probes relative to the imported constants instead.

Writing tests after the code is where tautology creeps in most: you have just read the implementation, and its logic leaks into the expected values. Derive them from the spec or a worked example, not from the code.

## Make it go red

Every new or changed test must be seen failing for the intended reason:

- **Test-first**: it is red before the implementation exists.
- **Bug fix**: it is red on the code before the fix.
- **After the code**: break the behaviour on purpose (flip a condition, drop a branch, change a constant), confirm the test goes red with a failure that names that behaviour, then restore the code exactly.

A test you have never seen red is unproven. When you can't run the red check, say so in your report.
