const express=require('express');
const http=require('http');
const {Server}=require('socket.io');
const helmet=require('helmet');
const morgan=require('morgan');
const Database=require('better-sqlite3');
const path=require('path');
const {v4:uuid}=require('uuid');

const app=express();
const server=http.createServer(app);
const io=new Server(server,{cors:{origin:true,methods:['GET','POST']}});
const db=new Database(path.join(__dirname,'aurum.db'))
db.pragma('journal_mode=WAL');
app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json());
app.use(morgan('tiny'));
app.use(express.static(path.join(__dirname,'public')));

db.exec(`CREATE TABLE IF NOT EXISTS players(id TEXT PRIMARY KEY,name TEXT NOT NULL,nickname TEXT NOT NULL UNIQUE,city TEXT,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tournaments(id TEXT PRIMARY KEY,name TEXT NOT NULL,max_players INTEGER NOT NULL,format TEXT NOT NULL,repechage INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS registrations(id TEXT PRIMARY KEY,tournament_id TEXT NOT NULL,player_id TEXT NOT NULL,seed INTEGER,UNIQUE(tournament_id,player_id));
CREATE TABLE IF NOT EXISTS matches(id TEXT PRIMARY KEY,tournament_id TEXT NOT NULL,stage TEXT NOT NULL,round INTEGER NOT NULL,position INTEGER NOT NULL,p1 TEXT,p2 TEXT,winner TEXT,score1 INTEGER,score2 INTEGER,status TEXT NOT NULL DEFAULT 'pending',next_match_id TEXT,loser_to_match_id TEXT);
CREATE TABLE IF NOT EXISTS friendly_matches(id TEXT PRIMARY KEY,p1 TEXT NOT NULL,p2 TEXT NOT NULL,winner TEXT,score1 INTEGER,score2 INTEGER,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL);`);
const now=()=>new Date().toISOString();
const err=(r,m,c=400)=>r.status(c).json({error:m});
const getP=id=>db.prepare('SELECT * FROM players WHERE id=?').get(id);
const rounds=n=>Math.log2(n);
app.get('/api/health',(q,r)=>r.json({ok:true,version:'1.0.0-playable',money:false,game:true}));
app.get('/api/players',(q,r)=>r.json(db.prepare('SELECT * FROM players ORDER BY nickname').all()));
app.post('/api/players',(q,r)=>{try{const {name,nickname,city=''}=q.body||{};if(!name||!nickname)return err(r,'Nome e apelido são obrigatórios.');const p={id:uuid(),name:String(name).trim(),nickname:String(nickname).trim(),city:String(city||'').trim(),created_at:now()};db.prepare('INSERT INTO players VALUES (@id,@name,@nickname,@city,@created_at)').run(p);r.json(p)}catch(e){err(r,'Esse apelido já está cadastrado.')}});
app.get('/api/friendly',(q,r)=>r.json(db.prepare(`SELECT f.*,a.nickname p1_nickname,b.nickname p2_nickname,w.nickname winner_nickname FROM friendly_matches f JOIN players a ON a.id=f.p1 JOIN players b ON b.id=f.p2 LEFT JOIN players w ON w.id=f.winner ORDER BY f.created_at DESC`).all()));
app.post('/api/friendly',(q,r)=>{const {p1,p2}=q.body||{};if(!getP(p1)||!getP(p2)||p1===p2)return err(r,'Escolha dois jogadores diferentes.');const m={id:uuid(),p1,p2,winner:null,score1:null,score2:null,status:'pending',created_at:now()};db.prepare('INSERT INTO friendly_matches VALUES (@id,@p1,@p2,@winner,@score1,@score2,@status,@created_at)').run(m);r.json(m)});
app.post('/api/friendly/:id/result',(q,r)=>{const m=db.prepare('SELECT * FROM friendly_matches WHERE id=?').get(q.params.id);if(!m)return err(r,'Amistoso não encontrado.',404);const {winner,score1=1,score2=0}=q.body||{};if(![m.p1,m.p2].includes(winner))return err(r,'Vencedor inválido.');db.prepare('UPDATE friendly_matches SET winner=?,score1=?,score2=?,status="finished" WHERE id=?').run(winner,Number(score1),Number(score2),m.id);r.json({ok:true})});
function createBracket(t,regs){db.prepare('DELETE FROM matches WHERE tournament_id=?').run(t.id);const size=t.max_players,slots=Array(size).fill(null);regs.forEach((p,i)=>slots[i]=p.id);const roundsN=rounds(size),ids={};for(let r=1;r<=roundsN;r++){const count=size/2**r;ids[r]=[];for(let pos=0;pos<count;pos++){const id=uuid();ids[r].push(id);db.prepare('INSERT INTO matches(id,tournament_id,stage,round,position,p1,p2,winner,score1,score2,status,next_match_id,loser_to_match_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,t.id,'main',r,pos,r===1?slots[pos*2]:null,r===1?slots[pos*2+1]:null,null,null,null,'pending',null,null)}}for(let r=1;r<roundsN;r++)for(let p=0;p<ids[r].length;p++)db.prepare('UPDATE matches SET next_match_id=? WHERE id=?').run(ids[r+1][Math.floor(p/2)],ids[r][p]);
if(t.repechage){const qRound=Math.max(1,roundsN-2),qMatches=ids[qRound]||[];let rep=[];for(let i=0;i<qMatches.length;i+=2){const id=uuid();rep.push(id);db.prepare('INSERT INTO matches(id,tournament_id,stage,round,position,p1,p2,winner,score1,score2,status,next_match_id,loser_to_match_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,t.id,'repechage',1,i/2,null,null,null,null,null,'pending',null,null);for(const qm of qMatches.slice(i,i+2))db.prepare('UPDATE matches SET loser_to_match_id=? WHERE id=?').run(id,qm)}if(rep.length>=2){const b=uuid();db.prepare('INSERT INTO matches(id,tournament_id,stage,round,position,p1,p2,winner,score1,score2,status,next_match_id,loser_to_match_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(b,t.id,'bronze',1,0,null,null,null,null,null,'pending',null,null);rep.forEach(x=>db.prepare('UPDATE matches SET next_match_id=? WHERE id=?').run(b,x))}}
resolveAll(t.id)}
function setPlayer(mid,player){const m=db.prepare('SELECT * FROM matches WHERE id=?').get(mid);if(!m)return;if(!m.p1)db.prepare('UPDATE matches SET p1=? WHERE id=?').run(player,mid);else if(!m.p2&&m.p1!==player)db.prepare('UPDATE matches SET p2=? WHERE id=?').run(player,mid)}
function advance(mid,winner){const m=db.prepare('SELECT * FROM matches WHERE id=?').get(mid);if(m&&m.next_match_id)setPlayer(m.next_match_id,winner)}
function feedLoser(m){if(!m.loser_to_match_id||!m.p1||!m.p2||!m.winner)return;const loser=m.winner===m.p1?m.p2:m.p1;setPlayer(m.loser_to_match_id,loser)}
function resolveAll(tid){for(const m of db.prepare(`SELECT * FROM matches WHERE tournament_id=? AND stage='main' AND round=1`).all(tid)){if(m.p1&&!m.p2){db.prepare('UPDATE matches SET winner=?,status="bye" WHERE id=?').run(m.p1,m.id);advance(m.id,m.p1)}else if(!m.p1&&m.p2){db.prepare('UPDATE matches SET winner=?,status="bye" WHERE id=?').run(m.p2,m.id);advance(m.id,m.p2)}}}
app.get('/api/tournaments',(q,r)=>r.json(db.prepare('SELECT t.*,COUNT(rg.id) participants FROM tournaments t LEFT JOIN registrations rg ON rg.tournament_id=t.id GROUP BY t.id ORDER BY t.created_at DESC').all()));
app.post('/api/tournaments',(q,r)=>{const {name,max_players=16,repechage=false}=q.body||{},n=Number(max_players);if(!name)return err(r,'Nome obrigatório.');if(![8,16,32,64,128].includes(n))return err(r,'Escolha 8, 16, 32, 64 ou 128 jogadores.');const t={id:uuid(),name:String(name).trim(),max_players:n,format:'single',repechage:repechage?1:0,status:'registration',created_at:now()};db.prepare('INSERT INTO tournaments VALUES (@id,@name,@max_players,@format,@repechage,@status,@created_at)').run(t);r.json(t)});
app.post('/api/tournaments/:id/register',(q,r)=>{try{const t=db.prepare('SELECT * FROM tournaments WHERE id=?').get(q.params.id);if(!t)return err(r,'Torneio não encontrado.',404);if(t.status!=='registration')return err(r,'Inscrições encerradas.');const p=getP(q.body?.player_id);if(!p)return err(r,'Jogador não encontrado.');const c=db.prepare('SELECT COUNT(*) c FROM registrations WHERE tournament_id=?').get(t.id).c;if(c>=t.max_players)return err(r,'Torneio lotado.');db.prepare('INSERT INTO registrations VALUES(?,?,?,?,?)').run(uuid(),t.id,p.id,c+1);r.json({ok:true})}catch(e){err(r,'Jogador já inscrito neste torneio.')}});
app.post('/api/tournaments/:id/draw',(q,r)=>{const t=db.prepare('SELECT * FROM tournaments WHERE id=?').get(q.params.id);if(!t)return err(r,'Torneio não encontrado.',404);if(t.status!=='registration')return err(r,'A chave já foi gerada.');const regs=db.prepare('SELECT p.* FROM registrations rg JOIN players p ON p.id=rg.player_id WHERE rg.tournament_id=? ORDER BY rg.seed').all(t.id);if(regs.length<2)return err(r,'Cadastre pelo menos 2 jogadores para o teste.');createBracket(t,regs);db.prepare('UPDATE tournaments SET status="running" WHERE id=?').run(t.id);r.json({ok:true})});
app.get('/api/tournaments/:id',(q,r)=>{const t=db.prepare('SELECT * FROM tournaments WHERE id=?').get(q.params.id);if(!t)return err(r,'Torneio não encontrado.',404);const players=db.prepare('SELECT p.* FROM registrations rg JOIN players p ON p.id=rg.player_id WHERE rg.tournament_id=? ORDER BY rg.seed').all(t.id);const matches=db.prepare('SELECT * FROM matches WHERE tournament_id=? ORDER BY stage,round,position').all(t.id);r.json({t,players,matches})});
app.post('/api/matches/:id/result',(q,r)=>{const m=db.prepare('SELECT * FROM matches WHERE id=?').get(q.params.id);if(!m)return err(r,'Partida não encontrada.',404);if(![m.p1,m.p2].includes(q.body?.winner))return err(r,'Vencedor inválido.');db.prepare('UPDATE matches SET winner=?,score1=?,score2=?,status="finished" WHERE id=?').run(q.body.winner,Number(q.body.score1||1),Number(q.body.score2||0),m.id);const updated=db.prepare('SELECT * FROM matches WHERE id=?').get(m.id);advance(m.id,updated.winner);feedLoser(updated);r.json({ok:true})});
app.get('/api/ranking',(q,r)=>r.json(db.prepare(`SELECT p.id,p.nickname,COUNT(f.id) games,SUM(CASE WHEN f.winner=p.id THEN 1 ELSE 0 END) wins,SUM(CASE WHEN f.winner IS NOT NULL AND f.winner<>p.id THEN 1 ELSE 0 END) losses FROM players p LEFT JOIN friendly_matches f ON p.id IN(f.p1,f.p2) AND f.status='finished' GROUP BY p.id ORDER BY wins DESC,games DESC,p.nickname`).all()));

const rooms=new Map();
function cleanState(s){return {balls:s.balls,turn:s.turn,players:s.players,mode:s.mode,started:s.started,gameOver:s.gameOver,winner:s.winner,shotNo:s.shotNo||0};}
io.on('connection',socket=>{
 socket.on('create-room',({name,mode='friendly'}={})=>{const code=Math.random().toString(36).slice(2,7).toUpperCase();rooms.set(code,{players:[{id:socket.id,name:name||'Jogador 1'}],state:null});socket.join(code);socket.data.room=code;socket.emit('room-created',{code,playerIndex:0});});
 socket.on('join-room',({code,name}={})=>{code=String(code||'').toUpperCase();const room=rooms.get(code);if(!room)return socket.emit('room-error','Sala não encontrada.');if(room.players.length>=2)return socket.emit('room-error','Sala cheia.');room.players.push({id:socket.id,name:name||'Jogador 2'});socket.join(code);socket.data.room=code;socket.emit('room-joined',{code,playerIndex:1,state:room.state});io.to(code).emit('room-players',room.players.map((p,i)=>({name:p.name,index:i})));});
 socket.on('start-game',({code,state}={})=>{const room=rooms.get(String(code||'').toUpperCase());if(!room||room.players[0]?.id!==socket.id)return;if(room.players.length<2)return socket.emit('room-error','Aguardando o segundo jogador.');room.state=cleanState({...state,players:room.players.map(p=>p.name),started:true,turn:0});io.to(code).emit('game-start',room.state);});
 socket.on('shot-state',({code,state}={})=>{const room=rooms.get(String(code||'').toUpperCase());if(!room||!room.state)return;const idx=room.players.findIndex(p=>p.id===socket.id);const expected=room.state.turn;if(idx!==expected)return;room.state=cleanState(state);room.state.turn=expected===0?1:0;room.state.shotNo=(room.state.shotNo||0)+1;io.to(code).emit('state-update',room.state);});
 socket.on('disconnect',()=>{const code=socket.data.room;if(!code)return;const room=rooms.get(code);if(!room)return;io.to(code).emit('room-message','O outro jogador saiu da sala.');room.players=room.players.filter(p=>p.id!==socket.id);if(room.players.length===0)rooms.delete(code);});
});

const PORT=process.env.PORT||3000;
server.listen(PORT,'0.0.0.0',()=>console.log(`Aurum Sinuca online na porta ${PORT}`));
