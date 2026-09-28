// src/frontend.ts
var NODE_H = 28;
var LANE_W = NODE_H;
var LANE_W_TOUCH = 32;
var NODE_R = 5;
var FORK_R = 7;
var PAD = { top: 20, left: 24, right: 24, bottom: 24 };
var COLORS = [
  "#8b7ff0",
  "#4db6e8",
  "#5bc98e",
  "#e8a54d",
  "#e86d6d",
  "#c46de8",
  "#4de8cc",
  "#e8d04d",
  "#e87d4d",
  "#6d9de8"
];
function setup(ctx) {
  let roots = [];
  let activeTreeIndex = 0;
  let activeChatId = null;
  let currentCharacterId = null;
  let pendingScrollMessageId = null;
  let pendingScrollIndex = null;
  let sortMode = "position";
  let fsOrientation = "horizontal";
  let zoom = 1;
  const ZOOM_MIN = 0.25, ZOOM_MAX = 2, ZOOM_STEP = 0.25;
  let compactMode = false;
  const expandedPills = new Set;
  let suppressPopIn = false;
  let cursorScrollUnsubscribe = null;
  let cursorRingEl = null;
  let cursorRingFsEl = null;
  let cursorPillRingEl = null;
  let cursorPillRingFsEl = null;
  let msgCursorMap = new Map;
  let msgCursorMapFs = new Map;
  function updateCursorFromDOM() {
    const msgEls = document.querySelectorAll("[data-message-id]");
    if (!msgEls.length)
      return;
    const viewCY = window.innerHeight / 2;
    let bestEl = null, bestDist = Infinity;
    for (const el of msgEls) {
      const rect = el.getBoundingClientRect();
      if (!rect.height || rect.bottom < 0 || rect.top > window.innerHeight)
        continue;
      const dist = Math.abs(rect.top + rect.height / 2 - viewCY);
      if (dist < bestDist) {
        bestDist = dist;
        bestEl = el;
      }
    }
    if (!bestEl)
      return;
    const msgId = bestEl.getAttribute("data-message-id");
    function applyRing(circleEl, rectEl, posMap) {
      const pos = posMap.get(msgId);
      if (!pos) {
        if (circleEl)
          circleEl.style.opacity = "0";
        if (rectEl)
          rectEl.style.opacity = "0";
        return;
      }
      if (pos.pill && rectEl) {
        if (circleEl)
          circleEl.style.opacity = "0";
        const pillWasHidden = parseFloat(rectEl.style.opacity || "0") < 0.1;
        if (pillWasHidden) {
          rectEl.style.transition = "none";
          rectEl.style.transform = `translate(${pos.pill.cx}px, ${pos.pill.cy}px)`;
          requestAnimationFrame(() => {
            rectEl.style.transition = "";
            rectEl.style.opacity = "0.75";
          });
        } else {
          rectEl.style.transform = `translate(${pos.pill.cx}px, ${pos.pill.cy}px)`;
          rectEl.style.opacity = "0.75";
        }
      } else {
        if (rectEl)
          rectEl.style.opacity = "0";
        if (circleEl) {
          circleEl.setAttribute("r", String(pos.r + 4));
          const circleWasHidden = parseFloat(circleEl.style.opacity || "0") < 0.1;
          if (circleWasHidden) {
            circleEl.style.transition = "none";
            circleEl.style.cx = pos.x + "px";
            circleEl.style.cy = pos.y + "px";
            requestAnimationFrame(() => {
              circleEl.style.transition = "";
              circleEl.style.opacity = "0.75";
            });
          } else {
            circleEl.style.cx = pos.x + "px";
            circleEl.style.cy = pos.y + "px";
            circleEl.style.opacity = "0.75";
          }
        }
      }
    }
    applyRing(cursorRingEl, cursorPillRingEl, msgCursorMap);
    applyRing(cursorRingFsEl, cursorPillRingFsEl, msgCursorMapFs);
  }
  const tab = ctx.ui.registerDrawerTab({
    id: "tapestry",
    title: "Tapestry",
    shortName: "Tapestry",
    description: "Weave together the full story of your chats — see every branch, fork point, and path in one living map.",
    keywords: ["branch", "fork", "tree", "tapestry", "history", "chat", "timeline", "weave"],
    iconSvg: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 4H8.1"/><path d="M11.9 4H18.5"/><path d="M1.5 10H2.1"/><path d="M5.9 10H14.1"/><path d="M17.9 10H18.5"/><path d="M1.5 16H8.1"/><path d="M11.9 16H14.1"/><path d="M17.9 16H18.5"/><path d="M4 1.5V2.1"/><path d="M4 5.9V8.1"/><path d="M4 11.9V14.1"/><path d="M4 17.9V18.5"/><path d="M10 1.5V2.1"/><path d="M10 5.9V8.1"/><path d="M10 11.9V18.5"/><path d="M16 1.5V2.1"/><path d="M16 5.9V14.1"/><path d="M16 17.9V18.5"/><circle cx="4" cy="10" r="1.9"/><circle cx="10" cy="4" r="1.9"/><circle cx="16" cy="16" r="1.9"/></svg>`
  });
  ctx.dom.addStyle(`
    .ctv-root { display:flex; flex-direction:column; height:100%; background:var(--lumiverse-bg); color:var(--lumiverse-text); font-family:inherit; overflow:hidden; }
    .ctv-header { display:flex; align-items:flex-start; gap:0; padding:10px 14px; border-bottom:1px solid var(--lumiverse-border); flex-shrink:0; position:relative; }
    .ctv-header-main { flex:1; display:flex; align-items:center; gap:8px; flex-wrap:wrap; min-width:0; padding-right:66px; }
    /* Top-right action cluster: reload tucked beside the fullscreen button so neither
       steals a row from the legend nor adds height to the header. */
    .ctv-header-actions { position:absolute; top:8px; right:14px; display:flex; align-items:center; gap:6px; }
    .ctv-reload-btn { width:26px; height:26px; border-radius:7px; border:1px solid var(--lumiverse-border); background:transparent; color:var(--lumiverse-text-dim); font-size:14px; line-height:1; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 150ms; padding:0; flex-shrink:0; }
    .ctv-reload-btn:hover { background:var(--lumiverse-fill-subtle); color:var(--lumiverse-text); }
    .ctv-header-label { font-size:11px; color:var(--lumiverse-text-dim); font-weight:500; text-transform:uppercase; letter-spacing:0.06em; margin-right:2px; }
    .ctv-tree-btn { padding:3px 10px; border-radius:999px; border:1px solid var(--lumiverse-border); background:var(--lumiverse-fill-subtle); color:var(--lumiverse-text-dim); font-size:11.5px; cursor:pointer; transition:all 150ms; white-space:nowrap; }
    .ctv-tree-btn:hover { background:var(--lumiverse-fill); color:var(--lumiverse-text); }
    .ctv-tree-btn.active { background:var(--lumiverse-primary-015); border-color:var(--lumiverse-primary-040); color:var(--lumiverse-primary-text); }
    .ctv-sort-btn { padding:3px 10px; border-radius:999px; border:1px solid var(--lumiverse-border); background:transparent; color:var(--lumiverse-text-dim); font-size:11.5px; cursor:pointer; transition:all 150ms; white-space:nowrap; }
    .ctv-sort-btn:hover { background:var(--lumiverse-fill-subtle); color:var(--lumiverse-text); }
    .ctv-sort-btn.active { background:var(--lumiverse-primary-015); border-color:var(--lumiverse-primary-040); color:var(--lumiverse-primary-text); }
    .ctv-compact-btn { padding:3px 10px; border-radius:999px; border:1px solid var(--lumiverse-border); background:transparent; color:var(--lumiverse-text-dim); font-size:11.5px; cursor:pointer; transition:all 150ms; white-space:nowrap; }
    .ctv-compact-btn:hover { background:var(--lumiverse-fill-subtle); color:var(--lumiverse-text); }
    .ctv-compact-btn.active { background:var(--lumiverse-primary-015); border-color:var(--lumiverse-primary-040); color:var(--lumiverse-primary-text); }
    .ctv-expand-btn { width:26px; height:26px; border-radius:7px; border:1px solid var(--lumiverse-border); background:transparent; color:var(--lumiverse-text-dim); font-size:14px; line-height:1; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 150ms; padding:0; }
    .ctv-expand-btn:hover { background:var(--lumiverse-fill-subtle); color:var(--lumiverse-text); }
    .ctv-zoom-group { display:flex; align-items:center; gap:2px; }
    .ctv-zoom-btn { width:24px; height:24px; border-radius:6px; border:1px solid var(--lumiverse-border); background:transparent; color:var(--lumiverse-text-dim); font-size:14px; line-height:1; cursor:pointer; transition:all 150ms; display:flex; align-items:center; justify-content:center; padding:0; flex-shrink:0; }
    .ctv-zoom-btn:hover { background:var(--lumiverse-fill-subtle); color:var(--lumiverse-text); }
    .ctv-zoom-btn:disabled { opacity:0.3; cursor:default; }
    .ctv-zoom-label { font-size:11px; color:var(--lumiverse-text-dim); min-width:34px; text-align:center; cursor:pointer; padding:2px 3px; border-radius:4px; transition:color 120ms; }
    .ctv-zoom-label:hover { color:var(--lumiverse-text); }
    /* Debug bar — hidden by default; remove display:none to re-enable for troubleshooting */
    .ctv-debug-bar { padding:4px 14px; border-bottom:1px solid var(--lumiverse-border); background:var(--lumiverse-fill-subtle); flex-shrink:0; display:none; }
    .ctv-debug-text { font-size:10px; font-family:ui-monospace,monospace; color:var(--lumiverse-text-dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:block; }
    .ctv-canvas-wrap { flex:1; min-height:0; overflow:auto; position:relative; touch-action:pan-x pan-y; }
    /* Defeat the host's global svg max-width:100% reset, which otherwise clamps the
       canvas to its container width and silently caps zoom-in at ~100% (the box
       grows but the drawn tree can't). !important to beat the host rule. */
    .ctv-svg { display:block; max-width:none !important; max-height:none !important; }
    .ctv-jump-loading { position:fixed; top:calc(12px + env(safe-area-inset-top,0px)); left:50%; transform:translateX(-50%); z-index:10003; display:flex; align-items:center; gap:8px; background:var(--lumiverse-bg-elevated,#1a1825); border:1px solid var(--lumiverse-border); border-radius:999px; padding:7px 8px 7px 14px; font-size:12.5px; color:var(--lumiverse-text); box-shadow:0 8px 24px rgba(0,0,0,0.35); pointer-events:auto; }
    .ctv-jump-cancel { flex-shrink:0; width:20px; height:20px; border-radius:50%; border:1px solid var(--lumiverse-border); background:transparent; color:var(--lumiverse-text-dim); font-size:11px; line-height:1; cursor:pointer; display:flex; align-items:center; justify-content:center; padding:0; transition:background 120ms, color 120ms; }
    .ctv-jump-cancel:hover { background:var(--lumiverse-fill); color:var(--lumiverse-text); }
    .ctv-track { fill:none; stroke-width:2; opacity:0.55; }
    .ctv-track.active { opacity:1; }
    .ctv-connector { fill:none; stroke-width:1.5; opacity:0.5; stroke-dasharray:4 3; }
    .ctv-node { cursor:pointer; transition: r 80ms; }
    .ctv-node:hover { r:8; }
    /* Touch: enlarge each node's tap target without changing the visible dot. A wide
       transparent stroke + pointer-events:all makes the whole padded disc tappable,
       so fingers don't have to land on the exact pixel. Desktop is untouched. */
    @media (hover: none) and (pointer: coarse) {
      .ctv-node { stroke:transparent; stroke-width:18px; pointer-events:all; }
    }
    .ctv-node-active-ring { fill:none; stroke-width:2; opacity:0.45; pointer-events:none; }
    .ctv-cursor-ring { fill:none; stroke:white; stroke-width:2; opacity:0; pointer-events:none; transition: cx 140ms ease, cy 140ms ease, opacity 200ms ease; }
    .ctv-cursor-ring-pill { fill:none; stroke:white; stroke-width:2; opacity:0; pointer-events:none; transition: transform 140ms ease, opacity 200ms ease; }
    .ctv-track-core { fill:none; stroke:#ffffff; stroke-width:1.5; opacity:0.85; pointer-events:none; stroke-linecap:round; filter:drop-shadow(0 0 4px rgba(255,255,255,0.9)) drop-shadow(0 0 8px rgba(255,255,255,0.4)); }
    .ctv-connector-core { fill:none; stroke:#ffffff; stroke-width:1.5; opacity:0.85; pointer-events:none; stroke-dasharray:4 3; stroke-linecap:round; filter:drop-shadow(0 0 4px rgba(255,255,255,0.9)) drop-shadow(0 0 8px rgba(255,255,255,0.4)); }
    /* Branch-preview glow: lights up a destination branch's nodes/pills/connector
       while the pointer is over its "→" button in the swipe tooltip. */
    .ctv-branch-hl { filter:drop-shadow(0 0 4px rgba(169,160,255,0.95)) drop-shadow(0 0 9px rgba(169,160,255,0.5)); transition:filter 130ms ease, stroke-width 130ms ease, opacity 130ms ease; }
    circle.ctv-branch-hl, rect.ctv-branch-hl { stroke:#fff; stroke-opacity:0.95; stroke-width:2.5; }
    path.ctv-branch-hl { opacity:1; stroke-width:2.5; stroke-dasharray:none; }
    .ctv-state { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; color:var(--lumiverse-text-dim); font-size:13px; text-align:center; padding:32px; height:100%; box-sizing:border-box; }
    .ctv-spinner { width:24px; height:24px; border:2px solid var(--lumiverse-border); border-top-color:var(--lumiverse-primary,#8b7ff0); border-radius:50%; animation:ctv-spin 0.7s linear infinite; }
    @keyframes ctv-spin { to { transform:rotate(360deg); } }
    .ctv-tooltip { position:fixed; z-index:10001; background:var(--lumiverse-bg-elevated,#1a1825); border:1px solid var(--lumiverse-border); border-radius:10px; padding:10px 13px; max-width:320px; pointer-events:none; box-shadow:0 8px 24px rgba(0,0,0,0.35); font-size:12.5px; line-height:1.5; transition:opacity 130ms ease, transform 170ms cubic-bezier(0.25,0.46,0.45,0.94); }
    .ctv-tooltip.expanded { pointer-events:auto; }
    /* Mobile bottom-docked preview: a floating sheet whose shadow reads as rising
       from the bottom edge. Height is capped so it can never run off the top. */
    .ctv-tooltip-docked { pointer-events:auto; max-width:none; max-height:calc(100vh - 24px - env(safe-area-inset-bottom,0px)); box-shadow:0 -10px 30px rgba(0,0,0,0.45); }
    .ctv-tooltip-role { font-size:10.5px; font-weight:600; text-transform:uppercase; letter-spacing:0.07em; margin-bottom:5px; opacity:0.55; }
    /* Header row: role label on the left, "view swipes" toggle on the right. */
    .ctv-tooltip-rolerow { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:5px; }
    .ctv-tooltip-rolerow .ctv-tooltip-role { margin-bottom:0; }
    .ctv-tooltip-swipes { flex-shrink:0; padding:2px 9px; border-radius:999px; border:1px solid var(--lumiverse-primary-040,#6b63c0); background:var(--lumiverse-primary-015); color:var(--lumiverse-primary-text,#a9a0ff); font-size:10.5px; font-weight:600; font-family:inherit; cursor:pointer; white-space:nowrap; transition:all 120ms; }
    .ctv-tooltip-swipes:hover { background:var(--lumiverse-primary-040,#6b63c0); color:#fff; }
    .ctv-tooltip-swipes:active { transform:scale(0.97); }
    /* Swipe view header: a "‹ Back" button returns to the message preview. */
    .ctv-swipe-header { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
    .ctv-swipe-header .ctv-tooltip-role { margin-bottom:0; }
    .ctv-swipe-back { flex-shrink:0; padding:3px 10px; border-radius:999px; border:1px solid var(--lumiverse-border); background:var(--lumiverse-fill-subtle); color:var(--lumiverse-text-dim); font-size:11px; font-weight:600; font-family:inherit; cursor:pointer; white-space:nowrap; transition:all 120ms; }
    .ctv-swipe-back:hover { background:var(--lumiverse-fill); color:var(--lumiverse-text); }
    .ctv-swipe-back:active { transform:scale(0.97); }
    .ctv-tooltip-preview { color:var(--lumiverse-text); word-break:break-word; }
    /* Expanded text keeps the message's own line breaks; the collapsed snippet folds them into spaces. */
    .ctv-tooltip.expanded .ctv-tooltip-preview { white-space:pre-wrap; }
    .ctv-tooltip-rolerow-end { display:flex; align-items:center; gap:6px; flex-shrink:0; }
    /* Icon buttons in the preview header (copy, new branch). Copy turns into a check for a moment after copying. */
    .ctv-icon-btn { flex-shrink:0; width:22px; height:22px; padding:0; display:inline-flex; align-items:center; justify-content:center; border-radius:5px; border:1px solid var(--lumiverse-border); background:var(--lumiverse-fill-subtle); color:var(--lumiverse-text-dim); cursor:pointer; transition:all 120ms; }
    .ctv-icon-btn:hover { background:var(--lumiverse-fill); color:var(--lumiverse-text); }
    .ctv-icon-btn:active { transform:scale(0.94); }
    .ctv-icon-btn svg { width:12px; height:12px; display:block; fill:none; stroke:currentColor; stroke-width:1.6; stroke-linecap:round; stroke-linejoin:round; }
    .ctv-copy-btn.copied { color:var(--lumiverse-success,#4ade80); border-color:var(--lumiverse-success,#4ade80); }
    .ctv-copy-btn.failed { color:var(--lumiverse-error,#f87171); border-color:var(--lumiverse-error,#f87171); }
    .ctv-tooltip.expanded .ctv-tooltip-preview { max-height:300px; overflow-y:auto; padding-right:5px; overscroll-behavior:contain; }
    .ctv-tooltip.expanded .ctv-tooltip-preview::-webkit-scrollbar { width:7px; }
    .ctv-tooltip.expanded .ctv-tooltip-preview::-webkit-scrollbar-thumb { background:var(--lumiverse-border); border-radius:4px; }
    .ctv-tooltip-meta { margin-top:6px; font-size:10.5px; color:var(--lumiverse-text-dim); }
    .ctv-tooltip-hint { margin-top:5px; font-size:10px; color:var(--lumiverse-primary-text,#a9a0ff); opacity:0.7; }
    /* Desktop nav button: compact pill, matching the swipe-node action buttons. */
    .ctv-tooltip-nav { display:inline-block; margin-top:8px; padding:3px 11px; border-radius:999px; border:1px solid var(--lumiverse-primary-040,#6b63c0); background:var(--lumiverse-primary-015); color:var(--lumiverse-primary-text,#a9a0ff); font-size:11px; font-family:inherit; font-weight:600; cursor:pointer; transition:all 120ms; }
    .ctv-tooltip-nav:hover { background:var(--lumiverse-primary-040,#6b63c0); color:#fff; }
    .ctv-tooltip-nav:active { transform:scale(0.97); }
    /* Touch layout: arrows flank a large primary button — ◀ │ Go to message │ ▶ */
    .ctv-tooltip-actions { margin-top:9px; display:flex; align-items:stretch; gap:7px; }
    .ctv-tooltip-actions .ctv-tooltip-nav { margin-top:0; flex:1; text-align:center; }
    .ctv-tooltip-nav--touch { min-height:44px; padding:8px 12px; font-size:13px; border-radius:10px; }
    .ctv-tooltip-arrow { flex-shrink:0; min-width:46px; min-height:44px; padding:0; border-radius:10px; border:1px solid var(--lumiverse-border); background:var(--lumiverse-fill-subtle); color:var(--lumiverse-text); font-size:16px; line-height:1; font-family:inherit; cursor:pointer; transition:all 120ms; }
    .ctv-tooltip-arrow:hover { background:var(--lumiverse-fill); }
    .ctv-tooltip-arrow:active { transform:scale(0.94); }
    .ctv-tooltip-arrow:disabled { opacity:0.28; cursor:default; }
    /* Glow ring on the node whose preview is open (touch crawl wayfinding). */
    .ctv-pill.ctv-node-peek { stroke:#fff; stroke-opacity:1; stroke-width:2.5; filter:drop-shadow(0 0 5px rgba(255,255,255,0.9)) drop-shadow(0 0 11px rgba(255,255,255,0.6)); }
    .ctv-node.ctv-node-peek { stroke:#fff; stroke-width:3.5; paint-order:stroke; filter:drop-shadow(0 0 6px rgba(255,255,255,1)) drop-shadow(0 0 13px rgba(255,255,255,0.7)); }
    /* Cap the legend so a branch-heavy chat can't crowd out the tree: it grows to a
       few rows, then scrolls internally (the canvas keeps the rest of the height).
       max-height is the smaller of a fixed cap and a fraction of the viewport so it
       also stays reasonable on short windows. overscroll-behavior keeps a legend
       scroll from bubbling out to the canvas/page. */
    .ctv-legend { padding:8px 14px; border-top:1px solid var(--lumiverse-border); display:flex; flex-wrap:wrap; gap:6px 14px; flex-shrink:0; max-height:min(120px, 30vh); overflow-y:auto; overscroll-behavior:contain; scrollbar-gutter:stable; }
    .ctv-legend-item { display:flex; align-items:center; gap:5px; font-size:11px; color:var(--lumiverse-text-dim); cursor:pointer; transition:color 120ms; -webkit-touch-callout:none; -webkit-user-select:none; user-select:none; }
    .ctv-legend-item:hover { color:var(--lumiverse-text); }
    .ctv-legend-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
    .ctv-legend-name { max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ctv-legend-input { background:var(--lumiverse-fill); border:1px solid var(--lumiverse-primary-040,#6b63c0); border-radius:4px; color:var(--lumiverse-text); font-size:11px; padding:1px 5px; outline:none; width:130px; font-family:inherit; }
    /* Node-shape key (solid = AI, ring = user). Pushed to the row's end; inert. */
    .ctv-legend-key { margin-left:auto; cursor:default; gap:4px; opacity:0.75; }
    .ctv-legend-key:hover { color:var(--lumiverse-text-dim); }
    .ctv-legend-key svg { display:block; flex-shrink:0; }
    .ctv-legend-key span + svg { margin-left:6px; }
    .ctv-ctx-menu { position:fixed; z-index:10002; background:var(--lumiverse-bg-elevated,#1a1825); border:1px solid var(--lumiverse-border); border-radius:9px; padding:4px; min-width:150px; box-shadow:0 8px 24px rgba(0,0,0,0.4); font-size:12.5px; }
    .ctv-ctx-item { padding:6px 10px; border-radius:6px; cursor:pointer; color:var(--lumiverse-text-dim); display:flex; align-items:center; gap:8px; transition:background 100ms, color 100ms; white-space:nowrap; }
    .ctv-ctx-item:hover { background:var(--lumiverse-fill); color:var(--lumiverse-text); }
    .ctv-ctx-sep { height:1px; background:var(--lumiverse-border); margin:3px 0; }
    /* Fullscreen overlay */
    .ctv-fs-overlay { position:fixed; inset:0; z-index:10000; background:rgba(0,0,0,0.72); backdrop-filter:blur(5px); display:flex; align-items:center; justify-content:center; opacity:0; transition:opacity 220ms ease; pointer-events:none; }
    .ctv-fs-overlay.ctv-fs-visible { opacity:1; pointer-events:all; }
    .ctv-fs-panel { width:95vw; height:95vh; background:var(--lumiverse-bg); border:1px solid var(--lumiverse-border); border-radius:14px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 28px 90px rgba(0,0,0,0.55); transform:scale(0.97); transition:transform 220ms ease; }
    .ctv-fs-overlay.ctv-fs-visible .ctv-fs-panel { transform:scale(1); }
    .ctv-fs-header { display:flex; align-items:center; gap:8px; padding:12px 16px; border-bottom:1px solid var(--lumiverse-border); flex-shrink:0; flex-wrap:wrap; }
    .ctv-fs-canvas-wrap { flex:1; min-height:0; overflow:auto; position:relative; touch-action:pan-x pan-y; }
    .ctv-fs-legend { padding:8px 16px; border-top:1px solid var(--lumiverse-border); display:flex; flex-wrap:wrap; gap:6px 14px; flex-shrink:0; max-height:72px; overflow-y:auto; }
    .ctv-fs-close-btn { margin-left:auto; width:30px; height:30px; border-radius:50%; border:1px solid var(--lumiverse-border); background:transparent; color:var(--lumiverse-text-dim); font-size:15px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 150ms; flex-shrink:0; }
    .ctv-fs-close-btn:hover { background:var(--lumiverse-fill-subtle); color:var(--lumiverse-text); }
    @keyframes ctv-pop-in { from { opacity:0; transform:scaleY(0.92); } to { opacity:1; transform:scaleY(1); } }

    /* ── Swipe-branch tooltip (interactive) ── */
    .ctv-tooltip.interactive { pointer-events:auto; }
    .ctv-tooltip.expandable { pointer-events:auto; }
    .ctv-swipe-list { margin-top:6px; display:flex; flex-direction:column; gap:6px; max-height:320px; overflow-y:auto; padding-right:4px; overscroll-behavior:contain; scrollbar-gutter:stable; }
    .ctv-swipe-list::-webkit-scrollbar { width:7px; }
    .ctv-swipe-list::-webkit-scrollbar-thumb { background:var(--lumiverse-border); border-radius:4px; }
    .ctv-swipe-row { border:1px solid var(--lumiverse-border); border-radius:7px; padding:6px 8px; background:var(--lumiverse-fill-subtle); }
    .ctv-swipe-row.active { border-color:var(--lumiverse-primary-040,#6b63c0); background:var(--lumiverse-primary-015); }
    .ctv-swipe-head { display:flex; align-items:center; gap:6px; margin-bottom:3px; cursor:pointer; user-select:none; }
    .ctv-swipe-head .ctv-swipe-act { margin-left:auto; }
    /* Highlighted by default (collapsed) — a toggle "on" look that switches off once the row is expanded. Not tied to :hover, so hovering the new-branch button no longer lights it up. The glyph is an SVG triangle whose centroid sits at the box centre, so it stays optically centred and pivots cleanly when the row rotates it 90°. */
    .ctv-swipe-caret { width:22px; height:22px; border:1px solid var(--lumiverse-primary-040,#6b63c0); background:var(--lumiverse-fill); border-radius:5px; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; transition:transform 160ms ease, background 120ms, border-color 120ms; }
    .ctv-swipe-caret svg { width:12px; height:12px; display:block; fill:var(--lumiverse-primary-text,#a9a0ff); transition:fill 120ms; }
    .ctv-swipe-row.expanded .ctv-swipe-caret { transform:rotate(90deg); background:transparent; border-color:var(--lumiverse-border); }
    .ctv-swipe-row.expanded .ctv-swipe-caret svg { fill:var(--lumiverse-text-dim); }
    .ctv-swipe-num { font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; color:var(--lumiverse-text-dim); white-space:nowrap; }
    .ctv-swipe-branch { font-size:10.5px; padding:2px 9px; border-radius:999px; border:1px solid var(--lumiverse-primary-040,#6b63c0); background:var(--lumiverse-primary-015); color:var(--lumiverse-primary-text,#a9a0ff); cursor:pointer; white-space:nowrap; transition:all 120ms; }
    .ctv-swipe-branch:hover { background:var(--lumiverse-primary-040,#6b63c0); color:#fff; }
    .ctv-swipe-text { font-size:11.5px; color:var(--lumiverse-text); line-height:1.4; word-break:break-word; max-height:2.9em; overflow:hidden; transition:max-height 220ms ease; }
    .ctv-swipe-row.expanded .ctv-swipe-text { white-space:pre-wrap; }
    .ctv-swipe-head .ctv-icon-btn { width:20px; height:20px; }
    /* Touch (docked) previews: finger-sized icon buttons. */
    .ctv-tooltip-docked .ctv-icon-btn, .ctv-tooltip-docked .ctv-swipe-head .ctv-icon-btn { width:34px; height:34px; border-radius:8px; }
    .ctv-tooltip-docked .ctv-icon-btn svg { width:15px; height:15px; }
    /* New-branch icon: primary tint so it reads as an action. On touch the first tap arms it ("Tap again"). */
    .ctv-branch-btn { border-color:var(--lumiverse-primary-040,#6b63c0); background:var(--lumiverse-primary-015); color:var(--lumiverse-primary-text,#a9a0ff); }
    .ctv-branch-btn:hover { background:var(--lumiverse-primary-040,#6b63c0); color:#fff; }
    .ctv-branch-btn.confirm, .ctv-tooltip-docked .ctv-branch-btn.confirm { width:auto; padding:0 10px; font-size:11.5px; font-weight:600; font-family:inherit; white-space:nowrap; background:var(--lumiverse-primary-040,#6b63c0); color:#fff; }
    /* Icon + label on one line. Explicit inline-flex so a host rule like "svg { display:block }" can't push the label under the icon. */
    .ctv-swipe-act.new { display:inline-flex; align-items:center; gap:4px; }
    /* Greetings list: links to separate chats get a dashed outline; create buttons sit on their own line. */
    .ctv-swipe-act.tree { border-style:dashed; }
    .ctv-swipe-act.more { color:var(--lumiverse-text-dim); }
    .ctv-greet-create { display:flex; flex-wrap:wrap; gap:4px; margin-top:5px; }
    .ctv-swipe-act .ctv-inline-icon { display:inline-block; flex-shrink:0; width:11px; height:11px; fill:none; stroke:currentColor; stroke-width:1.6; stroke-linecap:round; stroke-linejoin:round; }
    /* Desktop nav row: "→ Go to this message" with a compact ◀ ▶ pair beside it. */
    .ctv-tooltip-navrow { display:flex; align-items:center; gap:6px; margin-top:8px; }
    .ctv-tooltip-navrow .ctv-tooltip-nav { margin-top:0; }
    .ctv-tooltip-steps { display:flex; gap:3px; }
    .ctv-tooltip-step { width:24px; height:22px; padding:0; border-radius:6px; border:1px solid var(--lumiverse-border); background:var(--lumiverse-fill-subtle); color:var(--lumiverse-text-dim); font-size:10px; line-height:1; font-family:inherit; cursor:pointer; transition:all 120ms; }
    .ctv-tooltip-step:hover { background:var(--lumiverse-fill); color:var(--lumiverse-text); }
    .ctv-tooltip-step:active { transform:scale(0.94); }
    .ctv-tooltip-step:disabled { opacity:0.3; cursor:default; }
    .ctv-arrow-ico { display:block; margin:auto; width:9px; height:9px; fill:currentColor; }
    .ctv-tooltip-arrow .ctv-arrow-ico { width:15px; height:15px; }
    .ctv-tooltip.keynav .ctv-tooltip-step:not(:disabled) { border-color:var(--lumiverse-primary-040,#6b63c0); color:var(--lumiverse-text); }
    .ctv-swipe-row.expanded .ctv-swipe-text { max-height:170px; overflow-y:auto; padding-right:4px; overscroll-behavior:contain; }
    .ctv-swipe-text::-webkit-scrollbar { width:7px; }
    .ctv-swipe-text::-webkit-scrollbar-thumb { background:var(--lumiverse-border); border-radius:4px; }
    .ctv-swipe-actions { display:flex; flex-wrap:wrap; gap:4px; margin-top:5px; }
    /* packActionRows() regroups the buttons into equal-width rows (see JS). */
    .ctv-swipe-actions.packed { flex-direction:column; align-items:stretch; }
    .ctv-swipe-act-row { display:flex; gap:4px; }
    .ctv-swipe-act { font-size:10.5px; padding:2px 9px; border-radius:999px; cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; transition:all 120ms; border:1px solid var(--lumiverse-border); background:var(--lumiverse-fill-subtle); color:var(--lumiverse-text-dim); font-family:inherit; }
    .ctv-swipe-act:hover { background:var(--lumiverse-fill); color:var(--lumiverse-text); }
    .ctv-swipe-act.branch, .ctv-swipe-act.new { border-color:var(--lumiverse-primary-040,#6b63c0); background:var(--lumiverse-primary-015); color:var(--lumiverse-primary-text,#a9a0ff); }
    .ctv-swipe-act.branch:hover, .ctv-swipe-act.new:hover { background:var(--lumiverse-primary-040,#6b63c0); color:#fff; }
  `);
  const root = tab.root;
  root.style.height = "100%";
  root.style.overflow = "hidden";
  root.innerHTML = `
    <div class="ctv-root">
      <div class="ctv-header">
        <div class="ctv-header-main">
          <span class="ctv-header-label">Tapestry</span>
          <div class="ctv-tree-selector"></div>
          <button class="ctv-sort-btn active" title="Sort branches by fork position (no crossings)">⇅ Position</button>
          <button class="ctv-compact-btn" title="Compact view — collapse straight runs into pills">⊟ Compact</button>
          <div class="ctv-zoom-group">
            <button class="ctv-zoom-btn ctv-zoom-out" title="Zoom out (Ctrl+scroll)">−</button>
            <span class="ctv-zoom-label ctv-zoom-reset" title="Reset zoom">100%</span>
            <button class="ctv-zoom-btn ctv-zoom-in" title="Zoom in (Ctrl+scroll)">+</button>
          </div>
          <!-- <button class="ctv-ping-btn" title="Ping backend">Ping</button> — debug only -->
        </div>
        <div class="ctv-header-actions">
          <button class="ctv-reload-btn" title="Force reload tree">↻</button>
          <button class="ctv-expand-btn" title="Open fullscreen view">⛶</button>
        </div>
      </div>
      <div class="ctv-debug-bar"><span class="ctv-debug-text">Initialising…</span></div>
      <div class="ctv-canvas-wrap">
        <div class="ctv-state"><div class="ctv-spinner"></div><span>Connecting…</span></div>
      </div>
      <div class="ctv-legend"></div>
    </div>
  `;
  const canvasWrap = root.querySelector(".ctv-canvas-wrap");
  const treeSelector = root.querySelector(".ctv-tree-selector");
  const legend = root.querySelector(".ctv-legend");
  const sortBtn = root.querySelector(".ctv-sort-btn");
  const compactBtn = root.querySelector(".ctv-compact-btn");
  const expandBtn = root.querySelector(".ctv-expand-btn");
  const debugText = root.querySelector(".ctv-debug-text");
  const zoomInBtn = root.querySelector(".ctv-zoom-in");
  const zoomOutBtn = root.querySelector(".ctv-zoom-out");
  const zoomLabel = root.querySelector(".ctv-zoom-label");
  const reloadBtn = root.querySelector(".ctv-reload-btn");
  const dbg = (msg) => {
    const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    debugText.textContent = `${ts} ${msg}`;
  };
  dbg("Frontend loaded");
  addPanBehavior(canvasWrap);
  addPinchZoom(canvasWrap, () => renderAll());
  const tooltip = document.createElement("div");
  tooltip.className = "ctv-tooltip";
  tooltip.style.display = "none";
  document.body.appendChild(tooltip);
  let hoverExpandTimer = null;
  let hideTimer = null;
  let expandAnimTimer = null;
  let hoverAnchorEl = null;
  let suppressNodeHoverUntil = 0;
  let pendingExpand = null;
  let tooltipNavAction = null;
  let tooltipSwipeAction = null;
  let tooltipCopyAction = null;
  let tooltipBranchAction = null;
  let tooltipTouchMode = false;
  let keyNavActive = false;
  let deskPin = null;
  let stepTrackChat = null;
  let greetingView = null;
  const HOVER_EXPAND_MS = 2000;
  const HIDE_GRACE_MS = 170;
  const isCoarsePointer = typeof window.matchMedia === "function" && window.matchMedia("(hover: none) and (pointer: coarse)").matches || (navigator.maxTouchPoints ?? 0) > 0;
  let lastPointerType = "mouse";
  const onGlobalPointerDown = (e) => {
    const pe = e;
    lastPointerType = pe.pointerType || "mouse";
    if (pe.pointerType === "touch" && hoverAnchorEl) {
      const t = e.target;
      if (!hoverAnchorEl.contains(t) && !tooltip.contains(t))
        hideMsgTooltip();
    }
    if (keyNavActive && !tooltip.contains(e.target))
      hideMsgTooltip();
  };
  window.addEventListener("pointerdown", onGlobalPointerDown, true);
  const onKeyNav = (e) => {
    if (!keyNavActive || tooltip.style.display === "none")
      return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      hideMsgTooltip();
      return;
    }
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight")
      return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey)
      return;
    const a = document.activeElement;
    if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable))
      return;
    e.preventDefault();
    e.stopImmediatePropagation();
    moveTooltipToAdjacent(e.key === "ArrowLeft" ? -1 : 1);
  };
  window.addEventListener("keydown", onKeyNav, true);
  function anchorTooltip(el) {
    if (!el)
      return;
    tooltip.style.bottom = "";
    const rect = el.getBoundingClientRect();
    if (!rect.width && !rect.height)
      return;
    const gap = 12, margin = 8, MAXW = 320;
    const tw = tooltip.offsetWidth || 300;
    const th = tooltip.offsetHeight || 80;
    let left;
    const fitsRight = window.innerWidth - rect.right - gap - margin >= MAXW;
    const fitsLeft = rect.left - gap - MAXW >= margin;
    if (fitsRight || !fitsLeft) {
      left = rect.right + gap;
    } else {
      left = rect.left - gap - tw;
    }
    left = Math.max(margin, Math.min(left, window.innerWidth - tw - margin));
    let top = rect.top + rect.height / 2 - th / 2;
    top = Math.max(margin, Math.min(top, window.innerHeight - th - margin));
    tooltip.style.left = left + "px";
    tooltip.style.top = top + "px";
  }
  function mobileDockWidth() {
    return Math.min(window.innerWidth - 24, 420);
  }
  function positionTooltip(anchorEl, docked, keepPosition) {
    tooltip.classList.toggle("ctv-tooltip-docked", !!docked);
    if (docked) {
      const w = parseFloat(tooltip.style.width) || mobileDockWidth();
      tooltip.style.left = Math.round((window.innerWidth - w) / 2) + "px";
      tooltip.style.top = "";
      let bottomPx = 12;
      const root = anchorEl?.closest(".ctv-fs-panel") ?? anchorEl?.closest(".ctv-root");
      const legend = root?.querySelector(".ctv-fs-legend, .ctv-legend");
      if (legend) {
        const lr = legend.getBoundingClientRect();
        if (lr.height && lr.top < window.innerHeight) {
          bottomPx = Math.max(12, Math.round(window.innerHeight - lr.top + 10));
        }
      }
      bottomPx = Math.min(bottomPx, Math.round(window.innerHeight * 0.5));
      tooltip.style.bottom = `calc(${bottomPx}px + env(safe-area-inset-bottom, 0px))`;
    } else {
      anchorTooltip(anchorEl);
    }
    if (keepPosition) {
      tooltip.style.opacity = "1";
    } else {
      tooltip.style.opacity = "0";
      requestAnimationFrame(() => {
        tooltip.style.opacity = "1";
      });
    }
  }
  function resetTooltipMorph() {
    clearTimeout(expandAnimTimer);
    expandAnimTimer = null;
    tooltip.style.transition = "";
    tooltip.style.overflow = "";
    tooltip.style.height = "";
    tooltip.style.transform = "";
    tooltip.style.bottom = "";
  }
  function showSimpleTooltip(anchorEl, html) {
    greetingView = null;
    clearTimeout(hoverExpandTimer);
    hoverExpandTimer = null;
    clearTimeout(hideTimer);
    hideTimer = null;
    resetTooltipMorph();
    tooltip.classList.remove("expanded");
    tooltip.classList.remove("interactive");
    tooltip.classList.remove("expandable");
    pendingExpand = null;
    tooltipNavAction = null;
    clearNodePeek();
    tooltip.style.width = "";
    hoverAnchorEl = anchorEl;
    tooltip.innerHTML = html;
    tooltip.style.display = "block";
    anchorTooltip(anchorEl);
    tooltip.style.opacity = "0";
    requestAnimationFrame(() => {
      tooltip.style.opacity = "1";
    });
  }
  const fullTextCache = new Map;
  let fullTextWaiter = null;
  const FULL_TEXT_TIMEOUT_MS = 1e4;
  function requestFullText(chatId, messageId, apply, fail = null) {
    if (!chatId || !messageId) {
      fail?.();
      return;
    }
    const cached = fullTextCache.get(messageId);
    if (cached) {
      apply(cached);
      return;
    }
    if (fullTextWaiter?.messageId === messageId) {
      fullTextWaiter.applies.push(apply);
      if (fail)
        fullTextWaiter.fails.push(fail);
      return;
    }
    clearTimeout(fullTextWaiter?.timer);
    const waiter = { messageId, applies: [apply], fails: fail ? [fail] : [], timer: null };
    waiter.timer = setTimeout(() => endFullTextWaiter(messageId, null), FULL_TEXT_TIMEOUT_MS);
    fullTextWaiter = waiter;
    ctx.sendToBackend({ type: "get_full_message", chatId, messageId });
  }
  function endFullTextWaiter(messageId, entry) {
    if (fullTextWaiter?.messageId !== messageId)
      return;
    const waiter = fullTextWaiter;
    fullTextWaiter = null;
    clearTimeout(waiter.timer);
    if (entry)
      for (const apply of waiter.applies)
        apply(entry);
    else
      for (const fail of waiter.fails)
        fail();
  }
  const COPY_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V3.5a1.5 1.5 0 0 0-1.5-1.5H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2"/></svg>';
  const CHECK_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5"/></svg>';
  const ARROW_LEFT = '<svg class="ctv-arrow-ico" viewBox="0 0 10 10" aria-hidden="true"><path d="M6.5 2.5 L2 5 L6.5 7.5 Z"/></svg>';
  const ARROW_RIGHT = '<svg class="ctv-arrow-ico" viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2.5 L8 5 L3.5 7.5 Z"/></svg>';
  const copyBtnHtml = (title, extraAttrs = "") => `<button type="button" class="ctv-icon-btn ctv-copy-btn" title="${title}" aria-label="${title}"${extraAttrs}>${COPY_ICON}</button>`;
  const BRANCH_ICON_PATHS = '<circle cx="4" cy="3.5" r="1.5"/><circle cx="4" cy="12.5" r="1.5"/><circle cx="10.5" cy="5" r="1.5"/><path d="M4 5v6"/><path d="M10.5 6.5c0 3-6.5 2.5-6.5 4.5"/><path d="M13 10.5v4M11 12.5h4"/>';
  const BRANCH_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true">${BRANCH_ICON_PATHS}</svg>`;
  const branchBtnHtml = () => `<button type="button" class="ctv-icon-btn ctv-branch-btn" title="New branch from this message" aria-label="New branch from this message">${BRANCH_ICON}</button>`;
  async function writeClipboard(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none;";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
  async function copyTextWithFeedback(btn, text) {
    flashCopyResult(btn, await writeClipboard(text));
  }
  function flashCopyResult(btn, ok) {
    btn.classList.remove("copied", "failed");
    btn.classList.add(ok ? "copied" : "failed");
    btn.innerHTML = ok ? CHECK_ICON : COPY_ICON;
    btn.title = ok ? "Copied!" : "Copy failed";
    clearTimeout(btn._copyTimer);
    btn._copyTimer = setTimeout(() => {
      btn.classList.remove("copied", "failed");
      btn.innerHTML = COPY_ICON;
      btn.title = btn.getAttribute("aria-label") || "Copy";
    }, 1400);
  }
  function copyMessageText(btn, chatId, msg, swipeIndex = null) {
    const pick = (entry) => swipeIndex === null ? entry.content ?? "" : entry.swipes?.[swipeIndex] ?? "";
    const done = (text) => copyTextWithFeedback(btn, text);
    if (msg.truncated) {
      requestFullText(chatId, msg.id, (entry) => done(pick(entry)), () => flashCopyResult(btn, false));
    } else {
      done(pick({ content: msg.preview, swipes: msg.swipes }));
    }
  }
  function showMsgTooltip(anchorEl, msg, opts = {}) {
    greetingView = null;
    const { onNavigate = null, openedByTouch = false, keepPosition = false, onSwipes = null, swipeCount = 0, chatId = null, onBranch = null, stepping = false } = opts;
    const deskStep = stepping && !openedByTouch && !!deskPin;
    if (!stepping) {
      deskPin = null;
      stepTrackChat = stepTrackFor(anchorEl);
    }
    const docked = openedByTouch;
    clearTimeout(hoverExpandTimer);
    clearTimeout(hideTimer);
    hideTimer = null;
    resetTooltipMorph();
    tooltip.classList.remove("expanded");
    tooltip.classList.remove("interactive");
    tooltip.classList.remove("expandable");
    pendingExpand = null;
    tooltipNavAction = onNavigate;
    tooltipSwipeAction = onSwipes;
    tooltipCopyAction = (btn) => copyMessageText(btn, chatId, msg);
    tooltipBranchAction = onBranch;
    tooltipTouchMode = openedByTouch;
    hoverAnchorEl = anchorEl;
    if (onNavigate)
      tooltip.classList.add("interactive");
    clearNodePeek();
    const peekable = anchorEl?.classList?.contains("ctv-node") || anchorEl?.classList?.contains("ctv-pill");
    if ((openedByTouch || keyNavActive) && peekable) {
      anchorEl.classList.add("ctv-node-peek");
    }
    const hasPrev = !!onNavigate && !!adjacentNodeCircle(anchorEl, -1);
    const hasNext = !!onNavigate && !!adjacentNodeCircle(anchorEl, 1);
    const label = msg.role === "user" ? "User" : msg.role === "assistant" ? "AI" : "System";
    const ts = msg.timestamp ? new Date(msg.timestamp * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
    const SHORT = 200;
    const isLong = (msg.preview || "").length > SHORT;
    const shortText = isLong ? msg.preview.slice(0, SHORT) + "…" : msg.preview || "(empty)";
    const buildHtml = (text, expanded) => {
      const moreHint = expanded ? "Scroll to read more" : isLong ? openedByTouch ? "Tap the text to read more" : "Hold to read more" : "";
      const jumpHint = onNavigate ? openedByTouch ? "" : "Click node to jump" : "Click node to jump";
      const hintText = [moreHint, jumpHint].filter(Boolean).join(" · ");
      const swipesBtn = onSwipes ? msg.greetingVariants ? `<button type="button" class="ctv-tooltip-swipes" title="View this character's greetings and the chats that use them">⇄ Greetings</button>` : `<button type="button" class="ctv-tooltip-swipes" title="View all swipes">⇄ ${swipeCount} swipes</button>` : "";
      const actions = !onNavigate ? "" : openedByTouch ? `
      <div class="ctv-tooltip-actions">
        <button type="button" class="ctv-tooltip-arrow ctv-tooltip-prev" aria-label="Previous node"${hasPrev ? "" : " disabled"}>${ARROW_LEFT}</button>
        <button type="button" class="ctv-tooltip-nav ctv-tooltip-nav--touch">→ Go to this message</button>
        <button type="button" class="ctv-tooltip-arrow ctv-tooltip-next" aria-label="Next node"${hasNext ? "" : " disabled"}>${ARROW_RIGHT}</button>
      </div>` : `
      <div class="ctv-tooltip-navrow">
        <button type="button" class="ctv-tooltip-nav">→ Go to this message</button>
        <div class="ctv-tooltip-steps">
          <button type="button" class="ctv-tooltip-step ctv-tooltip-prev" aria-label="Previous message" title="Previous message (← key)"${hasPrev ? "" : " disabled"}>${ARROW_LEFT}</button>
          <button type="button" class="ctv-tooltip-step ctv-tooltip-next" aria-label="Next message" title="Next message (→ key)"${hasNext ? "" : " disabled"}>${ARROW_RIGHT}</button>
        </div>
      </div>`;
      return `
      <div class="ctv-tooltip-rolerow">
        <div class="ctv-tooltip-role">${label} · msg ${msg.index + 1}</div>
        <div class="ctv-tooltip-rolerow-end">
          ${swipesBtn}
          ${onNavigate && onBranch ? branchBtnHtml() : ""}
          ${onNavigate ? copyBtnHtml("Copy message") : ""}
        </div>
      </div>
      <div class="ctv-tooltip-preview">${escHtml(text)}</div>
      ${ts ? `<div class="ctv-tooltip-meta">${ts}</div>` : ""}
      ${hintText ? `<div class="ctv-tooltip-hint">${hintText}</div>` : ""}
      ${actions}
    `;
    };
    const fillFullText = () => {
      if (!msg.truncated)
        return;
      requestFullText(chatId, msg.id, (entry) => {
        if (hoverAnchorEl !== anchorEl || !tooltip.classList.contains("expanded"))
          return;
        if (anchorEl?._msg && anchorEl._msg !== msg)
          return;
        const pv = tooltip.querySelector(".ctv-tooltip-preview");
        if (pv && entry.content)
          pv.textContent = entry.content;
      });
    };
    if (deskStep && deskPin) {
      tooltip.style.width = "300px";
      if (isLong)
        tooltip.classList.add("expanded");
      tooltip.innerHTML = buildHtml(isLong ? msg.preview : shortText, isLong);
      tooltip.style.display = "block";
      tooltip.classList.remove("ctv-tooltip-docked");
      tooltip.style.bottom = "";
      tooltip.style.left = deskPin.left + "px";
      tooltip.style.top = Math.max(8, deskPin.bottom - tooltip.offsetHeight) + "px";
      tooltip.style.opacity = "1";
      if (isLong)
        fillFullText();
    } else {
      tooltip.style.width = docked ? mobileDockWidth() + "px" : isLong ? "300px" : "";
      if (isLong)
        tooltip.classList.add("expandable");
      tooltip.innerHTML = buildHtml(shortText, false);
      tooltip.style.display = "block";
      positionTooltip(anchorEl, docked, keepPosition);
    }
    if (openedByTouch && msg.truncated && onNavigate)
      requestFullText(chatId, msg.id, () => {});
    if (isLong && !deskStep) {
      const doExpand = () => {
        if (tooltip.classList.contains("expanded"))
          return;
        clearTimeout(hoverExpandTimer);
        hoverExpandTimer = null;
        pendingExpand = null;
        const startH = tooltip.offsetHeight;
        const startTop = parseFloat(tooltip.style.top) || 0;
        tooltip.classList.add("expanded");
        tooltip.innerHTML = buildHtml(msg.preview, true);
        const endH = tooltip.offsetHeight;
        fillFullText();
        if (docked) {
          clearTimeout(expandAnimTimer);
          if (Math.abs(endH - startH) < 2)
            return;
          tooltip.style.transition = "none";
          tooltip.style.overflow = "hidden";
          tooltip.style.height = startH + "px";
          tooltip.offsetHeight;
          const EASE_UP = "cubic-bezier(0.22,1,0.36,1)";
          requestAnimationFrame(() => {
            tooltip.style.transition = `height 230ms ${EASE_UP}`;
            tooltip.style.height = endH + "px";
          });
          expandAnimTimer = setTimeout(() => {
            tooltip.style.transition = "";
            tooltip.style.overflow = "";
            tooltip.style.height = "";
          }, 260);
          return;
        }
        const margin = 8;
        let endTop = startTop;
        if (endTop + endH > window.innerHeight - margin) {
          endTop = Math.max(margin, window.innerHeight - endH - margin);
        }
        clearTimeout(expandAnimTimer);
        if (Math.abs(endH - startH) < 2)
          return;
        tooltip.style.transition = "none";
        tooltip.style.overflow = "hidden";
        tooltip.style.height = startH + "px";
        tooltip.style.top = startTop + "px";
        tooltip.offsetHeight;
        const EASE = "cubic-bezier(0.22,1,0.36,1)";
        requestAnimationFrame(() => {
          tooltip.style.transition = `height 230ms ${EASE}, top 230ms ${EASE}`;
          tooltip.style.height = endH + "px";
          tooltip.style.top = endTop + "px";
        });
        expandAnimTimer = setTimeout(() => {
          tooltip.style.transition = "";
          tooltip.style.overflow = "";
          tooltip.style.height = "";
        }, 260);
      };
      pendingExpand = doExpand;
      if (!openedByTouch)
        hoverExpandTimer = setTimeout(doExpand, HOVER_EXPAND_MS);
    }
  }
  function scheduleHideTooltip() {
    if (lastPointerType === "touch")
      return;
    if (keyNavActive)
      return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideMsgTooltip, HIDE_GRACE_MS);
  }
  function setBranchHighlight(chatId, on) {
    if (!chatId)
      return;
    document.querySelectorAll("[data-chat]").forEach((el) => {
      if (el.dataset.chat === chatId)
        el.classList.toggle("ctv-branch-hl", on);
    });
  }
  function clearBranchHighlight() {
    document.querySelectorAll(".ctv-branch-hl").forEach((el) => el.classList.remove("ctv-branch-hl"));
  }
  function clearNodePeek() {
    document.querySelectorAll(".ctv-node-peek").forEach((el) => el.classList.remove("ctv-node-peek"));
  }
  function onTouchActions(el, opts) {
    const { tap = null, longPress = null, longMs = 500, moveTol = 12 } = opts;
    let sx = 0, sy = 0, moved = false, fired = false;
    let timer = null;
    const clear = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    el.addEventListener("pointerdown", (e) => {
      const pe = e;
      if (pe.pointerType !== "touch")
        return;
      sx = pe.clientX;
      sy = pe.clientY;
      moved = false;
      fired = false;
      clear();
      if (longPress)
        timer = setTimeout(() => {
          timer = null;
          fired = true;
          longPress();
        }, longMs);
    });
    el.addEventListener("pointermove", (e) => {
      const pe = e;
      if (pe.pointerType !== "touch")
        return;
      if (Math.hypot(pe.clientX - sx, pe.clientY - sy) > moveTol) {
        moved = true;
        clear();
      }
    });
    el.addEventListener("pointerup", (e) => {
      const pe = e;
      if (pe.pointerType !== "touch")
        return;
      clear();
      if (!moved && !fired && tap)
        tap();
    });
    el.addEventListener("pointercancel", (e) => {
      if (e.pointerType === "touch")
        clear();
    });
  }
  function nodeTooltipOpts(anchorEl, node, msg, extra = {}) {
    const isMultiSwipe = (msg.swipeCount ?? 1) > 1 && !!msg.swipes && msg.swipes.length > 1;
    const lastIdx = node.messages.length ? node.messages[node.messages.length - 1].index : msg.index;
    return {
      onNavigate: () => navigateToMessage(node.chatId, msg.id, msg.index),
      openedByTouch: lastPointerType === "touch",
      onSwipes: msg.greetingVariants ? () => showGreetingTooltip(anchorEl, node, msg) : isMultiSwipe ? () => showSwipeTooltip(anchorEl, node, msg) : null,
      swipeCount: isMultiSwipe ? msg.swipes.length : 0,
      chatId: node.chatId,
      onBranch: msg.index === lastIdx ? null : () => branchOnSwipe(node.chatId, msg, msg.swipeId ?? 0),
      ...extra
    };
  }
  function laneOwnerOf(chatId, index) {
    let n = findNodeByChat(chatId);
    const seen = new Set;
    while (n && !seen.has(n.chatId)) {
      seen.add(n.chatId);
      const firstUnique = n.parentId === null ? 0 : (n.forkAtIndex ?? 0) + 1;
      if (index >= firstUnique)
        return n.chatId;
      n = n.parentId ? findNodeByChat(n.parentId) : null;
    }
    return null;
  }
  function stepTrackFor(circle) {
    const node = circle?._node, msg = circle?._msg;
    if (!node || !msg)
      return null;
    if (activeChatId) {
      const active = findNodeByChat(activeChatId);
      if (active && msg.index < active.messages.length && laneOwnerOf(activeChatId, msg.index) === node.chatId) {
        return activeChatId;
      }
    }
    return node.chatId;
  }
  function adjacentStop(curEl, dir) {
    const el = curEl;
    const laneChat = el?.dataset?.nodeChat;
    const idx = parseInt(el?.dataset?.nodeIdx ?? "", 10);
    if (!laneChat || Number.isNaN(idx))
      return null;
    const track = findNodeByChat(stepTrackChat ?? laneChat);
    if (!track)
      return null;
    const scope = el.closest("svg") ?? document;
    const last = track.messages.length - 1;
    for (let i = idx + dir;i >= 0 && i <= last; i += dir) {
      const lane = laneOwnerOf(track.chatId, i);
      if (!lane)
        return null;
      const c = scope.querySelector(`circle.ctv-node[data-node-chat="${CSS.escape(lane)}"][data-node-idx="${i}"]`);
      if (c?._msg)
        return { el: c, msg: c._msg, node: c._node };
      for (const p of Array.from(scope.querySelectorAll(`.ctv-pill[data-pill-chat="${CSS.escape(lane)}"]`))) {
        const msg = (p._pillMsgs ?? []).find((m) => m.index === i);
        if (msg)
          return { el: p, msg, node: p._node };
      }
    }
    return null;
  }
  const adjacentNodeCircle = (curEl, dir) => adjacentStop(curEl, dir)?.el ?? null;
  function moveTooltipToAdjacent(dir) {
    const stop = adjacentStop(hoverAnchorEl, dir);
    if (!stop)
      return;
    const next = stop.el;
    if (next.classList.contains("ctv-pill")) {
      next.dataset.nodeChat = stop.node.chatId;
      next.dataset.nodeIdx = String(stop.msg.index);
      next._msg = stop.msg;
    }
    if (!tooltipTouchMode && !deskPin) {
      const r = tooltip.getBoundingClientRect();
      deskPin = { left: r.left, bottom: r.bottom };
    }
    showMsgTooltip(next, stop.msg, nodeTooltipOpts(next, stop.node, stop.msg, {
      openedByTouch: tooltipTouchMode,
      keepPosition: true,
      stepping: true
    }));
    next.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }
  function hideMsgTooltip() {
    greetingView = null;
    clearTimeout(hoverExpandTimer);
    hoverExpandTimer = null;
    clearTimeout(hideTimer);
    hideTimer = null;
    pendingExpand = null;
    tooltipNavAction = null;
    tooltipSwipeAction = null;
    tooltipBranchAction = null;
    keyNavActive = false;
    deskPin = null;
    stepTrackChat = null;
    tooltip.classList.remove("keynav");
    resetTooltipMorph();
    tooltip.classList.remove("expanded");
    tooltip.classList.remove("interactive");
    tooltip.classList.remove("expandable");
    tooltip.style.display = "none";
    tooltip.style.width = "";
    tooltip.classList.remove("ctv-tooltip-docked");
    hoverAnchorEl = null;
    clearBranchHighlight();
    clearNodePeek();
  }
  tooltip.addEventListener("mouseenter", () => {
    clearTimeout(hideTimer);
    if (lastPointerType !== "touch" && pendingExpand)
      pendingExpand();
  });
  tooltip.addEventListener("mouseleave", scheduleHideTooltip);
  tooltip.addEventListener("click", (e) => {
    const target = e.target;
    if (target.closest(".ctv-tooltip-swipes")) {
      tooltipSwipeAction?.();
      return;
    }
    const copyBtn = target.closest(".ctv-tooltip-rolerow .ctv-copy-btn");
    if (copyBtn) {
      tooltipCopyAction?.(copyBtn);
      return;
    }
    const branchBtn = target.closest(".ctv-branch-btn");
    if (branchBtn) {
      if (tooltipTouchMode && !branchBtn.classList.contains("confirm")) {
        branchBtn.classList.add("confirm");
        branchBtn.textContent = "Tap again";
        clearTimeout(branchBtn._armTimer);
        branchBtn._armTimer = setTimeout(() => {
          branchBtn.classList.remove("confirm");
          branchBtn.innerHTML = BRANCH_ICON;
        }, 2500);
        return;
      }
      tooltipBranchAction?.();
      return;
    }
    const step = target.closest(".ctv-tooltip-prev") ? -1 : target.closest(".ctv-tooltip-next") ? 1 : 0;
    if (step) {
      if (!tooltipTouchMode) {
        keyNavActive = true;
        tooltip.classList.add("keynav");
      }
      moveTooltipToAdjacent(step);
      return;
    }
    if (target.closest(".ctv-tooltip-nav")) {
      const go = tooltipNavAction;
      hideMsgTooltip();
      go?.();
      return;
    }
    if (target.closest(".ctv-tooltip-preview") && pendingExpand)
      pendingExpand();
  });
  function showSwipeTooltip(anchorEl, node, msg) {
    greetingView = null;
    clearTimeout(hoverExpandTimer);
    hoverExpandTimer = null;
    clearTimeout(hideTimer);
    hideTimer = null;
    resetTooltipMorph();
    tooltip.classList.remove("expanded");
    tooltip.classList.remove("expandable");
    tooltip.classList.add("interactive");
    pendingExpand = null;
    tooltipNavAction = null;
    tooltipSwipeAction = null;
    const docked = lastPointerType === "touch";
    tooltip.style.width = docked ? mobileDockWidth() + "px" : "330px";
    hoverAnchorEl = anchorEl;
    clearNodePeek();
    if (lastPointerType === "touch" && anchorEl?.classList?.contains("ctv-node")) {
      anchorEl.classList.add("ctv-node-peek");
    }
    const label = msg.role === "user" ? "User" : msg.role === "assistant" ? "AI" : "System";
    const swipes = msg.swipes ?? [];
    const activeIdx = msg.swipeId ?? 0;
    const currentIdx = currentSwipeForActive(node, msg);
    const lastIdx = node.messages.length ? node.messages[node.messages.length - 1].index : msg.index;
    const isTip = msg.index === lastIdx;
    const rows = swipes.map((text, i) => {
      const isCurrent = i === currentIdx;
      const full = text && text.length ? text : "(empty)";
      const branches = msg.swipeBranches && msg.swipeBranches[i] ? msg.swipeBranches[i] : [];
      const navDests = [];
      if (isTip)
        navDests.push({ label: "Continue here", inplace: true });
      else if (i === activeIdx)
        navDests.push({ label: branchLabel(node.chatName, node.branchPath), inplace: true });
      for (const b of branches)
        navDests.push({ label: branchLabel(b.name, b.branchPath), chatId: b.chatId });
      const navHtml = navDests.map((d) => d.inplace ? `<button class="ctv-swipe-act go" data-swipe="${i}" data-inplace="1">→ ${escHtml(truncate(d.label, 22))}</button>` : `<button class="ctv-swipe-act go" data-swipe="${i}" data-dest-chat="${escHtml(d.chatId)}">→ ${escHtml(truncate(d.label, 22))}</button>`).join("");
      const createHtml = isTip ? "" : `<button class="ctv-swipe-act new" data-swipe="${i}"><svg class="ctv-inline-icon" viewBox="0 0 16 16" aria-hidden="true">${BRANCH_ICON_PATHS}</svg>New branch</button>`;
      return `
        <div class="ctv-swipe-row${isCurrent ? " active" : ""}">
          <div class="ctv-swipe-head" title="Click to expand the text">
            <span class="ctv-swipe-caret"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2.5 L8 5 L3.5 7.5 Z"/></svg></span>
            <span class="ctv-swipe-num">Swipe ${i + 1}${isCurrent ? " · current" : ""}</span>
            ${copyBtnHtml("Copy this swipe", ` data-swipe="${i}"`)}
            ${createHtml}
          </div>
          <div class="ctv-swipe-text">${escHtml(full)}</div>
          ${navHtml ? `<div class="ctv-swipe-actions">${navHtml}</div>` : ""}
        </div>`;
    }).join("");
    tooltip.innerHTML = `
      <div class="ctv-swipe-header">
        <button type="button" class="ctv-swipe-back" title="Back to message preview">‹ Back</button>
        <div class="ctv-tooltip-role">${label} · msg ${msg.index + 1} · ⇄ ${swipes.length} swipes</div>
      </div>
      <div class="ctv-swipe-list">${rows}</div>
      <div class="ctv-tooltip-hint">Click a swipe to expand it · click an action to jump</div>
    `;
    tooltip.querySelector(".ctv-swipe-back")?.addEventListener("click", (e) => {
      e.stopPropagation();
      showMsgTooltip(anchorEl, msg, nodeTooltipOpts(anchorEl, node, msg));
    });
    tooltip.querySelectorAll(".ctv-swipe-head").forEach((head) => {
      head.addEventListener("click", (e) => {
        e.stopPropagation();
        head.closest(".ctv-swipe-row")?.classList.toggle("expanded");
      });
    });
    tooltip.querySelectorAll(".ctv-swipe-head .ctv-copy-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        copyMessageText(btn, node.chatId, msg, parseInt(btn.getAttribute("data-swipe") || "0", 10));
      });
    });
    tooltip.querySelectorAll(".ctv-swipe-act").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const i = parseInt(btn.getAttribute("data-swipe") || "0", 10);
        if (btn.classList.contains("branch") || btn.classList.contains("new")) {
          branchOnSwipe(node.chatId, msg, i);
        } else if (btn.getAttribute("data-inplace")) {
          goToSwipeInPlace(node.chatId, msg, i);
        } else {
          const destChat = btn.getAttribute("data-dest-chat");
          if (destChat)
            goToBranch(destChat, msg);
        }
      });
      const destChat = btn.getAttribute("data-dest-chat");
      if (destChat) {
        btn.addEventListener("mouseenter", () => setBranchHighlight(destChat, true));
        btn.addEventListener("mouseleave", () => setBranchHighlight(destChat, false));
      } else if (btn.getAttribute("data-inplace")) {
        btn.addEventListener("mouseenter", () => anchorEl.classList.add("ctv-branch-hl"));
        btn.addEventListener("mouseleave", () => anchorEl.classList.remove("ctv-branch-hl"));
      }
    });
    tooltip.style.display = "block";
    tooltip.querySelectorAll(".ctv-swipe-actions").forEach(packActionRows);
    positionTooltip(anchorEl, docked, false);
    if (msg.truncated) {
      requestFullText(node.chatId, msg.id, (entry) => {
        if (hoverAnchorEl !== anchorEl || !entry.swipes)
          return;
        tooltip.querySelectorAll(".ctv-swipe-text").forEach((el, i) => {
          const text = entry.swipes[i];
          if (text)
            el.textContent = text;
        });
      });
    }
  }
  const cardGreetings = new Map;
  function loadCardGreetings(characterId) {
    if (!cardGreetings.has(characterId)) {
      cardGreetings.set(characterId, hostApi("GET", `/characters/${encodeURIComponent(characterId)}`).then((c) => typeof c?.first_mes === "string" ? [c.first_mes, ...Array.isArray(c.alternate_greetings) ? c.alternate_greetings : []] : null).catch(() => {
        cardGreetings.delete(characterId);
        return null;
      }));
    }
    return cardGreetings.get(characterId);
  }
  const NEW_CHAT_ICON_PATHS = '<path d="M3 3h10a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1H7.5L4.5 13v-2.5H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M8 4.8v4M6 6.8h4"/>';
  function showGreetingTooltip(anchorEl, node, msg) {
    clearTimeout(hoverExpandTimer);
    hoverExpandTimer = null;
    clearTimeout(hideTimer);
    hideTimer = null;
    resetTooltipMorph();
    tooltip.classList.remove("expanded");
    tooltip.classList.remove("expandable");
    tooltip.classList.add("interactive");
    pendingExpand = null;
    tooltipNavAction = null;
    tooltipSwipeAction = null;
    const docked = lastPointerType === "touch";
    tooltip.style.width = docked ? mobileDockWidth() + "px" : "330px";
    hoverAnchorEl = anchorEl;
    clearNodePeek();
    if (docked && anchorEl?.classList?.contains("ctv-node")) {
      anchorEl.classList.add("ctv-node-peek");
    }
    const view = {};
    greetingView = view;
    const label = msg.role === "user" ? "User" : msg.role === "assistant" ? "AI" : "System";
    const key = (t) => (t || "").replace(/\s+/g, " ").trim();
    const isTip = node.messages.length <= msg.index + 1;
    const expandedKeys = new Set;
    const showAllKeys = new Set;
    let card = null;
    let rows = [];
    const buildRows = () => {
      const out = card ? card.map((text, i) => ({ text, greetingIndex: i, current: false, branches: [], trees: [] })) : [];
      for (const v of msg.greetingVariants ?? []) {
        let row = card && Number.isInteger(v.greetingIndex) ? out[v.greetingIndex] : null;
        if (!row && card)
          row = out.find((r) => key(r.text) === key(v.text)) ?? out.find((r) => !r.current && !r.branches.length && !r.trees.length && cardMatches(r.greetingIndex, v.text));
        if (row) {
          row.current = row.current || v.current;
          row.branches.push(...v.branches);
          row.trees.push(...v.trees);
          row.text = v.text || row.text;
          if (row.greetingIndex == null)
            row.greetingIndex = v.greetingIndex;
        } else {
          out.push({ ...v, branches: [...v.branches], trees: [...v.trees] });
        }
      }
      return out;
    };
    const cardPatterns = new Map;
    const cardMatches = (i, text) => {
      if (!cardPatterns.has(i)) {
        const src = key(card?.[i] ?? "");
        const parts = src.split(/\{\{\s*(?:user|char)\s*\}\}|<USER>|<BOT>/i);
        cardPatterns.set(i, parts.length > 1 ? new RegExp("^" + parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".{1,80}?") + "$", "s") : null);
      }
      const re = cardPatterns.get(i);
      return re ? re.test(key(text)) : false;
    };
    const rowName = (r) => Number.isInteger(r.greetingIndex) ? `Greeting ${r.greetingIndex + 1}` : "Other greeting";
    const render = (first) => {
      rows = buildRows();
      const html = rows.map((r, ri) => {
        const k = key(r.text);
        const dests = [];
        if (r.current) {
          dests.push(`<button class="ctv-swipe-act go" data-row="${ri}" data-here="1" title="This chat">→ ${escHtml(truncate(isTip ? "Continue here" : branchLabel(node.chatName, node.branchPath), 22))}</button>`);
        }
        for (const b of r.branches) {
          dests.push(`<button class="ctv-swipe-act go" data-row="${ri}" data-dest-chat="${escHtml(b.chatId)}" title="Branch in this tree">→ ${escHtml(truncate(branchLabel(b.name, b.branchPath), 22))}</button>`);
        }
        for (const t of r.trees) {
          dests.push(`<button class="ctv-swipe-act go tree" data-row="${ri}" data-tree-chat="${escHtml(t.chatId)}" title="Separate chat (its own tree)">↗ ${escHtml(truncate(t.name, 22))}</button>`);
        }
        const folded = dests.length > 3 && !showAllKeys.has(k);
        const shown = folded ? dests.slice(0, 2) : dests;
        const more = folded ? `<button class="ctv-swipe-act more" data-row="${ri}" data-more="1">+${dests.length - 2} more</button>` : "";
        const canBranch = !(r.current && isTip);
        const canNewChat = Number.isInteger(r.greetingIndex) && !!currentCharacterId;
        const create = canBranch || canNewChat ? `
          <div class="ctv-greet-create">
            ${canBranch ? `<button class="ctv-swipe-act new" data-row="${ri}" data-create="branch" title="Branch from this greeting — stays in this tree"><svg class="ctv-inline-icon" viewBox="0 0 16 16" aria-hidden="true">${BRANCH_ICON_PATHS}</svg>New branch</button>` : ""}
            ${canNewChat ? `<button class="ctv-swipe-act new" data-row="${ri}" data-create="chat" title="Start a separate chat on this greeting — its own tree"><svg class="ctv-inline-icon" viewBox="0 0 16 16" aria-hidden="true">${NEW_CHAT_ICON_PATHS}</svg>New chat</button>` : ""}
          </div>` : "";
        return `
          <div class="ctv-swipe-row${r.current ? " active" : ""}${expandedKeys.has(k) ? " expanded" : ""}" data-key="${escHtml(k.slice(0, 80))}">
            <div class="ctv-swipe-head" title="Click to expand the text" data-row="${ri}">
              <span class="ctv-swipe-caret"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2.5 L8 5 L3.5 7.5 Z"/></svg></span>
              <span class="ctv-swipe-num">${rowName(r)}${r.current ? " · current" : ""}</span>
              ${copyBtnHtml("Copy this greeting", ` data-row="${ri}"`)}
            </div>
            <div class="ctv-swipe-text">${escHtml(r.text || "(empty)")}</div>
            ${shown.length ? `<div class="ctv-swipe-actions">${shown.join("")}${more}</div>` : ""}
            ${create}
          </div>`;
      }).join("");
      tooltip.innerHTML = `
        <div class="ctv-swipe-header">
          <button type="button" class="ctv-swipe-back" title="Back to message preview">‹ Back</button>
          <div class="ctv-tooltip-role">${label} · msg ${msg.index + 1} · ⇄ ${rows.length} greetings</div>
        </div>
        <div class="ctv-swipe-list">${html}</div>
        <div class="ctv-tooltip-hint">Click a greeting to expand it · → this tree · ↗ separate chat</div>
      `;
      tooltip.style.display = "block";
      tooltip.querySelectorAll(".ctv-swipe-actions").forEach(packActionRows);
      positionTooltip(anchorEl, docked, !first);
    };
    render(true);
    if (currentCharacterId) {
      loadCardGreetings(currentCharacterId).then((c) => {
        if (!c || greetingView !== view || hoverAnchorEl !== anchorEl)
          return;
        card = c;
        render(false);
      });
    }
    const list = tooltip;
    const onClick = (e) => {
      if (greetingView !== view) {
        list.removeEventListener("click", onClick);
        return;
      }
      const t = e.target;
      if (t.closest(".ctv-swipe-back")) {
        e.stopPropagation();
        greetingView = null;
        list.removeEventListener("click", onClick);
        showMsgTooltip(anchorEl, msg, nodeTooltipOpts(anchorEl, node, msg));
        return;
      }
      const el = t.closest("[data-row]");
      if (!el)
        return;
      const r = rows[parseInt(el.getAttribute("data-row") || "-1", 10)];
      if (!r)
        return;
      e.stopPropagation();
      if (el.classList.contains("ctv-copy-btn")) {
        copyTextWithFeedback(el, r.text);
        return;
      }
      if (el.classList.contains("ctv-swipe-head")) {
        const k = key(r.text);
        if (expandedKeys.has(k))
          expandedKeys.delete(k);
        else
          expandedKeys.add(k);
        el.closest(".ctv-swipe-row")?.classList.toggle("expanded");
        return;
      }
      if (el.getAttribute("data-more")) {
        showAllKeys.add(key(r.text));
        render(false);
        return;
      }
      const create = el.getAttribute("data-create");
      if (create === "branch") {
        greetingView = null;
        branchOnGreeting(node.chatId, msg, r);
        return;
      }
      if (create === "chat") {
        greetingView = null;
        newChatOnGreeting(r.greetingIndex);
        return;
      }
      if (el.getAttribute("data-here")) {
        greetingView = null;
        hideMsgTooltip();
        navigateToMessage(node.chatId, msg.id, msg.index);
        return;
      }
      const dest = el.getAttribute("data-dest-chat");
      if (dest) {
        greetingView = null;
        goToBranch(dest, msg);
        return;
      }
      const treeChat = el.getAttribute("data-tree-chat");
      if (treeChat) {
        greetingView = null;
        hideMsgTooltip();
        pendingScrollMessageId = null;
        switchToChat(treeChat);
      }
    };
    list.addEventListener("click", onClick);
  }
  function packActionRows(container) {
    const btns = Array.from(container.children);
    if (btns.length < 2)
      return;
    const cw = container.clientWidth;
    if (!cw)
      return;
    const GAP = 4;
    const half = Math.floor((cw - GAP) / 2);
    btns.forEach((b) => {
      b.style.flex = "0 0 auto";
      b.style.width = "";
    });
    const widths = btns.map((b) => Math.min(b.offsetWidth, half));
    const rows = [];
    let row = [];
    let rowMax = 0;
    btns.forEach((b, i) => {
      const w = widths[i];
      const m = Math.max(rowMax, w);
      const n = row.length + 1;
      if (row.length === 0 || m * n + GAP * (n - 1) <= cw) {
        row.push(b);
        rowMax = m;
      } else {
        rows.push({ items: row, max: rowMax });
        row = [b];
        rowMax = w;
      }
    });
    if (row.length)
      rows.push({ items: row, max: rowMax });
    container.classList.add("packed");
    container.textContent = "";
    for (const r of rows) {
      const rd = document.createElement("div");
      rd.className = "ctv-swipe-act-row";
      for (const b of r.items) {
        b.style.flex = "1 1 0";
        b.style.width = "";
        b.style.minWidth = "0";
        rd.appendChild(b);
      }
      container.appendChild(rd);
    }
  }
  function currentSwipeForActive(node, msg) {
    if (!activeChatId || activeChatId === node.chatId)
      return msg.swipeId ?? 0;
    const sb = msg.swipeBranches;
    if (sb) {
      for (const key of Object.keys(sb)) {
        for (const b of sb[key]) {
          const bn = findNodeByChat(b.chatId);
          if (bn && treeContainsChat(bn, activeChatId))
            return Number(key);
        }
      }
    }
    return msg.swipeId ?? 0;
  }
  function findNodeByChat(chatId) {
    const walk = (n) => {
      if (n.chatId === chatId)
        return n;
      for (const c of n.children) {
        const f = walk(c);
        if (f)
          return f;
      }
      return null;
    };
    for (const r of roots) {
      const f = walk(r);
      if (f)
        return f;
    }
    return null;
  }
  function branchLabel(name, branchPath) {
    if (!branchPath || !/—\s*Branch at #\d+/.test(name || ""))
      return name;
    const base = (name || "").replace(/\s*—\s*Branch at #\d+(?:\s*\(\d+\))?\s*$/, "").trim();
    return `⎇${branchPath}${base ? " · " + base : ""}`;
  }
  function assignColors(node, counter, map) {
    map.set(node.chatId, COLORS[counter.n++ % COLORS.length]);
    for (const child of node.children)
      assignColors(child, counter, map);
  }
  function assignLanes(root, laneCounter, colorMap, mode) {
    const laneOf = new Map;
    if (mode === "position") {
      const byChat = new Map;
      const collect = (n) => {
        byChat.set(n.chatId, n);
        n.children.forEach(collect);
      };
      collect(root);
      const visualParentOf = (n) => {
        const fork = n.forkAtIndex ?? 0;
        let p = byChat.get(n.parentId);
        while (p) {
          const firstUnique = p.parentId === null ? 0 : (p.forkAtIndex ?? 0) + 1;
          if (fork >= firstUnique)
            return p;
          p = byChat.get(p.parentId);
        }
        return byChat.get(n.parentId) ?? null;
      };
      const visualKids = new Map;
      const addKids = (n) => {
        for (const c of n.children) {
          const vp = visualParentOf(c) ?? n;
          if (!visualKids.has(vp.chatId))
            visualKids.set(vp.chatId, []);
          visualKids.get(vp.chatId).push(c);
          addKids(c);
        }
      };
      addKids(root);
      const place = (n) => {
        laneOf.set(n.chatId, laneCounter.n++);
        const kids = (visualKids.get(n.chatId) ?? []).slice().sort((a, b) => (b.forkAtIndex ?? 0) - (a.forkAtIndex ?? 0));
        kids.forEach(place);
      };
      place(root);
    } else {
      const place = (n) => {
        laneOf.set(n.chatId, laneCounter.n++);
        n.children.forEach(place);
      };
      place(root);
    }
    const build = (n) => {
      const lane = laneOf.get(n.chatId);
      const color = colorMap.get(n.chatId) ?? COLORS[lane % COLORS.length];
      return { node: n, lane, color, children: n.children.map(build) };
    };
    return build(root);
  }
  function flattenLayout(lb, out = []) {
    out.push(lb);
    for (const c of lb.children)
      flattenLayout(c, out);
    return out;
  }
  function addPanBehavior(container) {
    let panning = false, moved = false;
    let startX = 0, startY = 0, sl = 0, st = 0;
    container.style.cursor = "grab";
    container.addEventListener("mousedown", (e) => {
      if (e.button !== 0)
        return;
      panning = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      sl = container.scrollLeft;
      st = container.scrollTop;
      container.style.cursor = "grabbing";
    });
    container.addEventListener("mousemove", (e) => {
      if (!panning)
        return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        moved = true;
        container.scrollLeft = sl - dx;
        container.scrollTop = st - dy;
      }
    });
    const stop = () => {
      panning = false;
      container.style.cursor = "grab";
    };
    container.addEventListener("mouseup", stop);
    container.addEventListener("mouseleave", stop);
    container.addEventListener("click", (e) => {
      if (moved) {
        moved = false;
        e.stopPropagation();
        e.preventDefault();
      }
    }, true);
  }
  function buildBranchInfoMap(allBranches) {
    const infoMap = new Map;
    const nodeByChat = new Map(allBranches.map((lb) => [lb.node.chatId, lb.node]));
    const forkPointsByBranch = new Map;
    for (const { node } of allBranches) {
      if (!node.parentId || node.forkAtIndex === null)
        continue;
      let ancestorId = node.parentId;
      while (ancestorId) {
        const ancestor = nodeByChat.get(ancestorId);
        if (!ancestor)
          break;
        const firstUnique = ancestor.parentId === null ? 0 : (ancestor.forkAtIndex ?? 0) + 1;
        if (node.forkAtIndex >= firstUnique) {
          if (!forkPointsByBranch.has(ancestorId))
            forkPointsByBranch.set(ancestorId, new Set);
          forkPointsByBranch.get(ancestorId).add(node.forkAtIndex);
          break;
        }
        ancestorId = ancestor.parentId;
      }
    }
    for (const { node } of allBranches) {
      const firstUniqueIdx = node.parentId === null ? 0 : (node.forkAtIndex ?? 0) + 1;
      const uniqueMsgs = node.messages.filter((m) => m.index >= firstUniqueIdx);
      let branchOriginSlot = 0;
      if (node.parentId !== null && node.forkAtIndex !== null) {
        let ancestorId = node.parentId;
        while (ancestorId) {
          const ancestorInfo = infoMap.get(ancestorId);
          if (!ancestorInfo)
            break;
          const forkLocalOff = ancestorInfo.uniqueMsgs.findIndex((m) => m.index === node.forkAtIndex);
          if (forkLocalOff !== -1) {
            const forkSlot = ancestorInfo.localSlotMap.get(forkLocalOff) ?? forkLocalOff;
            branchOriginSlot = ancestorInfo.branchOriginSlot + forkSlot + 1;
            break;
          }
          const ancestorNode = nodeByChat.get(ancestorId);
          if (!ancestorNode)
            break;
          ancestorId = ancestorNode.parentId;
        }
      }
      const N = uniqueMsgs.length;
      if (N === 0) {
        infoMap.set(node.chatId, { localSlotMap: new Map, gapByLocalSlot: new Map, totalLocalSlots: 0, branchOriginSlot, uniqueMsgs, expandedGroups: [] });
        continue;
      }
      const importantOffsets = new Set([0, N - 1]);
      for (const fp of forkPointsByBranch.get(node.chatId) ?? []) {
        const off = uniqueMsgs.findIndex((m) => m.index === fp);
        if (off !== -1)
          importantOffsets.add(off);
      }
      const sortedImportant = [...importantOffsets].sort((a, b) => a - b);
      const localSlotMap = new Map;
      const gapByLocalSlot = new Map;
      const expandedGroups = [];
      let slot = 0, prevOff = -1;
      for (const imp of sortedImportant) {
        if (imp > prevOff + 1) {
          const gStart = prevOff + 1, gEnd = imp - 1;
          const count = gEnd - gStart + 1;
          const gKey = `${node.chatId}:gap:${gStart}-${gEnd}`;
          if (expandedPills.has(gKey)) {
            for (let i = gStart;i <= gEnd; i++)
              localSlotMap.set(i, slot++);
            expandedGroups.push({ key: gKey, startOff: gStart, endOff: gEnd, count });
          } else {
            const gSlot = slot++;
            for (let i = gStart;i <= gEnd; i++)
              localSlotMap.set(i, gSlot);
            gapByLocalSlot.set(gSlot, { count, key: gKey });
          }
        }
        localSlotMap.set(imp, slot++);
        prevOff = imp;
      }
      infoMap.set(node.chatId, { localSlotMap, gapByLocalSlot, totalLocalSlots: slot, branchOriginSlot, uniqueMsgs, expandedGroups });
    }
    return infoMap;
  }
  function segmentBranchLocal(uniqueMsgs, branchInfo) {
    if (!compactMode || !branchInfo)
      return uniqueMsgs.map((msg) => ({ type: "node", msg }));
    const { localSlotMap, gapByLocalSlot } = branchInfo;
    const segments = [];
    let i = 0;
    while (i < uniqueMsgs.length) {
      const slot = localSlotMap.get(i) ?? i;
      const gap = gapByLocalSlot.get(slot);
      if (gap) {
        const run = [];
        while (i < uniqueMsgs.length && (localSlotMap.get(i) ?? i) === slot) {
          run.push(uniqueMsgs[i++]);
        }
        if (run.length < 2) {
          for (const m of run)
            segments.push({ type: "node", msg: m });
        } else
          segments.push({ type: "pill", msgs: run, gapInfo: gap });
      } else {
        segments.push({ type: "node", msg: uniqueMsgs[i] });
        i++;
      }
    }
    return segments;
  }
  function applyZoom(delta, rerender = true) {
    zoom = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom + delta)) * 100) / 100;
    syncZoomButtons();
    if (rerender && roots.length)
      renderAll();
  }
  function syncZoomButtons(inBtn = zoomInBtn, outBtn = zoomOutBtn, lbl = zoomLabel) {
    const pct = Math.round(zoom * 100) + "%";
    if (lbl)
      lbl.textContent = pct;
    if (inBtn)
      inBtn.disabled = zoom >= ZOOM_MAX;
    if (outBtn)
      outBtn.disabled = zoom <= ZOOM_MIN;
  }
  function addZoomScroll(container, onZoom) {
    container.addEventListener("wheel", (e) => {
      if (!e.ctrlKey && !e.metaKey)
        return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
      zoom = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom + delta)) * 100) / 100;
      syncZoomButtons();
      onZoom();
    }, { passive: false });
  }
  function addPinchZoom(container, onZoomEnd) {
    let pinching = false;
    let startDist = 0, startZoom = 1, curF = 1;
    let fx = 0, fy = 0, u = 0.5, v = 0.5;
    let scaleEl = null;
    const dist = (a, b) => Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
    container.addEventListener("touchstart", (e) => {
      if (pinching || e.touches.length !== 2)
        return;
      const svg = container.querySelector("svg");
      if (!svg)
        return;
      const [a, b] = [e.touches[0], e.touches[1]];
      pinching = true;
      startDist = dist(a, b) || 1;
      startZoom = zoom;
      curF = 1;
      fx = (a.clientX + b.clientX) / 2;
      fy = (a.clientY + b.clientY) / 2;
      const sr = svg.getBoundingClientRect();
      u = sr.width ? (fx - sr.left) / sr.width : 0.5;
      v = sr.height ? (fy - sr.top) / sr.height : 0.5;
      scaleEl = svg;
      scaleEl.style.transformOrigin = `${fx - sr.left}px ${fy - sr.top}px`;
      scaleEl.style.willChange = "transform";
      hideMsgTooltip();
    }, { passive: false });
    container.addEventListener("touchmove", (e) => {
      if (!pinching || e.touches.length !== 2 || !scaleEl)
        return;
      e.preventDefault();
      const d = dist(e.touches[0], e.touches[1]);
      const targetZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, startZoom * (d / startDist)));
      curF = targetZoom / startZoom;
      scaleEl.style.transform = `scale(${curF})`;
    }, { passive: false });
    const finish = () => {
      if (!pinching)
        return;
      pinching = false;
      if (scaleEl) {
        scaleEl.style.transform = "";
        scaleEl.style.transformOrigin = "";
        scaleEl.style.willChange = "";
      }
      const newZoom = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, startZoom * curF)) * 100) / 100;
      scaleEl = null;
      if (Math.abs(newZoom - startZoom) < 0.005)
        return;
      zoom = newZoom;
      syncZoomButtons();
      const prevScrollBehavior = container.style.scrollBehavior;
      container.style.scrollBehavior = "auto";
      suppressPopIn = true;
      onZoomEnd();
      suppressPopIn = false;
      const reanchor = () => {
        const svg2 = container.querySelector("svg");
        if (!svg2)
          return;
        const r = svg2.getBoundingClientRect();
        container.scrollLeft += r.left + u * r.width - fx;
        container.scrollTop += r.top + v * r.height - fy;
      };
      container.scrollHeight;
      reanchor();
      requestAnimationFrame(() => {
        reanchor();
        container.style.scrollBehavior = prevScrollBehavior;
      });
    };
    container.addEventListener("touchend", (e) => {
      if (pinching && e.touches.length < 2)
        finish();
    });
    container.addEventListener("touchcancel", finish);
  }
  function renderTree(rootNode, opts = {}) {
    const container = opts.container ?? canvasWrap;
    const orientation = opts.orientation ?? "vertical";
    const legendTarget = opts.legendContainer ?? legend;
    const onRender = opts.onRender ?? ((slow, ap) => renderAll(slow, ap));
    const slowAnim = opts.slowAnim ?? false;
    const animPill = opts.animPill ?? null;
    const capturedMsgPositions = new Map;
    const colorMap = new Map;
    assignColors(rootNode, { n: 0 }, colorMap);
    const laneCounter = { n: 0 };
    const layout = assignLanes(rootNode, laneCounter, colorMap, sortMode);
    const allBranches = flattenLayout(layout);
    const totalLanes = laneCounter.n;
    const activeLb = allBranches.find((lb) => lb.node.chatId === activeChatId);
    const activeMsgIdSet = activeLb ? new Set(activeLb.node.messages.map((m) => m.id).filter(Boolean)) : new Set;
    let maxMsgIndex = 0;
    for (const lb of allBranches) {
      if (lb.node.messages.length > 0)
        maxMsgIndex = Math.max(maxMsgIndex, lb.node.messages[lb.node.messages.length - 1].index);
    }
    const fittedStep = isCoarsePointer ? LANE_W_TOUCH : LANE_W;
    const branchInfoMap = compactMode ? buildBranchInfoMap(allBranches) : null;
    let totalMsgAxisSlots = maxMsgIndex;
    if (compactMode && branchInfoMap) {
      totalMsgAxisSlots = 0;
      for (const info of branchInfoMap.values()) {
        totalMsgAxisSlots = Math.max(totalMsgAxisSlots, info.branchOriginSlot + info.totalLocalSlots);
      }
    }
    const PAD_msg = orientation === "vertical" ? PAD.top : PAD.left;
    function mpForBranch(chatId, msgIndex) {
      if (!compactMode || !branchInfoMap)
        return PAD_msg + msgIndex * NODE_H;
      const info = branchInfoMap.get(chatId);
      if (!info)
        return PAD_msg + msgIndex * NODE_H;
      const localOff = info.uniqueMsgs.findIndex((m) => m.index === msgIndex);
      if (localOff === -1)
        return PAD_msg + msgIndex * NODE_H;
      const slot = info.localSlotMap.get(localOff) ?? localOff;
      return PAD_msg + (info.branchOriginSlot + slot) * NODE_H;
    }
    const bp = orientation === "vertical" ? (lane) => PAD.left + lane * fittedStep : (lane) => PAD.top + lane * fittedStep;
    const nc = (branchVal, msgVal) => orientation === "vertical" ? { x: branchVal, y: msgVal } : { x: msgVal, y: branchVal };
    const svgW = orientation === "vertical" ? PAD.left + (totalLanes - 1) * fittedStep + PAD.right + NODE_R * 2 : PAD.left + totalMsgAxisSlots * NODE_H + PAD.right + NODE_R * 2;
    const svgH = orientation === "vertical" ? PAD.top + totalMsgAxisSlots * NODE_H + PAD.bottom + NODE_R * 2 : PAD.top + (totalLanes - 1) * fittedStep + PAD.bottom + NODE_R * 2;
    const branchByChat = new Map(allBranches.map((lb) => [lb.node.chatId, lb]));
    function visualParentLb(childNode, forkRow) {
      let parentId = childNode.parentId;
      while (parentId) {
        const lb = branchByChat.get(parentId);
        if (!lb)
          return null;
        const firstUnique = lb.node.parentId === null ? 0 : (lb.node.forkAtIndex ?? 0) + 1;
        if (forkRow >= firstUnique)
          return lb;
        parentId = lb.node.parentId;
      }
      return null;
    }
    const ancestorRangeForCapture = new Map;
    const activeChatMsgIdByIndex = new Map;
    if (activeLb) {
      for (const m of activeLb.node.messages) {
        if (m.id)
          activeChatMsgIdByIndex.set(m.index, m.id);
      }
      const chain = [];
      let curr = activeLb;
      while (curr) {
        chain.unshift(curr);
        if (!curr.node.parentId || curr.node.forkAtIndex === null)
          break;
        const vp = visualParentLb(curr.node, curr.node.forkAtIndex);
        if (!vp)
          break;
        curr = vp;
      }
      for (let i = 0;i < chain.length - 1; i++) {
        const lb = chain[i];
        const minIdx = lb.node.parentId === null ? 0 : (lb.node.forkAtIndex ?? 0) + 1;
        const maxIdx = chain[i + 1].node.forkAtIndex ?? minIdx;
        if (maxIdx >= minIdx) {
          ancestorRangeForCapture.set(lb.node.chatId, { minIdx, maxIdx });
        }
      }
    }
    function isDownstreamOfPill(node) {
      if (!animPill || !branchInfoMap)
        return false;
      function visualParentChatId(n) {
        if (!n.parentId || n.forkAtIndex === null)
          return null;
        let aid = n.parentId;
        while (aid) {
          const aInfo = branchInfoMap.get(aid);
          if (!aInfo)
            return null;
          if (aInfo.uniqueMsgs.findIndex((m) => m.index === n.forkAtIndex) !== -1)
            return aid;
          const aNode = branchByChat.get(aid)?.node;
          if (!aNode)
            return null;
          aid = aNode.parentId;
        }
        return null;
      }
      const seen = new Set;
      let curr = node;
      while (curr && !seen.has(curr.chatId)) {
        seen.add(curr.chatId);
        const vpId = visualParentChatId(curr);
        if (!vpId)
          return false;
        if (vpId === animPill.chatId) {
          return mpForBranch(animPill.chatId, curr.forkAtIndex ?? 0) > animPill.pivotCoord;
        }
        curr = branchByChat.get(vpId)?.node ?? null;
      }
      return false;
    }
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", `0 0 ${svgW} ${svgH}`);
    svg.setAttribute("width", String(Math.round(svgW * zoom)));
    svg.setAttribute("height", String(Math.round(svgH * zoom)));
    svg.classList.add("ctv-svg");
    const connectorLayer = document.createElementNS(svgNS, "g");
    svg.appendChild(connectorLayer);
    const slideEls = [], fadeinEls = [], retractEls = [];
    for (const lb of allBranches) {
      const { node, lane, color } = lb;
      const bc = bp(lane);
      const isActiveBranch = node.chatId === activeChatId;
      const ancestorRange = ancestorRangeForCapture.get(node.chatId) ?? null;
      const isOnActivePath = isActiveBranch || ancestorRange !== null;
      const firstUniqueIdx = node.parentId === null ? 0 : (node.forkAtIndex ?? 0) + 1;
      const uniqueMsgs = node.messages.filter((m) => m.index >= firstUniqueIdx);
      const isExpandedBranch = animPill?.type === "expand" && node.chatId === animPill.chatId;
      const isCollapsedBranch = animPill?.type === "collapse" && node.chatId === animPill.chatId;
      const branchSlide = !isExpandedBranch && !isCollapsedBranch && isDownstreamOfPill(node);
      if (uniqueMsgs.length === 0) {
        if (node.parentId !== null) {
          const forkRow = node.forkAtIndex ?? 0;
          const parentLb = visualParentLb(node, forkRow);
          if (parentLb) {
            const forkAxisPos = mpForBranch(parentLb.node.chatId, forkRow);
            const A = nc(bp(parentLb.lane), forkAxisPos);
            const B = nc(bc, forkAxisPos);
            const C = nc(bc, forkAxisPos + NODE_H);
            const conn = document.createElementNS(svgNS, "path");
            conn.setAttribute("d", `M ${A.x} ${A.y} L ${B.x} ${B.y} L ${C.x} ${C.y}`);
            conn.setAttribute("stroke", color);
            conn.classList.add("ctv-connector");
            connectorLayer.appendChild(conn);
            if (branchSlide)
              slideEls.push(conn);
            const stub = document.createElementNS(svgNS, "circle");
            stub.setAttribute("cx", String(C.x));
            stub.setAttribute("cy", String(C.y));
            stub.setAttribute("r", String(NODE_R));
            stub.setAttribute("fill", color);
            stub.setAttribute("fill-opacity", "0.18");
            stub.setAttribute("stroke", color);
            stub.setAttribute("stroke-width", "1.5");
            stub.setAttribute("opacity", "0.75");
            stub.style.cursor = "pointer";
            stub.addEventListener("mouseenter", () => {
              showSimpleTooltip(stub, `
                <div class="ctv-tooltip-role">Empty branch</div>
                <div class="ctv-tooltip-preview">${escHtml(node.chatName)}</div>
                <div class="ctv-tooltip-hint">Click to continue this branch</div>
              `);
            });
            stub.addEventListener("mouseleave", scheduleHideTooltip);
            stub.addEventListener("click", () => {
              hideMsgTooltip();
              switchToChat(node.chatId);
            });
            svg.appendChild(stub);
            if (branchSlide)
              slideEls.push(stub);
          }
        }
        continue;
      }
      if (uniqueMsgs.length >= 2) {
        const from = nc(bc, mpForBranch(node.chatId, uniqueMsgs[0].index));
        const to = nc(bc, mpForBranch(node.chatId, uniqueMsgs[uniqueMsgs.length - 1].index));
        const track = document.createElementNS(svgNS, "line");
        track.setAttribute("x1", String(from.x));
        track.setAttribute("y1", String(from.y));
        track.setAttribute("x2", String(to.x));
        track.setAttribute("y2", String(to.y));
        track.setAttribute("stroke", color);
        track.classList.add("ctv-track");
        if (isOnActivePath)
          track.classList.add("active");
        svg.appendChild(track);
        if (branchSlide)
          slideEls.push(track);
        if (isOnActivePath) {
          const coreEndIdx = isActiveBranch ? uniqueMsgs[uniqueMsgs.length - 1].index : Math.min(ancestorRange.maxIdx, uniqueMsgs[uniqueMsgs.length - 1].index);
          if (coreEndIdx >= uniqueMsgs[0].index) {
            const coreTo = nc(bc, mpForBranch(node.chatId, coreEndIdx));
            const core = document.createElementNS(svgNS, "line");
            core.setAttribute("x1", String(from.x));
            core.setAttribute("y1", String(from.y));
            core.setAttribute("x2", String(coreTo.x));
            core.setAttribute("y2", String(coreTo.y));
            core.classList.add("ctv-track-core");
            svg.appendChild(core);
            if (branchSlide)
              slideEls.push(core);
          }
        }
        if (isCollapsedBranch && animPill && animPill.delta > 0) {
          const ghost = document.createElementNS(svgNS, "line");
          if (orientation === "horizontal") {
            ghost.setAttribute("x1", String(to.x));
            ghost.setAttribute("y1", String(to.y));
            ghost.setAttribute("x2", String(to.x + animPill.delta));
            ghost.setAttribute("y2", String(to.y));
          } else {
            ghost.setAttribute("x1", String(to.x));
            ghost.setAttribute("y1", String(to.y));
            ghost.setAttribute("x2", String(to.x));
            ghost.setAttribute("y2", String(to.y + animPill.delta));
          }
          ghost.setAttribute("stroke", color);
          ghost.classList.add("ctv-track");
          if (isActiveBranch)
            ghost.classList.add("active");
          svg.appendChild(ghost);
          retractEls.push([ghost, animPill.delta]);
        }
      }
      if (node.parentId !== null) {
        const forkRow = node.forkAtIndex !== null ? node.forkAtIndex : Math.max(0, uniqueMsgs[0].index - 1);
        const parentLb = visualParentLb(node, forkRow);
        if (parentLb) {
          const forkAxisPos = mpForBranch(parentLb.node.chatId, forkRow);
          const A = nc(bp(parentLb.lane), forkAxisPos);
          const B = nc(bc, forkAxisPos);
          const C = nc(bc, mpForBranch(node.chatId, uniqueMsgs[0].index));
          const connector = document.createElementNS(svgNS, "path");
          connector.setAttribute("d", `M ${A.x} ${A.y} L ${B.x} ${B.y} L ${C.x} ${C.y}`);
          connector.setAttribute("stroke", color);
          connector.classList.add("ctv-connector");
          connector.dataset.chat = node.chatId;
          connectorLayer.appendChild(connector);
          if (branchSlide)
            slideEls.push(connector);
          if (isOnActivePath) {
            const connectorCore = document.createElementNS(svgNS, "path");
            connectorCore.setAttribute("d", `M ${A.x} ${A.y} L ${B.x} ${B.y} L ${C.x} ${C.y}`);
            connectorCore.classList.add("ctv-connector-core");
            connectorLayer.appendChild(connectorCore);
            if (branchSlide)
              slideEls.push(connectorCore);
          }
        }
      }
      const branchInfo = branchInfoMap?.get(node.chatId);
      if (branchInfo) {
        for (const grp of branchInfo.expandedGroups) {
          const firstMsg = branchInfo.uniqueMsgs[grp.startOff];
          const lastMsg = branchInfo.uniqueMsgs[grp.endOff];
          if (!firstMsg || !lastMsg)
            continue;
          const m1 = mpForBranch(node.chatId, firstMsg.index);
          const m2 = mpForBranch(node.chatId, lastMsg.index);
          const coarse = isCoarsePointer;
          const GTHICK_HIT = coarse ? Math.round(fittedStep / 2) : 4;
          const GOFF = coarse ? fittedStep / 2 - GTHICK_HIT / 2 : 10;
          const GTHICK_VIS = coarse ? 6 : 3, GPAD = NODE_H * 0.45, GRX = 2;
          const GVISOFF = (GTHICK_HIT - GTHICK_VIS) / 2;
          let hx, hy, hw, hh, vx, vy, vw, vh;
          if (orientation === "vertical") {
            hx = bc + GOFF;
            hy = m1 - GPAD;
            hw = GTHICK_HIT;
            hh = m2 - m1 + GPAD * 2;
            vx = bc + GOFF + GVISOFF;
            vy = m1 - GPAD;
            vw = GTHICK_VIS;
            vh = m2 - m1 + GPAD * 2;
          } else {
            hx = m1 - GPAD;
            hy = bc + GOFF;
            hw = m2 - m1 + GPAD * 2;
            hh = GTHICK_HIT;
            vx = m1 - GPAD;
            vy = bc + GOFF + GVISOFF;
            vw = m2 - m1 + GPAD * 2;
            vh = GTHICK_VIS;
          }
          const ghostG = document.createElementNS(svgNS, "g");
          ghostG.style.cursor = "pointer";
          const hitRect = document.createElementNS(svgNS, "rect");
          hitRect.setAttribute("x", String(hx));
          hitRect.setAttribute("y", String(hy));
          hitRect.setAttribute("width", String(Math.max(0, hw)));
          hitRect.setAttribute("height", String(hh));
          hitRect.setAttribute("rx", String(GRX));
          hitRect.setAttribute("fill", "transparent");
          hitRect.setAttribute("stroke", "none");
          ghostG.appendChild(hitRect);
          const visRect = document.createElementNS(svgNS, "rect");
          visRect.setAttribute("x", String(vx));
          visRect.setAttribute("y", String(vy));
          visRect.setAttribute("width", String(Math.max(0, vw)));
          visRect.setAttribute("height", String(vh));
          visRect.setAttribute("rx", String(GRX));
          visRect.setAttribute("fill", color);
          visRect.setAttribute("fill-opacity", "0.22");
          visRect.setAttribute("stroke", color);
          visRect.setAttribute("stroke-opacity", "0.45");
          visRect.setAttribute("stroke-width", "1");
          visRect.style.pointerEvents = "none";
          ghostG.appendChild(visRect);
          const doCollapse = () => {
            hideMsgTooltip();
            expandedPills.delete(grp.key);
            onRender(true, { type: "collapse", chatId: node.chatId, pivotCoord: m1, delta: (grp.count - 1) * NODE_H });
          };
          ghostG.addEventListener("mouseenter", () => {
            if (lastPointerType === "touch")
              return;
            visRect.setAttribute("fill-opacity", "0.42");
            visRect.setAttribute("stroke-opacity", "0.75");
            showSimpleTooltip(ghostG, `
              <div class="ctv-tooltip-role">${grp.count} messages — expanded</div>
              <div class="ctv-tooltip-hint">Click to collapse back into pill</div>
            `);
          });
          ghostG.addEventListener("mouseleave", () => {
            visRect.setAttribute("fill-opacity", "0.22");
            visRect.setAttribute("stroke-opacity", "0.45");
            scheduleHideTooltip();
          });
          ghostG.addEventListener("click", () => {
            if (lastPointerType === "touch")
              return;
            doCollapse();
          });
          onTouchActions(ghostG, { tap: doCollapse });
          svg.appendChild(ghostG);
          if (branchSlide)
            slideEls.push(ghostG);
          else if (isExpandedBranch && m1 > animPill.pivotCoord + animPill.delta)
            slideEls.push(ghostG);
          else if (isCollapsedBranch && m1 > animPill.pivotCoord)
            slideEls.push(ghostG);
        }
      }
      const segments = segmentBranchLocal(uniqueMsgs, branchInfo);
      for (const seg of segments) {
        if (seg.type === "pill") {
          const PCROSS = 16, PRX = 8, PILL_H = NODE_H - 4;
          const pCx = mpForBranch(node.chatId, seg.msgs[0].index);
          const pStart = pCx - PILL_H / 2;
          const pLen = PILL_H;
          let px, py, pw, ph;
          if (orientation === "vertical") {
            px = bc - PCROSS / 2;
            py = pStart;
            pw = PCROSS;
            ph = pLen;
          } else {
            px = pStart;
            py = bc - PCROSS / 2;
            pw = pLen;
            ph = PCROSS;
          }
          const pill = document.createElementNS(svgNS, "rect");
          pill.setAttribute("x", String(px));
          pill.setAttribute("y", String(py));
          pill.setAttribute("width", String(pw));
          pill.setAttribute("height", String(ph));
          pill.setAttribute("rx", String(PRX));
          pill.setAttribute("fill", color);
          pill.setAttribute("fill-opacity", "0.3");
          pill.setAttribute("stroke", color);
          pill.setAttribute("stroke-opacity", "0.7");
          pill.setAttribute("stroke-width", "1.5");
          if (uniqueMsgs[0] && seg.msgs[0]?.index === uniqueMsgs[0].index)
            pill.dataset.chat = node.chatId;
          pill.style.cursor = "pointer";
          pill.classList.add("ctv-pill");
          pill.dataset.pillChat = node.chatId;
          pill._pillMsgs = seg.msgs;
          pill._node = node;
          const labelPt = nc(bc, pCx);
          const pillLabel = document.createElementNS(svgNS, "text");
          pillLabel.setAttribute("x", String(labelPt.x));
          pillLabel.setAttribute("y", String(labelPt.y));
          pillLabel.setAttribute("text-anchor", "middle");
          pillLabel.setAttribute("dominant-baseline", "central");
          pillLabel.setAttribute("fill", "white");
          pillLabel.setAttribute("opacity", "0.85");
          pillLabel.setAttribute("font-size", "9");
          pillLabel.setAttribute("font-weight", "600");
          pillLabel.style.pointerEvents = "none";
          pillLabel.textContent = String(seg.msgs.length);
          const first = seg.msgs[0], last = seg.msgs[seg.msgs.length - 1];
          const tsFirst = first.timestamp ? new Date(first.timestamp * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
          const tsLast = last.timestamp ? new Date(last.timestamp * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
          const doExpandPill = () => {
            hideMsgTooltip();
            expandedPills.add(seg.gapInfo.key);
            onRender(true, {
              type: "expand",
              chatId: node.chatId,
              pivotCoord: pCx,
              delta: (seg.gapInfo.count - 1) * NODE_H
            });
          };
          pill.addEventListener("mouseenter", () => {
            if (lastPointerType === "touch")
              return;
            showSimpleTooltip(pill, `
              <div class="ctv-tooltip-role">${seg.msgs.length} messages</div>
              ${tsFirst ? `<div class="ctv-tooltip-meta">${tsFirst} → ${tsLast}</div>` : ""}
              <div class="ctv-tooltip-hint">Click to expand</div>
            `);
          });
          pill.addEventListener("mouseleave", scheduleHideTooltip);
          pill.addEventListener("click", () => {
            if (lastPointerType === "touch")
              return;
            doExpandPill();
          });
          onTouchActions(pill, {
            tap: () => {
              suppressNodeHoverUntil = performance.now() + 500;
              doExpandPill();
            },
            longPress: () => showSimpleTooltip(pill, `
              <div class="ctv-tooltip-role">${seg.msgs.length} messages</div>
              ${tsFirst ? `<div class="ctv-tooltip-meta">${tsFirst} → ${tsLast}</div>` : ""}
              <div class="ctv-tooltip-hint">Tap the pill to expand</div>
            `)
          });
          const pillRingEntry = { x: labelPt.x, y: labelPt.y, r: 0, pill: { cx: labelPt.x, cy: labelPt.y } };
          for (const msg of seg.msgs) {
            if (msg.id && activeMsgIdSet.has(msg.id)) {
              capturedMsgPositions.set(msg.id, pillRingEntry);
            } else if (msg.id && ancestorRange && msg.index >= ancestorRange.minIdx && msg.index <= ancestorRange.maxIdx) {
              const activeId = activeChatMsgIdByIndex.get(msg.index);
              if (activeId)
                capturedMsgPositions.set(activeId, pillRingEntry);
            }
          }
          svg.appendChild(pill);
          svg.appendChild(pillLabel);
          if (branchSlide) {
            slideEls.push(pill);
            slideEls.push(pillLabel);
          } else if (isCollapsedBranch) {
            if (pCx > animPill.pivotCoord + 1) {
              slideEls.push(pill);
              slideEls.push(pillLabel);
            } else {
              fadeinEls.push(pill);
              fadeinEls.push(pillLabel);
            }
          }
          continue;
        }
        const nodeMsgs = seg.type === "node" ? [seg.msg] : seg.msgs;
        for (const msg of nodeMsgs) {
          const pt = nc(bc, mpForBranch(node.chatId, msg.index));
          const msgAxis = orientation === "horizontal" ? pt.x : pt.y;
          const isForkPoint = node.children.some((c) => c.forkAtIndex === msg.index);
          const r = isForkPoint ? FORK_R : NODE_R;
          if (msg.id && activeMsgIdSet.has(msg.id)) {
            capturedMsgPositions.set(msg.id, { x: pt.x, y: pt.y, r });
          } else if (msg.id && ancestorRange && msg.index >= ancestorRange.minIdx && msg.index <= ancestorRange.maxIdx) {
            const activeId = activeChatMsgIdByIndex.get(msg.index);
            if (activeId)
              capturedMsgPositions.set(activeId, { x: pt.x, y: pt.y, r });
          }
          const isActiveNode = isActiveBranch || ancestorRange !== null && msg.index <= ancestorRange.maxIdx;
          const circle = document.createElementNS(svgNS, "circle");
          circle.setAttribute("cx", String(pt.x));
          circle.setAttribute("cy", String(pt.y));
          circle.setAttribute("r", String(r));
          circle.setAttribute("fill", msg.role === "user" ? shade(color, 0.6) : color);
          circle.setAttribute("opacity", isActiveNode ? "1" : "0.65");
          circle.classList.add("ctv-node");
          if (uniqueMsgs[0] && msg.index === uniqueMsgs[0].index)
            circle.dataset.chat = node.chatId;
          circle.dataset.nodeChat = node.chatId;
          circle.dataset.nodeIdx = String(msg.index);
          circle._msg = msg;
          circle._node = node;
          circle.addEventListener("mouseenter", () => {
            if (performance.now() < suppressNodeHoverUntil)
              return;
            showMsgTooltip(circle, msg, nodeTooltipOpts(circle, node, msg));
          });
          circle.addEventListener("mouseleave", scheduleHideTooltip);
          circle.addEventListener("click", () => {
            if (lastPointerType === "touch")
              return;
            hideMsgTooltip();
            navigateToMessage(node.chatId, msg.id, msg.index);
          });
          svg.appendChild(circle);
          if (branchSlide)
            slideEls.push(circle);
          else if (isExpandedBranch) {
            if (msgAxis > animPill.pivotCoord + animPill.delta)
              slideEls.push(circle);
            else if (msgAxis > animPill.pivotCoord)
              fadeinEls.push(circle);
          } else if (isCollapsedBranch && msgAxis > animPill.pivotCoord)
            slideEls.push(circle);
          if ((msg.swipeCount ?? 1) > 1 || (msg.greetingVariants?.length ?? 0) > 1) {
            const dot = document.createElementNS(svgNS, "circle");
            dot.setAttribute("cx", String(pt.x));
            dot.setAttribute("cy", String(pt.y));
            dot.setAttribute("r", "2");
            dot.setAttribute("fill", "white");
            dot.setAttribute("opacity", "0.7");
            dot.style.pointerEvents = "none";
            svg.appendChild(dot);
            if (branchSlide)
              slideEls.push(dot);
            else if (isExpandedBranch) {
              if (msgAxis > animPill.pivotCoord + animPill.delta)
                slideEls.push(dot);
              else if (msgAxis > animPill.pivotCoord)
                fadeinEls.push(dot);
            } else if (isCollapsedBranch && msgAxis > animPill.pivotCoord)
              slideEls.push(dot);
          }
        }
      }
    }
    const padX = Math.round((container.clientWidth || 360) / 2);
    const padY = Math.round((container.clientHeight || 600) / 2);
    const wrap = document.createElement("div");
    wrap.style.cssText = `display:flex; justify-content:center; align-items:center; min-width:100%; min-height:100%; width:fit-content; box-sizing:border-box; padding:${padY}px ${padX}px;`;
    svg.style.flexShrink = "0";
    wrap.appendChild(svg);
    const existingChild = container.firstElementChild;
    const freshView = !existingChild || !existingChild.querySelector("svg");
    if (existingChild) {
      container.replaceChild(wrap, existingChild);
    } else {
      container.appendChild(wrap);
    }
    if (freshView) {
      container.scrollHeight;
      const fitsX = svgW * zoom <= container.clientWidth;
      const fitsY = svgH * zoom <= container.clientHeight;
      container.scrollLeft = fitsX ? (container.scrollWidth - container.clientWidth) / 2 : padX;
      container.scrollTop = fitsY ? (container.scrollHeight - container.clientHeight) / 2 : padY;
    }
    if (capturedMsgPositions.size > 0) {
      const isSidebar = container === canvasWrap;
      if (isSidebar)
        msgCursorMap = capturedMsgPositions;
      else
        msgCursorMapFs = capturedMsgPositions;
      const ring = document.createElementNS(svgNS, "circle");
      ring.setAttribute("r", String(NODE_R + 4));
      ring.classList.add("ctv-cursor-ring");
      svg.appendChild(ring);
      if (isSidebar)
        cursorRingEl = ring;
      else
        cursorRingFsEl = ring;
      const pillRing = document.createElementNS(svgNS, "rect");
      const PR_M = 4, PR_CROSS = 16, PR_LEN = NODE_H - 4;
      const prW = (orientation === "vertical" ? PR_CROSS : PR_LEN) + PR_M * 2;
      const prH = (orientation === "vertical" ? PR_LEN : PR_CROSS) + PR_M * 2;
      pillRing.setAttribute("x", String(-prW / 2));
      pillRing.setAttribute("y", String(-prH / 2));
      pillRing.setAttribute("width", String(prW));
      pillRing.setAttribute("height", String(prH));
      pillRing.setAttribute("rx", String(8 + PR_M));
      pillRing.classList.add("ctv-cursor-ring-pill");
      svg.appendChild(pillRing);
      if (isSidebar)
        cursorPillRingEl = pillRing;
      else
        cursorPillRingFsEl = pillRing;
      if (isSidebar) {
        if (cursorScrollUnsubscribe)
          cursorScrollUnsubscribe();
        const onScroll = () => requestAnimationFrame(updateCursorFromDOM);
        document.addEventListener("scroll", onScroll, { capture: true, passive: true });
        cursorScrollUnsubscribe = () => document.removeEventListener("scroll", onScroll, { capture: true });
      }
      updateCursorFromDOM();
    } else if (container === canvasWrap) {
      if (cursorScrollUnsubscribe) {
        cursorScrollUnsubscribe();
        cursorScrollUnsubscribe = null;
      }
      cursorRingEl = null;
      cursorPillRingEl = null;
    }
    if (slowAnim && animPill && (slideEls.length > 0 || fadeinEls.length > 0 || retractEls.length > 0)) {
      const axis = orientation === "horizontal" ? "X" : "Y";
      const txSign = animPill.type === "collapse" ? 1 : -1;
      const tx = `translate${axis}(${txSign * animPill.delta}px)`;
      for (const el of slideEls)
        el.style.transform = tx;
      for (const el of fadeinEls)
        el.style.opacity = "0";
      for (const [el, len] of retractEls)
        el.style.strokeDasharray = `${len} 0`;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const dur = "520ms cubic-bezier(0.25,0.46,0.45,0.94)";
        for (const el of slideEls) {
          el.style.transition = `transform ${dur}`;
          el.style.transform = "";
        }
        for (const el of fadeinEls) {
          el.style.transition = "opacity 420ms ease 160ms";
          el.style.opacity = "";
        }
        for (const [el, len] of retractEls) {
          el.style.transition = `stroke-dasharray ${dur}`;
          el.style.strokeDasharray = `0 ${len}`;
        }
      }));
    } else if (slowAnim) {
      wrap.style.opacity = "0";
      requestAnimationFrame(() => requestAnimationFrame(() => {
        wrap.style.transition = "opacity 380ms ease";
        wrap.style.opacity = "1";
      }));
    } else if (!suppressPopIn) {
      wrap.style.animation = "ctv-pop-in 160ms ease";
      wrap.style.transformOrigin = "top center";
    }
    renderLegend([...allBranches].sort((a, b) => a.lane - b.lane), legendTarget);
  }
  function renderLegend(allBranches, target = legend) {
    target.style.display = "flex";
    const staticEls = Array.from(target.children).filter((el) => !el.classList.contains("ctv-legend-item"));
    target.innerHTML = "";
    for (const lb of allBranches) {
      const item = document.createElement("div");
      item.className = "ctv-legend-item";
      const parentNode = lb.node.parentId ? findNodeByChat(lb.node.parentId) : null;
      const lineage = parentNode ? `Forked from ${branchLabel(parentNode.chatName, parentNode.branchPath)}` + (lb.node.forkAtIndex !== null ? ` at message #${lb.node.forkAtIndex + 1}` : "") + " · " : "";
      item.title = `${lineage}Click to navigate · Double-click to rename`;
      const dot = document.createElement("span");
      dot.className = "ctv-legend-dot";
      dot.style.background = lb.color;
      const nameSpan = document.createElement("span");
      nameSpan.className = "ctv-legend-name";
      nameSpan.textContent = branchLabel(lb.node.chatName, lb.node.branchPath);
      item._chatId = lb.node.chatId;
      item.appendChild(dot);
      item.appendChild(nameSpan);
      let longPressed = false;
      item.addEventListener("click", () => {
        if (longPressed) {
          longPressed = false;
          return;
        }
        pendingScrollMessageId = null;
        if (lb.node.chatId !== activeChatId)
          switchToChat(lb.node.chatId);
      });
      item.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        showLegendContextMenu(e, nameSpan, lb);
      });
      const LONG_PRESS_MS = 500, MOVE_CANCEL_PX = 10;
      let lpTimer = null;
      let lpX = 0, lpY = 0;
      const cancelLP = () => {
        if (lpTimer) {
          clearTimeout(lpTimer);
          lpTimer = null;
        }
      };
      item.addEventListener("touchstart", (e) => {
        longPressed = false;
        if (e.touches.length !== 1) {
          cancelLP();
          return;
        }
        lpX = e.touches[0].clientX;
        lpY = e.touches[0].clientY;
        cancelLP();
        lpTimer = setTimeout(() => {
          lpTimer = null;
          longPressed = true;
          if (navigator.vibrate)
            navigator.vibrate(10);
          showLegendContextMenu({ clientX: lpX, clientY: lpY }, nameSpan, lb, true);
        }, LONG_PRESS_MS);
      }, { passive: true });
      item.addEventListener("touchmove", (e) => {
        if (lpTimer && Math.hypot(e.touches[0].clientX - lpX, e.touches[0].clientY - lpY) > MOVE_CANCEL_PX)
          cancelLP();
      }, { passive: true });
      item.addEventListener("touchend", cancelLP);
      item.addEventListener("touchcancel", cancelLP);
      target.appendChild(item);
    }
    const key = document.createElement("div");
    key.className = "ctv-legend-item ctv-legend-key";
    key.title = "Bright nodes are AI messages · darker nodes are yours";
    key.innerHTML = `
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="currentColor"/></svg><span>AI</span>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="currentColor" fill-opacity="0.45"/></svg><span>You</span>`;
    target.appendChild(key);
    for (const el of staticEls)
      target.appendChild(el);
  }
  let activeCtxMenu = null;
  function dismissCtxMenu() {
    if (activeCtxMenu) {
      activeCtxMenu.remove();
      activeCtxMenu = null;
    }
  }
  function showLegendContextMenu(e, nameSpan, lb, fromTouch = false) {
    dismissCtxMenu();
    const menu = document.createElement("div");
    menu.className = "ctv-ctx-menu";
    activeCtxMenu = menu;
    const mkItem = (icon, label, action) => {
      const el = document.createElement("div");
      el.className = "ctv-ctx-item";
      el.innerHTML = `<span style="opacity:0.6;font-size:11px">${icon}</span><span>${label}</span>`;
      el.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        dismissCtxMenu();
        action();
      });
      return el;
    };
    if (lb.node.chatId !== activeChatId) {
      menu.appendChild(mkItem("↗", "Navigate here", () => {
        pendingScrollMessageId = null;
        switchToChat(lb.node.chatId);
      }));
      const sep = document.createElement("div");
      sep.className = "ctv-ctx-sep";
      menu.appendChild(sep);
    }
    menu.appendChild(mkItem("✏", "Rename branch", () => startLegendRename(nameSpan, lb)));
    document.body.appendChild(menu);
    const mw = menu.offsetWidth || 160;
    const mh = menu.offsetHeight || 80;
    let x, y;
    if (fromTouch || lastPointerType === "touch") {
      const GAP = 14;
      x = e.clientX - mw / 2;
      y = e.clientY - mh - GAP;
      if (y < 8)
        y = e.clientY + GAP;
      x = Math.max(8, Math.min(x, window.innerWidth - mw - 8));
      y = Math.min(y, window.innerHeight - mh - 8);
    } else {
      x = e.clientX + 4;
      y = e.clientY + 4;
      if (x + mw > window.innerWidth - 8)
        x = e.clientX - mw - 4;
      if (y + mh > window.innerHeight - 8)
        y = e.clientY - mh - 4;
    }
    menu.style.left = x + "px";
    menu.style.top = y + "px";
    setTimeout(() => {
      document.addEventListener("pointerdown", dismissCtxMenu, { once: true });
      document.addEventListener("scroll", dismissCtxMenu, { once: true, capture: true });
    }, 0);
  }
  const renamesInFlight = new Map;
  function startLegendRename(nameSpan, lb) {
    if (nameSpan.parentElement?.querySelector(".ctv-legend-input"))
      return;
    const input = document.createElement("input");
    input.className = "ctv-legend-input";
    input.value = lb.node.chatName;
    nameSpan.replaceWith(input);
    input.select();
    const commit = () => {
      const newName = input.value.trim();
      if (newName && newName !== lb.node.chatName) {
        if (!renamesInFlight.has(lb.node.chatId))
          renamesInFlight.set(lb.node.chatId, lb.node.chatName);
        lb.node.chatName = newName;
        ctx.sendToBackend({ type: "rename_chat", chatId: lb.node.chatId, name: newName });
      }
      nameSpan.textContent = branchLabel(lb.node.chatName, lb.node.branchPath);
      input.replaceWith(nameSpan);
    };
    let cancelled = false;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      }
      if (e.key === "Escape") {
        cancelled = true;
        input.replaceWith(nameSpan);
      }
    });
    input.addEventListener("blur", () => {
      if (!cancelled)
        commit();
    });
    input.focus();
  }
  function updateNodeName(nodes, chatId, name) {
    for (const node of nodes) {
      if (node.chatId === chatId) {
        node.chatName = name;
        return true;
      }
      if (node.children && updateNodeName(node.children, chatId, name))
        return true;
    }
    return false;
  }
  function renderTreeSelector() {
    treeSelector.innerHTML = "";
    if (roots.length <= 1)
      return;
    roots.forEach((r, i) => {
      const btn = document.createElement("button");
      btn.className = "ctv-tree-btn" + (i === activeTreeIndex ? " active" : "");
      btn.textContent = `Tree ${i + 1}`;
      btn.title = r.chatName;
      btn.addEventListener("click", () => {
        activeTreeIndex = i;
        renderAll();
      });
      treeSelector.appendChild(btn);
    });
  }
  function renderAll(slowAnim = false, animPill = null) {
    renderTreeSelector();
    if (!roots.length) {
      showState("No chats found for this character.");
      Array.from(legend.querySelectorAll(".ctv-legend-item")).forEach((el) => el.remove());
      legend.style.display = "flex";
      return;
    }
    const activeRoot = roots[activeTreeIndex] ?? roots[0];
    if (activeRoot)
      renderTree(activeRoot, { slowAnim, animPill });
  }
  function renderAllPreserveScroll(slowAnim = false, animPill = null) {
    const saved = savedScrollForRefresh ?? { sl: canvasWrap.scrollLeft, st: canvasWrap.scrollTop };
    savedScrollForRefresh = null;
    const hadTree = !!canvasWrap.firstElementChild?.querySelector("svg");
    suppressPopIn = true;
    renderAll(slowAnim, animPill);
    suppressPopIn = false;
    if (!hadTree)
      return;
    canvasWrap.scrollHeight;
    canvasWrap.scrollLeft = saved.sl;
    canvasWrap.scrollTop = saved.st;
  }
  let renderFsRef = null;
  let fsTeardown = null;
  function openFullscreen() {
    if (!roots.length)
      return;
    tooltip.style.display = "none";
    const overlay = document.createElement("div");
    overlay.className = "ctv-fs-overlay";
    overlay.innerHTML = `
      <div class="ctv-fs-panel">
        <div class="ctv-fs-header">
          <span class="ctv-header-label">Tapestry</span>
          <div class="ctv-fs-tree-selector"></div>
          <button class="ctv-sort-btn ${sortMode === "position" ? "active" : ""}" data-fs-sort>⇅ ${sortMode === "position" ? "Position" : "Time"}</button>
          <button class="ctv-sort-btn" data-fs-orient>${fsOrientation === "horizontal" ? "↕ Vertical" : "↔ Horizontal"}</button>
          <button class="ctv-compact-btn ${compactMode ? "active" : ""}" data-fs-compact>⊟ Compact</button>
          <div class="ctv-zoom-group">
            <button class="ctv-zoom-btn" data-fs-zoom-out title="Zoom out (Ctrl+scroll)">−</button>
            <span class="ctv-zoom-label" data-fs-zoom-label title="Reset zoom">${Math.round(zoom * 100)}%</span>
            <button class="ctv-zoom-btn" data-fs-zoom-in title="Zoom in (Ctrl+scroll)">+</button>
          </div>
          <button class="ctv-fs-close-btn" title="Close (Esc)">✕</button>
        </div>
        <div class="ctv-fs-canvas-wrap"></div>
        <div class="ctv-fs-legend"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    const fsCanvas = overlay.querySelector(".ctv-fs-canvas-wrap");
    addPanBehavior(fsCanvas);
    const fsLegend = overlay.querySelector(".ctv-fs-legend");
    const fsSelector = overlay.querySelector(".ctv-fs-tree-selector");
    const fsSortBtn = overlay.querySelector("[data-fs-sort]");
    const fsOrientBtn = overlay.querySelector("[data-fs-orient]");
    const fsCompactBtn = overlay.querySelector("[data-fs-compact]");
    const fsZoomIn = overlay.querySelector("[data-fs-zoom-in]");
    const fsZoomOut = overlay.querySelector("[data-fs-zoom-out]");
    const fsZoomLabel = overlay.querySelector("[data-fs-zoom-label]");
    const closeBtn = overlay.querySelector(".ctv-fs-close-btn");
    let fsTi = activeTreeIndex;
    function renderFs(slowAnim = false, animPill = null) {
      const r = roots[fsTi] ?? roots[0];
      if (!r)
        return;
      renderTree(r, { container: fsCanvas, orientation: fsOrientation, legendContainer: fsLegend, slowAnim, animPill, onRender: (slow, ap) => renderFs(slow, ap) });
      fsSelector.innerHTML = "";
      if (roots.length > 1) {
        roots.forEach((rt, i) => {
          const btn = document.createElement("button");
          btn.className = "ctv-tree-btn" + (i === fsTi ? " active" : "");
          btn.textContent = `Tree ${i + 1}`;
          btn.title = rt.chatName;
          btn.addEventListener("click", () => {
            fsTi = i;
            renderFs();
          });
          fsSelector.appendChild(btn);
        });
      }
    }
    const syncFs = () => syncZoomButtons(fsZoomIn, fsZoomOut, fsZoomLabel);
    fsZoomIn.addEventListener("click", () => {
      zoom = Math.round(Math.min(ZOOM_MAX, zoom + ZOOM_STEP) * 100) / 100;
      syncZoomButtons();
      syncFs();
      renderFs();
    });
    fsZoomOut.addEventListener("click", () => {
      zoom = Math.round(Math.max(ZOOM_MIN, zoom - ZOOM_STEP) * 100) / 100;
      syncZoomButtons();
      syncFs();
      renderFs();
    });
    fsZoomLabel.addEventListener("click", () => {
      zoom = 1;
      syncZoomButtons();
      syncFs();
      renderFs();
    });
    addZoomScroll(fsCanvas, () => {
      syncFs();
      renderFs();
    });
    addPinchZoom(fsCanvas, () => {
      syncFs();
      renderFs();
    });
    syncFs();
    renderFsRef = renderFs;
    renderFs();
    requestAnimationFrame(() => overlay.classList.add("ctv-fs-visible"));
    fsSortBtn.addEventListener("click", () => {
      sortMode = sortMode === "position" ? "time" : "position";
      const label = sortMode === "position" ? "⇅ Position" : "⇅ Time";
      fsSortBtn.textContent = label;
      fsSortBtn.classList.toggle("active", sortMode === "position");
      sortBtn.textContent = label;
      sortBtn.title = sortMode === "position" ? "Sort branches by fork position (no crossings)" : "Sort branches by creation time (newest rightmost)";
      sortBtn.classList.toggle("active", sortMode === "position");
      renderFs();
      renderAll();
    });
    fsOrientBtn.addEventListener("click", () => {
      fsOrientation = fsOrientation === "horizontal" ? "vertical" : "horizontal";
      fsOrientBtn.textContent = fsOrientation === "horizontal" ? "↕ Vertical" : "↔ Horizontal";
      renderFs();
    });
    fsCompactBtn.addEventListener("click", () => {
      compactMode = !compactMode;
      expandedPills.clear();
      fsCompactBtn.classList.toggle("active", compactMode);
      compactBtn.classList.toggle("active", compactMode);
      renderFs(true);
      renderAll(true);
    });
    function close() {
      fsTeardown = null;
      tooltip.style.display = "none";
      renderFsRef = null;
      cursorRingFsEl = null;
      cursorPillRingFsEl = null;
      msgCursorMapFs = new Map;
      overlay.classList.remove("ctv-fs-visible");
      overlay.addEventListener("transitionend", () => overlay.remove(), { once: true });
      syncZoomButtons();
      renderAll();
      document.removeEventListener("keydown", onKey);
    }
    closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay)
        close();
    });
    const onKey = (e) => {
      if (e.key === "Escape")
        close();
    };
    document.addEventListener("keydown", onKey);
    fsTeardown = () => {
      fsTeardown = null;
      renderFsRef = null;
      cursorRingFsEl = null;
      cursorPillRingFsEl = null;
      msgCursorMapFs = new Map;
      document.removeEventListener("keydown", onKey);
      overlay.remove();
    };
  }
  function navigateToMessage(chatId, messageId, messageIndex) {
    if (chatId === activeChatId) {
      scrollToMessage(messageId, messageIndex);
    } else {
      pendingScrollMessageId = messageId;
      switchToChat(chatId);
    }
  }
  function switchToChat(chatId) {
    const surfaces = ctx.host?.surfaces;
    if (typeof surfaces?.invoke === "function") {
      try {
        const r = surfaces.invoke({ kind: "route", id: "/chat/:chatId" }, { chatId });
        if (r && typeof r.catch === "function")
          r.catch((err) => {
            dbg(`route invoke failed: ${err?.message ?? err}`);
            legacySwitchToChat(chatId);
          });
        return;
      } catch (err) {
        dbg(`route invoke failed: ${err?.message ?? err}`);
      }
    }
    legacySwitchToChat(chatId);
  }
  function legacySwitchToChat(chatId) {
    window.history.pushState({}, "", `/chat/${chatId}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
  let jumpSeq = 0;
  const findMsgEl = (messageId) => messageId ? document.querySelector(`[data-message-id="${window.CSS?.escape ? CSS.escape(messageId) : messageId}"]`) : null;
  async function settleOnMessage(messageId, fallbackEl, mySeq) {
    const list = document.querySelector('[data-component="MessageList"]');
    const raf = () => new Promise((r) => requestAnimationFrame(() => r(null)));
    const current = () => findMsgEl(messageId) ?? (fallbackEl?.isConnected ? fallbackEl : null);
    const deadline = Date.now() + 3000;
    let stable = 0, missing = 0;
    while (list && Date.now() < deadline && mySeq === jumpSeq) {
      const el = current();
      if (!el) {
        if (++missing > 20)
          break;
        await raf();
        continue;
      }
      missing = 0;
      const lr = list.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const offset = r.height > lr.height * 0.8 ? r.top - (lr.top + 16) : r.top + r.height / 2 - (lr.top + lr.height / 2);
      if (Math.abs(offset) <= 24) {
        if (++stable >= 3)
          break;
      } else {
        stable = 0;
        list.scrollTop += offset;
      }
      await raf();
      await raf();
    }
    if (mySeq !== jumpSeq)
      return;
    const el = current();
    if (!el)
      return;
    if (!list)
      el.scrollIntoView({ block: "center" });
    el.style.transition = "box-shadow 200ms";
    el.style.boxShadow = "0 0 0 2px var(--lumiverse-primary,#8b7ff0)";
    setTimeout(() => {
      el.style.boxShadow = "";
    }, 1200);
  }
  let jumpLoadingEl = null;
  function showJumpLoading() {
    if (jumpLoadingEl)
      return;
    const el = document.createElement("div");
    el.className = "ctv-jump-loading";
    el.innerHTML = `<div class="ctv-spinner" style="width:13px;height:13px;border-width:2px"></div><span>Loading message…</span><button class="ctv-jump-cancel" title="Cancel">✕</button>`;
    el.querySelector(".ctv-jump-cancel")?.addEventListener("click", () => {
      jumpSeq++;
      hideJumpLoading();
    });
    document.body.appendChild(el);
    jumpLoadingEl = el;
  }
  function hideJumpLoading() {
    if (jumpLoadingEl) {
      jumpLoadingEl.remove();
      jumpLoadingEl = null;
    }
  }
  async function pumpOlderHistory(list, raf) {
    const armTo = Math.max(600, Math.round(list.clientHeight * 1.4));
    const maxTop = Math.max(0, list.scrollHeight - list.clientHeight);
    list.scrollTop = Math.min(armTo, maxTop);
    await raf();
    await raf();
    list.scrollTop = 0;
    await raf();
    await raf();
  }
  async function loadUntilMessagePresent(messageId, mySeq, maxMs = 45000) {
    const getList = () => document.querySelector('[data-component="MessageList"]');
    if (!getList())
      return null;
    const raf = () => new Promise((r) => requestAnimationFrame(() => r(null)));
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const oldestId = () => getList()?.querySelector("[data-message-id]")?.getAttribute("data-message-id") ?? null;
    const deadline = Date.now() + maxMs;
    let stagnant = 0;
    let startedOn = null;
    const progressTimer = setTimeout(showJumpLoading, 350);
    try {
      while (Date.now() < deadline && mySeq === jumpSeq) {
        const found = findMsgEl(messageId);
        if (found)
          return found;
        const list = getList();
        if (!list) {
          await sleep(60);
          continue;
        }
        if (list !== startedOn) {
          startedOn = list;
          stagnant = 0;
          list.scrollTop = list.scrollHeight;
          await raf();
          continue;
        }
        if (list.scrollTop > 8) {
          list.scrollTop = Math.max(0, list.scrollTop - Math.floor(list.clientHeight * 0.85));
          await raf();
          await raf();
          continue;
        }
        const before = oldestId();
        await pumpOlderHistory(list, raf);
        const fetchEnd = Date.now() + 5000;
        while (Date.now() < fetchEnd && mySeq === jumpSeq) {
          await sleep(60);
          if (findMsgEl(messageId) || oldestId() !== before || getList() !== list)
            break;
        }
        if (getList() !== list)
          continue;
        if (oldestId() === before) {
          if (++stagnant >= 2)
            break;
        } else
          stagnant = 0;
      }
      return findMsgEl(messageId);
    } finally {
      clearTimeout(progressTimer);
      hideJumpLoading();
    }
  }
  async function scrollToMessage(messageId, messageIndex) {
    const mySeq = ++jumpSeq;
    let el = findMsgEl(messageId);
    if (!el && messageId)
      el = await loadUntilMessagePresent(messageId, mySeq);
    if (mySeq !== jumpSeq)
      return;
    if (!el && !messageId)
      el = document.querySelectorAll('[data-component="BubbleMessage"]')[messageIndex];
    if (el)
      await settleOnMessage(messageId, el, mySeq);
  }
  let branchInFlight = false;
  async function branchOnSwipe(chatId, msg, swipeId) {
    if (branchInFlight)
      return;
    branchInFlight = true;
    const anchorEl = hoverAnchorEl;
    hideMsgTooltip();
    try {
      await createBranchAndGo(chatId, msg, async (newChatId) => {
        if (swipeId !== (msg.swipeId ?? 0)) {
          await askBackend({ type: "set_branch_swipe", chatId: newChatId, messageIndex: msg.index, swipeId }, "branch_swipe_set", "branch_swipe_error").catch((err) => {
            throw new Error(`couldn't select swipe ${swipeId + 1}: ${err.message}`);
          });
        }
      });
    } catch (err) {
      showActionError(anchorEl, branchErrorTitle(err), err);
    } finally {
      branchInFlight = false;
    }
  }
  async function hostApi(method, path, body) {
    const res = await fetch(`/api/v1${path}`, {
      method,
      credentials: "include",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    if (!res.ok)
      throw new Error(`${method} ${path.split("/").slice(0, 3).join("/")} failed (${res.status})`);
    return res.status === 204 ? null : res.json();
  }
  async function createBranchAndGo(chatId, msg, prepare) {
    const newChat = await hostApi("POST", `/chats/${encodeURIComponent(chatId)}/branch`, { message_id: msg.id });
    if (!newChat?.id)
      throw new Error("branch response missing chat id");
    dbg(`branched → ${newChat.id}`);
    const newMsgId = await messageIdAt(newChat.id, msg.index);
    let prepareErr = null;
    if (prepare) {
      try {
        await prepare(newChat.id, newMsgId);
      } catch (err) {
        prepareErr = err;
      }
    }
    if (newMsgId)
      pendingScrollMessageId = newMsgId;
    else
      pendingScrollIndex = msg.index;
    switchToChat(newChat.id);
    if (prepareErr) {
      const err = new Error(`Branch created, but ${prepareErr?.message ?? prepareErr}`);
      err.branchCreated = true;
      throw err;
    }
  }
  const branchErrorTitle = (err) => err?.branchCreated ? "Branch created with a problem" : "Branch failed";
  function showActionError(anchorEl, title, err) {
    dbg(`${title}: ${err?.message ?? err}`);
    showSimpleTooltip(anchorEl?.isConnected ? anchorEl : canvasWrap, `
      <div class="ctv-tooltip-role" style="color:var(--lumiverse-error,#f87171)">${escHtml(title)}</div>
      <div class="ctv-tooltip-preview">${escHtml(err?.message ?? "Unknown error")}</div>
    `);
    setTimeout(scheduleHideTooltip, 2400);
  }
  async function branchOnGreeting(chatId, msg, row) {
    if (branchInFlight)
      return;
    branchInFlight = true;
    const anchorEl = hoverAnchorEl;
    hideMsgTooltip();
    try {
      await createBranchAndGo(chatId, msg, async (newChatId, newMsgId) => {
        if (row.current)
          return;
        if (Number.isInteger(row.greetingIndex)) {
          await hostApi("PATCH", `/chats/${encodeURIComponent(newChatId)}/appearance`, { type: "greeting", greeting_index: row.greetingIndex }).catch((err) => dbg(`greeting switch failed: ${err?.message ?? err}`));
        }
        if (newMsgId) {
          await hostApi("PUT", `/chats/${encodeURIComponent(newChatId)}/messages/${encodeURIComponent(newMsgId)}`, { content: row.text });
        }
      });
    } catch (err) {
      showActionError(anchorEl, branchErrorTitle(err), err);
    } finally {
      branchInFlight = false;
    }
  }
  async function newChatOnGreeting(greetingIndex) {
    if (branchInFlight || !currentCharacterId)
      return;
    branchInFlight = true;
    const anchorEl = hoverAnchorEl;
    hideMsgTooltip();
    try {
      const chat = await hostApi("POST", "/chats", {
        character_id: currentCharacterId,
        greeting_index: greetingIndex,
        name: new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" })
      });
      if (!chat?.id)
        throw new Error("new chat response missing id");
      pendingScrollMessageId = null;
      switchToChat(chat.id);
    } catch (err) {
      showActionError(anchorEl, "New chat failed", err);
    } finally {
      branchInFlight = false;
    }
  }
  async function messageIdAt(chatId, index) {
    const known = findNodeByChat(chatId)?.messages?.[index]?.id;
    if (known)
      return known;
    try {
      const res = await fetch(`/api/v1/chats/${encodeURIComponent(chatId)}/messages?limit=1&offset=${index}`, { credentials: "include" });
      if (!res.ok)
        return null;
      const page = await res.json();
      return page?.data?.[0]?.id ?? null;
    } catch {
      return null;
    }
  }
  function goToBranch(branchChatId, msg) {
    hideMsgTooltip();
    const id = findNodeByChat(branchChatId)?.messages?.[msg.index]?.id;
    if (id) {
      navigateToMessage(branchChatId, id, msg.index);
      return;
    }
    if (branchChatId === activeChatId) {
      scrollToMessage("", msg.index);
    } else {
      pendingScrollIndex = msg.index;
      switchToChat(branchChatId);
    }
  }
  function goToSwipeInPlace(chatId, msg, swipeId) {
    const anchorEl = hoverAnchorEl;
    hideMsgTooltip();
    if (swipeId !== (msg.swipeId ?? 0)) {
      askBackend({ type: "set_branch_swipe", chatId, messageIndex: msg.index, swipeId }, "branch_swipe_set", "branch_swipe_error").catch((err) => showActionError(anchorEl, `Couldn't select swipe ${swipeId + 1}`, err));
    }
    if (chatId === activeChatId) {
      scrollToMessage(msg.id, msg.index);
    } else {
      if (msg.id)
        pendingScrollMessageId = msg.id;
      else
        pendingScrollIndex = msg.index;
      switchToChat(chatId);
    }
  }
  function showState(message) {
    canvasWrap.innerHTML = `<div class="ctv-state"><span>${escHtml(message)}</span></div>`;
  }
  function showError(message) {
    canvasWrap.innerHTML = `<div class="ctv-state" style="color:var(--lumiverse-error,#f87171)"><span>⚠ ${escHtml(message)}</span></div>`;
  }
  let treeReqSeq = 0;
  function requestTree(payload) {
    ctx.sendToBackend({ ...payload, reqId: ++treeReqSeq });
  }
  const TREE_REPLIES = new Set(["tree_loading", "tree_data", "tree_error", "tree_no_active"]);
  let backendCallSeq = 0;
  const backendCalls = new Map;
  function askBackend(payload, okType, errType, timeoutMs = 1e4) {
    const callId = ++backendCallSeq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        backendCalls.delete(callId);
        reject(new Error("the extension backend did not respond"));
      }, timeoutMs);
      backendCalls.set(callId, { okType, errType, resolve, reject, timer });
      ctx.sendToBackend({ ...payload, callId });
    });
  }
  const unsubBackend = ctx.onBackendMessage((payload) => {
    dbg(`backend: ${payload.type}`);
    const call = payload.callId !== undefined ? backendCalls.get(payload.callId) : undefined;
    if (call && (payload.type === call.okType || payload.type === call.errType)) {
      backendCalls.delete(payload.callId);
      clearTimeout(call.timer);
      if (payload.type === call.okType)
        call.resolve(payload);
      else
        call.reject(new Error(payload.error ?? "Unknown error"));
      return;
    }
    if (TREE_REPLIES.has(payload.type) && payload.reqId !== undefined && payload.reqId !== treeReqSeq) {
      dbg(`ignored stale ${payload.type} (#${payload.reqId}, latest #${treeReqSeq})`);
      return;
    }
    if (payload.type === "tree_loading") {
      if (!isSoftRefreshing && roots.length === 0) {
        canvasWrap.innerHTML = `<div class="ctv-state"><div class="ctv-spinner"></div><span>Loading messages…</span></div>`;
      }
      return;
    }
    if (payload.type === "tree_no_active") {
      showState("Switch to a chat to load its tree, or click Reload.");
      return;
    }
    if (payload.type === "tree_error") {
      dbg(`error: ${payload.error}`);
      showError(payload.error ?? "Failed to load tree");
      return;
    }
    if (payload.type === "pong") {
      dbg("Pong! Backend comm OK.");
      return;
    }
    if (payload.type === "full_message") {
      const entry = { content: payload.content ?? "", swipes: payload.swipes };
      fullTextCache.set(payload.messageId, entry);
      endFullTextWaiter(payload.messageId, entry);
      return;
    }
    if (payload.type === "full_message_error") {
      dbg(`full text failed: ${payload.error}`);
      endFullTextWaiter(payload.messageId, null);
      return;
    }
    if (payload.type === "chat_renamed") {
      renamesInFlight.delete(payload.chatId);
      updateNodeName(roots, payload.chatId, payload.name);
      const node = findNodeByChat(payload.chatId);
      legend.querySelectorAll(".ctv-legend-item").forEach((item) => {
        const nameSpan = item.querySelector(".ctv-legend-name");
        if (nameSpan && item._chatId === payload.chatId)
          nameSpan.textContent = branchLabel(payload.name, node?.branchPath ?? null);
      });
      return;
    }
    if (payload.type === "chat_rename_error") {
      if (renamesInFlight.has(payload.chatId)) {
        updateNodeName(roots, payload.chatId, renamesInFlight.get(payload.chatId));
        renamesInFlight.delete(payload.chatId);
        renderAllPreserveScroll();
        renderFsRef?.();
      }
      showActionError(null, "Rename failed", { message: payload.error });
      return;
    }
    if (payload.type === "tree_data") {
      isSoftRefreshing = false;
      roots = payload.roots ?? [];
      fullTextCache.clear();
      currentCharacterId = payload.characterId ?? null;
      if (!activeChatId) {
        const active = ctx.getActiveChat?.();
        if (active?.chatId)
          activeChatId = active.chatId;
      }
      if (activeChatId && roots.length > 1) {
        const idx = roots.findIndex((r) => treeContainsChat(r, activeChatId));
        if (idx !== -1)
          activeTreeIndex = idx;
      }
      if (roots.length === 0) {
        showState("No chats found for this character.");
        Array.from(legend.querySelectorAll(".ctv-legend-item")).forEach((el) => el.remove());
        legend.style.display = "flex";
        return;
      }
      renderAllPreserveScroll();
    }
  });
  let treeDirty = false;
  let autoRefreshTimer = null;
  let isSoftRefreshing = false;
  let savedScrollForRefresh = null;
  function softRefresh(chatId) {
    if (!chatId || chatId !== activeChatId)
      return;
    if (!root.offsetParent) {
      treeDirty = true;
      return;
    }
    clearTimeout(autoRefreshTimer);
    autoRefreshTimer = setTimeout(() => {
      dbg(`auto-refresh: ${chatId}`);
      isSoftRefreshing = true;
      savedScrollForRefresh = savedScrollForRefresh ?? { sl: canvasWrap.scrollLeft, st: canvasWrap.scrollTop };
      requestTree({ type: "get_tree_for_chat", chatId });
    }, 350);
  }
  ctx.events.on("GENERATION_ENDED", (p) => softRefresh(p.chatId));
  ctx.events.on("MESSAGE_SENT", (p) => softRefresh(p.chatId));
  ctx.events.on("MESSAGE_SWIPED", (p) => {
    if (p.action !== "navigated")
      softRefresh(p.chatId);
  });
  ctx.events.on("CHAT_CREATED", () => {
    if (activeChatId)
      softRefresh(activeChatId);
  });
  ctx.events.on("MESSAGE_DELETED", (p) => softRefresh(p.chatId));
  ctx.events.on("MESSAGE_EDITED", (p) => {
    if (!applySwipeSelection(p.message))
      softRefresh(p.chatId);
  });
  function findTreeMessage(messageId) {
    const walk = (n) => {
      const m = n.messages.find((x) => x.id === messageId);
      if (m)
        return m;
      for (const c of n.children) {
        const f = walk(c);
        if (f)
          return f;
      }
      return null;
    };
    for (const r of roots) {
      const f = walk(r);
      if (f)
        return f;
    }
    return null;
  }
  function applySwipeSelection(m) {
    if (!m?.id || !Array.isArray(m.swipes) || !Number.isInteger(m.swipe_id))
      return false;
    const known = findTreeMessage(m.id);
    if (!known?.swipes || known.swipes.length !== m.swipes.length || m.swipe_id === known.swipeId)
      return false;
    const preview = known.swipes[m.swipe_id];
    if (typeof preview !== "string" || !String(m.content ?? "").startsWith(preview))
      return false;
    known.swipeId = m.swipe_id;
    known.preview = preview;
    if (Array.isArray(m.swipe_dates) && m.swipe_dates[m.swipe_id])
      known.timestamp = m.swipe_dates[m.swipe_id];
    dbg(`swipe selected in place: ${m.id} → ${m.swipe_id + 1}`);
    if (root.offsetParent) {
      renderAllPreserveScroll();
      renderFsRef?.();
    }
    return true;
  }
  const unsubChatSwitch = ctx.events.on("CHAT_SWITCHED", (payload) => {
    const chatId = payload.chatId ?? null;
    activeChatId = chatId;
    dbg(`CHAT_SWITCHED → ${chatId ?? "null"}`);
    if (!chatId) {
      roots = [];
      showState("Open a chat to visualise its branch tree");
      Array.from(legend.querySelectorAll(".ctv-legend-item")).forEach((el) => el.remove());
      legend.style.display = "flex";
      treeSelector.innerHTML = "";
      return;
    }
    if (pendingScrollMessageId) {
      const msgId = pendingScrollMessageId;
      pendingScrollMessageId = null;
      setTimeout(() => scrollToMessage(msgId, 0), 600);
    }
    if (pendingScrollIndex != null) {
      const idx = pendingScrollIndex;
      pendingScrollIndex = null;
      setTimeout(() => scrollToMessage("", idx), 600);
    }
    if (roots.length > 0 && roots.some((r) => treeContainsChat(r, chatId))) {
      if (roots.length > 1) {
        const idx = roots.findIndex((r) => treeContainsChat(r, chatId));
        if (idx !== -1)
          activeTreeIndex = idx;
      }
      renderAll();
      renderFsRef?.();
      return;
    }
    if (roots.length > 0) {
      clearTimeout(autoRefreshTimer);
      isSoftRefreshing = true;
      savedScrollForRefresh = savedScrollForRefresh ?? { sl: canvasWrap.scrollLeft, st: canvasWrap.scrollTop };
      requestTree({ type: "get_tree_for_chat", chatId });
      return;
    }
    savedScrollForRefresh = savedScrollForRefresh ?? { sl: canvasWrap.scrollLeft, st: canvasWrap.scrollTop };
    roots = [];
    canvasWrap.innerHTML = `<div class="ctv-state"><div class="ctv-spinner"></div><span>Loading tree…</span></div>`;
    requestTree({ type: "get_tree_for_chat", chatId });
  });
  const unsubActivate = tab.onActivate(() => {
    if (treeDirty && activeChatId) {
      treeDirty = false;
      dbg("onActivate: flushing dirty refresh");
      requestTree({ type: "get_tree_for_chat", chatId: activeChatId });
    } else if (roots.length === 0) {
      requestTree({ type: "get_active_char_and_tree" });
    } else {
      renderAll();
    }
  });
  zoomInBtn.addEventListener("click", () => applyZoom(ZOOM_STEP));
  zoomOutBtn.addEventListener("click", () => applyZoom(-ZOOM_STEP));
  zoomLabel.addEventListener("click", () => {
    zoom = 1;
    syncZoomButtons();
    if (roots.length)
      renderAll();
  });
  addZoomScroll(canvasWrap, () => {
    if (roots.length)
      renderAll();
  });
  syncZoomButtons();
  compactBtn.addEventListener("click", () => {
    compactMode = !compactMode;
    expandedPills.clear();
    compactBtn.classList.toggle("active", compactMode);
    if (roots.length)
      renderAll(true);
  });
  sortBtn.addEventListener("click", () => {
    sortMode = sortMode === "position" ? "time" : "position";
    sortBtn.textContent = sortMode === "position" ? "⇅ Position" : "⇅ Time";
    sortBtn.title = sortMode === "position" ? "Sort branches by fork position (no crossings)" : "Sort branches by creation time (newest rightmost)";
    sortBtn.classList.toggle("active", sortMode === "position");
    if (roots.length > 0)
      renderAll();
  });
  expandBtn.addEventListener("click", openFullscreen);
  reloadBtn.addEventListener("click", () => {
    dbg("Force reload…");
    roots = [];
    canvasWrap.innerHTML = `<div class="ctv-state"><div class="ctv-spinner"></div><span>Loading…</span></div>`;
    requestTree({ type: "get_active_char_and_tree" });
  });
  dbg("Bootstrap: requesting active chat tree");
  requestTree({ type: "get_active_char_and_tree" });
  function treeContainsChat(node, chatId) {
    if (node.chatId === chatId)
      return true;
    return node.children.some((c) => treeContainsChat(c, chatId));
  }
  function escHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.round((n >> 16 & 255) * f);
    const g = Math.round((n >> 8 & 255) * f);
    const b = Math.round((n & 255) * f);
    return `rgb(${r},${g},${b})`;
  }
  function truncate(s, n) {
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }
  return () => {
    unsubBackend();
    unsubChatSwitch();
    unsubActivate();
    window.removeEventListener("pointerdown", onGlobalPointerDown, true);
    window.removeEventListener("keydown", onKeyNav, true);
    if (cursorScrollUnsubscribe) {
      cursorScrollUnsubscribe();
      cursorScrollUnsubscribe = null;
    }
    jumpSeq++;
    hideJumpLoading();
    clearTimeout(autoRefreshTimer);
    fsTeardown?.();
    tooltip.remove();
    clearTimeout(hoverExpandTimer);
    clearTimeout(hideTimer);
    clearTimeout(expandAnimTimer);
    dismissCtxMenu();
    tab.destroy();
  };
}
export {
  setup
};
