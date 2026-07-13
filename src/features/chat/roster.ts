// Pure roster helper shared by the chat client. The COLOSSUS bot IS in the
// /api/chat/users roster so DM name resolution (dmName / DM header / conversation
// list) can label it instead of showing "unknown" (F2). But it must stay invisible
// in every human-facing CHOOSER — the mention autocomplete, the new-DM picker, and
// the channel "Add people" picker — so those filter system users out through this
// single helper (T9 invariant: bot invisible in choosers, never a notification
// target). Kept framework-free so it is unit-testable without the React tree.
export function humanUsers<T extends { isSystem: boolean }>(users: T[]): T[] {
  return users.filter((u) => !u.isSystem)
}
