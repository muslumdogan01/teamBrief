// Invalidates in-flight loads/mutations before sign-out or an account/pub switch.
export function requestScope() {
  let generation = 0
  return { invalidate: () => ++generation, ticket: () => generation, current: (ticket: number) => ticket === generation }
}
export async function runMutation(write: () => Promise<unknown>, refresh: () => Promise<void>) {
  await write() // A failed write must never refresh or report success.
  try { await refresh() }
  catch { throw new Error('Saved, but refreshing failed. Reload before trying again to avoid a duplicate submission.') }
}
