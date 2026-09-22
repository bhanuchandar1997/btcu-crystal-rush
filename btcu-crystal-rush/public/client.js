const socket = io({ transports: ['websocket', 'polling'] });
const $ = s => document.querySelector(s);
const screens = { home: $('#home'), lobby: $('#lobby'), game: $('#game'), results: $('#results') };
const canvas = $('#gameCanvas');
const ctx = canvas.getContext('2d');
let state = null;
let myId = null;
let roomCode = '';
let input = { dx: 0, dy: 0 };
let inputTimer = null;

function show(name){ Object.values(screens).forEach(s=>s.classList.remove('active')); screens[name].classList.add('active'); }
function toast(msg){ const el=$('#toast'); el.textContent=msg; el.classList.add('show'); clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.remove('show'),2200); }
function nameValue(){ return ($('#nameInput').value || 'Player').trim().slice(0,18) || 'Player'; }
function setError(msg){ $('#homeError').textContent=msg||''; }
function emitInput(){ socket.emit('input', input); }
function setInput(dx,dy){ input={dx,dy}; emitInput(); clearInterval(inputTimer); inputTimer=setInterval(emitInput,70); }
function stopInput(){ input={dx:0,dy:0}; emitInput(); clearInterval(inputTimer); inputTimer=null; }

$('#createBtn').onclick = ()=>{ setError(''); socket.emit('createRoom',{name:nameValue()}); };
$('#joinBtn').onclick = ()=>{ setError(''); const code=$('#roomInput').value.toUpperCase().trim(); if(code.length!==5){setError('Enter a 5-character room code.');return;} socket.emit('joinRoom',{code,name:nameValue()}); };
$('#copyBtn').onclick = async ()=>{ try{ await navigator.clipboard.writeText(roomCode); toast('Room code copied'); }catch{ toast('Room code: '+roomCode); } };
$('#startBtn').onclick = ()=> socket.emit('startGame');
$('#rematchBtn').onclick = ()=> socket.emit('rematch');
$('#homeBtn').onclick = ()=>{ location.reload(); };

socket.on('connect',()=>toast('Connected to game server'));
socket.on('connect_error',()=>setError('Could not connect to the game server.'));
socket.on('errorMessage',msg=>{ setError(msg); toast(msg); });
socket.on('roomJoined',({code,playerId})=>{ roomCode=code; myId=playerId; $('#roomCode').textContent=code; $('#copyBtn').textContent=code; setError(''); show('lobby'); });
socket.on('state', next=>{
  const was = state?.status;
  state=next;
  if(next.status==='lobby'){
    renderLobby();
    if(screens.lobby.classList.contains('active')===false && !screens.results.classList.contains('active')) show('lobby');
  } else if(next.status==='playing'){
    if(was!=='playing') show('game');
  } else if(next.status==='finished'){
    renderResults();
    show('results');
  }
});

function renderLobby(){
  const host=state.hostId;
  $('#lobbyHint').textContent = state.players.length<2 ? 'Need at least 2 players.' : (myId===host ? 'Everyone is ready. Start the match.' : 'Waiting for the host to start.');
  $('#startBtn').style.display = myId===host ? 'block' : 'none';
  $('#playerList').innerHTML = state.players.map(p=>`<div class="player-item"><span class="dot" style="background:${p.color}"></span><span class="name">${escapeHtml(p.name)}</span>${p.id===host?'<span class="host">HOST</span>':''}</div>`).join('');
}
function renderResults(){
  const sorted=[...state.players].sort((a,b)=>b.score-a.score);
  const w=state.winner;
  $('#winnerTitle').textContent = w ? `${escapeHtml(w.name)} WINS` : 'MATCH COMPLETE';
  $('#winnerLine').textContent = w ? `${w.score} crystal points` : 'No winner';
  $('#finalScores').innerHTML=sorted.map((p,i)=>`<div class="final-line"><span>${i+1}. ${escapeHtml(p.name)}</span><strong>${p.score}</strong></div>`).join('');
  $('#rematchBtn').style.display = myId===state.hostId ? 'block' : 'none';
}
function escapeHtml(s){return s.replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

window.addEventListener('keydown',e=>{ if(!screens.game.classList.contains('active')) return; const k=e.key.toLowerCase(); const dx=(k==='a'||k==='arrowleft'? -1 : k==='d'||k==='arrowright'?1:0); const dy=(k==='w'||k==='arrowup'? -1 : k==='s'||k==='arrowdown'?1:0); if(dx||dy){e.preventDefault();setInput(dx,dy);} });
window.addEventListener('keyup',e=>{ const k=e.key.toLowerCase(); if(['a','d','w','s','arrowleft','arrowright','arrowup','arrowdown'].includes(k)) stopInput(); });
document.querySelectorAll('#touchControls button').forEach(btn=>{ const start=e=>{e.preventDefault();setInput(Number(btn.dataset.dx),Number(btn.dataset.dy));}; const end=e=>{e.preventDefault();stopInput();}; btn.addEventListener('pointerdown',start); btn.addEventListener('pointerup',end); btn.addEventListener('pointercancel',end); btn.addEventListener('pointerleave',end); });

function resize(){ canvas.width=window.innerWidth*devicePixelRatio; canvas.height=window.innerHeight*devicePixelRatio; }
window.addEventListener('resize',resize); resize();
function draw(){
  requestAnimationFrame(draw);
  if(!state || !screens.game.classList.contains('active')) return;
  const w=window.innerWidth,h=window.innerHeight; ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0); ctx.clearRect(0,0,w,h);
  const scale=Math.min(w/state.arena.width,h/state.arena.height); const ox=(w-state.arena.width*scale)/2, oy=(h-state.arena.height*scale)/2;
  ctx.save(); ctx.translate(ox,oy); ctx.scale(scale,scale);
  const g=ctx.createLinearGradient(0,0,state.arena.width,state.arena.height); g.addColorStop(0,'#101b25');g.addColorStop(1,'#070c12');ctx.fillStyle=g;ctx.fillRect(0,0,state.arena.width,state.arena.height);
  ctx.strokeStyle='#18303a';ctx.lineWidth=3;for(let x=0;x<state.arena.width;x+=100){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,state.arena.height);ctx.stroke();}for(let y=0;y<state.arena.height;y+=100){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(state.arena.width,y);ctx.stroke();}
  for(const c of state.crystals){ const pulse=8+Math.sin(performance.now()/180+c.id)*3; ctx.save();ctx.translate(c.x,c.y);ctx.rotate(Math.PI/4);ctx.fillStyle=c.value===3?'#ffd166':'#72f1b8';ctx.shadowBlur=18;ctx.shadowColor=ctx.fillStyle;ctx.fillRect(-8-pulse*.12,-8-pulse*.12,16+pulse*.25,16+pulse*.25);ctx.restore(); }
  const sorted=[...state.players].sort((a,b)=>a.score-b.score);
  for(const p of sorted){ const me=p.id===myId; ctx.beginPath();ctx.fillStyle=p.color;ctx.shadowBlur=me?24:12;ctx.shadowColor=p.color;ctx.arc(p.x,p.y,me?28:24,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='#071018';ctx.beginPath();ctx.arc(p.x,p.y,8,0,Math.PI*2);ctx.fill();ctx.fillStyle='#eef4ff';ctx.font='700 16px system-ui';ctx.textAlign='center';ctx.fillText(p.name,p.x,p.y-38);ctx.font='600 13px system-ui';ctx.fillStyle='#9fe8ff';ctx.fillText(String(p.score),p.x,p.y+47); }
  ctx.strokeStyle='#35505b';ctx.lineWidth=8;ctx.strokeRect(0,0,state.arena.width,state.arena.height);ctx.restore();
  const remaining=Math.max(0,Math.ceil((state.endsAt-Date.now())/1000)); $('#timer').textContent=remaining;
  $('#scoreboard').innerHTML=[...state.players].sort((a,b)=>b.score-a.score).slice(0,5).map(p=>`<div class="score-line"><span style="color:${p.color}">${escapeHtml(p.name)}${p.id===myId?' · YOU':''}</span><strong>${p.score}</strong></div>`).join('');
}
draw();
