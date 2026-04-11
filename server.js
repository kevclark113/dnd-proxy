<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>The Chronicle — AI Dungeon Master</title>
<link href="https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@400;700&family=Cinzel:wght@400;600;700&family=IM+Fell+English:ital@0;1&display=swap" rel="stylesheet"/>
<script type="module">
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, onSnapshot, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAE8sNk_A7c9MsThKb3_6wFAH_H7Nt9zsw",
  authDomain: "multiplayer-dnd.firebaseapp.com",
  projectId: "multiplayer-dnd",
  storageBucket: "multiplayer-dnd.firebasestorage.app",
  messagingSenderId: "131998027524",
  appId: "1:131998027524:web:c57a97b4edcce7e6268a51",
  measurementId: "G-7784XKZBBH"
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// ── CONSTANTS ────────────────────────────────────────────────────────────────
const RACES   = ["Human","Elf","Dwarf","Halfling","Half-Orc","Gnome","Tiefling","Dragonborn"];
const CLASSES = ["Fighter","Wizard","Rogue","Cleric","Ranger","Paladin","Bard","Druid","Barbarian","Warlock"];
const CLASS_HP= {Fighter:10,Wizard:6,Rogue:8,Cleric:8,Ranger:10,Paladin:10,Bard:8,Druid:8,Barbarian:12,Warlock:8};
const DICE    = [4,6,8,10,12,20,100];

// ── UTILS ────────────────────────────────────────────────────────────────────
const rollD   = s => Math.floor(Math.random()*s)+1;
const rollStat= () => { const r=[rollD(6),rollD(6),rollD(6),rollD(6)].sort((a,b)=>a-b); return r[1]+r[2]+r[3]; };
const rollAll = () => ({STR:rollStat(),DEX:rollStat(),CON:rollStat(),INT:rollStat(),WIS:rollStat(),CHA:rollStat()});
const mod     = s => Math.floor((s-10)/2);
const modStr  = s => { const m=mod(s); return m>=0?`+${m}`:`${m}`; };
const calcHp  = (cls,con) => (CLASS_HP[cls]||8)+mod(con);
const genCode = () => Math.random().toString(36).substring(2,8).toUpperCase();
const esc     = s => s ? String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br/>") : "";

// ── STATE ────────────────────────────────────────────────────────────────────
// Restore session from localStorage so refresh doesn't log you out
const _saved = (() => { try { return JSON.parse(localStorage.getItem("chronicle_session")||"{}"); } catch(e){ return {}; } })();

let S = {
  screen:     "landing",
  campaignId: _saved.campaignId || null,
  myName:     _saved.myName     || null,
  isCreator:  false, // always derived from Firestore, not stored
  campaign:   null,
  unsub:      null,
  charDraft:  { name:"", race:"Human", cls:"Fighter", backstory:"", stats:rollAll() },
  diceResult: null,
  inputText:  "",
  dmgInputs:  {},
  submitting: false,
};



// ── FIRESTORE ────────────────────────────────────────────────────────────────
const cref = id => doc(db,"campaigns",id);

async function createCampaign(creatorName, otherNames) {
  const id = genCode();
  const allNames = [creatorName, ...otherNames.filter(n=>n.trim())];
  const players  = allNames.map(name => ({ name, joined:name===creatorName, char:null, hp:null, maxHp:null }));
  await setDoc(cref(id), { id, creatorName, players, phase:"char-creation", turnIndex:0, messages:[], aiHistory:[], createdAt:Date.now() });
  return id;
}

async function fetchCamp(id) {
  const s = await getDoc(cref(id));
  return s.exists() ? s.data() : null;
}

function subscribe(id, cb) {
  return onSnapshot(cref(id), s => { if(s.exists()) cb(s.data()); });
}

const patch = (id, data) => updateDoc(cref(id), data);

// ── AI ───────────────────────────────────────────────────────────────────────
function buildSystem(camp) {
  const chars = camp.players.map(p => {
    if(!p.char) return `${p.name}: no character yet`;
    const c = p.char;
    return `${p.name} plays ${c.name}, ${c.race} ${c.cls} — STR${c.stats.STR} DEX${c.stats.DEX} CON${c.stats.CON} INT${c.stats.INT} WIS${c.stats.WIS} CHA${c.stats.CHA}${c.backstory?'. '+c.backstory:''}`;
  }).join("\n");
  const cur = camp.players[camp.turnIndex % camp.players.length];
  return `You are the sole Dungeon Master for a classic fantasy D&D 5e campaign with ${camp.players.length} players. There is no human DM.

PARTY:\n${chars}

RULES:
- Narrate vividly in 2–4 paragraphs. Make the world, NPCs, and atmosphere feel real and alive.
- This is strictly turn-based. One player acts per turn; you respond, then the next player goes.
- Always end your response by clearly naming whose turn it is next (e.g. "What do you do, ${cur?.name}?").
- When rolls are needed, name the player and die explicitly (e.g. "Roll a d20 for Stealth, ${cur?.name}.").
- Let choices have real weight — good ideas succeed, recklessness backfires.
- Keep all players engaged through vivid narration even when it's not their turn.
- Classic fantasy tone: dungeons, intrigue, wonder, moral weight, memorable NPCs.`;
}

const PROXY = "https://dnd-proxy.onrender.com";

// Keep Render free tier warm — ping every 8 minutes
setInterval(() => fetch(`${PROXY}/health`).catch(()=>{}), 8 * 60 * 1000);
// Also ping immediately on load
fetch(`${PROXY}/health`).catch(()=>{});

async function callDM(system, history) {
  const res  = await fetch(`${PROXY}/api/dm`, {
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:1000, system, messages:history })
  });
  const data = await res.json();
  return data.content?.[0]?.text || "...";
}

// ── RENDER ───────────────────────────────────────────────────────────────────
const go = screen => { S.screen=screen; render(); };

function render() {
  ({ landing:rLanding, "new-campaign":rNew, "join-campaign":rJoin,
     "char-creation":rChar, lobby:rLobby, play:rPlay }[S.screen] || rLanding)();
}

function saveSession() {
  try { localStorage.setItem("chronicle_session", JSON.stringify({ campaignId:S.campaignId, myName:S.myName })); } catch(e){}
}
function clearSession() {
  try { localStorage.removeItem("chronicle_session"); } catch(e){}
}

function attach(id) {
  if(S.unsub) S.unsub();
  saveSession();
  S.unsub = subscribe(id, camp => {
    S.campaign = camp;
    S.isCreator = camp.creatorName === S.myName;
    routePhase();
  });
}

function routePhase() {
  const c = S.campaign;
  if(!c) return;
  if(c.phase==="char-creation") {
    const me = c.players.find(p=>p.name===S.myName);
    go(me?.char ? "lobby" : "char-creation");
  } else if(c.phase==="play") {
    go("play");
  }
}

async function tryAutoRejoin() {
  try {
    const saved = JSON.parse(localStorage.getItem("chronicle_session")||"{}");
    if(!saved.campaignId || !saved.myName) { render(); return; }
    const camp = await fetchCamp(saved.campaignId);
    if(!camp) { clearSession(); render(); return; }
    const pl = camp.players.find(p=>p.name===saved.myName);
    if(!pl) { clearSession(); render(); return; }
    S.campaignId = saved.campaignId;
    S.myName     = saved.myName;
    attach(S.campaignId);
  } catch(e) { render(); }
}

// ── LANDING ──────────────────────────────────────────────────────────────────
function rLanding() {
  q("root").innerHTML = `
    <div class="fcenter">
      <div class="land-box">
        <div class="runes">ᚦᛖᚢᛞᛖᚾᛋᛏᛖᛁᚾᛖᚾ ᛒᚢᚢᚷᛁᚾᚾᛈᛖᚱᛋᚢᚾᚺᛖᛁᛗᛁᛞᚺᛖᛁᛗ ᛃᚨᛁᚾᚱᚢᚾᛖᛋ ᛏᛖᛁᚾᛖᚾᛒ</div>
        <h1 class="brand">The Chronicle</h1>
        <p class="brand-sub">AI-Mastered Campaign &middot; Any Screen &middot; Any Distance</p>
        <div class="divider-gold"></div>
        <div class="land-btns">
          <button class="btn-gold" id="b-new">⚔&thinsp; Start New Campaign</button>
          <button class="btn-blood" id="b-join">🗡&thinsp; Join Existing Campaign</button>
        </div>
      </div>
    </div>`;
  id("b-new").onclick  = () => go("new-campaign");
  id("b-join").onclick = () => go("join-campaign");
}

// ── NEW CAMPAIGN ──────────────────────────────────────────────────────────────
function rNew() {
  q("root").innerHTML = `
    <div class="fcenter">
      <div class="card wide">
        <h2 class="ch">Create a Campaign</h2>
        <p class="csub">You'll play as a full party member. Enter your name, then name up to 3 other players.</p>
        <div class="f"><label>Your Name</label><input id="cn" placeholder="Your name..."/></div>
        <div class="f"><label>Other Players <span class="dim">(optional, up to 3)</span></label>
          <div id="pl"><input class="pn" placeholder="Player 2..." style="margin-bottom:.4rem"/>
          <input class="pn" placeholder="Player 3..." style="margin-bottom:.4rem"/></div>
          <button class="btn-sm" id="addp">+ Add player</button>
        </div>
        <button class="btn-gold full" id="bcreate">Create &amp; Get Code</button>
        <button class="btn-ghost" id="bback">← Back</button>
        <div class="err" id="er"></div>
      </div>
    </div>`;
  id("bback").onclick = () => go("landing");
  let pc=2;
  id("addp").onclick = () => {
    if(pc>=4) return; pc++;
    const i=document.createElement("input"); i.className="pn"; i.placeholder=`Player ${pc}...`; i.style.marginBottom=".4rem";
    id("pl").appendChild(i);
    if(pc>=4) id("addp").style.display="none";
  };
  id("bcreate").onclick = async () => {
    const creator=id("cn").value.trim();
    if(!creator){id("er").textContent="Enter your name.";return;}
    const others=[...qall(".pn")].map(i=>i.value.trim()).filter(Boolean);
    const btn=id("bcreate"); btn.disabled=true; btn.textContent="Creating...";
    try {
      const cid=await createCampaign(creator,others);
      S.campaignId=cid; S.myName=creator; S.isCreator=true;
      S.charDraft={name:"",race:"Human",cls:"Fighter",backstory:"",stats:rollAll()};
      attach(cid);
    } catch(e){ id("er").textContent=e.message; btn.disabled=false; btn.textContent="Create & Get Code"; }
  };
}

// ── JOIN ──────────────────────────────────────────────────────────────────────
function rJoin() {
  q("root").innerHTML = `
    <div class="fcenter">
      <div class="card">
        <h2 class="ch">Join a Campaign</h2>
        <div class="f"><label>Campaign Code</label><input id="ci" placeholder="e.g. AB12CD" style="text-transform:uppercase;letter-spacing:.2em;font-size:1.1rem"/></div>
        <div class="f"><label>Your Name <span class="dim">(exactly as the creator entered it)</span></label><input id="ni" placeholder="Your name..."/></div>
        <button class="btn-gold full" id="bjoin">Join</button>
        <button class="btn-ghost" id="bback">← Back</button>
        <div class="err" id="er"></div>
      </div>
    </div>`;
  id("bback").onclick = () => go("landing");
  id("ci").oninput    = e => e.target.value=e.target.value.toUpperCase();
  id("bjoin").onclick = async () => {
    const code=id("ci").value.trim().toUpperCase(), name=id("ni").value.trim();
    if(!code||!name){id("er").textContent="Fill in both fields.";return;}
    const btn=id("bjoin"); btn.disabled=true; btn.textContent="Joining...";
    const camp=await fetchCamp(code);
    if(!camp){id("er").textContent="Campaign not found.";btn.disabled=false;btn.textContent="Join";return;}
    const pl=camp.players.find(p=>p.name.toLowerCase()===name.toLowerCase());
    if(!pl){id("er").textContent=`"${name}" isn't in this campaign — check with whoever created it.`;btn.disabled=false;btn.textContent="Join";return;}
    const players=camp.players.map(p=>p.name.toLowerCase()===name.toLowerCase()?{...p,joined:true}:p);
    await patch(code,{players});
    S.campaignId=code; S.myName=pl.name; S.isCreator=false;
    S.charDraft={name:"",race:"Human",cls:"Fighter",backstory:"",stats:rollAll()};
    attach(code);
  };
}

// ── CHAR CREATION ─────────────────────────────────────────────────────────────
function rChar() {
  const d=S.charDraft;
  q("root").innerHTML = `
    <div class="fcenter">
      <div class="card wide">
        <h2 class="ch">Forge Your Hero</h2>
        <p class="csub">Welcome, ${esc(S.myName)}. Build your character while the others prepare.</p>
        <div class="f"><label>Character Name</label><input id="cc-n" value="${esc(d.name)}" placeholder="Your hero's name..."/></div>
        <div class="two-col">
          <div class="f"><label>Race</label><select id="cc-r">${RACES.map(r=>`<option${r===d.race?" selected":""}>${r}</option>`).join("")}</select></div>
          <div class="f"><label>Class</label><select id="cc-c">${CLASSES.map(c=>`<option${c===d.cls?" selected":""}>${c}</option>`).join("")}</select></div>
        </div>
        <div class="f"><label>Backstory <span class="dim">(optional)</span></label><textarea id="cc-b" placeholder="A wandering sellsword, a disgraced noble's heir...">${esc(d.backstory)}</textarea></div>
        <div class="f">
          <label>Ability Scores <span class="dim">(4d6 drop lowest)</span></label>
          <div class="stat-grid">${Object.entries(d.stats).map(([k,v])=>`<div class="sbox"><div class="sk">${k}</div><div class="sv">${v}</div><div class="sm">${modStr(v)}</div></div>`).join("")}</div>
          <button class="btn-sm rmt" id="reroll">⚄ Reroll Stats</button>
        </div>
        <button class="btn-gold full" id="bsave">Save Character &amp; Enter Lobby</button>
        <div class="err" id="er"></div>
      </div>
    </div>`;
  id("cc-n").oninput=e=>S.charDraft.name=e.target.value;
  id("cc-r").onchange=e=>S.charDraft.race=e.target.value;
  id("cc-c").onchange=e=>S.charDraft.cls=e.target.value;
  id("cc-b").oninput=e=>S.charDraft.backstory=e.target.value;
  id("reroll").onclick=()=>{S.charDraft.stats=rollAll();rChar();};
  id("bsave").onclick=async()=>{
    const name=id("cc-n").value.trim();
    if(!name){id("er").textContent="Name your character.";return;}
    const char={name,race:id("cc-r").value,cls:id("cc-c").value,backstory:id("cc-b").value.trim(),stats:S.charDraft.stats};
    const hp=calcHp(char.cls,char.stats.CON);
    const btn=id("bsave"); btn.disabled=true; btn.textContent="Saving...";
    const players=S.campaign.players.map(p=>p.name===S.myName?{...p,char,hp,maxHp:hp}:p);
    await patch(S.campaignId,{players});
  };
}

// ── LOBBY ─────────────────────────────────────────────────────────────────────
function rLobby() {
  const camp=S.campaign;
  const allReady=camp.players.every(p=>p.char);
  q("root").innerHTML = `
    <div class="fcenter">
      <div class="card wide">
        <h2 class="ch">Campaign Lobby</h2>
        <div class="codebox">
          <div class="codelabel">Campaign Code</div>
          <div class="codevalue">${camp.id}</div>
          <div class="codehint">Share this code with your players</div>
        </div>
        <div class="roster">${camp.players.map(p=>`
          <div class="rrow ${p.char?"rdy":"wait"}">
            <div>
              <div class="rname">${esc(p.name)}</div>
              ${p.char?`<div class="rchar">${esc(p.char.name)} · ${esc(p.char.race)} ${esc(p.char.cls)}</div>`:`<div class="rwait">Forging their hero...</div>`}
            </div>
            <div class="rbadge">${p.char?"✦ Ready":"⏳"}</div>
          </div>`).join("")}
        </div>
        ${S.isCreator
          ?`<button class="btn-gold full" id="bstart" ${allReady?"":"disabled"}>${allReady?"⚔ Begin the Adventure":"Waiting for all characters to be ready..."}</button>`
          :`<div class="wait-msg">Waiting for the campaign creator to begin the adventure...</div>`}
        <div class="err" id="er"></div>
      </div>
    </div>`;
  if(S.isCreator && allReady) {
    id("bstart").onclick=async()=>{
      const btn=id("bstart"); btn.disabled=true; btn.textContent="Summoning the tale...";
      const camp=S.campaign, sys=buildSystem(camp), fp=camp.players[0].name;
      try {
        const txt=await callDM(sys,[{role:"user",content:`Begin the campaign. Open with a vivid atmospheric scene that brings all ${camp.players.length} adventurers together. Establish immediate tension or a compelling hook. End by inviting ${fp} to act first.`}]);
        const msg={type:"dm",text:txt,ts:Date.now()};
        const aih=[{role:"user",content:"Begin the campaign."},{role:"assistant",content:txt}];
        await patch(camp.id,{phase:"play",messages:[msg],aiHistory:aih,turnIndex:0});
      } catch(e){id("er").textContent="Failed to reach AI: "+e.message;btn.disabled=false;btn.textContent="⚔ Begin the Adventure";}
    };
  }
}

// ── PLAY ──────────────────────────────────────────────────────────────────────
function rPlay() {
  const camp=S.campaign;
  if(!camp) return;
  const cur=camp.players[camp.turnIndex%camp.players.length];
  const isMyTurn=cur?.name===S.myName;
  const me=camp.players.find(p=>p.name===S.myName);

  q("root").innerHTML = `
    <div class="play-wrap">
      <header class="phead">
        <span class="pbrand">The Chronicle</span>
        <span class="pcode">Code: <strong>${camp.id}</strong></span>
        <button class="btn-leave" id="btn-leave">✕ Leave</button>
      </header>
      <div class="pgrid">
        <!-- NARRATIVE -->
        <section class="narc">
          <div class="card narc-card">
            <div class="log" id="log">
              ${camp.messages.map(msgHtml).join("")}
              ${S.submitting?`<div class="thinking">The Dungeon Master weighs the fates...</div>`:""}
            </div>
            <div class="azone">
              <div class="tpill ${isMyTurn?"tpill-on":"tpill-off"}">
                ${isMyTurn?`⚔ Your turn, ${esc(S.myName)}`:`⏳ Waiting on ${esc(cur?.name)}...`}
              </div>
              ${isMyTurn?`<div class="arow">
                <textarea id="ainp" placeholder="What does ${esc(me?.char?.name||S.myName)} do?" rows="2">${esc(S.inputText)}</textarea>
                <button class="btn-declare" id="bdecl">Declare</button>
              </div>`:""}
            </div>
          </div>
        </section>
        <!-- SIDEBAR -->
        <aside class="sbar">
          <div class="card sc">
            <div class="st">Turn Order</div>
            ${camp.players.map((p,i)=>`
              <div class="trow ${i===camp.turnIndex%camp.players.length?"trow-cur":""}">
                <div>
                  <div class="tcn">${esc(p.char?p.char.name:p.name)}</div>
                  <div class="tcs">${p.char?esc(p.char.race)+" "+esc(p.char.cls):""}</div>
                </div>
                ${i===camp.turnIndex%camp.players.length?`<div class="tarr">▶</div>`:""}
              </div>`).join("")}
          </div>
          <div class="card sc">
            <div class="st">Hit Points</div>
            ${camp.players.map((p,i)=>{
              const hp=p.hp??0,mhp=p.maxHp??1,pct=Math.max(0,Math.round(hp/mhp*100));
              const mine=p.name===S.myName;
              return `<div class="hpb">
                <div class="hpn">${esc(p.char?p.char.name:p.name)}</div>
                <div class="hbar-w"><div class="hbar" style="width:${pct}%"></div></div>
                <div class="hpnum">${hp} / ${mhp}</div>
                ${mine?`<div class="hpctrl">
                  <input class="hpinp" id="hpi${i}" type="number" min="0" placeholder="amt" value="${S.dmgInputs[i]||""}"/>
                  <button class="hbtn db" data-i="${i}">Dmg</button>
                  <button class="hbtn hb" data-i="${i}">Heal</button>
                </div>`:""}
              </div>`;
            }).join("")}
          </div>
          <div class="card sc">
            <div class="st">Dice — ${esc(S.myName)}</div>
            <div class="dgrid">${DICE.map(d=>`<button class="dbtn" data-d="${d}">d${d}</button>`).join("")}</div>
            ${S.diceResult
              ?`<div class="dres">${S.diceResult.result}<span>d${S.diceResult.sides}</span></div>`
              :`<div class="dempty">tap to roll</div>`}
          </div>
          ${me?.char?`<div class="card sc">
            <div class="st">${esc(me.char.name)}</div>
            <div class="mstats">${Object.entries(me.char.stats).map(([k,v])=>`<div class="ms"><div class="msk">${k}</div><div class="msv">${v}</div><div class="msm">${modStr(v)}</div></div>`).join("")}</div>
          </div>`:""}
        </aside>
      </div>
    </div>`;

  const log=id("log"); if(log) log.scrollTop=log.scrollHeight;
  const bl=id("btn-leave"); if(bl) bl.onclick=()=>{ clearSession(); S.campaignId=null; S.myName=null; S.campaign=null; if(S.unsub){S.unsub();S.unsub=null;} go("landing"); };
  const ai=id("ainp");
  if(ai){ ai.oninput=e=>S.inputText=e.target.value; ai.onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();submitAction();}}; ai.focus(); }
  const bd=id("bdecl"); if(bd) bd.onclick=submitAction;

  // Retry button — resend last player message
  qall(".btn-retry").forEach(btn => {
    btn.onclick = async () => {
      const camp = S.campaign;
      // Find last player message
      const msgs = [...camp.messages];
      // Remove the error DM message
      const cleaned = msgs.filter(m => !(m.type==="dm" && m.text && m.text.startsWith("(The DM")));
      const lastPlayer = [...cleaned].reverse().find(m => m.type==="player");
      if(!lastPlayer) return;
      // Rebuild ai history up to before the error
      const aiHistory = camp.aiHistory || [];
      // Remove last assistant entry if it was the error
      const cleanedHist = aiHistory.filter(h => !(h.role==="assistant" && h.content && h.content.startsWith("(The DM")));
      await patch(S.campaignId, { messages: cleaned, aiHistory: cleanedHist });
      S.submitting = true; rPlay();
      try {
        const txt = await callDM(buildSystem(camp), cleanedHist);
        const dm = { type:"dm", text:txt, ts:Date.now() };
        const ni = (camp.turnIndex) % camp.players.length;
        await patch(S.campaignId, { messages:[...cleaned, dm], aiHistory:[...cleanedHist, {role:"assistant",content:txt}], turnIndex:(camp.turnIndex+1)%camp.players.length });
      } catch(e) {
        await patch(S.campaignId, { messages:[...cleaned, {type:"dm",text:"(The DM's voice fades... connection lost. Try again.)",ts:Date.now()}] });
      }
      S.submitting = false;
    };
  });

  qall(".dbtn").forEach(b=>b.onclick=async()=>{
    const sides=parseInt(b.dataset.d), result=rollD(sides);
    S.diceResult={sides,result};
    const msgs=[...S.campaign.messages,{type:"roll",text:`${S.myName} rolls d${sides}: ${result}`,ts:Date.now()}];
    await patch(S.campaignId,{messages:msgs});
  });

  qall(".hbtn").forEach(b=>{
    b.onclick=async()=>{
      const i=parseInt(b.dataset.i), inp=id(`hpi${i}`), amt=parseInt(inp?.value)||0;
      const p=S.campaign.players[i], mhp=p.maxHp||1;
      const nhp=b.classList.contains("db")?Math.max(0,(p.hp||0)-amt):Math.min(mhp,(p.hp||0)+amt);
      const players=S.campaign.players.map((pl,idx)=>idx===i?{...pl,hp:nhp}:pl);
      S.dmgInputs[i]="";
      await patch(S.campaignId,{players});
    };
  });
  qall(".hpinp").forEach(inp=>{
    const i=parseInt(inp.id.replace("hpi",""));
    inp.oninput=e=>S.dmgInputs[i]=e.target.value;
  });
}

function msgHtml(m) {
  if(m.type==="dm") {
    const isErr = m.text && m.text.startsWith("(The DM");
    return `<div class="mdm"><div class="mlbl">⚔ Dungeon Master</div>${esc(m.text)}${isErr ? `<button class="btn-retry" data-ts="${m.ts||''}">↺ Retry</button>` : ""}</div>`;
  }
  if(m.type==="player") return `<div class="mpl"><div class="mlbl">↳ ${esc(m.who)}</div>${esc(m.text)}</div>`;
  if(m.type==="roll")   return `<div class="mroll">🎲 ${esc(m.text)}</div>`;
  return "";
}

async function submitAction() {
  if(S.submitting) return;
  const action=S.inputText.trim(); if(!action) return;
  S.inputText=""; S.submitting=true; rPlay();
  const camp=S.campaign;
  const pm={type:"player",text:action,who:S.myName,ts:Date.now()};
  const nm=[...camp.messages,pm];
  const ue={role:"user",content:`${S.myName}: ${action}`};
  const nh=[...(camp.aiHistory||[]),ue];
  await patch(S.campaignId,{messages:nm,aiHistory:nh});
  try {
    const txt=await callDM(buildSystem(camp),nh);
    const dm={type:"dm",text:txt,ts:Date.now()};
    const ni=(camp.turnIndex+1)%camp.players.length;
    await patch(S.campaignId,{messages:[...nm,dm],aiHistory:[...nh,{role:"assistant",content:txt}],turnIndex:ni});
  } catch(e) {
    await patch(S.campaignId,{messages:[...nm,{type:"dm",text:"(The DM's voice fades... connection lost. Try again.)",ts:Date.now()}]});
  }
  S.submitting=false;
}

const id   = i => document.getElementById(i);
const q    = i => document.getElementById(i);
const qall = s => document.querySelectorAll(s);

tryAutoRejoin();
</script>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --ink:#1a0f0a;--p0:#f3e9d6;--p1:#e5d5b2;--p2:#cdb98a;
  --blood:#8b1a1a;--gold:#c9a84c;--gold2:#e8c96a;--ember:#c4560a;
  --green:#3a7840;--sh:rgba(8,4,2,.72)
}
html,body{min-height:100%;background:#0b0704;font-family:'IM Fell English',serif;color:var(--ink)}

.fcenter{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1.5rem;
  background:radial-gradient(ellipse at 50% 0%,#1e0c05 0%,#0b0704 70%)}

/* LANDING */
.land-box{text-align:center;max-width:480px;width:100%}
.runes{font-size:.52rem;color:var(--gold);opacity:.15;letter-spacing:.14em;margin-bottom:1.1rem;overflow:hidden;white-space:nowrap}
.brand{font-family:'Cinzel Decorative',serif;font-size:clamp(2.2rem,7vw,4rem);color:var(--gold);
  text-shadow:0 0 50px rgba(201,168,76,.55),0 2px 8px rgba(0,0,0,.9);line-height:1.15;margin-bottom:.45rem}
.brand-sub{font-family:'Cinzel',serif;font-size:.68rem;letter-spacing:.26em;text-transform:uppercase;
  color:var(--p2);opacity:.65;margin-bottom:1.3rem}
.divider-gold{width:80px;height:1px;background:linear-gradient(90deg,transparent,var(--gold),transparent);margin:0 auto 1.8rem}
.land-btns{display:flex;flex-direction:column;gap:.65rem}

/* CARD */
.card{background:linear-gradient(158deg,var(--p0) 0%,var(--p1) 55%,var(--p2) 100%);
  border:1px solid var(--gold);border-radius:3px;
  box-shadow:0 6px 30px var(--sh),inset 0 0 60px rgba(201,168,76,.05);
  position:relative;overflow:hidden}
.card::after{content:'';position:absolute;inset:0;pointer-events:none;
  background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='250' height='250'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='250' height='250' filter='url(%23n)' opacity='.05'/%3E%3C/svg%3E")}
.card.wide{max-width:520px;width:100%}
.card:not(.wide):not(.narc-card):not(.sc){max-width:420px;width:100%}
.card:not(.narc-card):not(.sc){padding:1.8rem 2rem}

/* HEADINGS */
.ch{font-family:'Cinzel',serif;font-size:.93rem;letter-spacing:.17em;text-transform:uppercase;
  color:var(--blood);border-bottom:1px solid var(--gold);padding-bottom:.52rem;margin-bottom:1.25rem}
.csub{font-size:.8rem;color:#5a3520;font-style:italic;margin-bottom:1.05rem;line-height:1.5;opacity:.85}
.dim{opacity:.5;font-size:.8em}
.err{color:var(--blood);font-size:.77rem;margin-top:.5rem;font-style:italic;min-height:1rem}

/* FORM */
.f{margin-bottom:.92rem}
.f label{display:block;font-family:'Cinzel',serif;font-size:.57rem;letter-spacing:.14em;
  text-transform:uppercase;color:var(--blood);margin-bottom:.26rem;opacity:.85}
.f input,.f select,.f textarea{width:100%;background:rgba(255,255,255,.34);border:1px solid var(--p2);
  border-radius:2px;padding:.4rem .6rem;font-family:'IM Fell English',serif;font-size:.95rem;
  color:var(--ink);outline:none;transition:border-color .2s,box-shadow .2s}
.f input:focus,.f select:focus,.f textarea:focus{border-color:var(--gold);box-shadow:0 0 0 2px rgba(201,168,76,.2)}
.f textarea{resize:vertical;min-height:54px}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}

/* BUTTONS */
.btn-gold{background:linear-gradient(135deg,var(--gold) 0%,#a8862e 100%);color:var(--ink);
  border:1px solid var(--gold2);border-radius:2px;padding:.68rem 1.4rem;font-family:'Cinzel',serif;
  font-size:.7rem;letter-spacing:.2em;text-transform:uppercase;cursor:pointer;font-weight:600;transition:all .2s}
.btn-gold.full{width:100%;margin-top:.2rem}
.btn-gold:hover:not(:disabled){background:linear-gradient(135deg,var(--gold2) 0%,var(--gold) 100%);
  box-shadow:0 3px 16px rgba(201,168,76,.4);transform:translateY(-1px)}
.btn-gold:disabled{opacity:.36;cursor:not-allowed}
.btn-blood{background:linear-gradient(135deg,var(--blood) 0%,#6b1414 100%);color:var(--p0);
  border:1px solid #6b1414;border-radius:2px;padding:.68rem 1.4rem;font-family:'Cinzel',serif;
  font-size:.7rem;letter-spacing:.2em;text-transform:uppercase;cursor:pointer;font-weight:600;transition:all .2s}
.btn-blood:hover{background:linear-gradient(135deg,#a02020 0%,var(--blood) 100%);box-shadow:0 3px 16px rgba(139,26,26,.4);transform:translateY(-1px)}
.btn-ghost{width:100%;background:transparent;color:var(--ember);border:1px solid var(--ember);border-radius:2px;
  padding:.46rem 1rem;font-family:'Cinzel',serif;font-size:.62rem;letter-spacing:.15em;text-transform:uppercase;
  cursor:pointer;margin-top:.42rem;transition:all .2s;opacity:.62}
.btn-ghost:hover{opacity:1}
.btn-sm{background:rgba(255,255,255,.26);border:1px solid var(--p2);border-radius:2px;padding:.26rem .62rem;
  font-family:'Cinzel',serif;font-size:.57rem;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;
  color:var(--ink);transition:all .15s}
.btn-sm:hover{border-color:var(--gold);background:rgba(201,168,76,.14)}
.rmt{margin-top:.42rem;display:inline-block}

/* STAT GRID */
.stat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.38rem;margin:.5rem 0}
.sbox{background:rgba(255,255,255,.24);border:1px solid var(--p2);border-radius:2px;text-align:center;padding:.38rem .18rem}
.sk{font-family:'Cinzel',serif;font-size:.49rem;letter-spacing:.1em;text-transform:uppercase;color:var(--blood);opacity:.85}
.sv{font-family:'Cinzel',serif;font-size:1.22rem;font-weight:600;color:var(--ink);line-height:1.1}
.sm{font-size:.6rem;color:var(--ember);font-style:italic}

/* CODE BOX */
.codebox{text-align:center;margin-bottom:1rem;padding:.8rem;background:rgba(255,255,255,.18);border-radius:2px;border:1px solid var(--p2)}
.codelabel{font-family:'Cinzel',serif;font-size:.56rem;letter-spacing:.2em;text-transform:uppercase;opacity:.6}
.codevalue{font-family:'Cinzel Decorative',serif;font-size:2.2rem;color:var(--blood);letter-spacing:.3em;text-shadow:0 0 20px rgba(139,26,26,.28);margin:.14rem 0}
.codehint{font-size:.7rem;font-style:italic;opacity:.58}

/* ROSTER */
.roster{margin:.9rem 0}
.rrow{display:flex;justify-content:space-between;align-items:center;padding:.46rem .65rem;border-radius:2px;margin-bottom:.35rem;border:1px solid var(--p2)}
.rrow.rdy{background:rgba(58,120,64,.1);border-color:var(--green)}
.rrow.wait{background:rgba(255,255,255,.16)}
.rname{font-family:'Cinzel',serif;font-size:.73rem;font-weight:600}
.rchar{font-size:.7rem;font-style:italic;color:#5a3520;opacity:.83;margin-top:.06rem}
.rwait{font-size:.7rem;font-style:italic;opacity:.48}
.rbadge{font-family:'Cinzel',serif;font-size:.58rem;letter-spacing:.08em}
.wait-msg{text-align:center;font-style:italic;font-size:.8rem;opacity:.55;margin-top:.9rem;padding:.6rem}

/* PLAY WRAP */
.play-wrap{min-height:100vh;background:radial-gradient(ellipse at 50% 0%,#200d05 0%,#0b0704 80%);display:flex;flex-direction:column}
.phead{display:flex;justify-content:space-between;align-items:center;padding:.65rem 1.1rem;border-bottom:1px solid rgba(201,168,76,.16);flex-shrink:0}
.pbrand{font-family:'Cinzel Decorative',serif;font-size:.92rem;color:var(--gold);text-shadow:0 0 20px rgba(201,168,76,.38)}
.pcode{font-family:'Cinzel',serif;font-size:.56rem;letter-spacing:.14em;text-transform:uppercase;color:var(--p2);opacity:.62}
.pcode strong{color:var(--gold);opacity:1}
.btn-leave{background:transparent;border:1px solid rgba(139,26,26,.4);color:var(--blood);border-radius:2px;padding:.3rem .7rem;font-family:'Cinzel',serif;font-size:.55rem;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;opacity:.6;transition:opacity .2s}
.btn-leave:hover{opacity:1}
.pgrid{display:grid;grid-template-columns:1fr 255px;gap:.9rem;padding:.9rem;flex:1;align-items:start}
@media(max-width:680px){.pgrid{grid-template-columns:1fr}}

/* NARRATIVE */
.narc{display:flex;flex-direction:column}
.narc-card{display:flex;flex-direction:column;padding:0}
.log{padding:1.1rem 1.35rem;min-height:260px;max-height:calc(100vh - 250px);overflow-y:auto;display:flex;flex-direction:column;gap:.82rem}
.log::-webkit-scrollbar{width:5px}
.log::-webkit-scrollbar-track{background:var(--p2)}
.log::-webkit-scrollbar-thumb{background:var(--gold);border-radius:3px}
.mdm{font-size:.96rem;line-height:1.78;color:var(--ink);border-left:3px solid var(--gold);padding-left:.82rem}
.mlbl{font-family:'Cinzel',serif;font-size:.53rem;letter-spacing:.2em;text-transform:uppercase;color:var(--blood);margin-bottom:.16rem;opacity:.7}
.mpl{font-size:.87rem;line-height:1.62;color:#3a2010;background:rgba(255,255,255,.24);border-radius:2px;padding:.42rem .72rem;border-left:3px solid var(--ember);font-style:italic}
.mroll{font-family:'Cinzel',serif;font-size:.68rem;text-align:center;color:var(--blood);letter-spacing:.1em;opacity:.74}
.thinking{font-style:italic;color:var(--p2);font-size:.78rem;opacity:.58;animation:pulse 1.6s infinite}
@keyframes pulse{0%,100%{opacity:.32}50%{opacity:.85}}

/* ACTION ZONE */
.azone{border-top:1px solid var(--p2);padding:.75rem .95rem}
.tpill{display:inline-block;font-family:'Cinzel',serif;font-size:.58rem;letter-spacing:.15em;text-transform:uppercase;padding:.28rem .72rem;border-radius:20px;border:1px solid;margin-bottom:.5rem}
.tpill-on{background:rgba(201,168,76,.14);border-color:var(--gold);color:var(--gold)}
.tpill-off{background:rgba(255,255,255,.08);border-color:var(--p2);color:#5a3520;opacity:.6}
.arow{display:flex;gap:.45rem;align-items:flex-end}
#ainp{flex:1;background:rgba(255,255,255,.34);border:1px solid var(--p2);border-radius:2px;padding:.42rem .6rem;font-family:'IM Fell English',serif;font-size:.94rem;color:var(--ink);resize:none;outline:none;transition:border-color .2s,box-shadow .2s}
#ainp:focus{border-color:var(--gold);box-shadow:0 0 0 2px rgba(201,168,76,.2)}
.btn-declare{background:linear-gradient(135deg,var(--blood) 0%,#6b1414 100%);color:var(--p0);border:1px solid #6b1414;border-radius:2px;padding:.42rem .85rem;font-family:'Cinzel',serif;font-size:.57rem;letter-spacing:.14em;text-transform:uppercase;cursor:pointer;transition:all .2s;white-space:nowrap}
.btn-declare:hover{background:linear-gradient(135deg,#a02020 0%,var(--blood) 100%)}
.btn-retry{display:inline-block;margin-top:.5rem;background:rgba(139,26,26,.12);border:1px solid var(--blood);color:var(--blood);border-radius:2px;padding:.25rem .7rem;font-family:'Cinzel',serif;font-size:.58rem;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;transition:all .2s}
.btn-retry:hover{background:rgba(139,26,26,.25)}

/* SIDEBAR */
.sbar{display:flex;flex-direction:column;gap:.72rem}
.sc{padding:.82rem}
.st{font-family:'Cinzel',serif;font-size:.57rem;letter-spacing:.2em;text-transform:uppercase;color:var(--blood);border-bottom:1px solid var(--p2);padding-bottom:.3rem;margin-bottom:.62rem}

/* TURN ORDER */
.trow{display:flex;justify-content:space-between;align-items:center;padding:.26rem .38rem;border-radius:2px;margin-bottom:.16rem}
.trow-cur{background:rgba(201,168,76,.13);border:1px solid rgba(201,168,76,.26)}
.tcn{font-family:'Cinzel',serif;font-size:.7rem;font-weight:600}
.tcs{font-size:.6rem;font-style:italic;color:#5a3520;opacity:.7}
.tarr{color:var(--gold);font-size:.62rem}

/* HP */
.hpb{margin-bottom:.62rem}.hpb:last-child{margin-bottom:0}
.hpn{font-family:'Cinzel',serif;font-size:.66rem;font-weight:600;margin-bottom:.16rem}
.hbar-w{background:var(--p2);border-radius:2px;height:5px;overflow:hidden}
.hbar{height:100%;background:linear-gradient(90deg,var(--blood),var(--ember));border-radius:2px;transition:width .4s}
.hpnum{font-family:'Cinzel',serif;font-size:.54rem;color:var(--blood);margin-top:.12rem}
.hpctrl{display:flex;gap:.26rem;margin-top:.28rem;align-items:center}
.hpinp{width:38px;background:rgba(255,255,255,.34);border:1px solid var(--p2);border-radius:2px;padding:.16rem .3rem;font-family:'Cinzel',serif;font-size:.66rem;color:var(--ink);text-align:center;outline:none}
.hbtn{flex:1;padding:.16rem 0;font-family:'Cinzel',serif;font-size:.5rem;letter-spacing:.04em;cursor:pointer;border-radius:2px;border:1px solid;transition:opacity .15s}
.db{background:rgba(139,26,26,.11);border-color:var(--blood);color:var(--blood)}
.hb{background:rgba(58,120,64,.11);border-color:var(--green);color:var(--green)}
.hbtn:hover{opacity:.68}

/* DICE */
.dgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:.28rem}
.dbtn{background:linear-gradient(135deg,var(--p1),var(--p2));border:1px solid var(--gold);border-radius:2px;padding:.35rem .08rem;font-family:'Cinzel',serif;font-size:.57rem;color:var(--ink);cursor:pointer;text-align:center;transition:all .15s}
.dbtn:hover{background:linear-gradient(135deg,var(--gold2),var(--gold));box-shadow:0 2px 6px rgba(201,168,76,.28)}
.dres{text-align:center;margin-top:.5rem;font-family:'Cinzel',serif;font-size:1.6rem;color:var(--blood);font-weight:700;line-height:1.1}
.dres span{font-size:.56rem;color:var(--ink);opacity:.52;display:block;font-weight:400}
.dempty{text-align:center;margin-top:.42rem;font-family:'Cinzel',serif;font-size:.52rem;opacity:.28;letter-spacing:.1em}

/* MINI STATS */
.mstats{display:grid;grid-template-columns:repeat(3,1fr);gap:.26rem}
.ms{background:rgba(255,255,255,.2);border:1px solid var(--p2);border-radius:2px;text-align:center;padding:.26rem .08rem}
.msk{font-family:'Cinzel',serif;font-size:.46rem;letter-spacing:.1em;text-transform:uppercase;color:var(--blood);opacity:.84}
.msv{font-family:'Cinzel',serif;font-size:.98rem;font-weight:600;color:var(--ink);line-height:1.1}
.msm{font-size:.56rem;color:var(--ember);font-style:italic}
</style>
</head>
<body><div id="root"></div></body>
</html>
