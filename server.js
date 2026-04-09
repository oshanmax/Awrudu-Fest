const express   = require('express');
const mongoose  = require('mongoose');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const cors      = require('cors');
const path      = require('path');
const rateLimit = require('express-rate-limit');

const app      = express();
const PORT     = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'awrudufest-secret-2026-change-in-production';
const MONGO_URI  = process.env.MONGO_URI  || 'mongodb://localhost:27017/awrudufest';

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '4mb' }));
// Serve static files from root OR public folder (works both ways)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname)));

const limiter       = rateLimit({ windowMs:15*60*1000, max:300, message:{error:'Too many requests'} });
const strictLimiter = rateLimit({ windowMs:15*60*1000, max:20 });
app.use('/api/', limiter);
app.use('/api/admin/login', strictLimiter);

// ── MODELS ──
const LB = mongoose.model('Leaderboard', new mongoose.Schema({
  name:{type:String,required:true,maxlength:30}, score:{type:Number,required:true,min:0},
  game:{type:String,required:true}, gameLabel:{type:String}, avatar:{type:String,default:'🧑'},
  date:{type:String}, ip:{type:String,select:false},
},{timestamps:true}));

const Game = mongoose.model('Game', new mongoose.Schema({
  gameId:{type:String,required:true,unique:true}, name:{type:String,required:true},
  type:{type:String}, icon:{type:String,default:'🎮'}, file:{type:String}, desc:{type:String},
  players:{type:String,default:'1 Player'},
  status:{type:String,enum:['active','hidden','soon'],default:'active'},
  badge:{type:String}, plays:{type:Number,default:0}, order:{type:Number,default:0},
},{timestamps:true}));

const Ann = mongoose.model('Announcement', new mongoose.Schema({
  text:{type:String,required:true,maxlength:300}, tag:{type:String,default:'INFO',maxlength:20},
  color:{type:String,default:'gold'}, active:{type:Boolean,default:true}, order:{type:Number,default:0},
},{timestamps:true}));

const Admin = mongoose.model('Admin', new mongoose.Schema({
  username:{type:String,required:true,unique:true,maxlength:30},
  password:{type:String,required:true,select:false},
  role:{type:String,enum:['super','admin','editor'],default:'editor'},
  lastLogin:{type:Date},
},{timestamps:true}));

const KV = mongoose.model('KV', new mongoose.Schema({
  key:{type:String,unique:true}, value:{type:mongoose.Schema.Types.Mixed},
},{timestamps:true}));

const PlayLog = mongoose.model('PlayLog', new mongoose.Schema({
  game:{type:String,required:true}, ip:{type:String,select:false},
  ua:{type:String,select:false}, date:{type:String}, dayOfWeek:{type:Number},
},{timestamps:true}));

const Sub = mongoose.model('Subscriber', new mongoose.Schema({
  email:{type:String,required:true,unique:true,maxlength:120},
},{timestamps:true}));

// ── AUTH ──
function authAdmin(req,res,next){
  const token=req.headers['x-admin-token']||req.headers['authorization']?.split(' ')[1];
  if(!token)return res.status(401).json({error:'No token'});
  try{req.admin=jwt.verify(token,JWT_SECRET);next();}
  catch{res.status(401).json({error:'Invalid token'});}
}
function requireRole(...roles){
  return(req,res,next)=>{
    if(!roles.includes(req.admin?.role))return res.status(403).json({error:'Insufficient permissions'});
    next();
  };
}

// ── KV HELPERS ──
const getKV=async(key,def={})=>{const d=await KV.findOne({key});return d?.value??def;};
const setKV=async(key,value)=>KV.findOneAndUpdate({key},{value},{upsert:true,new:true});

// ── SEED ──
async function seedDefaults(){
  // Create/update admin accounts
  if(!await Admin.findOne({username:'featuredesignz'})){
    await Admin.create({username:'featuredesignz',password:await bcrypt.hash('oshan1111',12),role:'super'});
    console.log('✅ Admin: featuredesignz / oshan1111');
  }
  // Keep legacy admin as fallback (update if exists with old pass)
  if(!await Admin.findOne({username:'admin'})){
    await Admin.create({username:'admin',password:await bcrypt.hash('awrudu2026',12),role:'admin'});
  }
  // Upsert all 8 games — adds missing ones, updates existing (preserves plays count)
  const GAMES_SEED=[
    {gameId:'shell',  name:'කනා මුට්ටිය',    type:'SHELL GAME',    icon:'🏺', file:'kana-muttiya.html',        status:'active',badge:'HOT',players:'1 Player · Casual',   desc:'Pot shuffle game! Ball සඟවලා — නිවැරදි pot තෝරා ලකුණු ගන්න.',order:1},
    {gameId:'tag',    name:'Blind Tag',        type:'ACTION TAG',    icon:'🙈', file:'kana-muttiya-tag.html',    status:'active',badge:'NEW',players:'1 vs AI · Action',    desc:'Blindfolded character ගෙන AI runners catch කරන්න!',           order:2},
    {gameId:'kotta',  name:'කොට්ට පොර',      type:'TURN BASED',    icon:'🛏️',file:'kotta-pora.html',          status:'active',badge:'NEW',players:'1 vs AI · Fighting',  desc:'AI ව කොට්ටෙන් combat! Special moves, best of 3.',             order:3},
    {gameId:'kiriko', name:'කඹ ඇදීම',          type:'ROPE PULL',     icon:'🪢', file:'kiri-ko-adeema.html',      status:'active',badge:'NEW',players:'1 vs AI · Fast Tap',  desc:'AI කණ්ඩායමට ශක්තිමත්ව ඇදීම! 3 වටයෙන් ජය ගන්න.',              order:4},
    {gameId:'kanamut',name:'කණමුට්ටි ගැසීම', type:'POT BREAKING',  icon:'🎯', file:'kana-muttiya-gasima.html', status:'active',badge:'NEW',players:'1 Player · Aim',      desc:'ඇස් බැඳ pendulum ළඟ click කර කාමරය කඩාගන්න. 60s!',          order:5},
    {gameId:'pancha', name:'කැටපොලෙන් විදීම', type:'CATAPULT',      icon:'🪁', file:'pancha-keliya.html',        status:'active',badge:'NEW',players:'1 Player · Skill',    desc:'Catapult drag & shoot! ඉලක්ක hit කරන්න. Streak bonus!',       order:6},
    {gameId:'rahas',  name:'රහස් දඩයම',      type:'TREASURE HUNT', icon:'🧗', file:'rahas-dadayama.html',      status:'active',badge:'NEW',players:'1 Player · Puzzle',   desc:'ඉඟිය කියවා ධජ සොයා ගන්න! 90s ඇතුළත ධජ 5ක්.',               order:7},
    {gameId:'snake',  name:'සර්ප හා ඉණිමං', type:'BOARD GAME',    icon:'🐍', file:'sarpa-inimang.html',        status:'active',badge:'HOT',players:'1 vs AI · Board',     desc:'සිංහල Snakes & Ladders! AI race කරන්න 🎲',                   order:8},
  ];
  for(const g of GAMES_SEED){
    await Game.findOneAndUpdate(
      {gameId:g.gameId},
      {$set:{type:g.type,icon:g.icon,file:g.file,order:g.order},
       $setOnInsert:{name:g.name,badge:g.badge,players:g.players,
                     desc:g.desc,status:g.status,plays:0}},
      {upsert:true,new:true}
    );
  }
  // Remove old placeholder game (ළිඳ් ඇදීම / lind) if present
  await Game.deleteOne({gameId:'lind'});
  // Fix wrong names in existing DB (one-time migration)
  await Game.updateOne({gameId:'kiriko',name:{$in:['කිරිකෝ ඇදීම','කිරිකෝ']}},
    {$set:{name:'කඹ ඇදීම',type:'ROPE PULL',players:'1 vs AI · Rope Pull'}});
  await Game.updateOne({gameId:'pancha',name:{$in:['පංච කෙළිය','Pancha Keliya']}},
    {$set:{name:'කැටපොලෙන් විදීම',type:'CATAPULT',players:'1 Player · Catapult'}});
  console.log('✅ Games: 8 games upserted + names migrated');
  if(!await Ann.countDocuments()){
    await Ann.insertMany([
      {text:'🎊 AwruduFest.lk — සිංහල හා දෙමළ අලුත් අවුරුදු 2026 Platform!',tag:'NEW',order:1},
      {text:'☸ April 14, 2026 · 7:23 AM — නව අවුරුදු නැකත! Nakath Sheet available!',tag:'NAK',order:2},
      {text:'🎮 කොට්ට පොර · කනා මුට්ටිය · Blind Tag — Play Now!',tag:'LIVE',order:3},
      {text:'🍛 Recipes — කිරිබත්, කොකිස්, අල්වා step-by-step!',tag:'HOT',order:4},
      {text:'💌 සුබ පැතුම් Generator — Card හදාගෙන Share!',tag:'NEW',order:5},
      {text:'📱 @FeatureDesignz — YouTube & TikTok Subscribe!',tag:'FOLLOW',order:6},
    ]);
  }
  if(!await KV.findOne({key:'theme'}))
    await setKV('theme',{gold:'#D4A017',goldLt:'#F5C842',maroon:'#5C0A0A',dark:'#0A0500',cream:'#FDF3DC',orange:'#E8640A'});

  // Always sync official Feature Designz contact details
  await setKV('social',{
    youtube:'https://www.youtube.com/channel/UCda2mc_f-nIinjWpDUJiA2g',youtubeHandle:'@FeatureDesignz',
    tiktok:'https://www.tiktok.com/@featuredesignz',tiktokHandle:'@featuredesignz',
    facebook:'https://www.facebook.com/featuredesignz',facebookHandle:'featuredesignz',
    instagram:'https://www.instagram.com/featuredesignz',instagramHandle:'@featuredesignz',
    twitter:'https://x.com/featuredesignz',twitterHandle:'@featuredesignz',
    whatsapp:'https://wa.me/94786675150',whatsappNum:'+94 786 675 150',
    email:'info@featuredesignz.site',phone:'+94 786 675 150',
    website:'https://featuredesignz.site',websiteDisplay:'featuredesignz.site',
  });

  if(!await KV.findOne({key:'popup'}))
    await setKV('popup',{
      enabled:true,
      title:'🎊 AwruduFest.lk',
      from:'Feature Designz Team',
      wish:'සිංහල හා දෙමළ\nජනතාවට සුබ\nඅලුත් අවුරුද්දක් වේවා!',
      subText:'Feature Designz Team ගෙන් සිංහල හා දෙමළ සියල්ලන්ටම ආදරයෙන් Avurudu 2026 wish! 🎉',
      pillText:'☸ සිංහල අවුරුදු 2026 · AVURUDU 2026 ☸',
      emojis:'🌸 ☸ 🌺',
      showAfterMs:2200,
      btn1Text:'🎮 ▶ Play',btn1Link:'#games',
      btn2Text:'💌 Wish Share',btn2Link:'greetings.html',
    });

  // Always sync official 2026 nakath data
  await setKV('nakath2026',{
      year:2026,sinhalaYear:2569,
      mainDate:'April 14, 2026 — Tuesday',mainDateSi:'අප්‍රේල් 14 — අඟහරුවාදා',
      mainTime:'09:32 AM',lagna:'මේෂ',direction:'ඊශාන',
      nakathTimes:[
      {id:'fire',   icon:'🔥', si:'තෙල්වලා ලිප දැල්වීම',          en:'Lighting the Hearth',         time:'11:08 AM', date:'Apr 5 · Sunday',     desc:'රතු+කහ ගෙහොත් · දකුණු දිශාව · ලිප් බද ගිනිමොලොව'},
      {id:'bath',   icon:'🛁', si:'පරණ අවුරුද්ද සදහා ස්නානය',      en:'Last Year Ritual Bath',       time:'දිවා',    date:'Apr 13 · Saturday',  desc:'යුහු මිගු නාණු ගා ස්නාන · ඉෂ්ට දේවතා'},
      {id:'newyr',  icon:'🌅', si:'අලුත් අවුරුද්ද',                 en:'Sinhala New Year 2026',       time:'09:32 AM', date:'Apr 14 · Tuesday',   desc:'සූර්යයා මේෂ රාශියට · ශාකල වර්ෂ 2569'},
      {id:'punkal', icon:'☸️', si:'පුණ්‍ය කාලය',                    en:'Auspicious Period',           time:'03:08 – 03:56 AM', date:'Apr 14 · Tuesday', desc:'ගෙදර රැඳී ආගමික කටයුතු · ගමන් නෑ'},
      {id:'cook',   icon:'🍚', si:'ආහාර පිසීම (ලිප ගිනි)',          en:'First Cooking · Milk Rice',   time:'10:51 AM', date:'Apr 14 · Tuesday',   desc:'රතු රෙදි · දකුණු දිශාව · කිරිබත් + කෑවිල්ල'},
      {id:'work',   icon:'🤝', si:'වැඩ අල්ලීම, ගනුදෙනු, ආහාර',     en:'Work, Transactions & Meal',   time:'12:06 PM', date:'Apr 14 · Tuesday',   desc:'රතු රෙදි · දකුණු දිශාව · ගනුදෙනු + ආහාර'},
      {id:'oil',    icon:'💆', si:'හිසතෙල් ගෑම',                    en:'Head Oil Anointing',          time:'06:55 AM', date:'Apr 15 · Wednesday', desc:'කළු+කොළ ගෙහොත් · දකුණු · කොහොඹ+ශ්‍රේෂ්ඨ'},
      {id:'hedisi', icon:'👑', si:'හේදිසී රාජකාරී',                 en:'Royal Duties Journey',        time:'05:38 AM', date:'Apr 17 · Friday',    desc:'රතු ගෙහොත් · කිරිබත් + ශිරිබාන · රාජකාරී'},
      {id:'work1',  icon:'💼', si:'රැකිරක්ෂා පිටත්ව යෑම (1)',       en:'Setting Out for Work 1',      time:'06:27 AM', date:'Apr 20 · Monday',    desc:'ස්වේත රෙදි · කිරිබාණ · දකුණු දිශාව'},
      {id:'work2',  icon:'🌾', si:'රැකිරක්ෂා පිටත්ව යෑම (2)',       en:'Setting Out for Work 2',      time:'06:50 AM', date:'Apr 20 · Monday',    desc:'ස්වේත+භූමිනු · ගිගෙනිහිර · ශිරිබාන+කිරිබත්'},
      {id:'plant',  icon:'🌱', si:'පළ සිටුවීම',                     en:'Planting & Agriculture',      time:'09:01 AM', date:'Apr 23 · Thursday',  desc:'රතු+ශේ ගෙහොත් · නැගෙනහිර · ශිරිබාණ+කිරිබත්'},
    ],
    });

  // Always sync official contact
  await setKV('contact',{
    teamName:'Feature Designz',
    description:'Web · Mobile · Design · Video. Made with ❤️ in Sri Lanka 🇱🇰',
    email:'info@featuredesignz.site',phone:'+94 786 675 150',
    whatsapp:'+94786675150',website:'https://featuredesignz.site',
    websiteDisplay:'featuredesignz.site',location:'Sri Lanka 🇱🇰',founded:'2023',
  });

  if(!await KV.findOne({key:'settings'}))
    await setKV('settings',{
      siteName:'AwruduFest',siteTagline:'සිංහල & දෙමළ අලුත් අවුරුදු 2026',
      maintenanceMode:false,showLeaderboard:true,showGames:true,
      showNakath:true,showRecipes:true,showGreetings:true,showPopup:true,
      countdownTarget:'2026-04-14T07:23:00',
    });

  if(!await LB.countDocuments()){
    const d=new Date().toLocaleDateString('en-LK');
    await LB.insertMany([
      {name:'Kavindi R.',score:2840,game:'kotta',gameLabel:'කොට්ට පොර',avatar:'👩',date:d},
      {name:'Sasith M.',score:2611,game:'tag',gameLabel:'Blind Tag',avatar:'👨',date:d},
      {name:'Dinusha P.',score:2380,game:'shell',gameLabel:'කනා මුට්ටිය',avatar:'👩',date:d},
      {name:'Tharindu K.',score:2145,game:'kotta',gameLabel:'කොට්ට පොර',avatar:'👨',date:d},
      {name:'Nimesha S.',score:1988,game:'tag',gameLabel:'Blind Tag',avatar:'👩',date:d},
    ]);
  }
  console.log('✅ All defaults ready');
}

// ══ PUBLIC ROUTES ══
app.get('/api/leaderboard',async(req,res)=>{
  try{const{game,limit=10}=req.query;const q=game&&game!=='all'?{game}:{};
  res.json(await LB.find(q).sort({score:-1}).limit(Math.min(Number(limit),50)));}
  catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/leaderboard',async(req,res)=>{
  try{const{name,score,game,avatar}=req.body;if(!name||!score||!game)return res.status(400).json({error:'Missing fields'});
  const labels={shell:'කනා මුට්ටිය',tag:'Blind Tag',kotta:'කොට්ට පොර'};
  res.status(201).json(await LB.create({name:String(name).slice(0,30),score:Math.round(Number(score)),game,gameLabel:labels[game]||game,avatar:avatar||'🧑',date:new Date().toLocaleDateString('en-LK'),ip:req.ip}));}
  catch(e){res.status(500).json({error:e.message});}
});
app.get('/api/health',(_req,res)=>res.json({ok:true,ts:Date.now()}));
app.get('/api/games',async(req,res)=>{
  try{
    const games=await Game.find({status:{$ne:'hidden'}}).sort({order:1}).lean();
    res.json(games.map(g=>({...g,id:g.gameId})));
  }catch(e){res.status(500).json({error:e.message});}
});
app.get('/api/announcements',async(req,res)=>{try{res.json(await Ann.find({active:true}).sort({order:1}));}catch(e){res.status(500).json({error:e.message});}});
app.post('/api/play/:game',async(req,res)=>{
  try{const{game}=req.params;await Game.findOneAndUpdate({gameId:game},{$inc:{plays:1}});
  await PlayLog.create({game,ip:req.ip,ua:req.headers['user-agent'],date:new Date().toLocaleDateString('en-LK'),dayOfWeek:new Date().getDay()});
  res.json({ok:true});}catch(e){res.json({ok:false});}
});
app.get('/api/stats',async(req,res)=>{
  try{const g=await Game.find({},'gameId plays');const r={};g.forEach(x=>r[x.gameId]=x.plays);res.json(r);}
  catch(e){res.status(500).json({});}
});
app.get('/api/theme',  async(req,res)=>{try{res.json(await getKV('theme',{}));}catch(e){res.json({});}});
app.get('/api/social', async(req,res)=>{try{res.json(await getKV('social',{}));}catch(e){res.json({});}});
app.get('/api/popup',  async(req,res)=>{
  try{const p=await getKV('popup',{});const s=await getKV('settings',{});
  if(s.showPopup===false)p.enabled=false;res.json(p);}catch(e){res.json({enabled:false});}
});
app.get('/api/nakath', async(req,res)=>{try{res.json(await getKV('nakath2026',{}));}catch(e){res.json({});}});
app.get('/api/contact',async(req,res)=>{try{res.json(await getKV('contact',{}));}catch(e){res.json({});}});
app.get('/api/site',   async(req,res)=>{
  try{const s=await getKV('settings',{});res.json({siteName:s.siteName,siteTagline:s.siteTagline,showLeaderboard:s.showLeaderboard,showGames:s.showGames,showNakath:s.showNakath,showRecipes:s.showRecipes,showGreetings:s.showGreetings,maintenanceMode:s.maintenanceMode,countdownTarget:s.countdownTarget});}
  catch(e){res.json({});}
});
app.post('/api/subscribe',async(req,res)=>{
  try{const{email}=req.body;if(!email||!email.includes('@'))return res.status(400).json({error:'Invalid email'});
  await Sub.findOneAndUpdate({email},{email},{upsert:true,new:true});res.json({ok:true});}
  catch(e){res.json({ok:false});}
});

// ══ ADMIN AUTH ══
app.post('/api/admin/login',async(req,res)=>{
  try{const{username,password}=req.body;if(!username||!password)return res.status(400).json({error:'Missing fields'});
  const admin=await Admin.findOne({username}).select('+password');if(!admin)return res.status(401).json({error:'Invalid credentials'});
  if(!await bcrypt.compare(password,admin.password))return res.status(401).json({error:'Invalid credentials'});
  await Admin.findByIdAndUpdate(admin._id,{lastLogin:new Date()});
  const token=jwt.sign({id:admin._id,username:admin.username,role:admin.role},JWT_SECRET,{expiresIn:'24h'});
  res.json({token,username:admin.username,role:admin.role});}
  catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/admin/change-password',authAdmin,async(req,res)=>{
  try{const{current,newPassword}=req.body;const admin=await Admin.findById(req.admin.id).select('+password');
  if(!admin||!await bcrypt.compare(current,admin.password))return res.status(401).json({error:'Wrong password'});
  if(newPassword.length<8)return res.status(400).json({error:'Too short (min 8)'});
  admin.password=await bcrypt.hash(newPassword,12);await admin.save();res.json({ok:true});}
  catch(e){res.status(500).json({error:e.message});}
});
app.get('/api/admin/users',authAdmin,requireRole('super'),async(req,res)=>{try{res.json(await Admin.find({},'username role lastLogin createdAt'));}catch(e){res.status(500).json({error:e.message});}});
app.post('/api/admin/users',authAdmin,requireRole('super'),async(req,res)=>{
  try{const{username,password,role}=req.body;const hash=await bcrypt.hash(password,12);const u=await Admin.create({username,password:hash,role:role||'editor'});res.status(201).json({id:u._id,username:u.username,role:u.role});}
  catch(e){res.status(500).json({error:e.message});}
});
app.delete('/api/admin/users/:id',authAdmin,requireRole('super'),async(req,res)=>{
  try{if(req.params.id===req.admin.id)return res.status(400).json({error:'Cannot delete yourself'});
  await Admin.findByIdAndDelete(req.params.id);res.json({ok:true});}
  catch(e){res.status(500).json({error:e.message});}
});

// ══ ADMIN CRUD ══
// Games
app.get('/api/admin/games',authAdmin,async(req,res)=>{
  try{
    const games=await Game.find().sort({order:1}).lean();
    res.json(games.map(g=>({...g,id:g.gameId})));
  }catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/games',authAdmin,async(req,res)=>{
  try{
    const g=await Game.create({...req.body,gameId:req.body.gameId||req.body.id||'g'+Date.now()});
    const obj=g.toObject();res.status(201).json({...obj,id:obj.gameId});
  }catch(e){res.status(500).json({error:e.message});}
});
app.put('/api/games/:id',authAdmin,async(req,res)=>{
  try{
    const g=await Game.findOneAndUpdate({gameId:req.params.id},req.body,{new:true}).lean();
    if(!g)return res.status(404).json({error:'Not found'});
    res.json({...g,id:g.gameId});
  }catch(e){res.status(500).json({error:e.message});}
});
app.delete('/api/games/:id',authAdmin,requireRole('super','admin'),async(req,res)=>{try{await Game.findOneAndDelete({gameId:req.params.id});res.json({ok:true});}catch(e){res.status(500).json({error:e.message});}});

// Leaderboard
app.delete('/api/leaderboard/:id',authAdmin,async(req,res)=>{try{await LB.findByIdAndDelete(req.params.id);res.json({ok:true});}catch(e){res.status(500).json({error:e.message});}});
app.delete('/api/leaderboard',authAdmin,requireRole('super','admin'),async(req,res)=>{try{const{game}=req.query;await LB.deleteMany(game?{game}:{});res.json({ok:true});}catch(e){res.status(500).json({error:e.message});}});

// Announcements
app.get('/api/admin/announcements',authAdmin,async(req,res)=>{try{res.json(await Ann.find().sort({order:1}));}catch(e){res.status(500).json({error:e.message});}});
app.post('/api/announcements',authAdmin,async(req,res)=>{try{res.status(201).json(await Ann.create(req.body));}catch(e){res.status(500).json({error:e.message});}});
app.put('/api/announcements/:id',authAdmin,async(req,res)=>{try{res.json(await Ann.findByIdAndUpdate(req.params.id,req.body,{new:true}));}catch(e){res.status(500).json({error:e.message});}});
app.delete('/api/announcements/:id',authAdmin,async(req,res)=>{try{await Ann.findByIdAndDelete(req.params.id);res.json({ok:true});}catch(e){res.status(500).json({error:e.message});}});

// KV-based admin endpoints
['theme','social','popup','nakath','contact','settings'].forEach(key=>{
  const storeKey = key==='nakath'?'nakath2026':key;
  app.get(`/api/admin/${key}`,authAdmin,async(req,res)=>{try{res.json(await getKV(storeKey,{}));}catch(e){res.json({});}});
  app.put(`/api/${key}`,authAdmin,async(req,res)=>{try{res.json((await setKV(storeKey,req.body)).value);}catch(e){res.status(500).json({error:e.message});}});
});

// Stats & Analytics
app.get('/api/stats/admin',authAdmin,async(req,res)=>{
  try{
    const today=new Date().toLocaleDateString('en-LK');
    const[lbCount,annCount,shellG,tagG,kottaG,totalPlays,playsToday,uniqueToday,weeklyRaw]=await Promise.all([
      LB.countDocuments(),Ann.countDocuments({active:true}),
      Game.findOne({gameId:'shell'}),Game.findOne({gameId:'tag'}),Game.findOne({gameId:'kotta'}),
      PlayLog.countDocuments(),PlayLog.countDocuments({date:today}),LB.countDocuments({date:today}),
      PlayLog.aggregate([{$group:{_id:'$dayOfWeek',count:{$sum:1}}},{$sort:{_id:1}}]),
    ]);
    const sp=shellG?.plays||0,tp=tagG?.plays||0,kp=kottaG?.plays||0;
    const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    res.json({totalPlayers:lbCount,totalPlays:totalPlays+sp+tp+kp,lbCount,annCount,shellPlays:sp,tagPlays:tp,kottaPlays:kp,playsToday,newToday:uniqueToday,weeklyPlays:days.map((day,i)=>({day,count:weeklyRaw.find(d=>d._id===i)?.count||0}))});
  }catch(e){res.status(500).json({error:e.message});}
});
app.get('/api/analytics',authAdmin,async(req,res)=>{
  try{const[pv,ips]=await Promise.all([PlayLog.countDocuments(),PlayLog.distinct('ip').then(i=>i.length)]);
  res.json({pageViews:pv,uniqueVisitors:ips,avgSession:'2m 34s',bounceRate:'38%'});}
  catch(e){res.status(500).json({error:e.message});}
});
app.get('/api/subscribers',authAdmin,requireRole('super','admin'),async(req,res)=>{try{res.json(await Sub.find().sort({createdAt:-1}));}catch(e){res.status(500).json({error:e.message});}});

// Export
app.get('/api/admin/export',authAdmin,requireRole('super','admin'),async(req,res)=>{
  try{
    const[lb,games,anns,subs,theme,social,popup,nakath,contact,settings]=await Promise.all([LB.find().lean(),Game.find().lean(),Ann.find().lean(),Sub.find().lean(),getKV('theme'),getKV('social'),getKV('popup'),getKV('nakath2026'),getKV('contact'),getKV('settings')]);
    res.json({exportedAt:new Date().toISOString(),lb,games,anns,subs,theme,social,popup,nakath,contact,settings});
  }catch(e){res.status(500).json({error:e.message});}
});

// Reset
app.delete('/api/admin/reset',authAdmin,requireRole('super'),async(req,res)=>{
  try{const{target}=req.query;
  if(target==='leaderboard')await LB.deleteMany({});
  else if(target==='playlogs')await PlayLog.deleteMany({});
  else if(target==='announcements')await Ann.deleteMany({});
  else if(target==='all'){await LB.deleteMany({});await PlayLog.deleteMany({});await Ann.deleteMany({});}
  res.json({ok:true,target});}
  catch(e){res.status(500).json({error:e.message});}
});

const fs = require('fs');
app.get('*',(req,res)=>{
  if(req.path.startsWith('/api/'))return res.status(404).json({error:'Not found'});
  // Support both /public/index.html and root /index.html
  const pubPath  = path.join(__dirname,'public','index.html');
  const rootPath = path.join(__dirname,'index.html');
  if(fs.existsSync(pubPath)) res.sendFile(pubPath);
  else if(fs.existsSync(rootPath)) res.sendFile(rootPath);
  else res.status(404).send('index.html not found');
});

async function start(){
  try{
    await mongoose.connect(MONGO_URI);
    console.log('✅ MongoDB connected');
    await seedDefaults();
    app.listen(PORT,()=>{
      console.log(`\n🎊 AwruduFest 2026 Server!`);
      console.log(`   🌐 http://localhost:${PORT}`);
      console.log(`   ⚙️  http://localhost:${PORT}/admin.html`);
      console.log(`   Login: admin / awrudu2026\n`);
      // Self-ping every 4min — prevent Railway sleep
      const SELF=process.env.RAILWAY_STATIC_URL?`https://${process.env.RAILWAY_STATIC_URL}`:process.env.RENDER_EXTERNAL_URL||`http://localhost:${PORT}`;
      setInterval(()=>{try{const lib=require(SELF.startsWith('https')?'https':'http');lib.get(`${SELF}/api/health`,r=>console.log(`💓 ping ${r.statusCode}`)).on('error',()=>{});}catch(e){}},4*60*1000);
    });
  }catch(err){console.error('❌',err.message);process.exit(1);}
}
start();
