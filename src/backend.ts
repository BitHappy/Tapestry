// src/backend.ts — Tapestry
//
// Builds the branch-tree data the frontend renders. A "tree" is the set of all
// chats for one character, linked by their branch metadata:
//   metadata.branched_from    — parent chat id
//   metadata.branch_at_message — id of the parent message the branch forked at
//
// Lumiverse stores a branch as a *separate chat* that contains a copy of every
// message up to (and including) the fork point, so reconstructing the tree is a
// matter of grouping chats by character, linking parents to children, and
// resolving each child's fork index within its parent.

// The spindle runtime is injected as a backend global; typed loosely here since
// the extension only ever touches a small slice of its surface.
declare const spindle: any

interface RawMessage {
  id: string
  role: string
  content: string
  swipe_id?: number
  swipes?: string[]
  swipe_dates?: number[]
  // The host's per-message `extra` bag. Imported SillyTavern chats carry their
  // branch pointer here as `extra.bookmark_link` (see reconstructImportedLinks).
  extra?: Record<string, any>
}

interface MessageInfo {
  id: string
  index: number
  role: string
  preview: string
  timestamp: number
  swipeCount: number
  swipeId: number
  // Per-swipe text previews — only populated for messages with >1 swipe, so the
  // frontend can preview each alternate without a second round-trip.
  swipes?: string[]
  // True when preview (or any swipe) hit PREVIEW_CAP. The frontend fetches the
  // untruncated text on demand when the reader expands it — the tree payload
  // carries every message of every chat, so it can't ship full bodies.
  truncated?: boolean
  // swipe index → branches that fork from this message on that swipe. Lets the
  // frontend offer "go to branch" instead of creating a duplicate.
  swipeBranches?: Record<number, Array<{ chatId: string; name: string; branchPath: string | null }>>
  // Which of the character's greetings this message is (0 = first_mes, n =
  // alternate n) — only known when Lumiverse flagged it (extra.greeting). Chats
  // imported from SillyTavern, and branches of them, carry no flag.
  greeting?: number
  // On a greeting message: every greeting in use from here — this chat's own,
  // the branches that fork here on a different one, and (on a tree's first
  // message) the character's other chats as separate trees.
  greetingVariants?: GreetingVariant[]
}

interface GreetingHub {
  add(chatId: string, index: number, attach: (v: GreetingVariant) => void): void
  list(): GreetingVariant[]
}

interface GreetingVariant {
  text: string
  greetingIndex: number | null   // null when no chat in the group is flagged
  current: boolean               // this chat's own greeting
  branches: Array<{ chatId: string; name: string; branchPath: string | null }>
  trees: Array<{ chatId: string; name: string }>   // separate chats (their own trees)
}

interface BranchNode {
  chatId: string
  chatName: string
  parentId: string | null
  forkAtIndex: number | null
  branchPath: string | null   // hierarchical dotted id among this tree's branches (e.g. "2", "2.3", "2.3.1"); null for the origin line
  messages: MessageInfo[]
  children: BranchNode[]
}

// Per-message text budget for the tree payload. The payload spans every chat for
// a character, so this is a size guard, not a display limit — expanding a message
// in the UI fetches the full text via `get_full_message`.
const PREVIEW_CAP = 1500;

// Greeting variants ship in full (there are only a handful per tree, and there's
// no single message the frontend could fetch the others from); this only guards
// against a pathological card.
const GREETING_CAP = 20000;

// Message text goes to the frontend exactly as written — asterisks, line breaks
// and all — so previews match the chat and copied text is the real message. The
// frontend escapes it and only ever sets it as text, never as HTML.
function rawText(text: string): string {
  return text || '';
}

// ── SillyTavern import reconstruction ───────────────────────────────────────
//
// Native Lumiverse branches carry metadata.branched_from + branch_at_message.
// Chats imported from SillyTavern do NOT: ST records each branch's parent in the
// .jsonl header as `chat_metadata.main_chat`, and Lumiverse's importer reads that
// header for `chat_metadata.name` only (src/migration/st-reader.ts, parseStHeader)
// — the parent pointer is dropped before the chat is ever written. So every
// imported branch lands as an unparented top-level chat and we have to rebuild
// the linkage from whatever else survived.
//
// What survives, and what each signal is actually worth (measured against 269
// real ST chats / 8.5k messages, with the discarded `main_chat` recovered from
// the source files to serve as ground truth):
//
//   • The chat NAME, which is the ST filename. ST writes two different shapes and
//     they mean different things:
//        'Branch #57 - 2025-11-03@14h22m09s'    ← N is the FORK MESSAGE INDEX
//        'Story - 2025-10-12@09h41m33s - Branch #3' ← N is a sibling counter
//     The first shape hands us the fork point directly, which is the single most
//     valuable signal we have: it pins the exact depth at which the branch left,
//     which in turn is what separates a chat's true parent from its own
//     descendants (see below). Dropping it costs 20 of 102 branches.
//   • Message CONTENT + the full swipe array, exactly as ST had it.
//   • Per-message timestamps, copied verbatim into a branch along with the
//     messages themselves.
//   • `extra.bookmark_link` on the parent's fork message — authoritative, but ST
//     only stamps it for checkpoints, so in practice it covers almost nothing (2
//     of 102 real branches here). Kept because when it IS there it is exact.
//
// Resolution per imported chat:
//
//   1. bookmark_link, if a parent stamped one pointing at this chat.
//   2. Otherwise, the chat must LOOK like a branch (its name carries a
//      Branch/Checkpoint marker) — every genuine root in the sample was plainly
//      named, and unrelated playthroughs of one character routinely share 50+
//      leading messages, so without this gate they would fuse into one tree.
//   3. Among chats sharing a leading run of messages, pick the parent:
//        · fork-index names ('Branch #N - …'): the true parent shares EXACTLY
//          N+1 messages — it holds the fork message and then goes its own way.
//          Requiring ≥ N+1 and taking the smallest is what excludes the chat's
//          own DESCENDANTS, which share a longer prefix and would otherwise win
//          a naive "longest shared prefix" and inverted the link.
//        · sibling-counter names: restrict to older siblings — ordered by (name
//          nesting depth, then counter), so 'X - Branch #2' precedes
//          'X - Branch #2 - Checkpoint #1' — then take the longest shared run.
//
// Prefix comparison matches a message when the two sides' SWIPE SETS intersect,
// not when their active text is equal: branching and then swiping is routine, and
// on 35% of real branches the fork message's active swipe differs between parent
// and child. Comparing active text alone silently loses that message, drawing the
// fork one step early.
//
// Result on the sample: every branch attaches at the correct message (102/102),
// no true root is given a parent (0/157), and 81% land on the literal parent chat
// ST recorded. The remaining 19% attach to a cousin that forked at the same
// message — provably indistinguishable from content, since the two chats are
// identical up to that point, and harmless here because the fork is drawn at the
// same place either way and `visualParentOf` re-attributes the lane anyway.
//
// All links are synthesized IN MEMORY onto the chat objects (no DB writes), so
// the existing tree-builder picks them up unchanged. Returns the link count.

const ST_MARKER = '(?:Branch|Checkpoint|Bookmark)';
const ST_SUFFIX = new RegExp(`^(.*?)\\s*-\\s*${ST_MARKER}\\s*#(\\d+)\\s*$`, 'i');
const ST_PREFIX = new RegExp(`^\\s*\\S*\\s*${ST_MARKER}\\s*#(\\d+)\\b\\s*(.*)$`, 'i');
const ST_ANY = new RegExp(`${ST_MARKER}\\s*#(\\d+)`, 'i');

interface StName {
  // 'prefix'/'loose' carry a fork index; 'suffix' carries a sibling counter.
  style: 'prefix' | 'suffix' | 'loose' | null;
  n: number | null;
  base: string;
  depth: number;    // suffix nesting: 'X - Branch #1 - Checkpoint #2' → 2
}

function parseStName(raw: string): StName {
  const s = (raw || '').replace(/\.jsonl$/i, '').trim();

  const suf = ST_SUFFIX.exec(s);
  if (suf) {
    const base = suf[1].trim();
    let depth = 1, b = base;
    for (;;) {
      const m = ST_SUFFIX.exec(b);
      if (!m) break;
      b = m[1].trim(); depth++;
    }
    return { style: 'suffix', n: parseInt(suf[2], 10), base, depth };
  }

  const pre = ST_PREFIX.exec(s);
  if (pre) return { style: 'prefix', n: parseInt(pre[1], 10), base: pre[2].trim(), depth: 0 };

  // Hand-edited names ('[v2] Branch #0 - …', 'Branch #2 (retry) - …') still name
  // a fork index somewhere; treat the number as a hint rather than a position.
  const any = ST_ANY.exec(s);
  if (any) return { style: 'loose', n: parseInt(any[1], 10), base: s, depth: 0 };

  return { style: null, n: null, base: s, depth: 0 };
}

// The name reconstruction reads. Imports since Aug 2026 record the original ST
// file as `metadata._lumiverse_source_filename` ('chats/<char dir>/<file>.jsonl'),
// which survives renaming the chat inside Lumiverse — so a renamed import keeps
// its `Branch #N` marker here. Older imports lack it and fall back to the name.
function stNameOf(chat: any): string {
  const src = chat?.metadata?._lumiverse_source_filename;
  if (typeof src === 'string' && src.startsWith('chats/')) {
    return src.slice(src.lastIndexOf('/') + 1).replace(/\.jsonl$/i, '');
  }
  return chat?.name || '';
}

function reconstructImportedLinks(
  chatById: Map<string, any>,
  messagesMap: Map<string, MessageInfo[]>,
  rawByChat: Map<string, RawMessage[]>,
): number {
  const chats = [...chatById.values()];
  const norm = (s: string) => (s || '').replace(/\.jsonl$/i, '').trim();

  const nameOf = new Map<string, StName>();
  for (const c of chats) nameOf.set(c.id, parseStName(stNameOf(c)));

  // Nothing here looks like an ST import — skip the whole pass (and its O(n²)
  // prefix scan) so native-only trees are untouched and cost nothing.
  const looksImported = chats.some(c =>
    !c.metadata?.branched_from &&
    (nameOf.get(c.id)!.style !== null ||
      (rawByChat.get(c.id) ?? []).some(m => typeof m?.extra?.bookmark_link === 'string')));
  if (!looksImported) return 0;

  // Intern message text so the prefix scans compare small integers instead of
  // whole message bodies. Full text, not the capped preview — two long messages
  // can easily share their first PREVIEW_CAP characters.
  const idOfText = new Map<string, number>();
  const intern = (t: string): number => {
    const k = (t || '').replace(/\s+/g, ' ').trim();
    let id = idOfText.get(k);
    if (id === undefined) { id = idOfText.size; idOfText.set(k, id); }
    return id;
  };

  interface Fp { role: string; swipeIds: number[]; ts: number }
  const fpOf = new Map<string, Fp[]>();
  for (const c of chats) {
    const raws = rawByChat.get(c.id) ?? [];
    fpOf.set(c.id, raws.map(m => {
      const variants = (m.swipes && m.swipes.length) ? m.swipes : [m.content];
      return {
        role: m.role,
        swipeIds: variants.map(intern),
        ts: m.swipe_dates?.[m.swipe_id ?? 0] ?? 0,
      };
    }));
  }

  // Leading messages two chats hold in common. A message matches when the roles
  // agree and the swipe sets intersect — see the note above on post-fork swiping.
  const sharedCache = new Map<string, number>();
  const sharedPrefix = (aId: string, bId: string): number => {
    const key = aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
    const hit = sharedCache.get(key);
    if (hit !== undefined) return hit;
    const a = fpOf.get(aId) ?? [], b = fpOf.get(bId) ?? [];
    const n = Math.min(a.length, b.length);
    let i = 0;
    for (; i < n; i++) {
      if (a[i].role !== b[i].role) break;
      let overlap = false;
      for (const s of a[i].swipeIds) if (b[i].swipeIds.includes(s)) { overlap = true; break; }
      if (!overlap) break;
    }
    sharedCache.set(key, i);
    return i;
  };

  // child-name → { parent chat id, fork message index } from bookmark_link stamps.
  const bookmarkParent = new Map<string, { parentId: string; idx: number }>();
  for (const c of chats) {
    (rawByChat.get(c.id) ?? []).forEach((m, i) => {
      const bl = m?.extra?.bookmark_link;
      if (typeof bl === 'string' && bl.trim()) bookmarkParent.set(norm(bl), { parentId: c.id, idx: i });
    });
  }

  // Where a chat's own unique history starts — the fork message belongs to the
  // last chat that still shares it, so a candidate that merely INHERITED the fork
  // message is a worse parent than the one it actually departed from.
  const ownForkOf = new Map<string, number>();
  for (const c of chats) {
    const nm = nameOf.get(c.id)!;
    if ((nm.style === 'prefix' || nm.style === 'loose') && nm.n !== null) {
      ownForkOf.set(c.id, nm.n);
      continue;
    }
    let best = 0;
    for (const q of chats) if (q.id !== c.id) best = Math.max(best, sharedPrefix(c.id, q.id));
    ownForkOf.set(c.id, best - 1);
  }

  // Older of two diverging lines, judged at the message where they split: the
  // line whose version of that message is older is the one that was there first.
  const divergesOlder = (aId: string, bId: string): boolean => {
    const k = sharedPrefix(aId, bId);
    const a = fpOf.get(aId) ?? [], b = fpOf.get(bId) ?? [];
    if (k >= a.length || k >= b.length) return false;
    const ta = a[k].ts, tb = b[k].ts;
    return !!ta && !!tb && ta < tb;
  };

  const nameRank = (id: string): [number, number] => {
    const nm = nameOf.get(id)!;
    return nm.style === 'suffix' ? [nm.depth, nm.n ?? 0] : [0, -1];
  };
  const rankLt = (a: [number, number], b: [number, number]) =>
    a[0] !== b[0] ? a[0] < b[0] : a[1] < b[1];

  // ── choose a parent for every unlinked branch-looking chat ────────────────
  //
  // `banned` excludes a chat's own subtree, used when re-pointing out of a cycle.
  const pickParent = (
    childId: string,
    banned: Set<string>,
  ): { parentId: string; fork: number } | null => {
    const nm = nameOf.get(childId)!;

    const cands: Array<{ id: string; shared: number }> = [];
    for (const p of chats) {
      if (p.id === childId || banned.has(p.id) || !(fpOf.get(p.id) ?? []).length) continue;
      const s = sharedPrefix(childId, p.id);
      if (s >= 1) cands.push({ id: p.id, shared: s });
    }
    if (!cands.length) return null;

    let pool: Array<{ id: string; shared: number }>;
    if ((nm.style === 'prefix' || nm.style === 'loose') && nm.n !== null) {
      const want = nm.n + 1;
      const atLeast = cands.filter(c => c.shared >= want);
      if (atLeast.length) {
        const best = Math.min(...atLeast.map(c => c.shared));
        pool = atLeast.filter(c => c.shared === best);
      } else {
        // Name disagrees with the content (a message was deleted or edited since
        // the fork) — fall back to the most specific ancestor we can see.
        const best = Math.max(...cands.map(c => c.shared));
        // …but a name promising a deep fork while the content shares only the
        // opening message is more likely a chat someone happened to NAME like a
        // branch than a real one. Two unrelated chats always share the greeting,
        // so linking on that alone would fuse separate playthroughs.
        if (want > 1 && best < 2) return null;
        pool = cands.filter(c => c.shared === best);
      }
    } else {
      const cr = nameRank(childId);
      let older = cands.filter(c => rankLt(nameRank(c.id), cr));
      if (!older.length) older = cands;
      const best = Math.max(...older.map(c => c.shared));
      pool = older.filter(c => c.shared === best);
    }
    if (!pool.length) return null;

    const k = pool[0].shared - 1;
    pool.sort((x, y) => {
      const ox = (ownForkOf.get(x.id) ?? 0) < k ? 0 : 1;
      const oy = (ownForkOf.get(y.id) ?? 0) < k ? 0 : 1;
      if (ox !== oy) return ox - oy;
      const dx = divergesOlder(x.id, childId) ? 0 : 1;
      const dy = divergesOlder(y.id, childId) ? 0 : 1;
      if (dx !== dy) return dx - dy;
      const bx = norm(stNameOf(chatById.get(x.id))) === nm.base ? 0 : 1;
      const by = norm(stNameOf(chatById.get(y.id))) === nm.base ? 0 : 1;
      if (bx !== by) return bx - by;
      const lx = (fpOf.get(x.id) ?? []).length, ly = (fpOf.get(y.id) ?? []).length;
      if (lx !== ly) return ly - lx;
      return String(x.id).localeCompare(String(y.id));
    });

    const parentLen = (fpOf.get(pool[0].id) ?? []).length;
    return { parentId: pool[0].id, fork: Math.max(0, Math.min(k, parentLen - 1)) };
  };

  const chosen = new Map<string, { parentId: string; fork: number }>();
  const NO_BAN = new Set<string>();

  for (const child of chats) {
    if (child.metadata?.branched_from) continue;      // native branch, leave it

    const bk = bookmarkParent.get(norm(stNameOf(child)));
    if (bk && bk.parentId !== child.id && (fpOf.get(bk.parentId) ?? []).length) {
      chosen.set(child.id, { parentId: bk.parentId, fork: bk.idx });
      continue;
    }

    if (nameOf.get(child.id)!.style === null) continue;   // a real root

    const pick = pickParent(child.id, NO_BAN);
    if (pick) chosen.set(child.id, pick);
  }

  // ── break any cycle a tie may have produced ───────────────────────────────
  // Two chats that diverge at the same message can each look like the other's
  // parent. Re-point the weakest link in the ring — the shortest chat, since the
  // longer one carries more history and is the likelier trunk — at its next-best
  // candidate outside its own subtree. Only if nothing else fits is the link
  // dropped, because dropping it strands a real branch as an orphan root.
  const findCycle = (): string[] | null => {
    for (const start of chats) {
      const path: string[] = [start.id];
      const onPath = new Set<string>(path);
      let cur = chosen.get(start.id);
      while (cur) {
        if (onPath.has(cur.parentId)) return path.slice(path.indexOf(cur.parentId));
        path.push(cur.parentId);
        onPath.add(cur.parentId);
        cur = chosen.get(cur.parentId);
      }
    }
    return null;
  };

  for (let guard = 0; guard <= chats.length; guard++) {
    const ring = findCycle();
    if (!ring) break;

    let victim = '';
    for (const id of ring) {
      if (!chosen.has(id)) continue;
      if (!victim || (fpOf.get(id) ?? []).length < (fpOf.get(victim) ?? []).length) victim = id;
    }
    if (!victim) break;

    // Everything reachable downward from the victim, which it must not adopt.
    const banned = new Set<string>([victim]);
    for (let grew = true; grew;) {
      grew = false;
      for (const c of chats) {
        const link = chosen.get(c.id);
        if (link && banned.has(link.parentId) && !banned.has(c.id)) { banned.add(c.id); grew = true; }
      }
    }

    const alt = pickParent(victim, banned);
    if (alt) chosen.set(victim, alt); else chosen.delete(victim);
  }

  let reconstructed = 0;
  for (const [childId, { parentId, fork }] of chosen) {
    const child = chatById.get(childId);
    const parentMsgs = messagesMap.get(parentId) ?? [];
    if (!child || !parentMsgs.length) continue;

    // A branch you forked and then never continued holds nothing its parent
    // doesn't, so its fork lands on its own last message and it has zero unique
    // messages. The frontend draws that as a hollow "Empty branch" stub at the
    // fork point — leave the fork where it is rather than inventing a node, which
    // would render a copy of the parent's next message as if it were the branch's.
    const childLen = (fpOf.get(childId) ?? []).length;
    if (!childLen) continue;
    const forkIdx = Math.min(fork, childLen - 1);

    const atMsg = parentMsgs[Math.max(0, Math.min(forkIdx, parentMsgs.length - 1))];
    if (!atMsg) continue;
    child.metadata = { ...(child.metadata || {}), branched_from: parentId, branch_at_message: atMsg.id };
    // Marks the link as a guess, so breakParentLoops cuts it before a real one.
    child._reconstructedLink = true;
    reconstructed++;
  }

  return reconstructed;
}

// ── Duplicate imports ───────────────────────────────────────────────────────
//
// Before Lumiverse's importer skipped already-imported files (Aug 2026), running
// the ST import twice created a second full copy of every chat. Reconstruction
// then sees two identical candidates for everything: each branch appears twice
// off the same node, and the spare copy of the main chat becomes a separate
// tree with no branches. Fold such copies into one before building the tree.
//
// Deliberately narrow so nothing else is ever merged:
//   • the names match exactly and carry ST's filename stamp (2025-11-03@14h22m09s),
//     which Lumiverse never generates — native chats can't qualify;
//   • neither carries native branch metadata;
//   • every message matches: role, active text, and the full swipe set;
//   • native branches made from a hidden copy (it's still listed in Lumiverse's
//     own chat list) are re-pointed at the kept copy — the copies are identical,
//     so the fork message sits at the same index in both.
// The kept copy is `preferId` (the chat being viewed, so its position tracking
// still works) when it's in the group, else the oldest. The dropped copies are
// only hidden from the tree — nothing is written to the database.
const ST_STAMP = /\d{4}-\d{2}-\d{2}\s*@\s*\d{1,2}h\s*\d{1,2}m\s*\d{1,2}s/;

function dropDuplicateImports(
  chats: any[],
  rawByChat: Map<string, RawMessage[]>,
  preferId: string | null,
): Map<string, string> {

  const groups = new Map<string, any[]>();
  for (const c of chats) {
    const name = (c.name || '').trim();
    if (c.metadata?.branched_from || !ST_STAMP.test(name)) continue;
    const content = (rawByChat.get(c.id) ?? []).map(m =>
      [m.role, m.content, ...(m.swipes ?? [])]);
    const key = JSON.stringify([name, content]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }

  const dropped = new Map<string, string>();   // hidden copy id → kept copy id
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const keep = group.find(c => c.id === preferId)
      ?? group.slice().sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0))[0];
    for (const c of group) {
      if (c !== keep) dropped.set(c.id, keep.id);
    }
  }
  return dropped;
}

// ── Parent loops ────────────────────────────────────────────────────────────
//
// The tree is drawn by walking down from the roots (chats with no parent), so
// chats whose parent links form a loop (A → B → A) are never reached: neither
// is a root, and both vanish along with everything branched from them. Native
// data shouldn't loop, but a reconstructed import link can close one with a
// native branch (reconstructImportedLinks only checks its own links for
// cycles). So find every chat the walk misses and cut its loop at one link,
// turning that chat into a root. A reconstructed link is cut first, being a
// guess; otherwise the loop's oldest chat becomes the root. In memory only.
function breakParentLoops(
  allChats: any[],
  chatById: Map<string, any>,
  childrenOf: Map<string, string[]>,
  rootIds: string[],
): void {
  const reached = new Set<string>();
  const reach = (id: string) => {
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      if (reached.has(cur)) continue;
      reached.add(cur);
      stack.push(...(childrenOf.get(cur) ?? []));
    }
  };
  rootIds.forEach(reach);
  if (reached.size === allChats.length) return;

  const byCreated = (a: string, b: string) =>
    (chatById.get(a)?.created_at ?? 0) - (chatById.get(b)?.created_at ?? 0);

  for (const chat of allChats) {
    if (reached.has(chat.id)) continue;
    // Climb the parent links until one repeats. A chat with no parent (or a
    // missing one) is already a root, so an unreached chat always hits a loop.
    const path: string[] = [];
    let cur: string | undefined = chat.id;
    while (cur && !path.includes(cur)) {
      path.push(cur);
      const parent: string | undefined = chatById.get(cur)?.metadata?.branched_from;
      cur = parent && chatById.has(parent) ? parent : undefined;
    }
    if (!cur) continue;
    const loop = path.slice(path.indexOf(cur));
    const cutId = loop.find(id => chatById.get(id)?._reconstructedLink)
      ?? loop.slice().sort(byCreated)[0];

    const cut = chatById.get(cutId);
    const oldParent = cut.metadata.branched_from;
    childrenOf.set(oldParent, (childrenOf.get(oldParent) ?? []).filter(id => id !== cutId));
    cut.metadata = { ...cut.metadata, branched_from: null, branch_at_message: null };
    rootIds.push(cutId);
    reach(cutId);
    spindle.log.warn(`[tapestry] broke a parent loop: ${cutId} no longer branches from ${oldParent}`);
  }
}

// `reqId` is the frontend's request number, echoed on every reply so it can
// ignore replies to requests it has since superseded.
async function handleGetTreeData(characterId: string, userId: string, preferChatId: string | null = null, reqId?: number) {
  try {
    spindle.sendToFrontend({ type: 'tree_loading', reqId }, userId);

    // The host caps `limit` at 200 per call, so page until the character's chats
    // are exhausted. Taking only the first page would not just hide the overflow:
    // any branch whose PARENT fell off the end loses its link and gets drawn as a
    // stray root, so a partial fetch corrupts the shape of the tree that remains.
    const allChats: any[] = [];
    for (let page = 0; page < 50; page++) {
      const { data, total } = await spindle.chats.list({
        characterId, limit: 200, offset: page * 200, userId,
      });
      if (!data?.length) break;
      allChats.push(...data);
      if (typeof total === 'number' ? allChats.length >= total : data.length < 200) break;
    }

    if (!allChats.length) {
      spindle.sendToFrontend({ type: 'tree_data', reqId, characterId, roots: [] }, userId);
      return;
    }

    // Load messages for every chat
    const messagesMap = new Map<string, MessageInfo[]>();
    // Raw messages kept alongside the trimmed previews so reconstruction can read
    // each message's `extra` (where imported ST branch pointers live).
    const rawByChat = new Map<string, RawMessage[]>();
    for (const chat of allChats) {
      const raw = await spindle.chat.getMessages(chat.id);
      rawByChat.set(chat.id, raw);
      messagesMap.set(chat.id, raw.map((m: RawMessage, i: number) => {
        const swipeCount = m.swipe_dates?.length ?? 1;
        const full = rawText(m.content);
        // Ship per-swipe previews only when a message actually has alternates —
        // keeps the tree payload lean for the overwhelmingly common 1-swipe case.
        const fullSwipes = (m.swipes && m.swipes.length > 1)
          ? m.swipes.map(s => rawText(s))
          : undefined;
        const swipes = fullSwipes?.map(s => s.slice(0, PREVIEW_CAP));
        return {
          id: m.id,
          index: i,
          role: m.role,
          preview: full.slice(0, PREVIEW_CAP),
          timestamp: m.swipe_dates?.[m.swipe_id ?? 0] ?? 0,
          swipeCount,
          swipeId: m.swipe_id ?? 0,
          swipes,
          truncated: full.length > PREVIEW_CAP
            || !!fullSwipes?.some(s => s.length > PREVIEW_CAP),
          greeting: m.extra?.greeting === true
            ? (Number.isInteger(m.extra.greeting_index) ? m.extra.greeting_index : 0)
            : undefined,
        };
      }));
    }

    const dupes = dropDuplicateImports(allChats, rawByChat, preferChatId);
    if (dupes.size) {
      spindle.log.info(`[tapestry] hid ${dupes.size} duplicate imported chat(s)`);
      for (let i = allChats.length - 1; i >= 0; i--) {
        if (dupes.has(allChats[i].id)) allChats.splice(i, 1);
      }
      for (const c of allChats) {
        const from = c.metadata?.branched_from;
        const keptId = from && dupes.get(from);
        if (!keptId) continue;
        const idx = (rawByChat.get(from) ?? []).findIndex(m => m.id === c.metadata.branch_at_message);
        const keptMsg = idx >= 0 ? rawByChat.get(keptId)?.[idx] : undefined;
        c.metadata = { ...c.metadata, branched_from: keptId, branch_at_message: keptMsg?.id ?? c.metadata.branch_at_message };
      }
    }

    // Build parent → children map and collect roots
    const chatById = new Map<string, any>(allChats.map((c: any) => [c.id, c]));

    // Imported SillyTavern chats arrive with no branch metadata; synthesize it
    // (in memory) so the tree-builder below links them like native branches.
    const reconstructed = reconstructImportedLinks(chatById, messagesMap, rawByChat);
    if (reconstructed > 0) {
      spindle.log.info(`[tapestry] reconstructed ${reconstructed} imported branch link(s)`);
    }

    const childrenOf = new Map<string, string[]>();
    const rootIds: string[] = [];

    for (const chat of allChats) {
      const parentId = chat.metadata?.branched_from;
      if (parentId && chatById.has(parentId)) {
        if (!childrenOf.has(parentId)) childrenOf.set(parentId, []);
        childrenOf.get(parentId)!.push(chat.id);
      } else {
        rootIds.push(chat.id);
      }
    }

    breakParentLoops(allChats, chatById, childrenOf, rootIds);

    rootIds.sort((a, b) => {
      return (chatById.get(a)?.created_at ?? 0) - (chatById.get(b)?.created_at ?? 0);
    });

    // Fork index (position of the fork message within the PARENT's history) for
    // every chat. buildNode needs it per node, and the path assignment below needs
    // it for every chat up front, so it's resolved once here.
    function computeForkIndex(chatId: string): number | null {
      const chat = chatById.get(chatId);
      const parentId = chat?.metadata?.branched_from;
      if (!parentId || !chatById.has(parentId)) return null;
      const parentMsgsArr = messagesMap.get(parentId) ?? [];
      const branchAtMsgId = chat.metadata?.branch_at_message;
      if (branchAtMsgId) {
        const idx = parentMsgsArr.findIndex(m => m.id === branchAtMsgId);
        if (idx !== -1) return idx;
      }
      // Fallback: content comparison — used when branch_at_message is missing
      // (e.g. older chats) or when the message ID wasn't found in the parent.
      const messages = messagesMap.get(chatId) ?? [];
      let shared = 0;
      for (let i = 0; i < Math.min(messages.length, parentMsgsArr.length); i++) {
        if (messages[i].preview === parentMsgsArr[i].preview) shared++;
        else break;
      }
      return shared > 0 ? shared - 1 : 0;
    }
    const forkIndexOf = new Map<string, number | null>();
    for (const chat of allChats) forkIndexOf.set(chat.id, computeForkIndex(chat.id));

    // ── Visual parentage ──────────────────────────────────────────────────────
    //
    // A chat's `branched_from` records which chat you happened to be IN when you
    // branched — not which line the branch visually leaves. Branch at an early
    // message while sitting in branch B, and the fork message is one B merely
    // INHERITED from A: the new chat's logical parent is B, but on screen it
    // departs from A's lane (which is where that message is drawn).
    //
    // Numbering by logical parent therefore drifts away from what you see: each
    // such branch nests one level deeper than the last even though they all fork
    // off the same visible line, producing ids like "2.1.1.1.1.1" for branches
    // that visually hang off the origin. Renderer-side this was already handled
    // (the connector is drawn from the owning ancestor's lane) — the ids just
    // weren't.
    //
    // So: attribute each branch to the nearest ancestor whose OWN unique section
    // actually contains the fork message, and number from that.
    const firstUniqueOf = (cid: string): number => {
      const c = chatById.get(cid);
      if (!c?.metadata?.branched_from) return 0;   // a root owns its whole history
      return (forkIndexOf.get(cid) ?? 0) + 1;
    };
    const visualParentOf = (cid: string): string | null => {
      const fork = forkIndexOf.get(cid);
      if (fork == null) return null;
      const seen = new Set<string>([cid]);         // guards against a metadata cycle
      let pid = chatById.get(cid)?.metadata?.branched_from ?? null;
      while (pid && chatById.has(pid) && !seen.has(pid)) {
        if (fork >= firstUniqueOf(pid)) return pid;
        seen.add(pid);
        pid = chatById.get(pid)?.metadata?.branched_from ?? null;
      }
      return null;
    };

    const visualChildrenOf = new Map<string, string[]>();
    for (const chat of allChats) {
      const vp = visualParentOf(chat.id);
      if (!vp) continue;
      if (!visualChildrenOf.has(vp)) visualChildrenOf.set(vp, []);
      visualChildrenOf.get(vp)!.push(chat.id);
    }

    // Give each branch a hierarchical dotted id that mirrors the tree, so the UI
    // can label them "⎇2", "⎇2.3", "⎇2.3.1" instead of an arbitrary flat rank.
    // The origin line is the implied "1" (unnamed); its branches start at 2, and
    // every deeper branch appends ".<sibling index>" to its parent's path. So a
    // branch's number stays clustered with its tree rather than reflecting the
    // global order in which branches happened to be created.
    const byCreated = (a: string, b: string) =>
      (chatById.get(a)?.created_at ?? 0) - (chatById.get(b)?.created_at ?? 0);
    const branchPathOf = new Map<string, string>();
    // Visited set, not a depth cap: stops only on a chat seen twice (a loop),
    // so a long chain of branch-from-a-branch is never cut short.
    const pathed = new Set<string>();
    function assignPaths(chatId: string, isRoot: boolean, parentPath: string) {
      if (pathed.has(chatId)) return;
      pathed.add(chatId);
      const kids = (visualChildrenOf.get(chatId) ?? []).slice().sort(byCreated);
      kids.forEach((cid, i) => {
        if (pathed.has(cid)) return;
        const path = isRoot ? String(i + 2) : `${parentPath}.${i + 1}`;
        branchPathOf.set(cid, path);
        assignPaths(cid, false, path);
      });
    }
    rootIds.forEach(rid => assignPaths(rid, true, ''));

    // ── Greetings ─────────────────────────────────────────────────────────────
    // A chat's opening message from the character is its greeting. Lumiverse
    // flags the ones it creates (extra.greeting + greeting_index), but imported
    // SillyTavern chats — and branches of them — carry no flag, so the first
    // character message counts too. Greetings kept as real swipes (how ST stores
    // them) stay in the swipe list instead.
    const isGreetingAt = (cid: string, i: number): boolean => {
      const raw = (rawByChat.get(cid) ?? [])[i];
      if (!raw || (raw.swipes?.length ?? 0) > 1) return false;
      if (raw.extra?.greeting === true) return true;
      return i === 0 && raw.role !== 'user' && raw.role !== 'system';
    };
    // Copies are grouped by their TEXT (what each chat actually shows) rather
    // than greeting index — unflagged copies have none. The index is kept when
    // any copy in a group has one, so the UI can name it; otherwise the frontend
    // matches the text against the character card.
    const greetingKey = (text: string) => (text || '').replace(/\s+/g, ' ').trim();
    const newGreetingHub = (ownerId: string, mi: number): GreetingHub => {
      const groups = new Map<string, GreetingVariant>();
      const add = (cid: string, i: number, attach: (v: GreetingVariant) => void) => {
        const text = (rawByChat.get(cid) ?? [])[i]?.content ?? '';
        const key = greetingKey(text);
        if (!groups.has(key)) {
          groups.set(key, { text: text.slice(0, GREETING_CAP), greetingIndex: null, current: false, branches: [], trees: [] });
        }
        const v = groups.get(key)!;
        const idx = (messagesMap.get(cid) ?? [])[i]?.greeting;
        if (v.greetingIndex === null && idx !== undefined) v.greetingIndex = idx;
        attach(v);
      };
      add(ownerId, mi, (v) => { v.current = true; });
      return {
        add,
        list: () => [...groups.values()].sort((a, b) => (a.greetingIndex ?? 1e9) - (b.greetingIndex ?? 1e9)),
      };
    };

    // Same visited-set guard as assignPaths — each chat is placed at most once.
    const placed = new Set<string>();
    function buildNode(chatId: string): BranchNode | null {
      if (placed.has(chatId)) return null;
      placed.add(chatId);
      const chat = chatById.get(chatId);
      if (!chat) return null;

      const messages = messagesMap.get(chatId) ?? [];
      const parentId = chat.metadata?.branched_from ?? null;

      const forkAtIndex: number | null = parentId ? (forkIndexOf.get(chatId) ?? null) : null;

      const childIds = (childrenOf.get(chatId) ?? []).slice().sort(byCreated);

      // Annotate fork-point messages with the branches that fork from them, grouped
      // by which swipe each branch continues from (the swipe_id its copy of the
      // fork message carries). Attached to the VISUAL parent — the chat whose lane
      // actually draws the fork message — not the chat the branch was made from:
      // branch at an early message from inside another branch and only the lane
      // that draws that message can show it.
      //
      // A greeting is the exception: it has no swipes — each chat's copy shows one
      // of the character's greetings — so branches that fork there are grouped by
      // which greeting their copy shows.
      const hub = new Map<number, GreetingHub>();
      for (const cid of (visualChildrenOf.get(chatId) ?? []).slice().sort(byCreated)) {
        const mi = forkIndexOf.get(cid);
        if (mi == null) continue;
        const m = messages[mi];
        if (!m) continue;
        const childChat = chatById.get(cid);
        const entry = { chatId: cid, name: childChat?.name || 'Branch', branchPath: branchPathOf.get(cid) ?? null };
        if (isGreetingAt(chatId, mi)) {
          if (!hub.has(mi)) hub.set(mi, newGreetingHub(chatId, mi));
          hub.get(mi)!.add(cid, mi, (v) => { v.branches.push(entry); });
          continue;
        }
        const forkSwipe = (messagesMap.get(cid) ?? [])[mi]?.swipeId ?? 0;
        if (!m.swipeBranches) m.swipeBranches = {};
        if (!m.swipeBranches[forkSwipe]) m.swipeBranches[forkSwipe] = [];
        m.swipeBranches[forkSwipe].push(entry);
      }
      // A tree's first message is also the hub for the character's OTHER chats —
      // separate trees, e.g. ones Lumiverse's greeting picker started (it opens a
      // new chat rather than branching once a conversation has begun).
      if (!parentId && isGreetingAt(chatId, 0)) {
        if (!hub.has(0)) hub.set(0, newGreetingHub(chatId, 0));
        for (const rid of rootIds) {
          if (rid === chatId || !isGreetingAt(rid, 0)) continue;
          hub.get(0)!.add(rid, 0, (v) => { v.trees.push({ chatId: rid, name: chatById.get(rid)?.name || 'Chat' }); });
        }
      }
      for (const [mi, h] of hub) {
        const variants = h.list();
        // Worth a list when there's more than one greeting in play — and always on
        // a tree's first message, where the list is also where new chats start.
        if (variants.length > 1 || (!parentId && mi === 0)) messages[mi].greetingVariants = variants;
      }

      const children = childIds.map(id => buildNode(id)).filter(Boolean) as BranchNode[];

      return { chatId, chatName: chat.name || 'Chat', parentId, forkAtIndex, branchPath: branchPathOf.get(chatId) ?? null, messages, children };
    }

    const roots = rootIds.map(id => buildNode(id)).filter(Boolean) as BranchNode[];

    spindle.sendToFrontend({ type: 'tree_data', reqId, characterId, roots }, userId);

  } catch (err: any) {
    spindle.log.error(`[tapestry] handleGetTreeData error: ${err?.message ?? err}`);
    spindle.sendToFrontend({ type: 'tree_error', reqId, error: err?.message ?? 'Unknown error' }, userId);
  }
}

spindle.onFrontendMessage(async (payload: any, userId: string) => {
  try {
    if (payload.type === 'get_tree_for_chat') {
      const chat = await spindle.chats.get(payload.chatId, userId);
      if (!chat) {
        spindle.sendToFrontend({ type: 'tree_error', reqId: payload.reqId, error: `Chat not found: ${payload.chatId}` }, userId);
        return;
      }
      spindle.log.info(`[tapestry] Loading tree for character ${chat.character_id}`);
      await handleGetTreeData(chat.character_id, userId, chat.id, payload.reqId);
      return;
    }

    if (payload.type === 'get_active_char_and_tree') {
      const activeChat = await spindle.chats.getActive(userId);
      spindle.log.info(`[tapestry] getActive() → ${activeChat ? activeChat.id : 'null'}`);
      if (!activeChat) {
        spindle.sendToFrontend({ type: 'tree_no_active', reqId: payload.reqId }, userId);
        return;
      }
      await handleGetTreeData(activeChat.character_id, userId, activeChat.id, payload.reqId);
      return;
    }

    if (payload.type === 'rename_chat') {
      try {
        const name = typeof payload.name === 'string' ? payload.name.trim() : '';
        if (!name) {
          spindle.sendToFrontend({ type: 'chat_rename_error', chatId: payload.chatId, error: 'Name cannot be empty' }, userId);
          return;
        }
        const updated = await spindle.chats.update(payload.chatId, { name }, userId);
        spindle.sendToFrontend({ type: 'chat_renamed', chatId: payload.chatId, name: updated.name }, userId);
      } catch (err: any) {
        spindle.sendToFrontend({ type: 'chat_rename_error', chatId: payload.chatId, error: err?.message ?? 'Rename failed' }, userId);
      }
      return;
    }

    // After the frontend creates a branch (via the REST branch endpoint), it asks
    // us to set which swipe the fork message should continue from. The branched
    // copy of that message lives at the same index in the new chat; we look it up
    // and patch swipe_id, which re-derives the active content from swipes[swipeId].
    if (payload.type === 'set_branch_swipe') {
      // The frontend waits on the reply (matched by callId) before opening the
      // branch, so every path below must answer.
      const callId = payload.callId;
      try {
        // Resolve the chat through the user-scoped API before touching its
        // messages — spindle.chat.* takes a raw chat id, so without this check a
        // forged chatId in the payload could reach another user's chat.
        const chat = await spindle.chats.get(payload.chatId, userId);
        if (!chat) {
          spindle.sendToFrontend({ type: 'branch_swipe_error', callId, chatId: payload.chatId, error: 'Chat not found' }, userId);
          return;
        }
        if (!Number.isInteger(payload.messageIndex) || payload.messageIndex < 0
          || !Number.isInteger(payload.swipeId) || payload.swipeId < 0) {
          spindle.sendToFrontend({ type: 'branch_swipe_error', callId, chatId: payload.chatId, error: 'Invalid message index or swipe id' }, userId);
          return;
        }
        const msgs = await spindle.chat.getMessages(payload.chatId);
        const target = msgs[payload.messageIndex];
        if (!target) {
          spindle.sendToFrontend({ type: 'branch_swipe_error', callId, chatId: payload.chatId, error: 'Fork message not found in new branch' }, userId);
          return;
        }
        const swipeTotal = target.swipes?.length || 1;
        if (payload.swipeId >= swipeTotal) {
          spindle.sendToFrontend({ type: 'branch_swipe_error', callId, chatId: payload.chatId, error: `Swipe ${payload.swipeId + 1} does not exist on this message` }, userId);
          return;
        }
        await spindle.chat.updateMessage(payload.chatId, target.id, { swipe_id: payload.swipeId });
        spindle.sendToFrontend({ type: 'branch_swipe_set', callId, chatId: payload.chatId, messageId: target.id, swipeId: payload.swipeId }, userId);
      } catch (err: any) {
        spindle.log.error(`[tapestry] set_branch_swipe error: ${err?.message ?? err}`);
        spindle.sendToFrontend({ type: 'branch_swipe_error', callId, chatId: payload.chatId, error: err?.message ?? 'Failed to set swipe' }, userId);
      }
      return;
    }

    // Full, untruncated text for one message — requested when the reader expands a
    // preview that was capped at PREVIEW_CAP. Fetched per message rather than shipped
    // with the tree so the tree payload stays a summary.
    // Always answers — the frontend holds the request open until it hears back.
    if (payload.type === 'get_full_message') {
      const fail = (error: string) => spindle.sendToFrontend({
        type: 'full_message_error', chatId: payload.chatId, messageId: payload.messageId, error,
      }, userId);
      try {
        const chat = await spindle.chats.get(payload.chatId, userId);
        if (!chat) { fail('Chat not found'); return; }
        const msgs = await spindle.chat.getMessages(payload.chatId);
        const m = msgs.find((x: RawMessage) => x.id === payload.messageId);
        if (!m) { fail('Message not found'); return; }
        spindle.sendToFrontend({
          type: 'full_message',
          chatId: payload.chatId,
          messageId: m.id,
          content: rawText(m.content),
          swipes: (m.swipes && m.swipes.length > 1) ? m.swipes.map((s: string) => rawText(s)) : undefined,
        }, userId);
      } catch (err: any) {
        spindle.log.error(`[tapestry] get_full_message error: ${err?.message ?? err}`);
        fail(err?.message ?? 'Failed to load message');
      }
      return;
    }

    if (payload.type === 'ping') {
      spindle.sendToFrontend({ type: 'pong' }, userId);
    }

  } catch (err: any) {
    spindle.log.error(`[tapestry] handler error: ${err?.message ?? err}`);
    spindle.sendToFrontend({ type: 'tree_error', reqId: payload?.reqId, error: err?.message ?? 'Unknown error' }, userId);
  }
});

spindle.log.info('[tapestry] backend ready');
