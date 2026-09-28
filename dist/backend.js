// @bun
// src/backend.ts
var PREVIEW_CAP = 1500;
var GREETING_CAP = 20000;
function rawText(text) {
  return text || "";
}
var ST_MARKER = "(?:Branch|Checkpoint|Bookmark)";
var ST_SUFFIX = new RegExp(`^(.*?)\\s*-\\s*${ST_MARKER}\\s*#(\\d+)\\s*$`, "i");
var ST_PREFIX = new RegExp(`^\\s*\\S*\\s*${ST_MARKER}\\s*#(\\d+)\\b\\s*(.*)$`, "i");
var ST_ANY = new RegExp(`${ST_MARKER}\\s*#(\\d+)`, "i");
function parseStName(raw) {
  const s = (raw || "").replace(/\.jsonl$/i, "").trim();
  const suf = ST_SUFFIX.exec(s);
  if (suf) {
    const base = suf[1].trim();
    let depth = 1, b = base;
    for (;; ) {
      const m = ST_SUFFIX.exec(b);
      if (!m)
        break;
      b = m[1].trim();
      depth++;
    }
    return { style: "suffix", n: parseInt(suf[2], 10), base, depth };
  }
  const pre = ST_PREFIX.exec(s);
  if (pre)
    return { style: "prefix", n: parseInt(pre[1], 10), base: pre[2].trim(), depth: 0 };
  const any = ST_ANY.exec(s);
  if (any)
    return { style: "loose", n: parseInt(any[1], 10), base: s, depth: 0 };
  return { style: null, n: null, base: s, depth: 0 };
}
function stNameOf(chat) {
  const src = chat?.metadata?._lumiverse_source_filename;
  if (typeof src === "string" && src.startsWith("chats/")) {
    return src.slice(src.lastIndexOf("/") + 1).replace(/\.jsonl$/i, "");
  }
  return chat?.name || "";
}
function reconstructImportedLinks(chatById, messagesMap, rawByChat) {
  const chats = [...chatById.values()];
  const norm = (s) => (s || "").replace(/\.jsonl$/i, "").trim();
  const nameOf = new Map;
  for (const c of chats)
    nameOf.set(c.id, parseStName(stNameOf(c)));
  const looksImported = chats.some((c) => !c.metadata?.branched_from && (nameOf.get(c.id).style !== null || (rawByChat.get(c.id) ?? []).some((m) => typeof m?.extra?.bookmark_link === "string")));
  if (!looksImported)
    return 0;
  const idOfText = new Map;
  const intern = (t) => {
    const k = (t || "").replace(/\s+/g, " ").trim();
    let id = idOfText.get(k);
    if (id === undefined) {
      id = idOfText.size;
      idOfText.set(k, id);
    }
    return id;
  };
  const fpOf = new Map;
  for (const c of chats) {
    const raws = rawByChat.get(c.id) ?? [];
    fpOf.set(c.id, raws.map((m) => {
      const variants = m.swipes && m.swipes.length ? m.swipes : [m.content];
      return {
        role: m.role,
        swipeIds: variants.map(intern),
        ts: m.swipe_dates?.[m.swipe_id ?? 0] ?? 0
      };
    }));
  }
  const sharedCache = new Map;
  const sharedPrefix = (aId, bId) => {
    const key = aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
    const hit = sharedCache.get(key);
    if (hit !== undefined)
      return hit;
    const a = fpOf.get(aId) ?? [], b = fpOf.get(bId) ?? [];
    const n = Math.min(a.length, b.length);
    let i = 0;
    for (;i < n; i++) {
      if (a[i].role !== b[i].role)
        break;
      let overlap = false;
      for (const s of a[i].swipeIds)
        if (b[i].swipeIds.includes(s)) {
          overlap = true;
          break;
        }
      if (!overlap)
        break;
    }
    sharedCache.set(key, i);
    return i;
  };
  const bookmarkParent = new Map;
  for (const c of chats) {
    (rawByChat.get(c.id) ?? []).forEach((m, i) => {
      const bl = m?.extra?.bookmark_link;
      if (typeof bl === "string" && bl.trim())
        bookmarkParent.set(norm(bl), { parentId: c.id, idx: i });
    });
  }
  const ownForkOf = new Map;
  for (const c of chats) {
    const nm = nameOf.get(c.id);
    if ((nm.style === "prefix" || nm.style === "loose") && nm.n !== null) {
      ownForkOf.set(c.id, nm.n);
      continue;
    }
    let best = 0;
    for (const q of chats)
      if (q.id !== c.id)
        best = Math.max(best, sharedPrefix(c.id, q.id));
    ownForkOf.set(c.id, best - 1);
  }
  const divergesOlder = (aId, bId) => {
    const k = sharedPrefix(aId, bId);
    const a = fpOf.get(aId) ?? [], b = fpOf.get(bId) ?? [];
    if (k >= a.length || k >= b.length)
      return false;
    const ta = a[k].ts, tb = b[k].ts;
    return !!ta && !!tb && ta < tb;
  };
  const nameRank = (id) => {
    const nm = nameOf.get(id);
    return nm.style === "suffix" ? [nm.depth, nm.n ?? 0] : [0, -1];
  };
  const rankLt = (a, b) => a[0] !== b[0] ? a[0] < b[0] : a[1] < b[1];
  const pickParent = (childId, banned) => {
    const nm = nameOf.get(childId);
    const cands = [];
    for (const p of chats) {
      if (p.id === childId || banned.has(p.id) || !(fpOf.get(p.id) ?? []).length)
        continue;
      const s = sharedPrefix(childId, p.id);
      if (s >= 1)
        cands.push({ id: p.id, shared: s });
    }
    if (!cands.length)
      return null;
    let pool;
    if ((nm.style === "prefix" || nm.style === "loose") && nm.n !== null) {
      const want = nm.n + 1;
      const atLeast = cands.filter((c) => c.shared >= want);
      if (atLeast.length) {
        const best = Math.min(...atLeast.map((c) => c.shared));
        pool = atLeast.filter((c) => c.shared === best);
      } else {
        const best = Math.max(...cands.map((c) => c.shared));
        if (want > 1 && best < 2)
          return null;
        pool = cands.filter((c) => c.shared === best);
      }
    } else {
      const cr = nameRank(childId);
      let older = cands.filter((c) => rankLt(nameRank(c.id), cr));
      if (!older.length)
        older = cands;
      const best = Math.max(...older.map((c) => c.shared));
      pool = older.filter((c) => c.shared === best);
    }
    if (!pool.length)
      return null;
    const k = pool[0].shared - 1;
    pool.sort((x, y) => {
      const ox = (ownForkOf.get(x.id) ?? 0) < k ? 0 : 1;
      const oy = (ownForkOf.get(y.id) ?? 0) < k ? 0 : 1;
      if (ox !== oy)
        return ox - oy;
      const dx = divergesOlder(x.id, childId) ? 0 : 1;
      const dy = divergesOlder(y.id, childId) ? 0 : 1;
      if (dx !== dy)
        return dx - dy;
      const bx = norm(stNameOf(chatById.get(x.id))) === nm.base ? 0 : 1;
      const by = norm(stNameOf(chatById.get(y.id))) === nm.base ? 0 : 1;
      if (bx !== by)
        return bx - by;
      const lx = (fpOf.get(x.id) ?? []).length, ly = (fpOf.get(y.id) ?? []).length;
      if (lx !== ly)
        return ly - lx;
      return String(x.id).localeCompare(String(y.id));
    });
    const parentLen = (fpOf.get(pool[0].id) ?? []).length;
    return { parentId: pool[0].id, fork: Math.max(0, Math.min(k, parentLen - 1)) };
  };
  const chosen = new Map;
  const NO_BAN = new Set;
  for (const child of chats) {
    if (child.metadata?.branched_from)
      continue;
    const bk = bookmarkParent.get(norm(stNameOf(child)));
    if (bk && bk.parentId !== child.id && (fpOf.get(bk.parentId) ?? []).length) {
      chosen.set(child.id, { parentId: bk.parentId, fork: bk.idx });
      continue;
    }
    if (nameOf.get(child.id).style === null)
      continue;
    const pick = pickParent(child.id, NO_BAN);
    if (pick)
      chosen.set(child.id, pick);
  }
  const findCycle = () => {
    for (const start of chats) {
      const path = [start.id];
      const onPath = new Set(path);
      let cur = chosen.get(start.id);
      while (cur) {
        if (onPath.has(cur.parentId))
          return path.slice(path.indexOf(cur.parentId));
        path.push(cur.parentId);
        onPath.add(cur.parentId);
        cur = chosen.get(cur.parentId);
      }
    }
    return null;
  };
  for (let guard = 0;guard <= chats.length; guard++) {
    const ring = findCycle();
    if (!ring)
      break;
    let victim = "";
    for (const id of ring) {
      if (!chosen.has(id))
        continue;
      if (!victim || (fpOf.get(id) ?? []).length < (fpOf.get(victim) ?? []).length)
        victim = id;
    }
    if (!victim)
      break;
    const banned = new Set([victim]);
    for (let grew = true;grew; ) {
      grew = false;
      for (const c of chats) {
        const link = chosen.get(c.id);
        if (link && banned.has(link.parentId) && !banned.has(c.id)) {
          banned.add(c.id);
          grew = true;
        }
      }
    }
    const alt = pickParent(victim, banned);
    if (alt)
      chosen.set(victim, alt);
    else
      chosen.delete(victim);
  }
  let reconstructed = 0;
  for (const [childId, { parentId, fork }] of chosen) {
    const child = chatById.get(childId);
    const parentMsgs = messagesMap.get(parentId) ?? [];
    if (!child || !parentMsgs.length)
      continue;
    const childLen = (fpOf.get(childId) ?? []).length;
    if (!childLen)
      continue;
    const forkIdx = Math.min(fork, childLen - 1);
    const atMsg = parentMsgs[Math.max(0, Math.min(forkIdx, parentMsgs.length - 1))];
    if (!atMsg)
      continue;
    child.metadata = { ...child.metadata || {}, branched_from: parentId, branch_at_message: atMsg.id };
    child._reconstructedLink = true;
    reconstructed++;
  }
  return reconstructed;
}
var ST_STAMP = /\d{4}-\d{2}-\d{2}\s*@\s*\d{1,2}h\s*\d{1,2}m\s*\d{1,2}s/;
function dropDuplicateImports(chats, rawByChat, preferId) {
  const groups = new Map;
  for (const c of chats) {
    const name = (c.name || "").trim();
    if (c.metadata?.branched_from || !ST_STAMP.test(name))
      continue;
    const content = (rawByChat.get(c.id) ?? []).map((m) => [m.role, m.content, ...m.swipes ?? []]);
    const key = JSON.stringify([name, content]);
    if (!groups.has(key))
      groups.set(key, []);
    groups.get(key).push(c);
  }
  const dropped = new Map;
  for (const group of groups.values()) {
    if (group.length < 2)
      continue;
    const keep = group.find((c) => c.id === preferId) ?? group.slice().sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0))[0];
    for (const c of group) {
      if (c !== keep)
        dropped.set(c.id, keep.id);
    }
  }
  return dropped;
}
function breakParentLoops(allChats, chatById, childrenOf, rootIds) {
  const reached = new Set;
  const reach = (id) => {
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop();
      if (reached.has(cur))
        continue;
      reached.add(cur);
      stack.push(...childrenOf.get(cur) ?? []);
    }
  };
  rootIds.forEach(reach);
  if (reached.size === allChats.length)
    return;
  const byCreated = (a, b) => (chatById.get(a)?.created_at ?? 0) - (chatById.get(b)?.created_at ?? 0);
  for (const chat of allChats) {
    if (reached.has(chat.id))
      continue;
    const path = [];
    let cur = chat.id;
    while (cur && !path.includes(cur)) {
      path.push(cur);
      const parent = chatById.get(cur)?.metadata?.branched_from;
      cur = parent && chatById.has(parent) ? parent : undefined;
    }
    if (!cur)
      continue;
    const loop = path.slice(path.indexOf(cur));
    const cutId = loop.find((id) => chatById.get(id)?._reconstructedLink) ?? loop.slice().sort(byCreated)[0];
    const cut = chatById.get(cutId);
    const oldParent = cut.metadata.branched_from;
    childrenOf.set(oldParent, (childrenOf.get(oldParent) ?? []).filter((id) => id !== cutId));
    cut.metadata = { ...cut.metadata, branched_from: null, branch_at_message: null };
    rootIds.push(cutId);
    reach(cutId);
    spindle.log.warn(`[tapestry] broke a parent loop: ${cutId} no longer branches from ${oldParent}`);
  }
}
async function handleGetTreeData(characterId, userId, preferChatId = null, reqId) {
  try {
    let computeForkIndex2 = function(chatId) {
      const chat = chatById.get(chatId);
      const parentId = chat?.metadata?.branched_from;
      if (!parentId || !chatById.has(parentId))
        return null;
      const parentMsgsArr = messagesMap.get(parentId) ?? [];
      const branchAtMsgId = chat.metadata?.branch_at_message;
      if (branchAtMsgId) {
        const idx = parentMsgsArr.findIndex((m) => m.id === branchAtMsgId);
        if (idx !== -1)
          return idx;
      }
      const messages = messagesMap.get(chatId) ?? [];
      let shared = 0;
      for (let i = 0;i < Math.min(messages.length, parentMsgsArr.length); i++) {
        if (messages[i].preview === parentMsgsArr[i].preview)
          shared++;
        else
          break;
      }
      return shared > 0 ? shared - 1 : 0;
    }, assignPaths2 = function(chatId, isRoot, parentPath) {
      if (pathed.has(chatId))
        return;
      pathed.add(chatId);
      const kids = (visualChildrenOf.get(chatId) ?? []).slice().sort(byCreated);
      kids.forEach((cid, i) => {
        if (pathed.has(cid))
          return;
        const path = isRoot ? String(i + 2) : `${parentPath}.${i + 1}`;
        branchPathOf.set(cid, path);
        assignPaths2(cid, false, path);
      });
    }, buildNode2 = function(chatId) {
      if (placed.has(chatId))
        return null;
      placed.add(chatId);
      const chat = chatById.get(chatId);
      if (!chat)
        return null;
      const messages = messagesMap.get(chatId) ?? [];
      const parentId = chat.metadata?.branched_from ?? null;
      const forkAtIndex = parentId ? forkIndexOf.get(chatId) ?? null : null;
      const childIds = (childrenOf.get(chatId) ?? []).slice().sort(byCreated);
      const hub = new Map;
      for (const cid of (visualChildrenOf.get(chatId) ?? []).slice().sort(byCreated)) {
        const mi = forkIndexOf.get(cid);
        if (mi == null)
          continue;
        const m = messages[mi];
        if (!m)
          continue;
        const childChat = chatById.get(cid);
        const entry = { chatId: cid, name: childChat?.name || "Branch", branchPath: branchPathOf.get(cid) ?? null };
        if (isGreetingAt(chatId, mi)) {
          if (!hub.has(mi))
            hub.set(mi, newGreetingHub(chatId, mi));
          hub.get(mi).add(cid, mi, (v) => {
            v.branches.push(entry);
          });
          continue;
        }
        const forkSwipe = (messagesMap.get(cid) ?? [])[mi]?.swipeId ?? 0;
        if (!m.swipeBranches)
          m.swipeBranches = {};
        if (!m.swipeBranches[forkSwipe])
          m.swipeBranches[forkSwipe] = [];
        m.swipeBranches[forkSwipe].push(entry);
      }
      if (!parentId && isGreetingAt(chatId, 0)) {
        if (!hub.has(0))
          hub.set(0, newGreetingHub(chatId, 0));
        for (const rid of rootIds) {
          if (rid === chatId || !isGreetingAt(rid, 0))
            continue;
          hub.get(0).add(rid, 0, (v) => {
            v.trees.push({ chatId: rid, name: chatById.get(rid)?.name || "Chat" });
          });
        }
      }
      for (const [mi, h] of hub) {
        const variants = h.list();
        if (variants.length > 1 || !parentId && mi === 0)
          messages[mi].greetingVariants = variants;
      }
      const children = childIds.map((id) => buildNode2(id)).filter(Boolean);
      return { chatId, chatName: chat.name || "Chat", parentId, forkAtIndex, branchPath: branchPathOf.get(chatId) ?? null, messages, children };
    };
    var computeForkIndex = computeForkIndex2, assignPaths = assignPaths2, buildNode = buildNode2;
    spindle.sendToFrontend({ type: "tree_loading", reqId }, userId);
    const allChats = [];
    for (let page = 0;page < 50; page++) {
      const { data, total } = await spindle.chats.list({
        characterId,
        limit: 200,
        offset: page * 200,
        userId
      });
      if (!data?.length)
        break;
      allChats.push(...data);
      if (typeof total === "number" ? allChats.length >= total : data.length < 200)
        break;
    }
    if (!allChats.length) {
      spindle.sendToFrontend({ type: "tree_data", reqId, characterId, roots: [] }, userId);
      return;
    }
    const messagesMap = new Map;
    const rawByChat = new Map;
    for (const chat of allChats) {
      const raw = await spindle.chat.getMessages(chat.id);
      rawByChat.set(chat.id, raw);
      messagesMap.set(chat.id, raw.map((m, i) => {
        const swipeCount = m.swipe_dates?.length ?? 1;
        const full = rawText(m.content);
        const fullSwipes = m.swipes && m.swipes.length > 1 ? m.swipes.map((s) => rawText(s)) : undefined;
        const swipes = fullSwipes?.map((s) => s.slice(0, PREVIEW_CAP));
        return {
          id: m.id,
          index: i,
          role: m.role,
          preview: full.slice(0, PREVIEW_CAP),
          timestamp: m.swipe_dates?.[m.swipe_id ?? 0] ?? 0,
          swipeCount,
          swipeId: m.swipe_id ?? 0,
          swipes,
          truncated: full.length > PREVIEW_CAP || !!fullSwipes?.some((s) => s.length > PREVIEW_CAP),
          greeting: m.extra?.greeting === true ? Number.isInteger(m.extra.greeting_index) ? m.extra.greeting_index : 0 : undefined
        };
      }));
    }
    const dupes = dropDuplicateImports(allChats, rawByChat, preferChatId);
    if (dupes.size) {
      spindle.log.info(`[tapestry] hid ${dupes.size} duplicate imported chat(s)`);
      for (let i = allChats.length - 1;i >= 0; i--) {
        if (dupes.has(allChats[i].id))
          allChats.splice(i, 1);
      }
      for (const c of allChats) {
        const from = c.metadata?.branched_from;
        const keptId = from && dupes.get(from);
        if (!keptId)
          continue;
        const idx = (rawByChat.get(from) ?? []).findIndex((m) => m.id === c.metadata.branch_at_message);
        const keptMsg = idx >= 0 ? rawByChat.get(keptId)?.[idx] : undefined;
        c.metadata = { ...c.metadata, branched_from: keptId, branch_at_message: keptMsg?.id ?? c.metadata.branch_at_message };
      }
    }
    const chatById = new Map(allChats.map((c) => [c.id, c]));
    const reconstructed = reconstructImportedLinks(chatById, messagesMap, rawByChat);
    if (reconstructed > 0) {
      spindle.log.info(`[tapestry] reconstructed ${reconstructed} imported branch link(s)`);
    }
    const childrenOf = new Map;
    const rootIds = [];
    for (const chat of allChats) {
      const parentId = chat.metadata?.branched_from;
      if (parentId && chatById.has(parentId)) {
        if (!childrenOf.has(parentId))
          childrenOf.set(parentId, []);
        childrenOf.get(parentId).push(chat.id);
      } else {
        rootIds.push(chat.id);
      }
    }
    breakParentLoops(allChats, chatById, childrenOf, rootIds);
    rootIds.sort((a, b) => {
      return (chatById.get(a)?.created_at ?? 0) - (chatById.get(b)?.created_at ?? 0);
    });
    const forkIndexOf = new Map;
    for (const chat of allChats)
      forkIndexOf.set(chat.id, computeForkIndex2(chat.id));
    const firstUniqueOf = (cid) => {
      const c = chatById.get(cid);
      if (!c?.metadata?.branched_from)
        return 0;
      return (forkIndexOf.get(cid) ?? 0) + 1;
    };
    const visualParentOf = (cid) => {
      const fork = forkIndexOf.get(cid);
      if (fork == null)
        return null;
      const seen = new Set([cid]);
      let pid = chatById.get(cid)?.metadata?.branched_from ?? null;
      while (pid && chatById.has(pid) && !seen.has(pid)) {
        if (fork >= firstUniqueOf(pid))
          return pid;
        seen.add(pid);
        pid = chatById.get(pid)?.metadata?.branched_from ?? null;
      }
      return null;
    };
    const visualChildrenOf = new Map;
    for (const chat of allChats) {
      const vp = visualParentOf(chat.id);
      if (!vp)
        continue;
      if (!visualChildrenOf.has(vp))
        visualChildrenOf.set(vp, []);
      visualChildrenOf.get(vp).push(chat.id);
    }
    const byCreated = (a, b) => (chatById.get(a)?.created_at ?? 0) - (chatById.get(b)?.created_at ?? 0);
    const branchPathOf = new Map;
    const pathed = new Set;
    rootIds.forEach((rid) => assignPaths2(rid, true, ""));
    const isGreetingAt = (cid, i) => {
      const raw = (rawByChat.get(cid) ?? [])[i];
      if (!raw || (raw.swipes?.length ?? 0) > 1)
        return false;
      if (raw.extra?.greeting === true)
        return true;
      return i === 0 && raw.role !== "user" && raw.role !== "system";
    };
    const greetingKey = (text) => (text || "").replace(/\s+/g, " ").trim();
    const newGreetingHub = (ownerId, mi) => {
      const groups = new Map;
      const add = (cid, i, attach) => {
        const text = (rawByChat.get(cid) ?? [])[i]?.content ?? "";
        const key = greetingKey(text);
        if (!groups.has(key)) {
          groups.set(key, { text: text.slice(0, GREETING_CAP), greetingIndex: null, current: false, branches: [], trees: [] });
        }
        const v = groups.get(key);
        const idx = (messagesMap.get(cid) ?? [])[i]?.greeting;
        if (v.greetingIndex === null && idx !== undefined)
          v.greetingIndex = idx;
        attach(v);
      };
      add(ownerId, mi, (v) => {
        v.current = true;
      });
      return {
        add,
        list: () => [...groups.values()].sort((a, b) => (a.greetingIndex ?? 1e9) - (b.greetingIndex ?? 1e9))
      };
    };
    const placed = new Set;
    const roots = rootIds.map((id) => buildNode2(id)).filter(Boolean);
    spindle.sendToFrontend({ type: "tree_data", reqId, characterId, roots }, userId);
  } catch (err) {
    spindle.log.error(`[tapestry] handleGetTreeData error: ${err?.message ?? err}`);
    spindle.sendToFrontend({ type: "tree_error", reqId, error: err?.message ?? "Unknown error" }, userId);
  }
}
spindle.onFrontendMessage(async (payload, userId) => {
  try {
    if (payload.type === "get_tree_for_chat") {
      const chat = await spindle.chats.get(payload.chatId, userId);
      if (!chat) {
        spindle.sendToFrontend({ type: "tree_error", reqId: payload.reqId, error: `Chat not found: ${payload.chatId}` }, userId);
        return;
      }
      spindle.log.info(`[tapestry] Loading tree for character ${chat.character_id}`);
      await handleGetTreeData(chat.character_id, userId, chat.id, payload.reqId);
      return;
    }
    if (payload.type === "get_active_char_and_tree") {
      const activeChat = await spindle.chats.getActive(userId);
      spindle.log.info(`[tapestry] getActive() \u2192 ${activeChat ? activeChat.id : "null"}`);
      if (!activeChat) {
        spindle.sendToFrontend({ type: "tree_no_active", reqId: payload.reqId }, userId);
        return;
      }
      await handleGetTreeData(activeChat.character_id, userId, activeChat.id, payload.reqId);
      return;
    }
    if (payload.type === "rename_chat") {
      try {
        const name = typeof payload.name === "string" ? payload.name.trim() : "";
        if (!name) {
          spindle.sendToFrontend({ type: "chat_rename_error", chatId: payload.chatId, error: "Name cannot be empty" }, userId);
          return;
        }
        const updated = await spindle.chats.update(payload.chatId, { name }, userId);
        spindle.sendToFrontend({ type: "chat_renamed", chatId: payload.chatId, name: updated.name }, userId);
      } catch (err) {
        spindle.sendToFrontend({ type: "chat_rename_error", chatId: payload.chatId, error: err?.message ?? "Rename failed" }, userId);
      }
      return;
    }
    if (payload.type === "set_branch_swipe") {
      const callId = payload.callId;
      try {
        const chat = await spindle.chats.get(payload.chatId, userId);
        if (!chat) {
          spindle.sendToFrontend({ type: "branch_swipe_error", callId, chatId: payload.chatId, error: "Chat not found" }, userId);
          return;
        }
        if (!Number.isInteger(payload.messageIndex) || payload.messageIndex < 0 || !Number.isInteger(payload.swipeId) || payload.swipeId < 0) {
          spindle.sendToFrontend({ type: "branch_swipe_error", callId, chatId: payload.chatId, error: "Invalid message index or swipe id" }, userId);
          return;
        }
        const msgs = await spindle.chat.getMessages(payload.chatId);
        const target = msgs[payload.messageIndex];
        if (!target) {
          spindle.sendToFrontend({ type: "branch_swipe_error", callId, chatId: payload.chatId, error: "Fork message not found in new branch" }, userId);
          return;
        }
        const swipeTotal = target.swipes?.length || 1;
        if (payload.swipeId >= swipeTotal) {
          spindle.sendToFrontend({ type: "branch_swipe_error", callId, chatId: payload.chatId, error: `Swipe ${payload.swipeId + 1} does not exist on this message` }, userId);
          return;
        }
        await spindle.chat.updateMessage(payload.chatId, target.id, { swipe_id: payload.swipeId });
        spindle.sendToFrontend({ type: "branch_swipe_set", callId, chatId: payload.chatId, messageId: target.id, swipeId: payload.swipeId }, userId);
      } catch (err) {
        spindle.log.error(`[tapestry] set_branch_swipe error: ${err?.message ?? err}`);
        spindle.sendToFrontend({ type: "branch_swipe_error", callId, chatId: payload.chatId, error: err?.message ?? "Failed to set swipe" }, userId);
      }
      return;
    }
    if (payload.type === "get_full_message") {
      const fail = (error) => spindle.sendToFrontend({
        type: "full_message_error",
        chatId: payload.chatId,
        messageId: payload.messageId,
        error
      }, userId);
      try {
        const chat = await spindle.chats.get(payload.chatId, userId);
        if (!chat) {
          fail("Chat not found");
          return;
        }
        const msgs = await spindle.chat.getMessages(payload.chatId);
        const m = msgs.find((x) => x.id === payload.messageId);
        if (!m) {
          fail("Message not found");
          return;
        }
        spindle.sendToFrontend({
          type: "full_message",
          chatId: payload.chatId,
          messageId: m.id,
          content: rawText(m.content),
          swipes: m.swipes && m.swipes.length > 1 ? m.swipes.map((s) => rawText(s)) : undefined
        }, userId);
      } catch (err) {
        spindle.log.error(`[tapestry] get_full_message error: ${err?.message ?? err}`);
        fail(err?.message ?? "Failed to load message");
      }
      return;
    }
    if (payload.type === "ping") {
      spindle.sendToFrontend({ type: "pong" }, userId);
    }
  } catch (err) {
    spindle.log.error(`[tapestry] handler error: ${err?.message ?? err}`);
    spindle.sendToFrontend({ type: "tree_error", reqId: payload?.reqId, error: err?.message ?? "Unknown error" }, userId);
  }
});
spindle.log.info("[tapestry] backend ready");
