/**
 * Test doubles for collaborators that are classes.
 *
 * A class with private fields is nominally typed, so a plain object literal can
 * never satisfy it however complete it is. Rather than weaken production types
 * for the sake of tests, the assertion is confined to this one helper.
 *
 * Only the members a test actually exercises need to be supplied; touching an
 * unsupplied member fails loudly with a `TypeError`, which is the behaviour a
 * test wants anyway.
 */
export const asFake = <TTarget>(implementation: Partial<TTarget>): TTarget =>
  implementation as TTarget;
