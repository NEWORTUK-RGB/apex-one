(function() {
'use strict';
/* ════════════════════════════════════════════════════════════
   WHITE-LABEL CONFIG — Change these to rebrand the entire app
   ════════════════════════════════════════════════════════════ */
var BRAND={
  name:'APEX ONE',
  short:'A1',
  tagline:'Enterprise Operations Platform',
  copilotName:'AI Copilot',
  accessCode:''
};
/* ════════════════════════════════════════════════════════════
   SECURITY LAYER
   ════════════════════════════════════════════════════════════ */
(function(){
  if(window.self!==window.top){document.documentElement.innerHTML='';throw new Error('Frame embedding not permitted');}
})();
/* Rate limiter — sessionStorage-backed so page refresh cannot bypass it */
const RL={MAX:10,WIN:60000};
function rlOK(){
  const now=Date.now();
  let calls=JSON.parse(sessionStorage.getItem('apexone_rl')||'[]');
  calls=calls.filter(function(t){return now-t<RL.WIN;});
  if(calls.length>=RL.MAX)return false;
  calls.push(now);
  sessionStorage.setItem('apexone_rl',JSON.stringify(calls));
  return true;
}
function sanitize(s,max){
  if(typeof s!=='string')s=String(s==null?'':s);
  s=s.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi,'')
     .replace(/javascript\s*:/gi,'')
     .replace(/on\w+\s*=/gi,'')
     .replace(/<\/?(?:script|object|embed|iframe|frame|link|meta|base)[^>]*>/gi,'')
     .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,'');
  return s.slice(0,max||500).trim();
}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function maskKey(k){return(!k||k.length<10)?'':'••••••••'+k.slice(-4);}
async function sha256(str){
  var buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
}
/* PBKDF2 key-stretched PIN hash — 150k iterations makes brute force impractical */
const PIN_ITER=150000;
async function pinHash(pin,salt,iter){
  var key=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveBits']);
  var bits=await crypto.subtle.deriveBits(
    {name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode(salt),iterations:iter||PIN_ITER},key,256);
  return Array.from(new Uint8Array(bits)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
}
function randSalt(){
  var a=new Uint8Array(16);crypto.getRandomValues(a);
  return Array.from(a).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
}

/* ════ STATE ════ */
const SK='apexone_m2',AK='apexone_api',PK='apexone_pin';
var state={
  alerts:[],deals:[],contacts:[],courses:[],students:[],cart:[],ordersAcad:[],
  inventory:[],inbound:[],orders:[],locations:[],
  production:[],workorders:[],quality:[],equipment:[],
  workers:[],shifts:{},tasks:[],certificates:[],compliance:[],hrActions:[],holidays:[],
  emails:[],
  settings:{name:'Manager',dark:true},rosterOffset:0
};
function verifyState(s){
  if(typeof s!=='object'||s===null)return false;
  var required=['alerts','deals','contacts','courses','students','cart','ordersAcad','inventory','inbound','orders','locations','production','workorders','quality','equipment','workers','tasks','certificates','compliance','hrActions','holidays','emails'];
  if(!required.every(function(k){return s[k]===undefined||Array.isArray(s[k]);}))return false;
  return Array.isArray(s.alerts)&&Array.isArray(s.inventory)&&typeof s.settings==='object';
}
/* Overload guards: hard caps per collection + total-size ceiling so storage can never blow up */
const CAPS={alerts:300,deals:500,contacts:1000,courses:200,students:1000,ordersAcad:300,
  inventory:2000,inbound:500,orders:500,locations:500,production:50,workorders:500,
  quality:500,equipment:300,workers:1000,tasks:500,certificates:1000,compliance:200,
  hrActions:500,holidays:500,emails:500};
function capCollections(){
  Object.keys(CAPS).forEach(function(k){
    if(Array.isArray(state[k])&&state[k].length>CAPS[k])state[k].length=CAPS[k];
  });
}
function pruneShifts(){
  var cutoff=new Date();cutoff.setDate(cutoff.getDate()-180);
  var cut=cutoff.toISOString().slice(0,10);
  Object.keys(state.shifts).forEach(function(key){
    var d=key.slice(key.indexOf('_')+1);
    if(d<cut)delete state.shifts[key];
  });
}
let _saveTimer=null;
function save(){
  /* Debounce writes: coalesce rapid mutations into one 300ms write */
  clearTimeout(_saveTimer);
  _saveTimer=setTimeout(_flushSave,300);
}
function _flushSave(){
  try{
    capCollections();
    var json=JSON.stringify(state);
    if(json.length>4.5*1024*1024){
      pruneShifts();
      state.alerts=state.alerts.slice(0,100);
      state.ordersAcad=state.ordersAcad.slice(-50);
      json=JSON.stringify(state);
      if(json.length>4.5*1024*1024){exportData();toast('Storage full — backup downloaded automatically. Reset data to continue.');return;}
    }
    localStorage.setItem(SK,json);
  }catch(e){toast('Storage error: '+e.message);}
}
function load(){
  var raw=localStorage.getItem(SK);
  if(!raw)return;
  try{
    var p=JSON.parse(raw);
    if(!verifyState(p)){toast('Data integrity check failed — using defaults');return;}
    Object.keys(state).forEach(function(k){if(p[k]!==undefined)state[k]=p[k];});
    if(typeof state.shifts!=='object'||state.shifts===null||Array.isArray(state.shifts))state.shifts={};
    pruneShifts();
    capCollections();
    state.rosterOffset=Math.max(-52,Math.min(52,Number(state.rosterOffset)||0));
  }catch(e){toast('Could not load saved data — starting fresh');}
}
function $(id){return document.getElementById(id);}
function icon(n,c){return'<svg class="ico'+(c?' '+c:'')+'"><use href="#i-'+n+'"/></svg>';}
function uid(p){return(p||'X')+'-'+Date.now().toString(36).slice(-4).toUpperCase()+Math.random().toString(36).slice(2,5).toUpperCase();}
function today(){return new Date().toISOString().slice(0,10);}
function fmtD(d){if(!d)return'—';try{return new Date(d+'T12:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short'});}catch(e){return d;}}
function money(n){return'£'+Number(n||0).toLocaleString('en-GB');}
function haptic(){if(navigator.vibrate)try{navigator.vibrate(8);}catch(e){}}
function badge(t,c){return'<span class="badge b-'+c+'">'+esc(t)+'</span>';}
function priBadge(p){return badge(p,{critical:'danger',high:'orange',med:'info',low:'success'}[p]||'dim');}
function stBadge(s){return badge(s,{open:'warn',inprog:'info',done:'success',active:'success',inactive:'dim',leave:'warn',pending:'warn',approved:'success',rejected:'danger',pass:'success',fail:'danger',running:'success',idle:'info',maintenance:'warn',down:'danger',arrived:'info',checked:'success',complete:'success',picking:'warn',packing:'info',staging:'purple',dispatched:'success',ok:'success',due:'warn',overdue:'danger',closed:'dim',expired:'danger'}[s]||'info');}

/* ════ SEED DATA ════ */
const SEED={
alerts:[
 {id:'AL-001',msg:'Line 4 conveyor belt snapped — repair in progress',source:'Production',priority:'critical',time:'08:32',read:false},
 {id:'AL-002',msg:'Safety Gloves L out of stock — reorder required',source:'Inventory',priority:'high',time:'07:15',read:false},
 {id:'AL-003',msg:'PO-002 partial delivery received at Dock 2',source:'Receiving',priority:'med',time:'09:10',read:true},
 {id:'AL-004',msg:'Fire safety training 55% coverage — deadline 30 Jun',source:'Compliance',priority:'high',time:'06:00',read:false}],
deals:[
 {id:'DL-001',company:'Acme Corp',contact:'James Acme',value:48000,stage:'proposal',priority:'high',owner:'J. Walsh'},
 {id:'DL-002',company:'BuildRight Ltd',contact:'Sarah Build',value:22000,stage:'qualified',priority:'med',owner:'J. Walsh'},
 {id:'DL-003',company:'TechFab Inc',contact:'Tom Tech',value:95000,stage:'negotiation',priority:'high',owner:'P. Patel'},
 {id:'DL-004',company:'SafeCo',contact:'Nina Safe',value:8500,stage:'won',priority:'low',owner:'J. Walsh'},
 {id:'DL-005',company:'GlobalParts',contact:'Raj Global',value:31000,stage:'lead',priority:'med',owner:'P. Patel'}],
contacts:[
 {id:'C-001',name:'James Acme',company:'Acme Corp',role:'Procurement Dir',type:'customer',email:'james@acme.com',phone:'07700 100001'},
 {id:'C-002',name:'Sarah Build',company:'BuildRight Ltd',role:'Ops Manager',type:'customer',email:'sarah@buildright.com',phone:'07700 100002'},
 {id:'C-003',name:'Tom Tech',company:'TechFab Inc',role:'CEO',type:'customer',email:'tom@techfab.com',phone:'07700 100003'},
 {id:'C-004',name:'Mel Steel',company:'MetalCo Ltd',role:'Account Mgr',type:'supplier',email:'sales@metalco.com',phone:'07700 200001'},
 {id:'C-005',name:'Sam Safe',company:'SafetyFirst',role:'Sales Rep',type:'supplier',email:'orders@safetyfirst.com',phone:'07700 200002'}],
courses:[
 {id:'CRS-001',title:'Warehouse Operations Fundamentals',category:'Warehouse',instructor:'J. Walsh',duration:'8 weeks',price:299,level:'Beginner',modules:12,icn:'package',color:'#00c8ff'},
 {id:'CRS-002',title:'Lean Manufacturing & Six Sigma',category:'Production',instructor:'P. Patel',duration:'12 weeks',price:499,level:'Intermediate',modules:16,icn:'cpu',color:'#ff6b35'},
 {id:'CRS-003',title:'Health & Safety at Work',category:'H&S',instructor:'F. Hassan',duration:'4 weeks',price:199,level:'Beginner',modules:8,icn:'shield',color:'#00e87a'},
 {id:'CRS-004',title:'Supply Chain Management',category:'Logistics',instructor:'L. Evans',duration:'16 weeks',price:699,level:'Advanced',modules:20,icn:'truck',color:'#8b5cf6'},
 {id:'CRS-005',title:'Team Leadership Essentials',category:'Management',instructor:'J. Walsh',duration:'6 weeks',price:349,level:'Intermediate',modules:10,icn:'users',color:'#d4a23c'},
 {id:'CRS-006',title:'Quality Control & ISO 9001',category:'Quality',instructor:'S. Ali',duration:'10 weeks',price:449,level:'Intermediate',modules:14,icn:'check',color:'#fbbf24'}],
students:[
 {id:'ST-001',name:'Alex Johnson',email:'a.johnson@email.com',company:'Acme Corp',status:'active',courses:['CRS-001'],enrolled:'2026-05-10',progress:65},
 {id:'ST-002',name:'Maria Garcia',email:'m.garcia@email.com',company:'TechFab',status:'active',courses:['CRS-002'],enrolled:'2026-04-20',progress:80},
 {id:'ST-003',name:'Kwame Osei',email:'k.osei@email.com',company:'APEX',status:'active',courses:['CRS-003','CRS-002'],enrolled:'2026-03-15',progress:100},
 {id:'ST-004',name:'Priya Shah',email:'p.shah@email.com',company:'BuildRight',status:'active',courses:['CRS-004'],enrolled:'2026-04-01',progress:45},
 {id:'ST-005',name:'Tom Walker',email:'t.walker@email.com',company:'SafeCo',status:'inactive',courses:['CRS-005'],enrolled:'2026-05-22',progress:30}],
inventory:[
 {id:'SKU001',sku:'SKU001',name:'Steel Bracket 50mm',category:'Components',qty:2840,reorder:500,unit:'pcs',zone:'A',bay:'01-B-02',supplier:'MetalCo Ltd'},
 {id:'SKU002',sku:'SKU002',name:'Conveyor Belt 2m',category:'Spare Parts',qty:12,reorder:20,unit:'pcs',zone:'C',bay:'03-A-01',supplier:'BeltTech'},
 {id:'SKU003',sku:'SKU003',name:'Safety Gloves L',category:'PPE',qty:0,reorder:100,unit:'pairs',zone:'D',bay:'01-C-03',supplier:'SafetyFirst'},
 {id:'SKU004',sku:'SKU004',name:'Packing Tape 48mm',category:'Consumables',qty:540,reorder:200,unit:'rolls',zone:'B',bay:'02-D-01',supplier:'PackSupply'},
 {id:'SKU005',sku:'SKU005',name:'Motor 3-Phase 5kW',category:'Electrical',qty:4,reorder:2,unit:'pcs',zone:'E',bay:'01-A-02',supplier:'ElectroParts'},
 {id:'SKU006',sku:'SKU006',name:'Cardboard Box L',category:'Packaging',qty:180,reorder:500,unit:'pcs',zone:'B',bay:'01-B-01',supplier:'BoxWorld'},
 {id:'SKU007',sku:'SKU007',name:'Lubricant 5L',category:'Maintenance',qty:38,reorder:10,unit:'cans',zone:'F',bay:'02-A-01',supplier:'LubeCo'},
 {id:'SKU008',sku:'SKU008',name:'Barcode Labels A4',category:'Consumables',qty:1200,reorder:300,unit:'sheets',zone:'B',bay:'02-C-02',supplier:'LabelPro'}],
inbound:[
 {id:'PO-001',po:'PO-2026-001',supplier:'MetalCo Ltd',expected:'2026-06-10',arrived:'',status:'pending',lines:'SKU001 x500',value:600},
 {id:'PO-002',po:'PO-2026-002',supplier:'SafetyFirst',expected:'2026-06-09',arrived:'2026-06-09',status:'arrived',lines:'SKU003 x200',value:700},
 {id:'PO-003',po:'PO-2026-003',supplier:'PackSupply',expected:'2026-06-08',arrived:'2026-06-08',status:'checked',lines:'SKU004 x1000',value:850}],
orders:[
 {id:'SO-001',customer:'Acme Corp',carrier:'DHL',due:'2026-06-09',status:'picking',priority:'high',lines:'SKU001 x100'},
 {id:'SO-002',customer:'BuildRight Ltd',carrier:'FedEx',due:'2026-06-10',status:'packing',priority:'med',lines:'SKU004 x50'},
 {id:'SO-003',customer:'TechFab Inc',carrier:'UPS',due:'2026-06-08',status:'dispatched',priority:'high',lines:'SKU005 x2'},
 {id:'SO-004',customer:'SafeCo',carrier:'Royal Mail',due:'2026-06-13',status:'staging',priority:'low',lines:'SKU003 x50'}],
locations:[
 {id:'A-01-01',zone:'A',type:'Pallet Racking',capacity:120,used:82},
 {id:'A-01-02',zone:'A',type:'Pallet Racking',capacity:120,used:64},
 {id:'A-02-01',zone:'A',type:'Bulk Floor',capacity:200,used:140},
 {id:'B-01-01',zone:'B',type:'Shelving',capacity:80,used:71},
 {id:'B-01-02',zone:'B',type:'Shelving',capacity:80,used:75},
 {id:'B-02-01',zone:'B',type:'Pallet Racking',capacity:150,used:96},
 {id:'C-01-01',zone:'C',type:'Bin',capacity:60,used:22},
 {id:'C-02-01',zone:'C',type:'Bin',capacity:60,used:31},
 {id:'D-01-01',zone:'D',type:'Shelving',capacity:90,used:49},
 {id:'E-01-01',zone:'E',type:'Cold Store',capacity:40,used:12}],
production:[
 {id:'L1',name:'Assembly Line 1',product:'Steel Brackets',status:'running',target:300,actual:240,uptime:92,oee:82,good:2840,total:2880,operator:'T. Walsh'},
 {id:'L2',name:'Assembly Line 2',product:'Motor Housings',status:'idle',target:180,actual:0,uptime:60,oee:0,good:0,total:0,operator:'—'},
 {id:'L3',name:'Packaging Line A',product:'Mixed SKUs',status:'running',target:450,actual:420,uptime:97,oee:91,good:7180,total:7240,operator:'R. Patel'},
 {id:'L4',name:'Packaging Line B',product:'Large Boxes',status:'down',target:200,actual:0,uptime:20,oee:0,good:0,total:0,operator:'—'}],
workorders:[
 {id:'WO-001',product:'Steel Bracket 50mm',line:'Assembly Line 1',qty:5000,completed:2840,start:'2026-06-05',end:'2026-06-12',assignee:'T. Walsh',status:'running',priority:'high'},
 {id:'WO-002',product:'Packaging Run #47',line:'Packaging Line A',qty:10000,completed:7200,start:'2026-06-06',end:'2026-06-09',assignee:'R. Patel',status:'running',priority:'high'},
 {id:'WO-003',product:'Motor Housing A',line:'Assembly Line 2',qty:200,completed:0,start:'2026-06-10',end:'2026-06-14',assignee:'K. Osei',status:'planned',priority:'med'}],
quality:[
 {id:'QC-001',product:'Safety Gloves batch',line:'Inbound Dock 2',inspected:200,defects:5,result:'pass',date:'2026-06-09',inspector:'J. Brown'},
 {id:'QC-002',product:'Steel Bracket 50mm',line:'Assembly Line 1',inspected:500,defects:2,result:'pass',date:'2026-06-09',inspector:'M. Singh'},
 {id:'QC-003',product:'Packaging Run #46',line:'Packaging Line A',inspected:1000,defects:60,result:'fail',date:'2026-06-08',inspector:'S. Ali'}],
equipment:[
 {id:'EQ-001',name:'Forklift FLK-01',type:'Forklift',location:'Zone A',status:'running',lastService:'2026-04-10',nextService:'2026-07-10',hours:1240},
 {id:'EQ-002',name:'Conveyor CV-01',type:'Conveyor',location:'Line 1',status:'running',lastService:'2026-05-01',nextService:'2026-08-01',hours:3400},
 {id:'EQ-003',name:'Conveyor CV-02',type:'Conveyor',location:'Line 4',status:'down',lastService:'2026-02-20',nextService:'2026-06-12',hours:5100},
 {id:'EQ-004',name:'Wrapper WRP-01',type:'Pallet Wrapper',location:'Dispatch',status:'maintenance',lastService:'2026-06-01',nextService:'2026-09-01',hours:870}],
workers:[
 {id:'W001',name:'Jordan Walsh',role:'Warehouse Manager',dept:'Management',zone:'All',phone:'07700 900001',email:'j.walsh@apexone.com',status:'active',skills:['WMS','Forklift','Leadership'],cert:'IOSH',hire:'2019-03-01'},
 {id:'W002',name:'Priya Patel',role:'Production Supervisor',dept:'Production',zone:'Lines 1-3',phone:'07700 900002',email:'p.patel@apexone.com',status:'active',skills:['Lean','QC','Team Lead'],cert:'Lean Six Sigma',hire:'2020-07-15'},
 {id:'W003',name:'Kwame Osei',role:'Fabrication Lead',dept:'Production',zone:'Line 5',phone:'07700 900003',email:'k.osei@apexone.com',status:'active',skills:['CNC','Welding'],cert:'City & Guilds L3',hire:'2021-02-10'},
 {id:'W004',name:'Sarah Ali',role:'QC Inspector',dept:'Quality',zone:'All Lines',phone:'07700 900004',email:'s.ali@apexone.com',status:'active',skills:['ISO 9001','Inspection'],cert:'ISO 9001 Auditor',hire:'2022-01-18'},
 {id:'W005',name:'Marcus Brown',role:'Forklift Operator',dept:'Warehouse',zone:'Zone A-B',phone:'07700 900005',email:'m.brown@apexone.com',status:'active',skills:['Counterbalance','Reach Truck'],cert:'RTITB Forklift',hire:'2021-09-01'},
 {id:'W006',name:'Nina Torres',role:'Picking Operative',dept:'Warehouse',zone:'Zone B',phone:'07700 900006',email:'n.torres@apexone.com',status:'active',skills:['Pick & Pack','RF Scanner'],cert:'',hire:'2023-03-14'},
 {id:'W007',name:'Raj Mehta',role:'Maintenance Engineer',dept:'Maintenance',zone:'All',phone:'07700 900007',email:'r.mehta@apexone.com',status:'active',skills:['Hydraulics','Electrical','PLC'],cert:'C&G Electrical',hire:'2018-06-05'},
 {id:'W008',name:'Lucy Evans',role:'Despatch Coordinator',dept:'Despatch',zone:'Dispatch Bay',phone:'07700 900008',email:'l.evans@apexone.com',status:'active',skills:['TMS','Carrier Mgmt'],cert:'',hire:'2020-11-22'},
 {id:'W009',name:'Fatima Hassan',role:'H&S Officer',dept:'H&S',zone:'All',phone:'07700 900009',email:'f.hassan@apexone.com',status:'active',skills:['NEBOSH','Risk Assessment','First Aid'],cert:'NEBOSH General',hire:'2021-04-19'},
 {id:'W010',name:'Tom Clarke',role:'Receiving Clerk',dept:'Receiving',zone:'Dock',phone:'07700 900010',email:'t.clarke@apexone.com',status:'leave',skills:['GRN','Goods Inward'],cert:'',hire:'2022-08-08'}],
tasks:[
 {id:'T001',title:'Repair Line 4 conveyor belt',desc:'CV-02 belt snapped. Maintenance team assigned.',priority:'critical',status:'inprog',due:'2026-06-09',assignee:'Raj Mehta',dept:'Maintenance'},
 {id:'T002',title:'Reorder Safety Gloves L',desc:'Stock at zero. Raise PO immediately.',priority:'high',status:'open',due:'2026-06-09',assignee:'Tom Clarke',dept:'Receiving'},
 {id:'T003',title:'Complete WO-002 packaging run',desc:'7200/10000 complete. Push to finish today.',priority:'high',status:'inprog',due:'2026-06-09',assignee:'Priya Patel',dept:'Production'},
 {id:'T004',title:'Schedule forklift service',desc:'FLK-01 service due in 30 days.',priority:'med',status:'open',due:'2026-06-20',assignee:'Jordan Walsh',dept:'Management'},
 {id:'T005',title:'Monthly safety walkthrough',desc:'NEBOSH walkthrough all zones.',priority:'med',status:'open',due:'2026-06-12',assignee:'Fatima Hassan',dept:'H&S'},
 {id:'T006',title:'Refresh Lean course materials',desc:'Update module content for Academy.',priority:'low',status:'done',due:'2026-06-07',assignee:'Priya Patel',dept:'Academy'}],
certificates:[
 {id:'CERT-001',student:'Alex Johnson',course:'Warehouse Operations Fundamentals',issued:'2026-06-01',expires:'2029-06-01',ref:'AJ-WH-001',status:'active'},
 {id:'CERT-002',student:'Kwame Osei',course:'Health & Safety at Work',issued:'2026-05-15',expires:'2029-05-15',ref:'KO-HS-001',status:'active'},
 {id:'CERT-003',student:'Maria Garcia',course:'Lean Manufacturing & Six Sigma',issued:'2026-06-05',expires:'2029-06-05',ref:'MG-LM-001',status:'active'}],
compliance:[
 {id:'COMP-001',title:'NEBOSH General Certificate',dept:'All',dueDate:'2026-09-01',mandatory:'yes',renewEvery:36,status:'ok',coverage:90},
 {id:'COMP-002',title:'Manual Handling Training',dept:'Warehouse',dueDate:'2026-07-15',mandatory:'yes',renewEvery:12,status:'due',coverage:72},
 {id:'COMP-003',title:'Fire Safety Awareness',dept:'All',dueDate:'2026-06-30',mandatory:'yes',renewEvery:12,status:'overdue',coverage:55},
 {id:'COMP-004',title:'COSHH Awareness',dept:'Maintenance',dueDate:'2026-08-01',mandatory:'yes',renewEvery:24,status:'ok',coverage:100},
 {id:'COMP-005',title:'Forklift Refresher',dept:'Warehouse',dueDate:'2026-12-01',mandatory:'no',renewEvery:36,status:'ok',coverage:80}],
hrActions:[
 {id:'HR-001',employee:'Kwame Osei',type:'commendation',date:'2026-05-20',desc:'Zero defects on Line 5 for 30 days.',by:'Jordan Walsh',status:'closed'},
 {id:'HR-002',employee:'Tom Clarke',type:'informal',date:'2026-05-28',desc:'Absence discussion — 3 unplanned absences in 8 weeks.',by:'Jordan Walsh',status:'open'},
 {id:'HR-003',employee:'Nina Torres',type:'review',date:'2026-06-01',desc:'6-month probation review. Meets expectations.',by:'Priya Patel',status:'closed'},
 {id:'HR-004',employee:'Marcus Brown',type:'training',date:'2026-06-09',desc:'Reach Truck refresher after near-miss.',by:'Fatima Hassan',status:'open'}],
holidays:[
 {id:'HOL-001',employee:'Tom Clarke',type:'annual',from:'2026-06-16',to:'2026-06-20',days:5,status:'approved',note:'Summer holiday'},
 {id:'HOL-002',employee:'Nina Torres',type:'annual',from:'2026-07-07',to:'2026-07-11',days:5,status:'pending',note:''},
 {id:'HOL-003',employee:'Marcus Brown',type:'sick',from:'2026-06-02',to:'2026-06-03',days:2,status:'approved',note:'Self-certified'},
 {id:'HOL-004',employee:'Fatima Hassan',type:'annual',from:'2026-08-04',to:'2026-08-15',days:10,status:'approved',note:'Family holiday'},
 {id:'HOL-005',employee:'— Public Holiday',type:'public',from:'2026-12-25',to:'2026-12-25',days:1,status:'approved',note:'Christmas Day'}],
emails:[
 {id:'EM-001',folder:'inbox',from:'james@acme.com',fromName:'James Acme',to:'manager@apex.com',subject:'RE: Proposal for Q3 Supply Contract',body:'Hi,\n\nThank you for sending over the proposal. We\'ve reviewed the terms and are very interested in moving forward.\n\nCould we arrange a call this week to discuss the pricing on the Steel Bracket 50mm order? We\'re looking at volumes of 500–1,000 units per month.\n\nBest regards,\nJames Acme\nProcurement Director, Acme Corp',date:'2026-06-16T09:15:00',read:false,priority:'high'},
 {id:'EM-002',folder:'inbox',from:'orders@safetyfirst.com',fromName:'SafetyFirst Dispatch',to:'manager@apex.com',subject:'Delivery Confirmation — PO-2026-002',body:'Dear Customer,\n\nWe are writing to confirm that your order PO-2026-002 for Safety Gloves L (200 pairs) has been dispatched today.\n\nExpected Delivery: 09 June 2026\nTracking Reference: SF-892341\nCarrier: Royal Mail Tracked 24\n\nKind regards,\nSafetyFirst Dispatch Team',date:'2026-06-15T14:22:00',read:true,priority:'med'},
 {id:'EM-003',folder:'inbox',from:'sarah@buildright.com',fromName:'Sarah Build',to:'manager@apex.com',subject:'Urgent Order Enquiry — Packing Tape',body:'Hello,\n\nWe need to place an urgent order for Packing Tape 48mm — approximately 100 rolls needed by Friday.\n\nCan you confirm availability, unit price, and lead time?\n\nMany thanks,\nSarah Build\nOps Manager, BuildRight Ltd',date:'2026-06-15T11:05:00',read:false,priority:'high'},
 {id:'EM-004',folder:'inbox',from:'tom@techfab.com',fromName:'Tom Tech',to:'manager@apex.com',subject:'Invoice Query — SO-003',body:'Hi,\n\nI\'m writing regarding invoice INV-SO-003 for the Motor 3-Phase 5kW units delivered last week.\n\nCould you confirm the VAT breakdown and send a PDF copy? Our finance team needs this for month-end processing.\n\nThanks,\nTom\nCEO, TechFab Inc',date:'2026-06-14T16:00:00',read:false,priority:'med'},
 {id:'EM-005',folder:'sent',from:'manager@apex.com',fromName:'Manager',to:'sales@metalco.com',subject:'Purchase Order — PO-2026-001 (Steel Bracket 50mm x500)',body:'Dear MetalCo,\n\nPlease find our Purchase Order PO-2026-001 below:\n\nItem: Steel Bracket 50mm\nQuantity: 500 pcs\nUnit Price: £1.20\nTotal Value: £600.00\nDelivery Required By: 10 June 2026\nDelivery Address: APEX ONE Warehouse, Dock 1\n\nPlease confirm receipt and expected delivery date at your earliest convenience.\n\nKind regards,\nManager\nAPEX ONE Procurement',date:'2026-06-14T10:30:00',read:true,priority:'med'},
 {id:'EM-006',folder:'sent',from:'manager@apex.com',fromName:'Manager',to:'tom@techfab.com',subject:'Your Order SO-003 Has Been Dispatched',body:'Dear Tom,\n\nYour order SO-003 (Motor 3-Phase 5kW x2) has been dispatched via UPS.\n\nTracking Reference: 1Z999AA10123456784\nExpected Delivery: 08 June 2026\n\nPlease do not hesitate to contact us if you have any queries regarding your order.\n\nBest regards,\nManager\nAPEX ONE',date:'2026-06-13T15:45:00',read:true,priority:'low'}
]
};
function seedIfEmpty(){
  if(state.inventory.length||state.workers.length)return;
  Object.keys(SEED).forEach(function(k){state[k]=JSON.parse(JSON.stringify(SEED[k]));});
  save();
}

/* ════ MODULE REGISTRY ════ */
const MODULES=[
 {id:'home',l:'Home',i:'home',s:'Command'},
 {id:'alerts',l:'Alerts',i:'bell',s:'Command'},
 {id:'tasks',l:'Tasks',i:'check',s:'Command'},
 {id:'analytics',l:'Analytics',i:'chart',s:'Command'},
 {id:'crm',l:'CRM Pipeline',i:'briefcase',s:'Business'},
 {id:'contacts',l:'Contacts',i:'user',s:'Business'},
 {id:'email',l:'Email',i:'mail',s:'Business'},
 {id:'courses',l:'Courses',i:'book',s:'Academy'},
 {id:'students',l:'Students',i:'cap',s:'Academy'},
 {id:'store',l:'Store',i:'cart',s:'Academy'},
 {id:'leaderboard',l:'Leaderboard',i:'award',s:'Academy'},
 {id:'certificates',l:'Certificates',i:'star',s:'Academy'},
 {id:'inventory',l:'Inventory',i:'package',s:'Warehouse'},
 {id:'inbound',l:'Inbound',i:'truck',s:'Warehouse'},
 {id:'outbound',l:'Outbound',i:'send',s:'Warehouse'},
 {id:'locations',l:'Locations',i:'map',s:'Warehouse'},
 {id:'production',l:'Lines',i:'cpu',s:'Production'},
 {id:'workorders',l:'Work Orders',i:'clipboard',s:'Production'},
 {id:'quality',l:'Quality',i:'check',s:'Production'},
 {id:'equipment',l:'Equipment',i:'tool',s:'Production'},
 {id:'workforce',l:'Workforce',i:'users',s:'People'},
 {id:'roster',l:'Roster',i:'calendar',s:'People'},
 {id:'holidays',l:'Holidays',i:'umbrella',s:'People'},
 {id:'hr',l:'HR Log',i:'file',s:'People'},
 {id:'compliance',l:'Compliance',i:'shield',s:'People'},
 {id:'settings',l:'Settings',i:'gear',s:'System'}
];

/* ════ ROUTER ════ */
let current='home';
let UI={search:{},filter:{}};
let PAGES={};
function navigate(page){
  if(!PAGES[page])page='home';
  if(location.hash!=='#'+page){location.hash=page;return;}
  current=page;
  haptic();
  closeAllSheets();
  var mod=MODULES.find(function(m){return m.id===page;});
  $('barTitle').textContent=mod?mod.l==='Home'?BRAND.name:mod.l:BRAND.name;
  PAGES[page]();
  window.scrollTo(0,0);
  document.querySelectorAll('.nav-tab').forEach(function(t){
    var n=t.getAttribute('data-nav');
    t.classList.toggle('active',n===page||(n==='modules'&&['home','alerts'].indexOf(page)<0));
  });
  document.querySelectorAll('.side-link').forEach(function(l){
    l.classList.toggle('active',l.getAttribute('data-side')===page);
  });
  updateBadges();
}
function a11yFix(){
  document.querySelectorAll('[onclick]').forEach(function(el){
    if(el.tagName==='BUTTON'||el.tagName==='A'||el.tagName==='INPUT'||el.tagName==='SELECT'||el.tagName==='TEXTAREA')return;
    if(!el.hasAttribute('tabindex'))el.setAttribute('tabindex','0');
    if(!el.getAttribute('role'))el.setAttribute('role','button');
  });
}
function rerender(){if(PAGES[current])PAGES[current]();updateBadges();a11yFix();}
function updateBadges(){
  var unread=state.alerts.filter(function(a){return!a.read;}).length;
  var b=$('alertBadge');
  b.style.display=unread?'flex':'none';b.textContent=unread;
  var cartN=state.cart.reduce(function(s,c){return s+c.qty;},0);
  var mb=document.querySelector('[data-mod-badge="store"]');
  if(mb){mb.style.display=cartN?'flex':'none';mb.textContent=cartN;}
  var unreadEmail=Array.isArray(state.emails)?state.emails.filter(function(e){return e.folder==='inbox'&&!e.read;}).length:0;
  var eb=$('sideEmailBadge');
  if(eb){eb.style.display=unreadEmail?'flex':'none';eb.textContent=unreadEmail;}
}

/* ════ GENERIC LIST PAGE ════ */
function pageHead(title,iconName,sub,btnHtml){
  return'<div class="page-head"><div class="page-title">'+icon(iconName)+esc(title)+'</div>'+(btnHtml||'')+'<div class="page-sub">'+sub+'</div></div>';
}
function listPage(o){
  var q=(UI.search[o.id]||'').toLowerCase();
  var f=UI.filter[o.id]||'all';
  var list=state[o.col].filter(function(it){
    if(q&&!o.searchText(it).toLowerCase().includes(q))return false;
    if(f!=='all'&&o.filterFn&&!o.filterFn(it,f))return false;
    return true;
  });
  if(o.sort)list=list.slice().sort(o.sort);
  var chips=o.filters?'<div class="chips">'+o.filters.map(function(c){
    return'<button class="chip'+(f===c.v?' active':'')+'" onclick="setFilter(\''+o.id+'\',\''+c.v+'\')">'+esc(c.l)+'</button>';
  }).join('')+'</div>':'';
  var addBtn=o.form?'<button class="btn '+(o.gold?'btn-gold':'btn-primary')+' btn-sm" onclick="openForm(\''+o.form+'\')">'+icon('plus','sm')+' New</button>':'';
  $('view').innerHTML=pageHead(o.title,o.icon,list.length+' of '+state[o.col].length+' shown',addBtn)
    +'<div class="searchbar">'+icon('search')+'<input value="'+esc(UI.search[o.id]||'')+'" placeholder="Search '+esc(o.title.toLowerCase())+'…" aria-label="Search '+esc(o.title.toLowerCase())+'" oninput="setSearch(\''+o.id+'\',this.value)"></div>'
    +chips
    +(list.length?list.map(o.card).join(''):'<div class="empty">'+icon(o.icon)+'Nothing here yet</div>');
}
var _searchDeb=null;
function setSearch(id,v){UI.search[id]=v;clearTimeout(_searchDeb);_searchDeb=setTimeout(function(){rerender();var nb=document.querySelector('.searchbar input');if(nb){nb.focus();var l=nb.value.length;nb.setSelectionRange(l,l);}},150);}
function setFilter(id,v){UI.filter[id]=v;haptic();rerender();}
function actBtns(form,col,id,extra){
  return'<div class="row-acts">'+(extra||'')
    +'<button class="btn btn-sec btn-sm" onclick="openForm(\''+form+'\',\''+id+'\')">'+icon('edit','sm')+' Edit</button>'
    +'<button class="btn btn-danger btn-sm" onclick="delItem(\''+col+'\',\''+id+'\')">'+icon('trash','sm')+'</button></div>';
}

/* ════ DELETE + UNDO ════ */
/* Bounded undo stack — max 5 entries so rapid deletes don't silently lose earlier undo targets */
var UNDO_STACK=[];
var UNDO_MAX=5;
function delItem(col,id){
  var idx=state[col].findIndex(function(x){return x.id===id;});
  if(idx<0)return;
  UNDO_STACK.unshift({col:col,item:state[col][idx],idx:idx});
  if(UNDO_STACK.length>UNDO_MAX)UNDO_STACK.length=UNDO_MAX;
  state[col].splice(idx,1);
  save();haptic();rerender();
  var snap=UNDO_STACK[0];
  toast('Deleted','Undo',function(){
    if(!snap)return;
    state[snap.col].splice(Math.min(snap.idx,state[snap.col].length),0,snap.item);
    UNDO_STACK=UNDO_STACK.filter(function(u){return u!==snap;});
    save();rerender();
  });
}

/* ════ TOAST ════ */
function toast(msg,actionLabel,actionFn){
  var t=document.createElement('div');
  t.className='toast';
  /* cap visible toasts so rapid actions can never flood the screen */
  var box=$('toasts');
  while(box.children.length>=3)box.firstChild.remove();
  t.innerHTML='<span>'+esc(msg)+'</span>';
  if(actionLabel){
    var b=document.createElement('button');
    b.textContent=actionLabel;
    b.onclick=function(){actionFn();t.remove();};
    t.appendChild(b);
  }
  $('toasts').appendChild(t);
  setTimeout(function(){t.style.opacity='0';t.style.transition='opacity .3s';setTimeout(function(){t.remove();},320);},3200);
}

/* ════ SHEETS ════ */
let _sheetPrevFocus=null;
let _trapHandler=null;
function openSheet(id){
  closeAllSheets(true);
  $('veil').classList.add('open');
  var sheet=$(id);
  sheet.classList.add('open');
  haptic();
  _sheetPrevFocus=document.activeElement;
  /* Focus first interactive element after animation */
  setTimeout(function(){
    var focusable=sheet.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
    if(focusable.length)focusable[0].focus();
    /* Trap focus inside sheet */
    if(_trapHandler)document.removeEventListener('keydown',_trapHandler);
    _trapHandler=function(e){
      if(e.key!=='Tab')return;
      var els=Array.from(sheet.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'));
      if(!els.length)return;
      var first=els[0],last=els[els.length-1];
      if(e.shiftKey){if(document.activeElement===first){e.preventDefault();last.focus();}}
      else{if(document.activeElement===last){e.preventDefault();first.focus();}}
    };
    document.addEventListener('keydown',_trapHandler);
    /* Close on Escape */
    sheet._escHandler=function(e){if(e.key==='Escape')closeAllSheets();};
    document.addEventListener('keydown',sheet._escHandler);
  },50);
}
function closeAllSheets(keepVeil){
  document.querySelectorAll('.sheet').forEach(function(s){
    if(s._escHandler){document.removeEventListener('keydown',s._escHandler);s._escHandler=null;}
    s.classList.remove('open');
  });
  if(!keepVeil)$('veil').classList.remove('open');
  if(_trapHandler){document.removeEventListener('keydown',_trapHandler);_trapHandler=null;}
  if(_sheetPrevFocus){try{_sheetPrevFocus.focus();}catch(e){}  _sheetPrevFocus=null;}
}

/* ════════════════════════════════════════════
   PAGE: HOME / COMMAND CENTRE
   ════════════════════════════════════════════ */
PAGES.home=function(){
  var crit=state.alerts.filter(function(a){return!a.read;}).length;
  var low=state.inventory.filter(function(i){return i.qty<=i.reorder;}).length;
  var pipeline=state.deals.filter(function(d){return d.stage!=='won'&&d.stage!=='lost';}).reduce(function(s,d){return s+d.value;},0);
  var oees=state.production.filter(function(p){return p.status==='running';}).map(function(p){return p.oee;});
  var avgOee=oees.length?Math.round(oees.reduce(function(a,b){return a+b;},0)/oees.length):0;
  var openTasks=state.tasks.filter(function(t){return t.status!=='done';}).length;
  var activeWO=state.workorders.filter(function(w){return w.status==='running';}).length;
  var pendingHol=state.holidays.filter(function(h){return h.status==='pending';}).length;
  var h=new Date().getHours();
  var greet=h<12?'Good morning':h<18?'Good afternoon':'Good evening';
  var kpis=[
    {v:crit,l:'Unread Alerts',s:'tap to triage',c:'var(--red)',go:'alerts'},
    {v:money(pipeline),l:'Pipeline',s:state.deals.length+' deals',c:'var(--gold)',go:'crm'},
    {v:avgOee+'%',l:'Avg OEE',s:'running lines',c:'var(--cyan)',go:'production'},
    {v:low,l:'Low Stock',s:'need reorder',c:'var(--orange)',go:'inventory'},
    {v:activeWO,l:'Active WOs',s:'in production',c:'var(--green)',go:'workorders'},
    {v:state.students.length,l:'Students',s:'enrolled',c:'var(--purple)',go:'students'},
    {v:openTasks,l:'Open Tasks',s:'pending',c:'var(--amber)',go:'tasks'},
    {v:pendingHol,l:'Leave Requests',s:'awaiting approval',c:'var(--blue)',go:'holidays'}
  ];
  var alertsPrev=state.alerts.filter(function(a){return!a.read;}).slice(0,3).map(function(a){
    return'<div class="row" style="margin-bottom:7px" onclick="navigate(\'alerts\')"><div class="row-top"><div class="row-title" style="font-size:.8rem">'+esc(a.msg)+'</div>'+priBadge(a.priority)+'</div></div>';
  }).join('')||'<div class="empty" style="padding:14px">All clear — no unread alerts</div>';
  var taskPrev=state.tasks.filter(function(t){return t.status!=='done';}).slice(0,4).map(function(t){
    return'<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border2)"><div style="min-width:0"><div style="font-weight:700;font-size:.8rem;">'+esc(t.title)+'</div><div class="c-muted fs-xs">'+esc(t.assignee)+' · due '+fmtD(t.due)+'</div></div>'+stBadge(t.status)+'</div>';
  }).join('')||'<div class="empty" style="padding:14px">No open tasks</div>';
  var lines=state.production.map(function(p){
    var c=p.oee>=75?'var(--green)':p.oee>=50?'var(--amber)':'var(--red)';
    return'<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border2)" onclick="navigate(\'production\')"><div class="f1 min-w0"><div style="font-weight:700;font-size:.8rem">'+esc(p.name)+'</div><div style="font-size:.66rem;color:var(--muted)">'+esc(p.product)+'</div></div><span class="mono" style="color:'+c+';font-weight:700">'+p.oee+'%</span>'+stBadge(p.status)+'</div>';
  }).join('');
  $('view').innerHTML=
    '<div class="page-head"><div><div class="page-title">'+esc(greet)+', '+esc(state.settings.name)+'</div><div class="page-sub" id="liveDate"></div></div></div>'
    +'<div class="kpi-grid">'+kpis.map(function(k){return'<div class="kpi" style="border-top-color:'+k.c+'" onclick="navigate(\''+k.go+'\')"><div class="kpi-val" style="color:'+k.c+'">'+k.v+'</div><div class="kpi-lbl">'+k.l+'</div><div class="kpi-sub">'+k.s+'</div></div>';}).join('')+'</div>'
    +'<div class="two-col">'
    +'<div class="card"><div class="card-title">'+icon('bell','sm')+' Live Alerts <button class="btn btn-sec btn-sm" onclick="navigate(\'alerts\')">All</button></div>'+alertsPrev+'</div>'
    +'<div class="card"><div class="card-title">'+icon('check','sm')+' Open Tasks <button class="btn btn-sec btn-sm" onclick="navigate(\'tasks\')">All</button></div>'+taskPrev+'</div>'
    +'<div class="card"><div class="card-title">'+icon('cpu','sm')+' Production Lines <span class="badge b-success">LIVE</span></div>'+lines+'</div>'
    +'<div class="card"><div class="card-title">'+icon('zap','sm')+' Quick Actions</div><div class="quick-grid">'
      +'<button class="btn btn-sec" onclick="openForm(\'tasks\')">'+icon('plus','sm')+' Task</button>'
      +'<button class="btn btn-sec" onclick="openForm(\'deals\')">'+icon('plus','sm')+' Deal</button>'
      +'<button class="btn btn-sec" onclick="openForm(\'inventory\')">'+icon('plus','sm')+' SKU</button>'
      +'<button class="btn btn-sec" onclick="openForm(\'holidays\')">'+icon('plus','sm')+' Leave</button>'
    +'</div></div></div>';
  var d=$('liveDate');
  if(d)d.textContent=new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
};

/* ════ PAGE: ALERTS ════ */
PAGES.alerts=function(){
  listPage({
    id:'alerts',col:'alerts',title:'Alerts',icon:'bell',form:'alerts',
    searchText:function(a){return a.msg+' '+a.source;},
    filters:[{v:'all',l:'All'},{v:'unread',l:'Unread'},{v:'critical',l:'Critical'},{v:'high',l:'High'}],
    filterFn:function(a,f){return f==='unread'?!a.read:a.priority===f;},
    card:function(a){
      return'<div class="row" style="'+(a.read?'opacity:.65':'')+'"><div class="row-top"><div class="row-title">'+esc(a.msg)+'</div>'+priBadge(a.priority)+'</div>'
      +'<div class="row-meta"><span class="badge b-dim">'+esc(a.source)+'</span><span class="badge b-dim mono">'+esc(a.time)+'</span>'+(a.read?badge('read','dim'):badge('unread','warn'))+'</div>'
      +actBtns('alerts','alerts',a.id,(!a.read?'<button class="btn btn-success btn-sm" onclick="ackAlert(\''+a.id+'\')">'+icon('check','sm')+' Read</button>':''))+'</div>';
    }
  });
  var head=document.querySelector('.page-head');
  if(state.alerts.some(function(a){return!a.read;})){
    var b=document.createElement('button');
    b.className='btn btn-sec btn-sm';b.innerHTML=icon('check','sm')+' Mark all read';
    b.onclick=markAllRead;
    head.insertBefore(b,head.lastElementChild);
  }
};
function ackAlert(id){var a=state.alerts.find(function(x){return x.id===id;});if(a){a.read=true;save();rerender();}}
function markAllRead(){state.alerts.forEach(function(a){a.read=true;});save();rerender();toast('All alerts marked read');}

/* ════ PAGE: TASKS ════ */
PAGES.tasks=function(){
  listPage({
    id:'tasks',col:'tasks',title:'Tasks',icon:'check',form:'tasks',
    searchText:function(t){return t.title+' '+t.desc+' '+t.assignee+' '+t.dept;},
    filters:[{v:'all',l:'All'},{v:'open',l:'Open'},{v:'inprog',l:'In Progress'},{v:'done',l:'Done'},{v:'overdue',l:'Overdue'}],
    filterFn:function(t,f){return f==='overdue'?(t.due<today()&&t.status!=='done'):t.status===f;},
    sort:function(a,b){var o={critical:0,high:1,med:2,low:3};return(o[a.priority]||9)-(o[b.priority]||9);},
    card:function(t){
      var late=t.due<today()&&t.status!=='done';
      return'<div class="row"><div class="row-top"><div class="row-title">'+esc(t.title)+'</div>'+priBadge(t.priority)+'</div>'
      +'<div class="row-sub">'+esc(t.desc)+'</div>'
      +'<div class="row-meta">'+stBadge(t.status)+'<span class="badge b-dim">'+esc(t.assignee)+'</span><span class="badge '+(late?'b-danger':'b-dim')+'">due '+fmtD(t.due)+'</span></div>'
      +actBtns('tasks','tasks',t.id,'<button class="btn btn-success btn-sm" onclick="cycleTask(\''+t.id+'\')">'+icon('refresh','sm')+' '+(t.status==='open'?'Start':t.status==='inprog'?'Done':'Reopen')+'</button>')+'</div>';
    }
  });
};
function cycleTask(id){
  var t=state.tasks.find(function(x){return x.id===id;});
  if(!t)return;
  t.status={open:'inprog',inprog:'done',done:'open'}[t.status]||'open';
  save();haptic();rerender();
}

/* ════ PAGE: CRM BOARD ════ */
const CRM_STAGES=['lead','qualified','proposal','negotiation','won','lost'];
var CRM_L={lead:'Lead',qualified:'Qualified',proposal:'Proposal',negotiation:'Negotiation',won:'Won',lost:'Lost'};
var _drag=null;
function boardPage(o){
  var cols=o.stages.map(function(st){
    var items=state[o.col].filter(function(x){return x[o.stageKey]===st;});
    var cards=items.map(function(it){
      var si=o.stages.indexOf(st);
      return'<div class="b-card" draggable="true" ondragstart="_drag={col:\''+o.col+'\',id:\''+it.id+'\',key:\''+o.stageKey+'\'}" ondragend="this.classList.remove(\'dragging\')">'
        +o.cardBody(it)
        +'<div class="row-acts" style="justify-content:space-between">'
        +'<span><button class="btn btn-icon btn-sm" '+(si<=0?'disabled style="opacity:.3"':'onclick="moveStage(\''+o.col+'\',\''+it.id+'\',\''+o.stageKey+'\',-1)"')+'>'+icon('left','sm')+'</button> '
        +'<button class="btn btn-icon btn-sm" '+(si>=o.stages.length-1?'disabled style="opacity:.3"':'onclick="moveStage(\''+o.col+'\',\''+it.id+'\',\''+o.stageKey+'\',1)"')+'>'+icon('right','sm')+'</button></span>'
        +'<span>'+(o.form?'<button class="btn btn-sec btn-sm" onclick="openForm(\''+o.form+'\',\''+it.id+'\')">'+icon('edit','sm')+'</button> ':'')
        +'<button class="btn btn-danger btn-sm" onclick="delItem(\''+o.col+'\',\''+it.id+'\')">'+icon('trash','sm')+'</button></span></div></div>';
    }).join('');
    return'<div class="b-col"><div class="b-col-h"><span>'+esc(o.labels[st])+'</span><span class="c-muted fs-xs">'+(o.colMeta?o.colMeta(items):items.length)+'</span></div>'
      +'<div class="b-col-body" ondragover="event.preventDefault();this.classList.add(\'drag-over\')" ondragleave="this.classList.remove(\'drag-over\')" ondrop="dropStage(event,\''+st+'\')">'+(cards||'<div class="empty" style="padding:14px">Empty</div>')+'</div></div>';
  }).join('');
  $('view').innerHTML=pageHead(o.title,o.icon,o.sub,o.form?'<button class="btn btn-primary btn-sm" onclick="openForm(\''+o.form+'\')">'+icon('plus','sm')+' New</button>':'')
    +'<div style="font-size:.68rem;color:var(--dim);margin-bottom:8px">'+icon('left','sm')+' Swipe columns · use arrows to move cards '+icon('right','sm')+'</div>'
    +'<div class="board">'+cols+'</div>';
}
function moveStage(col,id,key,dir){
  var stages=col==='deals'?CRM_STAGES:ORD_STAGES;
  var it=state[col].find(function(x){return x.id===id;});
  if(!it)return;
  var i=stages.indexOf(it[key])+dir;
  if(i<0||i>=stages.length)return;
  it[key]=stages[i];
  save();haptic();rerender();
}
function dropStage(ev,st){
  ev.preventDefault();
  ev.currentTarget.classList.remove('drag-over');
  if(!_drag)return;
  var it=state[_drag.col].find(function(x){return x.id===_drag.id;});
  if(it){it[_drag.key]=st;save();rerender();}
  _drag=null;
}
PAGES.crm=function(){
  var total=state.deals.reduce(function(s,d){return s+d.value;},0);
  boardPage({
    col:'deals',stageKey:'stage',stages:CRM_STAGES,labels:CRM_L,form:'deals',
    title:'CRM Pipeline',icon:'briefcase',sub:state.deals.length+' deals · '+money(total)+' total',
    colMeta:function(items){return money(items.reduce(function(s,d){return s+d.value;},0));},
    cardBody:function(d){
      return'<div class="row-top"><div class="row-title" style="font-size:.82rem">'+esc(d.company)+'</div>'+priBadge(d.priority)+'</div>'
        +'<div class="mono" style="color:var(--gold);font-weight:700">'+money(d.value)+'</div>'
        +'<div class="row-sub">'+esc(d.contact)+' · '+esc(d.owner)+'</div>';
    }
  });
};

/* ════ PAGE: OUTBOUND BOARD ════ */
const ORD_STAGES=['picking','packing','staging','dispatched'];
var ORD_L={picking:'Picking',packing:'Packing',staging:'Ready',dispatched:'Dispatched'};
PAGES.outbound=function(){
  boardPage({
    col:'orders',stageKey:'status',stages:ORD_STAGES,labels:ORD_L,form:'orders',
    title:'Outbound',icon:'send',sub:state.orders.length+' active orders',
    cardBody:function(o){
      return'<div class="row-top"><div class="row-title mono" style="font-size:.78rem">'+esc(o.id)+'</div>'+badge(o.carrier,'info')+'</div>'
        +'<div class="row-sub" class="fw7 c-text">'+esc(o.customer)+'</div>'
        +'<div class="row-sub">'+esc(o.lines)+' · due '+fmtD(o.due)+'</div>'
        +'<button class="btn btn-sec btn-sm" style="margin-top:7px;width:100%" onclick="openOrderEmail(\'dispatch\',\''+o.id+'\')">'+icon('mail','sm')+' Email Customer</button>';
    }
  });
};

/* ════ PAGE: CONTACTS ════ */
PAGES.contacts=function(){
  listPage({
    id:'contacts',col:'contacts',title:'Contacts',icon:'user',form:'contacts',
    searchText:function(c){return c.name+' '+c.company+' '+c.email+' '+c.role;},
    filters:[{v:'all',l:'All'},{v:'customer',l:'Customers'},{v:'supplier',l:'Suppliers'},{v:'partner',l:'Partners'},{v:'prospect',l:'Prospects'}],
    filterFn:function(c,f){return c.type===f;},
    card:function(c){
      var ini=c.name.split(' ').map(function(n){return n[0]||'';}).join('').slice(0,2);
      return'<div class="row"><div class="row-top"><div class="d-flex g10 ai-c min-w0"><div class="avatar">'+esc(ini)+'</div><div style="min-width:0"><div class="row-title">'+esc(c.name)+'</div><div class="row-sub">'+esc(c.role)+' · '+esc(c.company)+'</div></div></div>'+badge(c.type,'info')+'</div>'
      +'<div class="row-sub">'+icon('mail','sm')+' '+esc(c.email)+'<br>'+icon('phone','sm')+' '+esc(c.phone)+'</div>'
      +'<div class="row-acts"><button class="btn btn-sec btn-sm" onclick="openOrderEmail(\'contact\',\''+c.id+'\')">'+icon('mail','sm')+' Email</button></div>'
      +actBtns('contacts','contacts',c.id)+'</div>';
    }
  });
};

/* ════ PAGE: COURSES ════ */
PAGES.courses=function(){
  listPage({
    id:'courses',col:'courses',title:'Courses',icon:'book',form:'courses',gold:true,
    searchText:function(c){return c.title+' '+c.category+' '+c.instructor;},
    card:function(c){
      var enr=state.students.filter(function(s){return(s.courses||[]).includes(c.id);}).length;
      return'<div class="row"><div class="row-top"><div class="d-flex g11 ai-c min-w0"><div class="avatar" style="background:'+esc(c.color||'#00c8ff')+'22;color:'+esc(c.color||'#00c8ff')+';border:1px solid '+esc(c.color||'#00c8ff')+'">'+icon(c.icn||'book')+'</div><div style="min-width:0"><div class="row-title">'+esc(c.title)+'</div><div class="row-sub">'+esc(c.instructor)+' · '+esc(c.duration)+' · '+esc(c.level)+'</div></div></div></div>'
      +'<div class="row-meta"><span class="badge b-gold mono">'+money(c.price)+'</span><span class="badge b-dim">'+c.modules+' modules</span><span class="badge b-purple">'+enr+' enrolled</span><span class="badge b-dim">'+esc(c.category)+'</span></div>'
      +actBtns('courses','courses',c.id)+'</div>';
    }
  });
};

/* ════ PAGE: STUDENTS ════ */
PAGES.students=function(){
  listPage({
    id:'students',col:'students',title:'Students',icon:'cap',form:'students',gold:true,
    searchText:function(s){return s.name+' '+s.email+' '+(s.company||'');},
    filters:[{v:'all',l:'All'},{v:'active',l:'Active'},{v:'inactive',l:'Inactive'}],
    filterFn:function(s,f){return s.status===f;},
    card:function(s){
      var names=(s.courses||[]).map(function(cid){var c=state.courses.find(function(x){return x.id===cid;});return c?c.title:cid;});
      return'<div class="row"><div class="row-top"><div class="row-title">'+esc(s.name)+'</div>'+stBadge(s.status)+'</div>'
      +'<div class="row-sub">'+esc(s.email)+(s.company?' · '+esc(s.company):'')+'</div>'
      +(names.length?'<div class="row-meta">'+names.map(function(n){return'<span class="skill-tag">'+esc(n)+'</span>';}).join('')+'</div>':'')
      +'<div class="d-flex ai-c g9"><div class="prog" style="flex:1"><div style="width:'+(s.progress||0)+'%"></div></div><span class="mono" style="font-size:.7rem;color:var(--cyan)">'+(s.progress||0)+'%</span></div>'
      +actBtns('students','students',s.id,
        '<button class="btn btn-sec btn-sm" onclick="bumpProgress(\''+s.id+'\')">'+icon('trend','sm')+' +10%</button>'
        +((s.progress||0)>=100&&!hasCert(s)?'<button class="btn btn-gold btn-sm" onclick="issueCert(\''+s.id+'\')">'+icon('award','sm')+' Certify</button>':''))+'</div>';
    }
  });
};
function hasCert(s){return state.certificates.some(function(c){return c.student===s.name;});}
function bumpProgress(id){
  var s=state.students.find(function(x){return x.id===id;});
  if(!s)return;
  s.progress=Math.min(100,(s.progress||0)+10);
  save();haptic();rerender();
}
function issueCert(id){
  var s=state.students.find(function(x){return x.id===id;});
  if(!s)return;
  var cname=(s.courses||[]).map(function(cid){var c=state.courses.find(function(x){return x.id===cid;});return c?c.title:cid;})[0]||'Course';
  var iss=today();
  var exp=new Date();exp.setFullYear(exp.getFullYear()+3);
  state.certificates.push({id:uid('CERT'),student:s.name,course:cname,issued:iss,expires:exp.toISOString().slice(0,10),ref:uid('REF'),status:'active'});
  save();toast('Certificate issued to '+s.name);rerender();
}

/* ════ PAGE: STORE + CART ════ */
PAGES.store=function(){
  var cartCount=state.cart.reduce(function(s,c){return s+c.qty;},0);
  var cartTotal=state.cart.reduce(function(s,c){return s+c.price*c.qty;},0);
  var cards=state.courses.map(function(c){
    var inCart=state.cart.find(function(x){return x.id===c.id;});
    return'<div class="row"><div class="row-top"><div class="d-flex g11 ai-c min-w0"><div class="avatar" style="background:'+esc(c.color||'#d4a23c')+'22;color:'+esc(c.color||'#d4a23c')+';border:1px solid '+esc(c.color||'#d4a23c')+'">'+icon(c.icn||'book')+'</div><div style="min-width:0"><div class="row-title">'+esc(c.title)+'</div><div class="row-sub">'+esc(c.level)+' · '+esc(c.duration)+' · '+c.modules+' modules</div></div></div></div>'
    +'<div class="row-top"><span class="mono" style="font-size:1.1rem;font-weight:700;color:var(--gold)">'+money(c.price)+'</span>'
    +'<button class="btn '+(inCart?'btn-success':'btn-gold')+' btn-sm" onclick="addToCart(\''+c.id+'\')">'+icon(inCart?'check':'cart','sm')+' '+(inCart?'In cart ('+inCart.qty+')':'Add to cart')+'</button></div></div>';
  }).join('');
  var cartRows=state.cart.map(function(ci){
    var c=state.courses.find(function(x){return x.id===ci.id;});
    if(!c)return'';
    return'<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border2)"><div class="f1 min-w0"><div style="font-weight:700;font-size:.78rem">'+esc(c.title)+'</div><div style="font-size:.66rem;color:var(--muted)">'+money(c.price)+' each</div></div>'
    +'<button class="btn btn-icon btn-sm" onclick="adjCart(\''+ci.id+'\',-1)">−</button><span class="mono" style="min-width:18px;text-align:center">'+ci.qty+'</span><button class="btn btn-icon btn-sm" onclick="adjCart(\''+ci.id+'\',1)">+</button>'
    +'<span class="mono" style="color:var(--gold);font-weight:700;min-width:54px;text-align:right">'+money(c.price*ci.qty)+'</span></div>';
  }).join('');
  var history=state.ordersAcad.slice(-3).reverse().map(function(o){
    return'<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border2);font-size:.74rem"><span class="mono">'+esc(o.id)+'</span><span>'+fmtD(o.date)+'</span><span class="mono" style="color:var(--gold)">'+money(o.total)+'</span>'+stBadge(o.status)+'</div>';
  }).join('');
  $('view').innerHTML=pageHead('Course Store','cart',state.courses.length+' courses available')
    +(state.cart.length?'<div class="card" style="border-color:var(--gold)"><div class="card-title">'+icon('cart','sm')+' Cart ('+cartCount+') <span class="mono" style="color:var(--gold)">'+money(cartTotal)+'</span></div>'+cartRows
      +'<button class="btn btn-gold btn-block" style="margin-top:11px" onclick="checkout()">'+icon('check','sm')+' Checkout — '+money(cartTotal)+'</button></div>':'')
    +cards
    +(history?'<div class="card"><div class="card-title">'+icon('clipboard','sm')+' Recent Orders</div>'+history+'</div>':'');
};
function addToCart(id){
  var c=state.courses.find(function(x){return x.id===id;});
  if(!c)return;
  var ex=state.cart.find(function(x){return x.id===id;});
  if(ex)ex.qty++;else state.cart.push({id:id,qty:1,price:c.price});
  save();haptic();rerender();
}
function adjCart(id,d){
  var i=state.cart.findIndex(function(x){return x.id===id;});
  if(i<0)return;
  state.cart[i].qty+=d;
  if(state.cart[i].qty<=0)state.cart.splice(i,1);
  save();haptic();rerender();
}
function checkout(){
  var total=state.cart.reduce(function(s,c){return s+c.price*c.qty;},0);
  state.ordersAcad.push({id:uid('ORD'),date:today(),items:state.cart.slice(),total:total,status:'complete'});
  state.cart=[];
  save();rerender();
  toast('Order placed — '+money(total));
}

/* ════ PAGE: INVENTORY ════ */
PAGES.inventory=function(){
  listPage({
    id:'inventory',col:'inventory',title:'Inventory',icon:'package',form:'inventory',
    searchText:function(i){return i.sku+' '+i.name+' '+i.category+' '+i.supplier+' '+i.zone;},
    filters:[{v:'all',l:'All'},{v:'low',l:'Low Stock'},{v:'out',l:'Out of Stock'},{v:'ok',l:'Healthy'}],
    filterFn:function(i,f){return f==='out'?i.qty===0:f==='low'?(i.qty>0&&i.qty<=i.reorder):i.qty>i.reorder;},
    card:function(i){
      var st=i.qty===0?'danger':i.qty<=i.reorder?'warn':'success';
      var pct=Math.min(100,Math.round(i.qty/Math.max(i.reorder*2,1)*100));
      return'<div class="row"><div class="row-top"><div style="min-width:0"><div class="row-title">'+esc(i.name)+'</div><div class="row-sub mono">'+esc(i.sku)+' · '+esc(i.zone)+'-'+esc(i.bay)+'</div></div>'+badge(i.qty===0?'OUT':i.qty<=i.reorder?'LOW':'OK',st)+'</div>'
      +'<div class="d-flex ai-c g9"><div class="prog" style="flex:1"><div style="width:'+pct+'%;background:'+(st==='danger'?'var(--red)':st==='warn'?'var(--amber)':'var(--green)')+'"></div></div><span class="mono" style="font-size:.72rem">'+i.qty+' '+esc(i.unit)+'</span></div>'
      +'<div class="row-meta"><span class="badge b-dim">reorder @ '+i.reorder+'</span><span class="badge b-dim">'+esc(i.category)+'</span><span class="badge b-dim">'+esc(i.supplier)+'</span></div>'
      +actBtns('inventory','inventory',i.id,
        '<button class="btn btn-sec btn-sm" onclick="adjStock(\''+i.id+'\',-10)">−10</button>'
        +'<button class="btn btn-sec btn-sm" onclick="adjStock(\''+i.id+'\',10)">+10</button>'
        +(i.qty<=i.reorder?'<button class="btn btn-success btn-sm" onclick="raisePO(\''+i.id+'\')">'+icon('truck','sm')+' Reorder</button>':''))+'</div>';
    }
  });
};
function adjStock(id,d){
  var i=state.inventory.find(function(x){return x.id===id;});
  if(!i)return;
  i.qty=Math.max(0,i.qty+d);
  save();haptic();rerender();
}
function raisePO(id){
  var i=state.inventory.find(function(x){return x.id===id;});
  if(!i)return;
  var need=Math.max(i.reorder*2-i.qty,i.reorder);
  state.inbound.push({id:uid('PO'),po:uid('PO-2026'),supplier:i.supplier,expected:today(),arrived:'',status:'pending',lines:i.sku+' x'+need,value:need});
  save();toast('PO raised for '+i.name,'View',function(){navigate('inbound');});rerender();
}

/* ════ PAGE: INBOUND ════ */
PAGES.inbound=function(){
  listPage({
    id:'inbound',col:'inbound',title:'Inbound',icon:'truck',form:'inbound',
    searchText:function(p){return p.po+' '+p.supplier+' '+p.lines;},
    filters:[{v:'all',l:'All'},{v:'pending',l:'Pending'},{v:'arrived',l:'Arrived'},{v:'checked',l:'Checked'}],
    filterFn:function(p,f){return p.status===f;},
    card:function(p){
      var next=p.status==='pending'?'arrived':p.status==='arrived'?'checked':null;
      return'<div class="row"><div class="row-top"><div class="row-title mono" style="font-size:.82rem">'+esc(p.po)+'</div>'+stBadge(p.status)+'</div>'
      +'<div class="row-sub" class="fw7 c-text">'+esc(p.supplier)+'</div>'
      +'<div class="row-meta"><span class="badge b-dim">'+esc(p.lines)+'</span><span class="badge b-dim">ETA '+fmtD(p.expected)+'</span>'+(p.arrived?'<span class="badge b-info">in '+fmtD(p.arrived)+'</span>':'')+'<span class="badge b-gold mono">'+money(p.value)+'</span></div>'
      +'<div class="row-acts" style="margin-bottom:4px"><button class="btn btn-sec btn-sm" onclick="openOrderEmail(\'po\',\''+p.id+'\')">'+icon('mail','sm')+' Email Supplier</button></div>'
      +actBtns('inbound','inbound',p.id,next?'<button class="btn btn-success btn-sm" onclick="advancePO(\''+p.id+'\')">'+icon('check','sm')+' Mark '+next+'</button>':'')+'</div>';
    }
  });
};
function advancePO(id){
  var p=state.inbound.find(function(x){return x.id===id;});
  if(!p)return;
  if(p.status==='pending'){p.status='arrived';p.arrived=today();}
  else if(p.status==='arrived'){p.status='checked';}
  save();haptic();rerender();
}

/* ════ PAGE: LOCATIONS ════ */
PAGES.locations=function(){
  var zones={};
  state.locations.forEach(function(l){(zones[l.zone]=zones[l.zone]||[]).push(l);});
  var html=Object.keys(zones).sort().map(function(z){
    var locs=zones[z];
    var cells=locs.map(function(l){
      var cap=Math.round(l.used/Math.max(l.capacity,1)*100);
      var c=cap>90?'var(--red)':cap>70?'var(--amber)':'var(--green)';
      return'<div style="background:var(--raised);border:1px solid var(--border);border-radius:var(--rs);padding:10px" onclick="openForm(\'locations\',\''+l.id+'\')">'
        +'<div style="display:flex;justify-content:space-between;align-items:center"><span class="mono" style="font-weight:700;font-size:.76rem">'+esc(l.id)+'</span><button class="btn btn-danger btn-sm" style="min-height:26px;padding:3px 8px" onclick="event.stopPropagation();delItem(\'locations\',\''+l.id+'\')">'+icon('trash','sm')+'</button></div>'
        +'<div style="font-size:.64rem;color:var(--muted);margin:3px 0">'+esc(l.type)+'</div>'
        +'<div class="prog"><div style="width:'+cap+'%;background:'+c+'"></div></div>'
        +'<div style="font-size:.64rem;color:var(--muted);margin-top:3px" class="mono">'+l.used+'/'+l.capacity+' · '+cap+'%</div></div>';
    }).join('');
    var avg=Math.round(locs.reduce(function(s,l){return s+l.used/Math.max(l.capacity,1);},0)/locs.length*100);
    return'<div class="card"><div class="card-title">'+icon('map','sm')+' Zone '+esc(z)+'<span class="badge '+(avg>85?'b-danger':avg>65?'b-warn':'b-success')+'">'+avg+'% full</span></div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:9px">'+cells+'</div></div>';
  }).join('');
  $('view').innerHTML=pageHead('Zones & Locations','map',state.locations.length+' locations · tap a bay to edit','<button class="btn btn-primary btn-sm" onclick="openForm(\'locations\')">'+icon('plus','sm')+' New</button>')+html;
};

/* ════ PAGE: PRODUCTION ════ */
PAGES.production=function(){
  var avg=state.production.length?Math.round(state.production.reduce(function(s,p){return s+p.oee;},0)/state.production.length):0;
  var cards=state.production.map(function(p){
    var c=p.oee>=75?'var(--green)':p.oee>=50?'var(--amber)':'var(--red)';
    var r=44,circ=2*Math.PI*r,dash=circ*p.oee/100;
    var perf=p.target?Math.min(100,Math.round(p.actual/p.target*100)):0;
    var qual=p.total?Math.round(p.good/p.total*100):100;
    return'<div class="card" style="margin-bottom:0"><div class="row-top"><div><div class="row-title">'+esc(p.name)+'</div><div class="row-sub">'+esc(p.product)+' · '+esc(p.operator)+'</div></div>'+stBadge(p.status)+'</div>'
    +'<div style="display:flex;align-items:center;gap:14px;margin:10px 0">'
    +'<svg viewBox="0 0 100 100" width="86" height="86" style="flex-shrink:0"><circle cx="50" cy="50" r="'+r+'" fill="none" stroke="var(--raised)" stroke-width="9"/><circle cx="50" cy="50" r="'+r+'" fill="none" stroke="'+c+'" stroke-width="9" stroke-linecap="round" stroke-dasharray="'+dash.toFixed(1)+' '+(circ-dash).toFixed(1)+'" transform="rotate(-90 50 50)"/><text x="50" y="48" text-anchor="middle" fill="'+c+'" font-size="19" font-weight="700" font-family="JetBrains Mono,monospace">'+p.oee+'%</text><text x="50" y="64" text-anchor="middle" fill="var(--muted)" font-size="9">OEE</text></svg>'
    +'<div class="mstats" style="flex:1"><div class="mstat"><div class="v">'+p.uptime+'%</div><div class="l">Uptime</div></div><div class="mstat"><div class="v">'+perf+'%</div><div class="l">Perf</div></div><div class="mstat"><div class="v">'+qual+'%</div><div class="l">Quality</div></div>'
    +'<div class="mstat"><div class="v">'+p.target+'</div><div class="l">Tgt/hr</div></div><div class="mstat"><div class="v" id="act-'+p.id+'">'+p.actual+'</div><div class="l">Act/hr</div></div><div class="mstat"><div class="v">'+p.good.toLocaleString()+'</div><div class="l">Good</div></div></div></div>'
    +'<div class="row-acts"><button class="btn btn-sec btn-sm" onclick="cycleLine(\''+p.id+'\')">'+icon('refresh','sm')+' Status</button><button class="btn btn-sec btn-sm" onclick="openForm(\'production\',\''+p.id+'\')">'+icon('edit','sm')+' Edit</button><button class="btn btn-danger btn-sm" onclick="delItem(\'production\',\''+p.id+'\')">'+icon('trash','sm')+'</button></div></div>';
  }).join('');
  $('view').innerHTML=pageHead('Production Lines','cpu',state.production.length+' lines · avg OEE '+avg+'% · live feed','<button class="btn btn-primary btn-sm" onclick="openForm(\'production\')">'+icon('plus','sm')+' New</button>')
    +'<div class="machine-grid">'+cards+'</div>';
};
function cycleLine(id){
  var p=state.production.find(function(x){return x.id===id;});
  if(!p)return;
  p.status={running:'idle',idle:'maintenance',maintenance:'down',down:'running'}[p.status]||'running';
  if(p.status!=='running'){p.actual=0;p.oee=0;}
  else{p.actual=Math.round(p.target*0.8);p.oee=75;}
  save();haptic();rerender();
}

/* ════ PAGE: WORK ORDERS ════ */
PAGES.workorders=function(){
  listPage({
    id:'workorders',col:'workorders',title:'Work Orders',icon:'clipboard',form:'workorders',
    searchText:function(w){return w.id+' '+w.product+' '+w.line+' '+w.assignee;},
    filters:[{v:'all',l:'All'},{v:'planned',l:'Planned'},{v:'running',l:'Running'},{v:'done',l:'Done'},{v:'hold',l:'On Hold'}],
    filterFn:function(w,f){return w.status===f;},
    card:function(w){
      var pct=w.qty?Math.round(w.completed/w.qty*100):0;
      return'<div class="row"><div class="row-top"><div style="min-width:0"><div class="row-title">'+esc(w.product)+'</div><div class="row-sub mono">'+esc(w.id)+' · '+esc(w.line)+'</div></div>'+stBadge(w.status)+'</div>'
      +'<div class="d-flex ai-c g9"><div class="prog" style="flex:1"><div style="width:'+pct+'%"></div></div><span class="mono" style="font-size:.7rem">'+w.completed.toLocaleString()+'/'+w.qty.toLocaleString()+'</span></div>'
      +'<div class="row-meta">'+priBadge(w.priority)+'<span class="badge b-dim">'+esc(w.assignee)+'</span><span class="badge b-dim">'+fmtD(w.start)+' → '+fmtD(w.end)+'</span></div>'
      +actBtns('workorders','workorders',w.id,
        (w.status!=='done'?'<button class="btn btn-success btn-sm" onclick="logUnits(\''+w.id+'\')">'+icon('plus','sm')+' Log units</button>':''))+'</div>';
    }
  });
};
function logUnits(id){
  var w=state.workorders.find(function(x){return x.id===id;});
  if(!w)return;
  w.completed=Math.min(w.qty,w.completed+Math.max(50,Math.round(w.qty*0.05)));
  if(w.completed>=w.qty)w.status='done';
  else if(w.status==='planned')w.status='running';
  save();haptic();rerender();
}

/* ════ PAGE: QUALITY ════ */
PAGES.quality=function(){
  var ins=state.quality.reduce(function(s,q){return s+q.inspected;},0);
  var def=state.quality.reduce(function(s,q){return s+q.defects;},0);
  var rate=ins?((1-def/ins)*100).toFixed(1):'100.0';
  listPage({
    id:'quality',col:'quality',title:'Quality Control',icon:'check',form:'quality',
    searchText:function(q){return q.product+' '+q.line+' '+q.inspector;},
    filters:[{v:'all',l:'All'},{v:'pass',l:'Pass'},{v:'fail',l:'Fail'}],
    filterFn:function(q,f){return q.result===f;},
    card:function(q){
      var pr=q.inspected?((1-q.defects/q.inspected)*100).toFixed(1):'100';
      return'<div class="row"><div class="row-top"><div style="min-width:0"><div class="row-title">'+esc(q.product)+'</div><div class="row-sub">'+esc(q.line)+' · '+esc(q.inspector)+' · '+fmtD(q.date)+'</div></div>'+stBadge(q.result)+'</div>'
      +'<div class="row-meta"><span class="badge b-info mono">'+q.inspected+' inspected</span><span class="badge '+(q.defects?'b-danger':'b-success')+' mono">'+q.defects+' defects</span><span class="badge b-dim mono">'+pr+'% pass</span></div>'
      +actBtns('quality','quality',q.id)+'</div>';
    }
  });
  var head=document.querySelector('.page-head .page-sub');
  if(head)head.textContent='Overall pass rate '+rate+'% · '+ins.toLocaleString()+' units inspected';
};

/* ════ PAGE: EQUIPMENT ════ */
PAGES.equipment=function(){
  listPage({
    id:'equipment',col:'equipment',title:'Equipment',icon:'tool',form:'equipment',
    searchText:function(e){return e.name+' '+e.type+' '+e.location;},
    filters:[{v:'all',l:'All'},{v:'running',l:'Running'},{v:'maintenance',l:'Maintenance'},{v:'down',l:'Down'}],
    filterFn:function(e,f){return e.status===f;},
    card:function(e){
      var days=Math.round((new Date(e.nextService)-new Date())/864e5);
      var urg=days<=7?'danger':days<=30?'warn':'success';
      return'<div class="row"><div class="row-top"><div style="min-width:0"><div class="row-title">'+esc(e.name)+'</div><div class="row-sub">'+esc(e.type)+' · '+esc(e.location)+' · '+Number(e.hours||0).toLocaleString()+' hrs</div></div>'+stBadge(e.status)+'</div>'
      +'<div class="row-meta"><span class="badge b-dim">serviced '+fmtD(e.lastService)+'</span><span class="badge b-'+urg+'">next '+fmtD(e.nextService)+' ('+days+'d)</span></div>'
      +actBtns('equipment','equipment',e.id,
        '<button class="btn btn-success btn-sm" onclick="serviceNow(\''+e.id+'\')">'+icon('tool','sm')+' Service</button>')+'</div>';
    }
  });
};
function serviceNow(id){
  var e=state.equipment.find(function(x){return x.id===id;});
  if(!e)return;
  e.lastService=today();
  var nx=new Date();nx.setMonth(nx.getMonth()+3);
  e.nextService=nx.toISOString().slice(0,10);
  if(e.status!=='running')e.status='running';
  save();toast(e.name+' serviced — next due '+fmtD(e.nextService));rerender();
}

/* ════ PAGE: WORKFORCE ════ */
PAGES.workforce=function(){
  var depts=Array.from(new Set(state.workers.map(function(w){return w.dept;}))).sort();
  listPage({
    id:'workforce',col:'workers',title:'Workforce',icon:'users',form:'workers',
    searchText:function(w){return w.name+' '+w.role+' '+w.dept+' '+(w.skills||[]).join(' ');},
    filters:[{v:'all',l:'All'}].concat(depts.map(function(d){return{v:d,l:d};})),
    filterFn:function(w,f){return w.dept===f;},
    card:function(w){
      var ini=w.name.split(' ').map(function(n){return n[0]||'';}).join('').slice(0,2);
      return'<div class="row"><div class="row-top"><div class="d-flex g10 ai-c min-w0"><div class="avatar">'+esc(ini)+'</div><div style="min-width:0"><div class="row-title">'+esc(w.name)+'</div><div class="row-sub">'+esc(w.role)+' · '+esc(w.dept)+'</div></div></div>'+stBadge(w.status)+'</div>'
      +'<div class="row-meta">'+(w.skills||[]).map(function(s){return'<span class="skill-tag">'+esc(s)+'</span>';}).join('')+(w.cert?'<span class="badge b-gold">'+esc(w.cert)+'</span>':'')+'</div>'
      +'<div class="row-sub">'+icon('phone','sm')+' '+esc(w.phone)+' · '+esc(w.zone)+'</div>'
      +actBtns('workers','workers',w.id)+'</div>';
    }
  });
};

/* ════ PAGE: ROSTER ════ */
var SHIFTS=['','D','E','N','OFF','AL','TRN'];
var SHIFT_C={D:'#00c8ff',E:'#d4a23c',N:'#8b5cf6',OFF:'#3a4d6e',AL:'#00e87a',TRN:'#ff6b35'};
PAGES.roster=function(){
  var t0=new Date();t0.setHours(0,0,0,0);
  var start=new Date(t0);start.setDate(t0.getDate()+state.rosterOffset*7);
  var days=[];for(var i=0;i<14;i++){var d=new Date(start);d.setDate(start.getDate()+i);days.push(d);}
  var f=UI.filter.roster||'all';
  var workers=state.workers.filter(function(w){return f==='all'||w.dept===f;});
  var depts=Array.from(new Set(state.workers.map(function(w){return w.dept;}))).sort();
  var head='<tr><th style="text-align:left">Employee</th>'+days.map(function(d){
    var isT=d.getTime()===t0.getTime();
    return'<th style="'+(isT?'color:var(--cyan)':'')+'">'+['Su','Mo','Tu','We','Th','Fr','Sa'][d.getDay()]+'<br>'+d.getDate()+'/'+(d.getMonth()+1)+'</th>';
  }).join('')+'</tr>';
  var rows=workers.map(function(w){
    var cells=days.map(function(d){
      var key=w.id+'_'+d.toISOString().slice(0,10);
      var s=state.shifts[key]||'';
      var c=SHIFT_C[s];
      return'<td><div class="shift-cell" style="'+(c?'background:'+c+'22;border-color:'+c+';color:'+c:'')+'" onclick="cycleShift(\''+w.id+'\',\''+d.toISOString().slice(0,10)+'\')">'+(s||'·')+'</div></td>';
    }).join('');
    return'<tr><td><div class="rname">'+esc(w.name)+'</div><div class="rdept">'+esc(w.dept)+'</div></td>'+cells+'</tr>';
  }).join('');
  var legend=Object.keys(SHIFT_C).map(function(k){
    return'<span style="display:inline-flex;align-items:center;gap:4px;font-size:.64rem;color:var(--muted)"><span style="width:14px;height:11px;border-radius:3px;background:'+SHIFT_C[k]+'22;border:1px solid '+SHIFT_C[k]+'"></span>'+k+'</span>';
  }).join(' ');
  var range=fmtD(days[0].toISOString().slice(0,10))+' – '+fmtD(days[13].toISOString().slice(0,10));
  $('view').innerHTML=pageHead('Roster & Shifts','calendar','Tap a cell to cycle: Day · Early · Night · Off · Leave · Training')
    +'<div class="chips"><button class="chip'+(f==='all'?' active':'')+'" onclick="setFilter(\'roster\',\'all\')">All</button>'
    +depts.map(function(d){return'<button class="chip'+(f===d?' active':'')+'" onclick="setFilter(\'roster\',\''+esc(d)+'\')">'+esc(d)+'</button>';}).join('')+'</div>'
    +'<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">'
    +'<button class="btn btn-icon" onclick="state.rosterOffset--;save();rerender()">'+icon('left')+'</button>'
    +'<span class="mono" style="font-size:.72rem;color:var(--muted);flex:1;text-align:center">'+range+'</span>'
    +'<button class="btn btn-icon" onclick="state.rosterOffset++;save();rerender()">'+icon('right')+'</button>'
    +'<button class="btn btn-sec btn-sm" onclick="state.rosterOffset=0;save();rerender()">Today</button>'
    +'<button class="btn btn-success btn-sm" onclick="autoFillRoster()">'+icon('zap','sm')+' Auto-fill</button>'
    +'<button class="btn btn-sec btn-sm" onclick="exportRosterCSV()">'+icon('download','sm')+' CSV</button></div>'
    +'<div style="display:flex;gap:9px;flex-wrap:wrap;margin-bottom:9px">'+legend+'</div>'
    +'<div class="roster-scroll"><table class="roster-tbl"><thead>'+head+'</thead><tbody>'+rows+'</tbody></table></div>';
};
function cycleShift(wid,date){
  var key=wid+'_'+date;
  var i=SHIFTS.indexOf(state.shifts[key]||'');
  var next=SHIFTS[(i+1)%SHIFTS.length];
  if(next)state.shifts[key]=next;else delete state.shifts[key];
  save();haptic();rerender();
}
function autoFillRoster(){
  var t0=new Date();t0.setHours(0,0,0,0);
  var start=new Date(t0);start.setDate(t0.getDate()+state.rosterOffset*7);
  var pats=[['D','D','D','D','D','OFF','OFF'],['N','N','N','N','OFF','OFF','D'],['E','E','D','D','OFF','OFF','E']];
  state.workers.forEach(function(w,wi){
    for(var i=0;i<14;i++){
      var d=new Date(start);d.setDate(start.getDate()+i);
      var key=w.id+'_'+d.toISOString().slice(0,10);
      if(!state.shifts[key])state.shifts[key]=pats[wi%pats.length][d.getDay()%7];
    }
  });
  save();toast('Roster auto-filled for 2 weeks');rerender();
}
function exportRosterCSV(){
  var t0=new Date();t0.setHours(0,0,0,0);
  var start=new Date(t0);start.setDate(t0.getDate()+state.rosterOffset*7);
  var days=[];for(var i=0;i<14;i++){var d=new Date(start);d.setDate(start.getDate()+i);days.push(d.toISOString().slice(0,10));}
  var csv='Employee,Dept,'+days.join(',')+'\n'+state.workers.map(function(w){
    return[w.name,w.dept].concat(days.map(function(dd){return state.shifts[w.id+'_'+dd]||'';})).join(',');
  }).join('\n');
  dlFile('roster.csv',csv,'text/csv');
}
function dlFile(name,content,type){
  var a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([content],{type:type||'application/octet-stream'}));
  a.download=name;a.click();
  setTimeout(function(){URL.revokeObjectURL(a.href);},2000);
}

/* ════ PAGE: HOLIDAYS ════ */
PAGES.holidays=function(){
  listPage({
    id:'holidays',col:'holidays',title:'Holiday Planner',icon:'umbrella',form:'holidays',
    searchText:function(h){return h.employee+' '+h.type+' '+(h.note||'');},
    filters:[{v:'all',l:'All'},{v:'pending',l:'Pending'},{v:'approved',l:'Approved'},{v:'rejected',l:'Rejected'}],
    filterFn:function(h,f){return h.status===f;},
    card:function(h){
      return'<div class="row"><div class="row-top"><div style="min-width:0"><div class="row-title">'+esc(h.employee)+'</div><div class="row-sub">'+fmtD(h.from)+' → '+fmtD(h.to)+' · '+h.days+' day'+(h.days===1?'':'s')+(h.note?' · '+esc(h.note):'')+'</div></div>'+stBadge(h.status)+'</div>'
      +'<div class="row-meta">'+badge(h.type,{annual:'info',sick:'danger',public:'purple',unpaid:'dim'}[h.type]||'dim')+'</div>'
      +actBtns('holidays','holidays',h.id,
        h.status==='pending'?'<button class="btn btn-success btn-sm" onclick="setHol(\''+h.id+'\',\'approved\')">'+icon('check','sm')+' Approve</button><button class="btn btn-danger btn-sm" onclick="setHol(\''+h.id+'\',\'rejected\')">'+icon('x','sm')+' Reject</button>':'')+'</div>';
    }
  });
};
function setHol(id,st){
  var h=state.holidays.find(function(x){return x.id===id;});
  if(h){h.status=st;save();haptic();rerender();}
}

/* ════ PAGE: HR LOG ════ */
PAGES.hr=function(){
  listPage({
    id:'hr',col:'hrActions',title:'HR Actions Log',icon:'file',form:'hrActions',
    searchText:function(h){return h.employee+' '+h.type+' '+h.desc;},
    filters:[{v:'all',l:'All'},{v:'open',l:'Open'},{v:'closed',l:'Closed'},{v:'commendation',l:'Commendations'},{v:'review',l:'Reviews'}],
    filterFn:function(h,f){return h.status===f||h.type===f;},
    card:function(h){
      return'<div class="row"><div class="row-top"><div style="min-width:0"><div class="row-title">'+esc(h.employee)+'</div><div class="row-sub">'+fmtD(h.date)+' · logged by '+esc(h.by)+'</div></div>'+stBadge(h.status)+'</div>'
      +'<div class="row-sub">'+esc(h.desc)+'</div>'
      +'<div class="row-meta">'+badge(h.type,{commendation:'success',warning:'danger',informal:'warn',review:'info',training:'purple'}[h.type]||'dim')+'</div>'
      +actBtns('hrActions','hrActions',h.id,
        h.status==='open'?'<button class="btn btn-success btn-sm" onclick="closeHR(\''+h.id+'\')">'+icon('check','sm')+' Close</button>':'')+'</div>';
    }
  });
};
function closeHR(id){
  var h=state.hrActions.find(function(x){return x.id===id;});
  if(h){h.status='closed';save();rerender();}
}

/* ════ PAGE: COMPLIANCE ════ */
PAGES.compliance=function(){
  listPage({
    id:'compliance',col:'compliance',title:'Compliance',icon:'shield',form:'compliance',
    searchText:function(c){return c.title+' '+c.dept;},
    filters:[{v:'all',l:'All'},{v:'ok',l:'OK'},{v:'due',l:'Due Soon'},{v:'overdue',l:'Overdue'}],
    filterFn:function(c,f){return c.status===f;},
    card:function(c){
      var cc=c.coverage>=90?'var(--green)':c.coverage>=70?'var(--amber)':'var(--red)';
      return'<div class="row"><div class="row-top"><div style="min-width:0"><div class="row-title">'+esc(c.title)+'</div><div class="row-sub">'+esc(c.dept)+' · renew every '+c.renewEvery+' months'+(c.mandatory==='yes'?' · mandatory':'')+'</div></div>'+stBadge(c.status)+'</div>'
      +'<div class="d-flex ai-c g9"><div class="prog" style="flex:1"><div style="width:'+c.coverage+'%;background:'+cc+'"></div></div><span class="mono" style="font-size:.7rem;color:'+cc+'">'+c.coverage+'%</span></div>'
      +'<div class="row-meta"><span class="badge '+(c.status==='overdue'?'b-danger':'b-dim')+'">deadline '+fmtD(c.dueDate)+'</span></div>'
      +actBtns('compliance','compliance',c.id,
        '<button class="btn btn-success btn-sm" onclick="bumpCoverage(\''+c.id+'\')">'+icon('trend','sm')+' +5%</button>')+'</div>';
    }
  });
};
function bumpCoverage(id){
  var c=state.compliance.find(function(x){return x.id===id;});
  if(!c)return;
  c.coverage=Math.min(100,c.coverage+5);
  if(c.coverage>=90)c.status='ok';
  save();haptic();rerender();
}

/* ════ PAGE: CERTIFICATES ════ */
PAGES.certificates=function(){
  listPage({
    id:'certificates',col:'certificates',title:'Certificates',icon:'star',form:'certificates',gold:true,
    searchText:function(c){return c.student+' '+c.course+' '+c.ref;},
    filters:[{v:'all',l:'All'},{v:'active',l:'Active'},{v:'expired',l:'Expired'}],
    filterFn:function(c,f){return f==='expired'?c.expires<today():c.status===f&&c.expires>=today();},
    card:function(c){
      var exp=c.expires<today();
      return'<div class="row"><div class="row-top"><div class="d-flex g10 ai-c min-w0"><div class="avatar" style="background:rgba(212,162,60,.15);color:var(--gold);border:1px solid var(--gold)">'+icon('award')+'</div><div style="min-width:0"><div class="row-title">'+esc(c.student)+'</div><div class="row-sub">'+esc(c.course)+'</div></div></div>'+(exp?badge('expired','danger'):stBadge(c.status))+'</div>'
      +'<div class="row-meta"><span class="badge b-dim mono">'+esc(c.ref)+'</span><span class="badge b-dim">issued '+fmtD(c.issued)+'</span><span class="badge '+(exp?'b-danger':'b-dim')+'">expires '+fmtD(c.expires)+'</span></div>'
      +actBtns('certificates','certificates',c.id)+'</div>';
    }
  });
};

/* ════ PAGE: LEADERBOARD ════ */
PAGES.leaderboard=function(){
  var scored=state.students.map(function(s){
    var certs=state.certificates.filter(function(c){return c.student===s.name;}).length;
    return{s:s,certs:certs,score:Math.round((s.progress||0)*0.6+certs*200+(s.courses||[]).length*40)};
  }).sort(function(a,b){return b.score-a.score;});
  var max=scored.length?Math.max(scored[0].score,1):1;
  var medals=['b-gold','b-dim','b-orange'];
  var rows=scored.map(function(e,i){
    return'<div class="row"><div class="row-top"><div class="d-flex g10 ai-c min-w0">'
    +'<span class="badge '+(medals[i]||'b-dim')+' mono" style="min-width:30px;justify-content:center">#'+(i+1)+'</span>'
    +'<div style="min-width:0"><div class="row-title">'+esc(e.s.name)+'</div><div class="row-sub">'+e.certs+' cert'+(e.certs===1?'':'s')+' · '+(e.s.courses||[]).length+' course'+((e.s.courses||[]).length===1?'':'s')+' · '+(e.s.progress||0)+'% progress</div></div></div>'
    +'<span class="mono" style="color:var(--gold);font-weight:700">'+e.score+'</span></div>'
    +'<div class="prog"><div style="width:'+Math.round(e.score/max*100)+'%;background:linear-gradient(90deg,#7a5a1a,var(--gold))"></div></div></div>';
  }).join('');
  $('view').innerHTML=pageHead('Leaderboard','award','Score = progress ×0.6 + certificates ×200 + courses ×40',
    '<button class="btn btn-gold btn-sm" onclick="exportLeaderboard()">'+icon('download','sm')+' CSV</button>')
    +(rows||'<div class="empty">'+icon('award')+'No students yet</div>');
};
function exportLeaderboard(){
  var rows=state.students.map(function(s,i){
    var certs=state.certificates.filter(function(c){return c.student===s.name;}).length;
    return[i+1,s.name,s.email,s.progress||0,certs].join(',');
  });
  dlFile('leaderboard.csv','Rank,Name,Email,Progress%,Certificates\n'+rows.join('\n'),'text/csv');
}

/* ════ PAGE: ANALYTICS ════ */
function bars(data,maxV){
  var m=maxV||Math.max.apply(null,data.map(function(d){return d.v;}).concat([1]));
  return data.map(function(d){
    return'<div class="bar-row"><div class="bar-lbl">'+esc(d.l)+'</div><div class="bar-track"><div class="bar-fill" style="width:'+Math.round(d.v/m*100)+'%;background:'+(d.c||'var(--cyan)')+'"></div></div><div class="bar-val">'+d.v+'</div></div>';
  }).join('');
}
PAGES.analytics=function(){
  var dealVal=state.deals.reduce(function(s,d){return s+d.value;},0);
  var wonVal=state.deals.filter(function(d){return d.stage==='won';}).reduce(function(s,d){return s+d.value;},0);
  var acadRev=state.ordersAcad.reduce(function(s,o){return s+o.total;},0);
  var byStage=CRM_STAGES.map(function(st){return{l:CRM_L[st],v:state.deals.filter(function(d){return d.stage===st;}).length,c:'var(--cyan)'};});
  var oee=state.production.map(function(p){return{l:p.name,v:p.oee,c:p.oee>=75?'var(--green)':p.oee>=50?'var(--amber)':'var(--red)'};});
  var invZone={};state.inventory.forEach(function(i){invZone[i.zone]=(invZone[i.zone]||0)+i.qty;});
  var zoneData=Object.keys(invZone).sort().map(function(z){return{l:'Zone '+z,v:invZone[z],c:'var(--green)'};});
  var wfDept={};state.workers.forEach(function(w){wfDept[w.dept]=(wfDept[w.dept]||0)+1;});
  var wfData=Object.keys(wfDept).map(function(d){return{l:d,v:wfDept[d],c:'var(--purple)'};});
  var pri={critical:0,high:0,med:0,low:0};state.tasks.forEach(function(t){pri[t.priority]=(pri[t.priority]||0)+1;});
  var taskData=[{l:'Critical',v:pri.critical,c:'var(--red)'},{l:'High',v:pri.high,c:'var(--orange)'},{l:'Medium',v:pri.med,c:'var(--amber)'},{l:'Low',v:pri.low,c:'var(--green)'}];
  var compData=state.compliance.map(function(c){return{l:c.title,v:c.coverage,c:c.coverage>=90?'var(--green)':c.coverage>=70?'var(--amber)':'var(--red)'};});
  $('view').innerHTML=pageHead('Analytics & KPIs','chart','Live cross-platform metrics')
    +'<div class="kpi-grid">'
    +'<div class="kpi" style="border-top-color:var(--gold)"><div class="kpi-val" style="color:var(--gold)">'+money(dealVal)+'</div><div class="kpi-lbl">Total Pipeline</div></div>'
    +'<div class="kpi" style="border-top-color:var(--green)"><div class="kpi-val" style="color:var(--green)">'+money(wonVal)+'</div><div class="kpi-lbl">Won Revenue</div></div>'
    +'<div class="kpi" style="border-top-color:var(--cyan)"><div class="kpi-val" style="color:var(--cyan)">'+money(acadRev)+'</div><div class="kpi-lbl">Academy Revenue</div></div>'
    +'<div class="kpi" style="border-top-color:var(--purple)"><div class="kpi-val" style="color:var(--purple)">'+state.students.length+'</div><div class="kpi-lbl">Students</div></div></div>'
    +'<div class="two-col">'
    +'<div class="card"><div class="card-title">'+icon('briefcase','sm')+' Deals by Stage</div>'+bars(byStage)+'</div>'
    +'<div class="card"><div class="card-title">'+icon('cpu','sm')+' OEE by Line</div>'+bars(oee,100)+'</div>'
    +'<div class="card"><div class="card-title">'+icon('package','sm')+' Stock by Zone</div>'+bars(zoneData)+'</div>'
    +'<div class="card"><div class="card-title">'+icon('users','sm')+' Workforce by Dept</div>'+bars(wfData)+'</div>'
    +'<div class="card"><div class="card-title">'+icon('check','sm')+' Tasks by Priority</div>'+bars(taskData)+'</div>'
    +'<div class="card"><div class="card-title">'+icon('shield','sm')+' Compliance Coverage</div>'+bars(compData,100)+'</div>'
    +'</div>';
};

/* ════ PAGE: SETTINGS ════ */
PAGES.settings=function(){
  /* Check both plaintext and encrypted storage for key presence indicator */
  var keyPresent=!!(localStorage.getItem(AK)||localStorage.getItem(EK));
  var key=keyPresent?'sk-ant-present':'';
  var pin=localStorage.getItem(PK);
  var used=0;try{used=(localStorage.getItem(SK)||'').length;}catch(e){}
  $('view').innerHTML=pageHead('Settings','gear','Profile, security, data & app')
  +'<div class="card"><div class="card-title">'+icon('user','sm')+' Profile</div>'
    +'<div class="f-group"><label class="f-label">Display name</label><input id="setName" value="'+esc(state.settings.name)+'" maxlength="40"></div>'
    +'<div class="f-group"><label class="f-label">Theme</label><select id="setTheme"><option value="dark"'+(state.settings.dark?' selected':'')+'>Dark (Navy)</option><option value="light"'+(!state.settings.dark?' selected':'')+'>Light</option></select></div>'
    +'<button class="btn btn-primary btn-block" onclick="saveSettings()">'+icon('check','sm')+' Save profile</button></div>'
  +'<div class="card"><div class="card-title">'+icon('lock','sm')+' Security</div>'
    +'<div class="row-sub" style="margin-bottom:10px">'+(pin?'App lock is ON — PIN required on open and after 10 min idle.':'Set a 4-digit PIN to lock the app on your phone.')+'</div>'
    +(pin
      ?'<div style="display:flex;gap:9px"><button class="btn btn-sec" style="flex:1" onclick="lockNow()">'+icon('lock','sm')+' Lock now</button><button class="btn btn-danger" style="flex:1" onclick="removePin()">'+icon('x','sm')+' Remove PIN</button></div>'
      :'<button class="btn btn-primary btn-block" onclick="setupPin()">'+icon('key','sm')+' Set up PIN lock</button>')
  +'</div>'
  +'<div class="card"><div class="card-title">'+icon('bot','sm')+' '+esc(BRAND.copilotName)+'</div>'
    +'<div class="row-sub" style="margin-bottom:8px;color:var(--green)">'+icon('check','sm')+' '+esc(BRAND.copilotName)+' is active and ready to use.</div></div>'
  +'<div class="card"><div class="card-title">'+icon('download','sm')+' Data & Backup</div>'
    +'<div class="row-sub" style="margin-bottom:11px">Your data is stored only on this device. Export regularly to prevent loss from browser resets or device changes.</div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:9px">'
    +'<button class="btn btn-primary" onclick="exportData()">'+icon('download','sm')+' Export Backup</button>'
    +'<button class="btn btn-sec" onclick="$(\'importFile\').click()">'+icon('upload','sm')+' Restore Backup</button>'
    +'<button class="btn btn-sec" onclick="exportRosterCSV()">'+icon('calendar','sm')+' Roster CSV</button>'
    +'<button class="btn btn-danger" onclick="resetData()">'+icon('refresh','sm')+' Reset demo data</button></div>'
    +'<input type="file" id="importFile" accept=".json,application/json" style="display:none" onchange="importData(event)">'
    +'<div class="row-sub" style="margin-top:9px;font-size:.66rem">Workspace size: '+(used/1024).toFixed(1)+' KB · last backup: '+lastExportLabel()+'</div></div>'
  +'<div class="card"><div class="card-title">'+icon('phone','sm')+' App</div>'
    +'<button class="btn btn-primary btn-block" id="installFromSettings" onclick="triggerInstall()" style="margin-bottom:9px">'+icon('phone','sm')+' Install on home screen</button>'
    +'<div class="row-sub" style="font-size:.68rem">'+esc(BRAND.name)+' v2.0 · offline-ready PWA · '+(navigator.serviceWorker&&navigator.serviceWorker.controller?'service worker active':'service worker pending')+'</div></div>';
};
function saveSettings(){
  state.settings.name=sanitize($('setName').value,40)||'Manager';
  state.settings.dark=$('setTheme').value==='dark';
  applyTheme();
  save();toast('Settings saved');rerender();
}
async function saveApiKey(){
  var k=$('setKey').value.trim();
  if(!k){toast('Paste a key first');return;}
  if(!/^sk-ant-/.test(k)){toast('Invalid key — must start with sk-ant-');return;}
  if(!localStorage.getItem(PK)){toast('⚠️ No PIN set — key will be stored unencrypted. Set a PIN first for full security.','Set PIN',function(){setupPin();});return;}
  await storeApiKey(k);
  localStorage.setItem('apexone_keyhint_dismissed','1');
  toast('API key saved — encrypted with your PIN');rerender();
}
async function clearApiKey(){await removeApiKey();toast('API key removed');rerender();}
function lastExportLabel(){
  var ts=localStorage.getItem('apexone_lastexport');
  if(!ts)return'never — export now!';
  try{return new Date(ts).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});}catch(e){return'unknown';}
}
function exportData(){
  var payload={version:2,app:BRAND.name,exportedAt:new Date().toISOString(),exportedBy:state.settings.name||'User',data:state};
  dlFile('apexone-backup-'+today()+'.json',JSON.stringify(payload,null,2),'application/json');
  localStorage.setItem('apexone_lastexport',new Date().toISOString());
  toast('Backup downloaded — keep it safe');
  rerender();
}
function importData(e){
  var f=e.target.files[0];
  if(!f)return;
  /* Reset the input so the same file can be re-imported */
  e.target.value='';
  if(f.type&&f.type!=='application/json'&&!f.name.endsWith('.json')){toast('Please select a .json backup file');return;}
  if(f.size>10*1024*1024){toast('Import rejected — file too large (max 10 MB)');return;}
  var r=new FileReader();
  r.onload=function(ev){
    try{
      var parsed=JSON.parse(ev.target.result);
      /* Support both legacy (raw state) and v2 (wrapped) backup formats */
      var d=parsed.version===2&&parsed.data?parsed.data:parsed;
      if(!verifyState(d)){toast('Import rejected — invalid workspace structure');return;}
      var exportedAt=parsed.exportedAt?new Date(parsed.exportedAt).toLocaleString('en-GB'):'unknown date';
      var _importD=d,_importAt=exportedAt;
      toast('Restore backup from '+exportedAt+'?','CONFIRM',function(){
        var cleaned=JSON.parse(JSON.stringify(_importD).replace(/<script[\s\S]*?<\/script>/gi,'').replace(/javascript\s*:/gi,'').replace(/on\w+\s*=/gi,''));
        Object.keys(state).forEach(function(k){if(cleaned[k]!==undefined)state[k]=cleaned[k];});
        pruneShifts();capCollections();
        save();applyTheme();toast('Backup restored successfully');rerender();
      });
    }catch(err){toast('Import failed — file may be corrupted');}
  };
  r.onerror=function(){toast('Could not read file');};
  r.readAsText(f);
}
function resetData(){
  toast('Reset all demo data?','CONFIRM',function(){
    Object.keys(SEED).forEach(function(k){state[k]=JSON.parse(JSON.stringify(SEED[k]));});
    state.shifts={};state.cart=[];state.ordersAcad=[];
    save();rerender();toast('Demo data restored');
  });
}

/* ════ FORM ENGINE ════ */
const FORMS={
 alerts:{t:'Alert',col:'alerts',p:'AL',f:[
   {k:'msg',l:'Message',t:'text',req:1},{k:'source',l:'Source',t:'text',req:1},
   {k:'priority',l:'Priority',t:'select',o:['low','med','high','critical'],d:'med'}],
   pre:function(o,isNew){if(isNew){o.time=new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});o.read=false;}}},
 deals:{t:'Deal',col:'deals',p:'DL',f:[
   {k:'company',l:'Company',t:'text',req:1},{k:'contact',l:'Contact',t:'text'},
   {k:'value',l:'Value (£)',t:'num',req:1},
   {k:'stage',l:'Stage',t:'select',o:CRM_STAGES,d:'lead'},
   {k:'priority',l:'Priority',t:'select',o:['low','med','high','critical'],d:'med'},
   {k:'owner',l:'Owner',t:'text'}]},
 contacts:{t:'Contact',col:'contacts',p:'C',f:[
   {k:'name',l:'Full name',t:'text',req:1},{k:'company',l:'Company',t:'text'},{k:'role',l:'Role',t:'text'},
   {k:'type',l:'Type',t:'select',o:['customer','supplier','partner','prospect'],d:'customer'},
   {k:'email',l:'Email',t:'text'},{k:'phone',l:'Phone',t:'text'}]},
 courses:{t:'Course',col:'courses',p:'CRS',f:[
   {k:'title',l:'Title',t:'text',req:1},{k:'category',l:'Category',t:'text'},{k:'instructor',l:'Instructor',t:'text'},
   {k:'duration',l:'Duration',t:'text'},{k:'price',l:'Price (£)',t:'num',req:1},
   {k:'level',l:'Level',t:'select',o:['Beginner','Intermediate','Advanced'],d:'Beginner'},
   {k:'modules',l:'Modules',t:'num',d:10},
   {k:'icn',l:'Icon',t:'select',o:['book','package','cpu','shield','truck','users','check','chart','zap','tool'],d:'book'},
   {k:'color',l:'Colour (hex)',t:'text',d:'#00c8ff'}]},
 students:{t:'Student',col:'students',p:'ST',f:[
   {k:'name',l:'Full name',t:'text',req:1},{k:'email',l:'Email',t:'text',req:1},{k:'company',l:'Company',t:'text'},
   {k:'status',l:'Status',t:'select',o:['active','inactive'],d:'active'},
   {k:'progress',l:'Progress %',t:'num',d:0},
   {k:'course1',l:'Enrol on course',t:'select',o:function(){return state.courses.map(function(c){return{v:c.id,l:c.title};});}}],
   pre:function(o,isNew){
     if(isNew){o.enrolled=today();o.courses=[];}
     o.progress=Math.max(0,Math.min(100,o.progress||0));
     if(o.course1){o.courses=o.courses||[];if(o.courses.indexOf(o.course1)<0)o.courses.push(o.course1);}
     delete o.course1;}},
 inventory:{t:'Inventory item',col:'inventory',p:'SKU',f:[
   {k:'sku',l:'SKU code',t:'text',req:1},{k:'name',l:'Name',t:'text',req:1},{k:'category',l:'Category',t:'text'},
   {k:'qty',l:'Quantity',t:'num',req:1},{k:'reorder',l:'Reorder point',t:'num',d:10},
   {k:'unit',l:'Unit',t:'text',d:'pcs'},{k:'zone',l:'Zone',t:'text',d:'A'},{k:'bay',l:'Bay',t:'text'},{k:'supplier',l:'Supplier',t:'text'}]},
 inbound:{t:'Purchase order',col:'inbound',p:'PO',f:[
   {k:'po',l:'PO number',t:'text',req:1},{k:'supplier',l:'Supplier',t:'text',req:1},
   {k:'expected',l:'Expected date',t:'date',req:1},{k:'lines',l:'Lines (e.g. SKU001 x500)',t:'text'},
   {k:'value',l:'Value (£)',t:'num'},
   {k:'status',l:'Status',t:'select',o:['pending','arrived','checked'],d:'pending'}],
   pre:function(o){if(o.status!=='pending'&&!o.arrived)o.arrived=today();}},
 orders:{t:'Outbound order',col:'orders',p:'SO',f:[
   {k:'customer',l:'Customer',t:'text',req:1},
   {k:'carrier',l:'Carrier',t:'select',o:['DHL','DPD','FedEx','UPS','Parcelforce','Royal Mail','Own Fleet'],d:'DHL'},
   {k:'due',l:'Due date',t:'date',req:1},{k:'lines',l:'Lines',t:'text'},
   {k:'priority',l:'Priority',t:'select',o:['low','med','high'],d:'med'},
   {k:'status',l:'Stage',t:'select',o:ORD_STAGES,d:'picking'}]},
 locations:{t:'Location',col:'locations',p:'LOC',f:[
   {k:'zone',l:'Zone (A–F)',t:'text',req:1},
   {k:'type',l:'Type',t:'select',o:['Pallet Racking','Shelving','Bin','Cold Store','Bulk Floor'],d:'Shelving'},
   {k:'capacity',l:'Capacity',t:'num',d:100},{k:'used',l:'Used',t:'num',d:0}],
   pre:function(o){o.used=Math.min(o.used||0,o.capacity||0);}},
 production:{t:'Production line',col:'production',p:'L',f:[
   {k:'name',l:'Line name',t:'text',req:1},{k:'product',l:'Product',t:'text'},
   {k:'status',l:'Status',t:'select',o:['running','idle','maintenance','down'],d:'idle'},
   {k:'target',l:'Target /hr',t:'num',d:100},{k:'actual',l:'Actual /hr',t:'num',d:0},
   {k:'uptime',l:'Uptime %',t:'num',d:90},{k:'oee',l:'OEE %',t:'num',d:0},
   {k:'good',l:'Good units',t:'num',d:0},{k:'total',l:'Total units',t:'num',d:0},
   {k:'operator',l:'Operator',t:'text',d:'—'}]},
 workorders:{t:'Work order',col:'workorders',p:'WO',f:[
   {k:'product',l:'Product',t:'text',req:1},
   {k:'line',l:'Line',t:'select',o:function(){return state.production.map(function(p){return p.name;});}},
   {k:'qty',l:'Target qty',t:'num',req:1},{k:'completed',l:'Completed',t:'num',d:0},
   {k:'start',l:'Start',t:'date'},{k:'end',l:'End',t:'date'},{k:'assignee',l:'Assignee',t:'text'},
   {k:'status',l:'Status',t:'select',o:['planned','running','done','hold'],d:'planned'},
   {k:'priority',l:'Priority',t:'select',o:['low','med','high'],d:'med'}]},
 quality:{t:'QC inspection',col:'quality',p:'QC',f:[
   {k:'product',l:'Product / batch',t:'text',req:1},{k:'line',l:'Line / area',t:'text'},
   {k:'inspected',l:'Units inspected',t:'num',req:1},{k:'defects',l:'Defects found',t:'num',d:0},
   {k:'inspector',l:'Inspector',t:'text'}],
   pre:function(o,isNew){if(isNew)o.date=today();o.result=(o.defects/Math.max(o.inspected,1))<0.05?'pass':'fail';}},
 equipment:{t:'Equipment asset',col:'equipment',p:'EQ',f:[
   {k:'name',l:'Asset name',t:'text',req:1},{k:'type',l:'Type',t:'text'},{k:'location',l:'Location',t:'text'},
   {k:'status',l:'Status',t:'select',o:['running','maintenance','down'],d:'running'},
   {k:'lastService',l:'Last service',t:'date'},{k:'nextService',l:'Next service',t:'date'},
   {k:'hours',l:'Run hours',t:'num',d:0}]},
 workers:{t:'Employee',col:'workers',p:'W',f:[
   {k:'name',l:'Full name',t:'text',req:1},{k:'role',l:'Role',t:'text',req:1},{k:'dept',l:'Department',t:'text',req:1},
   {k:'zone',l:'Zone',t:'text'},{k:'phone',l:'Phone',t:'text'},{k:'email',l:'Email',t:'text'},
   {k:'skillsCsv',l:'Skills (comma-separated)',t:'text'},{k:'cert',l:'Certification',t:'text'},
   {k:'status',l:'Status',t:'select',o:['active','inactive','leave'],d:'active'}],
   pre:function(o,isNew){
     if(isNew)o.hire=today();
     if(o.skillsCsv!==undefined){o.skills=o.skillsCsv.split(',').map(function(s){return s.trim();}).filter(Boolean);delete o.skillsCsv;}
     o.skills=o.skills||[];},
   hydrate:function(o){o.skillsCsv=(o.skills||[]).join(', ');}},
 tasks:{t:'Task',col:'tasks',p:'T',f:[
   {k:'title',l:'Title',t:'text',req:1},{k:'desc',l:'Description',t:'textarea'},
   {k:'priority',l:'Priority',t:'select',o:['low','med','high','critical'],d:'med'},
   {k:'status',l:'Status',t:'select',o:['open','inprog','done'],d:'open'},
   {k:'assignee',l:'Assignee',t:'select',o:function(){return state.workers.map(function(w){return w.name;});}},
   {k:'dept',l:'Department',t:'text'},{k:'due',l:'Due date',t:'date',req:1}]},
 certificates:{t:'Certificate',col:'certificates',p:'CERT',f:[
   {k:'student',l:'Student name',t:'text',req:1},{k:'course',l:'Course',t:'text',req:1},
   {k:'issued',l:'Issued',t:'date',req:1},{k:'expires',l:'Expires',t:'date',req:1},
   {k:'ref',l:'Reference',t:'text'}],
   pre:function(o,isNew){if(isNew)o.status='active';if(!o.ref)o.ref=uid('REF');}},
 compliance:{t:'Compliance requirement',col:'compliance',p:'COMP',f:[
   {k:'title',l:'Requirement',t:'text',req:1},{k:'dept',l:'Department',t:'text',d:'All'},
   {k:'dueDate',l:'Deadline',t:'date',req:1},
   {k:'mandatory',l:'Mandatory',t:'select',o:['yes','no'],d:'yes'},
   {k:'renewEvery',l:'Renew every (months)',t:'num',d:12},
   {k:'coverage',l:'Coverage %',t:'num',d:0}],
   pre:function(o){o.coverage=Math.max(0,Math.min(100,o.coverage||0));o.status=o.dueDate<today()&&o.coverage<90?'overdue':o.coverage>=90?'ok':'due';}},
 hrActions:{t:'HR action',col:'hrActions',p:'HR',f:[
   {k:'employee',l:'Employee',t:'select',o:function(){return state.workers.map(function(w){return w.name;});},req:1},
   {k:'type',l:'Type',t:'select',o:['commendation','informal','warning','review','training'],d:'review'},
   {k:'date',l:'Date',t:'date',req:1},{k:'desc',l:'Details',t:'textarea',req:1},
   {k:'by',l:'Logged by',t:'text'},
   {k:'status',l:'Status',t:'select',o:['open','closed'],d:'open'}]},
 holidays:{t:'Leave request',col:'holidays',p:'HOL',f:[
   {k:'employee',l:'Employee',t:'select',o:function(){return state.workers.map(function(w){return w.name;});},req:1},
   {k:'type',l:'Type',t:'select',o:['annual','sick','unpaid','public'],d:'annual'},
   {k:'from',l:'From',t:'date',req:1},{k:'to',l:'To',t:'date',req:1},
   {k:'note',l:'Note',t:'text'},
   {k:'status',l:'Status',t:'select',o:['pending','approved','rejected'],d:'pending'}],
   pre:function(o){
     var d1=new Date(o.from),d2=new Date(o.to);
     o.days=Math.max(1,Math.round((d2-d1)/864e5)+1);}}
};
let formCtx=null;
function openForm(formKey,id){
  var cfg=FORMS[formKey];
  if(!cfg)return;
  var item=id?state[cfg.col].find(function(x){return x.id===id;}):null;
  var work=item?JSON.parse(JSON.stringify(item)):{};
  if(item&&cfg.hydrate)cfg.hydrate(work);
  formCtx={cfg:cfg,id:id||null};
  $('formTitle').innerHTML=icon(id?'edit':'plus')+' '+(id?'Edit ':'New ')+esc(cfg.t);
  $('formBody').innerHTML=cfg.f.map(function(f){
    var val=work[f.k]!==undefined?work[f.k]:(f.d!==undefined?f.d:'');
    var inner;
    if(f.t==='select'){
      var opts=typeof f.o==='function'?f.o():f.o;
      inner='<select id="ff-'+f.k+'">'+(f.req?'':'<option value="">—</option>')+opts.map(function(op){
        var v=typeof op==='object'?op.v:op,l=typeof op==='object'?op.l:op;
        return'<option value="'+esc(v)+'"'+(String(val)===String(v)?' selected':'')+'>'+esc(l)+'</option>';
      }).join('')+'</select>';
    }else if(f.t==='textarea'){
      inner='<textarea id="ff-'+f.k+'">'+esc(val)+'</textarea>';
    }else{
      inner='<input id="ff-'+f.k+'" type="'+(f.t==='num'?'number':f.t==='date'?'date':'text')+'" value="'+esc(val)+'"'+(f.t==='num'?' inputmode="decimal" step="any"':'')+'>';
    }
    return'<div class="f-group"><label class="f-label" for="ff-'+f.k+'">'+esc(f.l)+(f.req?' *':'')+'</label>'+inner+'</div>';
  }).join('');
  openSheet('formSheet');
}
function submitForm(){
  if(!formCtx)return;
  var cfg=formCtx.cfg;
  var isNew=!formCtx.id;
  var obj=isNew?{id:uid(cfg.p)}:JSON.parse(JSON.stringify(state[cfg.col].find(function(x){return x.id===formCtx.id;})||{}));
  for(var i=0;i<cfg.f.length;i++){
    var f=cfg.f[i];
    var el=$('ff-'+f.k);
    if(!el)continue;
    var v=f.t==='num'?(parseFloat(el.value)||0):sanitize(el.value,f.t==='textarea'?2000:300);
    if(f.req&&(v===''||(f.t==='num'&&el.value===''))){toast(f.l+' is required');return;}
    obj[f.k]=v;
  }
  if(cfg.pre)cfg.pre(obj,isNew);
  if(isNew)state[cfg.col].unshift(obj);
  else{
    var idx=state[cfg.col].findIndex(function(x){return x.id===formCtx.id;});
    if(idx>=0)state[cfg.col][idx]=obj;
  }
  save();haptic();closeAllSheets();
  toast(cfg.t+(isNew?' created':' updated'));
  rerender();
}

/* ════ EMAIL MODULE ════ */
const EMAIL_TEMPLATES=[
  {id:'TPL-01',name:'Purchase Order',icon:'truck',color:'var(--cyan)',
   subject:'Purchase Order — [PO Number]',
   body:'Dear [Supplier Name],\n\nPlease find our Purchase Order details below:\n\nItem: [Item Name]\nQuantity: [Qty]\nUnit Price: [Price]\nDelivery Required By: [Date]\nDelivery Address: APEX ONE Warehouse\n\nPlease confirm receipt and your expected delivery date.\n\nKind regards,\n[Your Name]\nAPEX ONE Procurement'},
  {id:'TPL-02',name:'Order Confirmation',icon:'check',color:'var(--green)',
   subject:'Order Confirmation — [Order Ref]',
   body:'Dear [Customer Name],\n\nThank you for your order. We are pleased to confirm the following:\n\nOrder Reference: [Order Ref]\nItems: [Items]\nExpected Dispatch: [Date]\n\nYou will receive dispatch and tracking information as soon as your order ships.\n\nBest regards,\n[Your Name]\nAPEX ONE'},
  {id:'TPL-03',name:'Dispatch Notification',icon:'send',color:'var(--purple)',
   subject:'Your Order Has Been Dispatched — [Order Ref]',
   body:'Dear [Customer Name],\n\nYour order [Order Ref] has been dispatched.\n\nCarrier: [Carrier]\nTracking Reference: [Tracking No]\nExpected Delivery: [Date]\n\nPlease contact us if you have any questions regarding your delivery.\n\nKind regards,\n[Your Name]\nAPEX ONE'},
  {id:'TPL-04',name:'Urgent Stock Reorder',icon:'alert',color:'var(--red)',
   subject:'Urgent Reorder Request — [Item]',
   body:'Dear [Supplier],\n\nWe urgently require the following:\n\nProduct: [Item Name]\nQuantity Required: [Qty]\nRequired By: [Date]\n\nCurrent stock has fallen below our reorder threshold. Please confirm availability and your earliest delivery date.\n\nThank you,\n[Your Name]\nAPEX ONE'},
  {id:'TPL-05',name:'Sales Follow-up',icon:'briefcase',color:'var(--gold)',
   subject:'Following Up — [Topic]',
   body:'Dear [Contact Name],\n\nI wanted to follow up on our recent conversation regarding [Topic].\n\nWe remain very interested in progressing this opportunity and believe we can provide excellent value for your business.\n\nWould you be available for a brief call this week to discuss next steps?\n\nKind regards,\n[Your Name]\nAPEX ONE'},
  {id:'TPL-06',name:'Invoice / Statement',icon:'pound',color:'var(--amber)',
   subject:'Invoice — [Invoice Number]',
   body:'Dear [Customer Name],\n\nPlease find attached Invoice [Invoice Number] for recent services/goods supplied.\n\nAmount Due: [Amount]\nDue Date: [Date]\nPayment Reference: [Ref]\n\nBank Transfer Details:\nAccount Name: APEX ONE Ltd\nSort Code: 00-00-00\nAccount No: 00000000\n\nPlease do not hesitate to contact us if you have any queries.\n\nKind regards,\n[Your Name]\nAPEX ONE Finance'}
];
var _emailView=null;

PAGES.email=function(){
  const folder=UI.filter.email||'inbox';
  const allEmails=Array.isArray(state.emails)?state.emails:[];
  const emails=allEmails.filter(function(e){return e.folder===folder;});
  const unread=allEmails.filter(function(e){return e.folder==='inbox'&&!e.read;}).length;

  const folderTabs=[
    {v:'inbox',l:'Inbox',i:'inbox',badge:unread},
    {v:'sent',l:'Sent',i:'send',badge:0},
    {v:'templates',l:'Templates',i:'file',badge:0}
  ].map(function(t){
    return'<button class="chip'+(folder===t.v?' active':'')+'" onclick="setFilter(\'email\',\''+t.v+'\');navigate(\'email\')">'
      +icon(t.i,'sm')+' '+t.l
      +(t.badge?'<span class="nbadge" style="position:relative;top:auto;left:auto;margin-left:5px">'+t.badge+'</span>':'')
      +'</button>';
  }).join('');

  var mainContent='';

  if(folder==='templates'){
    mainContent='<div class="quick-grid">'
      +EMAIL_TEMPLATES.map(function(t){
        return'<div class="template-card" onclick="composeFromTemplate(\''+t.id+'\')" role="button" tabindex="0">'
          +'<div style="display:flex;align-items:center;gap:9px;margin-bottom:9px">'
            +'<div style="width:32px;height:32px;border-radius:8px;background:'+t.color+'22;color:'+t.color+';display:flex;align-items:center;justify-content:center">'+icon(t.icon)+'</div>'
            +'<div class="template-name">'+esc(t.name)+'</div>'
          +'</div>'
          +'<div class="template-subject">'+esc(t.subject)+'</div>'
          +'<div style="margin-top:10px"><span class="badge b-info">'+icon('mail','sm')+' Use Template</span></div>'
          +'</div>';
      }).join('')
      +'</div>';
  } else {
    var sel=_emailView?allEmails.find(function(e){return e.id===_emailView;}):null;
    if(sel&&sel.folder!==folder)sel=null;

    var listHtml=emails.length===0
      ?'<div class="email-empty-state">'+icon('mail')+'<div style="font-size:.84rem">No emails in '+esc(folder)+'</div></div>'
      :emails.map(function(e){
        var ini=(e.fromName||e.from).split(' ').map(function(w){return w[0]||'';}).join('').slice(0,2).toUpperCase();
        const pallete=['#00c8ff','#ff6b35','#8b5cf6','#d4a23c','#00e87a','#3b82f6'];
        var col=pallete[(e.from||'').charCodeAt(0)%pallete.length];
        return'<div class="email-item'+(e.read?'':' unread')+(e.id===_emailView?' active':'')+'" onclick="viewEmail(\''+e.id+'\')">'
          +'<div class="email-avatar" style="background:'+col+'22;color:'+col+'">'+esc(ini)+'</div>'
          +'<div class="f1 min-w0">'
            +'<div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px">'
              +'<div class="email-sender">'+esc(e.fromName||e.from)+'</div>'
              +'<div class="email-time">'+fmtD(e.date)+'</div>'
            +'</div>'
            +'<div class="email-subject">'+esc(e.subject)+'</div>'
            +'<div class="email-preview">'+esc(e.body.slice(0,90))+'</div>'
          +'</div>'
          +(!e.read?'<div class="email-dot"></div>':'')
          +'</div>';
      }).join('');

    var detailHtml=sel
      ?'<div class="email-body-card">'
          +'<div class="email-body-actions">'
            +'<button class="btn btn-sec btn-sm" onclick="replyEmail(\''+sel.id+'\')">'+icon('reply','sm')+' Reply</button>'
            +'<button class="btn btn-sec btn-sm" onclick="forwardEmail(\''+sel.id+'\')">'+icon('send','sm')+' Forward</button>'
            +'<button class="btn btn-danger btn-sm" onclick="deleteEmail(\''+sel.id+'\')">'+icon('trash','sm')+' Delete</button>'
          +'</div>'
          +'<div class="email-body-header">'
            +'<div class="email-body-subject">'+esc(sel.subject)+'</div>'
            +'<div class="email-body-meta">'
              +'<strong>From:</strong> '+esc(sel.fromName||sel.from)+' &lt;'+esc(sel.from)+'&gt;<br>'
              +'<strong>To:</strong> '+esc(sel.to)+'<br>'
              +'<strong>Date:</strong> '+new Date(sel.date).toLocaleString('en-GB',{dateStyle:'full',timeStyle:'short'})
            +'</div>'
          +'</div>'
          +'<div class="email-body-text">'+esc(sel.body)+'</div>'
        +'</div>'
      :'<div class="email-body-card"><div class="email-empty-state">'+icon('mail')+'<div style="font-size:.84rem">Select an email to read</div></div></div>';

    mainContent='<div class="email-layout">'
      +'<div class="email-panel"><div style="padding:10px 13px;border-bottom:1px solid var(--border2);display:flex;justify-content:space-between;align-items:center"><span style="font-size:.72rem;font-weight:700;color:var(--muted)">'+emails.length+' message'+(emails.length!==1?'s':'')+'</span>'+(unread&&folder==='inbox'?'<span class="badge b-info">'+unread+' unread</span>':'')+'</div><div class="email-list">'+listHtml+'</div></div>'
      +'<div>'+detailHtml+'</div>'
      +'</div>';
  }

  $('view').innerHTML=pageHead('Email','mail',folder.charAt(0).toUpperCase()+folder.slice(1)+' · '+emails.length+' message'+(emails.length!==1?'s':''),
    '<button class="btn btn-primary btn-sm" onclick="composeEmail()">'+icon('plus','sm')+' Compose</button>')
    +'<div class="chips">'+folderTabs+'</div>'
    +mainContent;
};

function viewEmail(id){
  var em=state.emails.find(function(e){return e.id===id;});
  if(!em)return;
  _emailView=id;
  if(!em.read){em.read=true;save();updateBadges();}
  if(current==='email')PAGES.email();
}

function composeEmail(opts){
  opts=opts||{};
  var contactOpts=state.contacts.map(function(c){
    return'<option value="'+esc(c.email)+'">'+esc(c.name)+' — '+esc(c.company)+'</option>';
  }).join('');
  $('emailSheetBody').innerHTML=
    '<div style="background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.3);border-radius:8px;padding:9px 12px;margin-bottom:12px;font-size:.72rem;color:var(--amber)">'+icon('alert','sm')+' Emails are saved locally for records only — they are not delivered via SMTP.</div>'
    +'<div class="f-group"><label class="f-label" for="em-to">To</label>'
      +'<input id="em-to" list="em-contacts" value="'+esc(opts.to||'')+'" placeholder="recipient@email.com" maxlength="200">'
      +'<datalist id="em-contacts">'+contactOpts+'</datalist>'
    +'</div>'
    +'<div class="f-group"><label class="f-label" for="em-subject">Subject</label>'
      +'<input id="em-subject" value="'+esc(opts.subject||'')+'" placeholder="Email subject" maxlength="200">'
    +'</div>'
    +'<div class="f-group"><label class="f-label" for="em-body">Message</label>'
      +'<textarea id="em-body" style="min-height:200px;font-family:inherit">'+esc(opts.body||'')+'</textarea>'
    +'</div>';
  $('emailSend').onclick=sendEmail;
  openSheet('emailSheet');
}

function composeFromTemplate(tplId){
  var tpl=EMAIL_TEMPLATES.find(function(t){return t.id===tplId;});
  if(!tpl)return;
  composeEmail({subject:tpl.subject,body:tpl.body});
}

function replyEmail(id){
  var em=state.emails.find(function(e){return e.id===id;});
  if(!em)return;
  composeEmail({
    to:em.from,
    subject:'RE: '+em.subject,
    body:'\n\n--- Original Message ---\nFrom: '+(em.fromName||em.from)+'\nDate: '+new Date(em.date).toLocaleString('en-GB')+'\n\n'+em.body
  });
}

function forwardEmail(id){
  var em=state.emails.find(function(e){return e.id===id;});
  if(!em)return;
  composeEmail({
    subject:'FWD: '+em.subject,
    body:'\n\n--- Forwarded Message ---\nFrom: '+(em.fromName||em.from)+'\nTo: '+em.to+'\nDate: '+new Date(em.date).toLocaleString('en-GB')+'\nSubject: '+em.subject+'\n\n'+em.body
  });
}

function sendEmail(){
  var to=($('em-to')||{}).value||'';
  var subject=($('em-subject')||{}).value||'';
  var body=($('em-body')||{}).value||'';
  if(!to.trim()){toast('Please add a recipient');return;}
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())){toast('Invalid email address — check the To field');return;}
  if(!subject.trim()){toast('Please add a subject');return;}
  var em={
    id:uid('EM'),
    folder:'sent',
    from:'manager@apex.com',
    fromName:state.settings.name||'Manager',
    to:sanitize(to,200),
    subject:sanitize(subject,200),
    body:sanitize(body,4000),
    date:new Date().toISOString(),
    read:true,
    priority:'med'
  };
  if(!Array.isArray(state.emails))state.emails=[];
  state.emails.unshift(em);
  save();
  closeAllSheets();
  haptic();
  toast('Email sent to '+em.to,'View',function(){_emailView=em.id;setFilter('email','sent');navigate('email');});
}

function deleteEmail(id){
  var email=state.emails.find(function(e){return e.id===id;});
  if(!email)return;
  var wasView=_emailView===id;
  state.emails=state.emails.filter(function(e){return e.id!==id;});
  if(wasView)_emailView=null;
  save();haptic();navigate('email');
  toast('Email deleted','Undo',function(){
    state.emails.unshift(email);
    save();rerender();
  });
}

function openOrderEmail(type,id){
  if(type==='dispatch'){
    var ord=state.orders.find(function(o){return o.id===id;});
    if(!ord)return;
    var ct=state.contacts.find(function(c){return c.company===ord.customer;});
    var dispatchTpl=EMAIL_TEMPLATES.find(function(t){return t.id==='TPL-03';});
    composeEmail({
      to:ct?ct.email:'',
      subject:'Your Order Has Been Dispatched — '+ord.id,
      body:(dispatchTpl?dispatchTpl.body:'')
        .replace(/\[Customer Name\]/g,ord.customer)
        .replace(/\[Order Ref\]/g,ord.id)
        .replace(/\[Carrier\]/g,ord.carrier||'')
        .replace(/\[Tracking No\]/g,'[Add tracking number]')
        .replace(/\[Date\]/g,fmtD(ord.due))
        .replace(/\[Your Name\]/g,state.settings.name||'Manager')
    });
  }else if(type==='po'){
    var po=state.inbound.find(function(p){return p.id===id;});
    if(!po)return;
    var poTpl=EMAIL_TEMPLATES.find(function(t){return t.id==='TPL-01';});
    composeEmail({
      to:'',
      subject:'Purchase Order — '+po.po,
      body:(poTpl?poTpl.body:'')
        .replace(/\[Supplier Name\]/g,po.supplier||'')
        .replace(/\[Item Name\]/g,po.lines||'')
        .replace(/\[Qty\]/g,'')
        .replace(/\[Price\]/g,'')
        .replace(/\[Date\]/g,fmtD(po.expected))
        .replace(/\[Your Name\]/g,state.settings.name||'Manager')
    });
  }else if(type==='contact'){
    var con=state.contacts.find(function(c){return c.id===id;});
    if(!con)return;
    composeEmail({to:con.email,subject:'',body:''});
  }
}

/* ════ MODULES + QUICK SHEETS ════ */
function buildModSheet(){
  var secs={};
  MODULES.forEach(function(m){(secs[m.s]=secs[m.s]||[]).push(m);});
  $('modSheetBody').innerHTML=Object.keys(secs).map(function(s){
    return'<div class="mod-section">'+esc(s)+'</div><div class="mod-grid">'+secs[s].map(function(m){
      return'<button class="mod-cell" onclick="navigate(\''+m.id+'\')">'+(m.id==='store'?'<span class="nbadge" data-mod-badge="store" style="display:none">0</span>':'')+icon(m.i)+'<span>'+esc(m.l)+'</span></button>';
    }).join('')+'</div>';
  }).join('');
}
function buildQuickSheet(){
  var quick=[
    {f:'tasks',l:'Task',i:'check'},{f:'alerts',l:'Alert',i:'bell'},{f:'deals',l:'Deal',i:'briefcase'},{f:'contacts',l:'Contact',i:'user'},
    {f:'inventory',l:'SKU',i:'package'},{f:'workorders',l:'Work Order',i:'clipboard'},{f:'workers',l:'Employee',i:'users'},{f:'holidays',l:'Leave',i:'umbrella'},
    {f:'courses',l:'Course',i:'book'},{f:'students',l:'Student',i:'cap'},{f:'quality',l:'Inspection',i:'shield'},{f:'inbound',l:'PO',i:'truck'}
  ];
  $('quickGrid').innerHTML=quick.map(function(q){
    return'<button class="mod-cell" onclick="openForm(\''+q.f+'\')">'+icon(q.i)+'<span>'+esc(q.l)+'</span></button>';
  }).join('');
}

/* ════ GLOBAL SEARCH ════ */
const SEARCH_SOURCES=[
 {col:'contacts',page:'contacts',i:'user',txt:function(x){return x.name+' '+x.company+' '+x.email;},title:function(x){return x.name;},sub:function(x){return x.company;}},
 {col:'deals',page:'crm',i:'briefcase',txt:function(x){return x.company+' '+x.contact;},title:function(x){return x.company;},sub:function(x){return money(x.value)+' · '+x.stage;}},
 {col:'inventory',page:'inventory',i:'package',txt:function(x){return x.sku+' '+x.name+' '+x.supplier;},title:function(x){return x.name;},sub:function(x){return x.sku+' · '+x.qty+' in stock';}},
 {col:'workers',page:'workforce',i:'users',txt:function(x){return x.name+' '+x.role+' '+x.dept;},title:function(x){return x.name;},sub:function(x){return x.role;}},
 {col:'tasks',page:'tasks',i:'check',txt:function(x){return x.title+' '+x.desc;},title:function(x){return x.title;},sub:function(x){return x.status+' · due '+fmtD(x.due);}},
 {col:'courses',page:'courses',i:'book',txt:function(x){return x.title+' '+x.category;},title:function(x){return x.title;},sub:function(x){return money(x.price);}},
 {col:'students',page:'students',i:'cap',txt:function(x){return x.name+' '+x.email;},title:function(x){return x.name;},sub:function(x){return(x.progress||0)+'% progress';}},
 {col:'orders',page:'outbound',i:'send',txt:function(x){return x.id+' '+x.customer;},title:function(x){return x.customer;},sub:function(x){return x.id+' · '+x.status;}},
 {col:'equipment',page:'equipment',i:'tool',txt:function(x){return x.name+' '+x.type;},title:function(x){return x.name;},sub:function(x){return x.status;}},
 {col:'alerts',page:'alerts',i:'bell',txt:function(x){return x.msg+' '+x.source;},title:function(x){return x.msg;},sub:function(x){return x.source;}}
];
function runGlobalSearch(){
  var q=$('gSearchInput').value.trim().toLowerCase();
  var out=$('gSearchResults');
  if(q.length<2){out.innerHTML='<div class="empty">'+icon('search')+'Type at least 2 characters</div>';return;}
  var html='';
  SEARCH_SOURCES.forEach(function(src){
    var hits=state[src.col].filter(function(x){return src.txt(x).toLowerCase().includes(q);}).slice(0,5);
    if(!hits.length)return;
    var mod=MODULES.find(function(m){return m.id===src.page;});
    html+='<div class="mod-section">'+esc(mod?mod.l:src.col)+'</div>'+hits.map(function(h){
      return'<div class="row" style="margin-bottom:7px" onclick="navigate(\''+src.page+'\')"><div class="row-top"><div style="display:flex;gap:9px;align-items:center;min-width:0">'+icon(src.i)+'<div style="min-width:0"><div class="row-title" style="font-size:.8rem">'+esc(src.title(h))+'</div><div class="row-sub">'+esc(src.sub(h))+'</div></div></div>'+icon('right','sm')+'</div></div>';
    }).join('');
  });
  out.innerHTML=html||'<div class="empty">'+icon('search')+'No matches for "'+esc(q)+'"</div>';
}

/* ════ AI COPILOT ════ */
let copMsgs=[];
function copilotContext(){
  var unread=state.alerts.filter(function(a){return!a.read;});
  return'Live workspace snapshot: '
    +state.deals.length+' deals ('+money(state.deals.reduce(function(s,d){return s+d.value;},0))+' pipeline), '
    +state.inventory.filter(function(i){return i.qty<=i.reorder;}).length+' low-stock SKUs, '
    +state.production.filter(function(p){return p.status==='running';}).length+'/'+state.production.length+' lines running, '
    +state.tasks.filter(function(t){return t.status!=='done';}).length+' open tasks, '
    +state.workers.length+' employees, '+state.students.length+' academy students. '
    +'Unread alerts: '+(unread.map(function(a){return a.priority+': '+sanitize(a.msg,100);}).join('; ')||'none')+'.';
}
function appendCop(role,text){
  var d=document.createElement('div');
  d.className='cmsg '+role;
  d.textContent=text;
  $('copMsgs').appendChild(d);
  $('copMsgs').scrollTop=$('copMsgs').scrollHeight;
  return d;
}
async function sendCopilot(msgOverride){
  var inp=$('copInput');
  var msg=sanitize(msgOverride||inp.value,1000);
  if(!msg)return;
  inp.value='';
  if(!navigator.onLine){appendCop('bot','You are offline. Connect to the internet to use the AI Copilot.');return;}
  if(!rlOK()){appendCop('bot','Rate limit reached (10 requests/min). Please wait a moment.');return;}
  appendCop('user',msg);
  copMsgs.push({role:'user',content:msg.slice(0,4000)});
  if(copMsgs.length>40)copMsgs=copMsgs.slice(-24);
  var think=appendCop('think','Thinking…');
  var safeMsgs=copMsgs.slice(-12).map(function(m){
    return{role:m.role==='assistant'?'assistant':'user',content:String(m.content||'').slice(0,4000)};
  });
  var systemPrompt='You are the '+BRAND.copilotName+' for '+BRAND.name+', a mobile enterprise command app covering CRM, warehouse, production/OEE, e-learning academy, workforce and compliance. Be concise, direct and actionable — short answers suit a phone screen. '+copilotContext();

  /* Try server-side proxy first; fall back to direct API with user's stored key */
  function doFetch(url,headers,bodyExtra){
    return fetch(url,{
      method:'POST',
      headers:headers,
      body:JSON.stringify(Object.assign({system:systemPrompt,messages:safeMsgs},bodyExtra||{}))
    }).then(function(r){
      if(r.status===503||r.status===404)return Promise.reject(Object.assign(new Error('proxy-unavailable'),{status:r.status}));
      if(!r.ok){return r.json().then(function(e){throw new Error((e.error&&e.error.message)||'API error '+r.status);}).catch(function(){throw new Error('API error '+r.status);});}
      return r.json();
    });
  }

  doFetch('/api/copilot',{'Content-Type':'application/json'}).catch(function(){
    /* Proxy unavailable (any error: 503, CORS, network) — fall back to direct API */
    return getApiKey().then(function(key){
      if(!key||!/^sk-ant-/.test(key)){return Promise.reject(new Error('no-key'));}
      return doFetch('https://api.anthropic.com/v1/messages',{
        'Content-Type':'application/json',
        'x-api-key':key,
        'anthropic-version':'2023-06-01',
        'anthropic-dangerous-direct-browser-access':'true'
      },{model:'claude-sonnet-4-6',max_tokens:1024});
    });
  }).then(function(d){
    think.remove();
    if(d.error){appendCop('bot','API error: '+esc(d.error.message));return;}
    var reply=(d.content&&d.content[0]&&d.content[0].text)||'No response';
    copMsgs.push({role:'assistant',content:reply});
    appendCop('bot',reply);
  }).catch(function(err){
    think.remove();
    if(err.message==='no-key'){appendCop('bot','AI Copilot is not available right now. Please contact your administrator.');return;}
    appendCop('bot','Request failed — please check your internet connection and try again.');
    console.error('Copilot error:',err);
  });
}
function openCopilot(){
  openSheet('copilotSheet');
  if(!$('copMsgs').children.length){
    appendCop('bot','Hi '+state.settings.name+' — I can summarise alerts, suggest priorities, or answer questions about your live operations. How can I help?');
    $('copSugg').innerHTML=['What should I prioritise today?','Summarise unread alerts','Which SKUs need reordering?','How is production performing?'].map(function(s){
      return'<button class="chip" onclick="sendCopilot(\''+s.replace(/'/g,"\\'")+'\')">'+esc(s)+'</button>';
    }).join('');
  }
}

/* ════ API KEY ENCRYPTION ════
   API key is encrypted with AES-GCM using a key derived from the PIN.
   The raw key never touches localStorage — only the encrypted blob does.
   When no PIN is set, the key falls back to plaintext (same as before).
   _encKey holds the CryptoKey in memory for the current session only.     */
var _encKey=null;
const EK='apexone_api_enc'; /* encrypted API key storage key */

async function deriveEncKey(pin,salt){
  /* Derive a 256-bit AES-GCM key from the PIN using PBKDF2 (separate from auth hash) */
  const raw=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey(
    {name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode('apexenc:'+salt),iterations:PIN_ITER},
    raw,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function encryptApiKey(plainKey,encKey){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},encKey,new TextEncoder().encode(plainKey));
  return JSON.stringify({iv:Array.from(iv),ct:Array.from(new Uint8Array(ct))});
}
async function decryptApiKey(blob,encKey){
  try{
    const {iv,ct}=JSON.parse(blob);
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(iv)},encKey,new Uint8Array(ct));
    return new TextDecoder().decode(plain);
  }catch(e){return null;}
}
/* Read API key — returns plaintext regardless of storage format */
async function getApiKey(){
  if(_encKey){
    const enc=localStorage.getItem(EK);
    if(enc)return decryptApiKey(enc,_encKey);
  }
  /* Fallback: unencrypted (no PIN set, or session just started) */
  return localStorage.getItem('apexone_api');
}
/* Write API key — encrypts if PIN+encKey available, else stores plaintext */
async function storeApiKey(plainKey){
  if(_encKey){
    localStorage.setItem(EK,await encryptApiKey(plainKey,_encKey));
    localStorage.removeItem('apexone_api'); /* migrate away from plaintext */
  }else{
    localStorage.setItem('apexone_api',plainKey);
    localStorage.removeItem(EK);
  }
}
async function removeApiKey(){
  _encKey=null;
  localStorage.removeItem('apexone_api');
  localStorage.removeItem(EK);
}
/* Called at unlock — migrate existing plaintext key to encrypted storage */
async function migrateApiKeyToEncrypted(encKey){
  const plain=localStorage.getItem('apexone_api');
  if(plain&&plain.startsWith('sk-ant-')){
    localStorage.setItem(EK,await encryptApiKey(plain,encKey));
    localStorage.removeItem('apexone_api');
  }
}


let pinBuf='';
function buildPinPad(){
  var keys=['1','2','3','4','5','6','7','8','9','C','0','⌫'];
  var labels={'C':'Clear PIN','⌫':'Backspace','0':'Digit 0','1':'Digit 1','2':'Digit 2','3':'Digit 3','4':'Digit 4','5':'Digit 5','6':'Digit 6','7':'Digit 7','8':'Digit 8','9':'Digit 9'};
  $('pinPad').innerHTML=keys.map(function(k){
    var lbl=labels[k]?(' aria-label="'+labels[k]+'"'):'';
    return'<button class="pin-key" data-pk="'+k+'"'+lbl+'>'+k+'</button>';
  }).join('');
  $('pinPad').querySelectorAll('.pin-key').forEach(function(b){
    b.addEventListener('click',function(){pinPress(b.getAttribute('data-pk'));});
  });
}
function pinPress(k){
  haptic();
  if(k==='C')pinBuf='';
  else if(k==='⌫')pinBuf=pinBuf.slice(0,-1);
  else if(pinBuf.length<4)pinBuf+=k;
  renderPinDots();
  if(pinBuf.length===4)checkPin();
}
function renderPinDots(){
  var dots=$('pinDots').children;
  for(var i=0;i<4;i++)dots[i].classList.toggle('fill',i<pinBuf.length);
}
/* Brute-force lockout: 5 free attempts, then exponential cool-down (30s, 60s, 120s…) */
const FK='apexone_pinfail';
function pinLockout(){
  var f=JSON.parse(localStorage.getItem(FK)||'{"n":0,"until":0}');
  return f.until>Date.now()?Math.ceil((f.until-Date.now())/1000):0;
}
function pinFail(){
  var f=JSON.parse(localStorage.getItem(FK)||'{"n":0,"until":0}');
  f.n++;
  if(f.n>=5)f.until=Date.now()+30000*Math.pow(2,Math.min(f.n-5,6));
  localStorage.setItem(FK,JSON.stringify(f));
  return f;
}
async function checkPin(){
  var stored=JSON.parse(localStorage.getItem(PK)||'null');
  if(!stored){unlock();return;}
  var wait=pinLockout();
  if(wait){
    $('lockMsg').textContent='Too many attempts — locked for '+wait+'s';
    pinBuf='';renderPinDots();
    return;
  }
  var entered=pinBuf;
  pinBuf='';renderPinDots();
  $('lockMsg').textContent='Checking…';
  var ok;
  if(stored.v===2){
    ok=(await pinHash(entered,stored.salt,stored.iter))===stored.hash;
  }else{
    /* legacy single-round hash — verify, then upgrade in place to PBKDF2 */
    ok=(await sha256(stored.salt+entered))===stored.hash;
    if(ok){
      var salt=randSalt();
      localStorage.setItem(PK,JSON.stringify({v:2,salt:salt,iter:PIN_ITER,hash:await pinHash(entered,salt,PIN_ITER)}));
    }
  }
  if(ok){
    localStorage.removeItem(FK);
    /* Derive AES-GCM encryption key from PIN and migrate any plaintext API key */
    deriveEncKey(entered,stored.salt).then(function(ek){
      _encKey=ek;
      migrateApiKeyToEncrypted(ek);
    });
    unlock();
  }else{
    var f=pinFail();
    var w=pinLockout();
    $('lockMsg').textContent=w?'Too many attempts — locked for '+w+'s':'Wrong PIN — '+(5-f.n)+' attempt'+(5-f.n===1?'':'s')+' left';
    if(navigator.vibrate)try{navigator.vibrate([60,40,60]);}catch(e){}
  }
}
function unlock(){pinBuf='';renderPinDots();$('lockScreen').classList.remove('show');lastActive=Date.now();}
/* ════ ACCESS CODE GATE ════ */
function showAccessGate(){
  var overlay=document.createElement('div');
  overlay.id='accessGate';
  overlay.style.cssText='position:fixed;inset:0;z-index:9999;background:var(--bg);display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML='<div style="max-width:380px;width:100%;text-align:center">'
    +'<div style="font-size:2rem;font-weight:800;margin-bottom:6px">'+esc(BRAND.name)+'</div>'
    +'<div style="color:var(--muted);margin-bottom:24px;font-size:.85rem">'+esc(BRAND.tagline)+'</div>'
    +'<div class="f-group" style="text-align:left"><label class="f-label">Access Code</label><input id="accessInput" type="password" placeholder="Enter your access code" autocomplete="off" style="width:100%;padding:12px;border-radius:10px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:1rem"></div>'
    +'<button id="accessBtn" class="btn btn-primary btn-block" style="margin-top:12px;padding:14px">Unlock</button>'
    +'<div id="accessErr" style="color:var(--red);font-size:.78rem;margin-top:10px"></div>'
    +'</div>';
  document.body.appendChild(overlay);
  setTimeout(function(){$('accessInput').focus();},100);
  $('accessBtn').addEventListener('click',checkAccess);
  $('accessInput').addEventListener('keydown',function(e){if(e.key==='Enter')checkAccess();});
}
function checkAccess(){
  var code=$('accessInput').value.trim();
  if(code===BRAND.accessCode){
    localStorage.setItem('apexone_access_granted','1');
    var gate=$('accessGate');if(gate)gate.remove();
  }else{
    $('accessErr').textContent='Invalid access code. Please try again.';
    $('accessInput').value='';$('accessInput').focus();
  }
}
function lockNow(){
  if(!localStorage.getItem(PK))return;
  _encKey=null;
  pinBuf='';renderPinDots();
  $('lockMsg').textContent='Enter your PIN to unlock';
  $('lockScreen').classList.add('show');
}
async function setupPin(){
  formCtx=null;
  $('formTitle').innerHTML=icon('key')+' Set up PIN lock';
  $('formBody').innerHTML='<div class="f-group"><label class="f-label">New 4-digit PIN</label><input id="pinA" type="password" inputmode="numeric" maxlength="4" pattern="[0-9]*" autocomplete="off"></div>'
    +'<div class="f-group"><label class="f-label">Confirm PIN</label><input id="pinB" type="password" inputmode="numeric" maxlength="4" pattern="[0-9]*" autocomplete="off"></div>'
    +'<div class="row-sub">'+icon('shield','sm')+' Stored on this device only as a salted PBKDF2 hash (150,000 rounds). 5 wrong attempts triggers a cool-down.</div>';
  $('formSave').onclick=async function(){
    var a=$('pinA').value,b=$('pinB').value;
    if(!/^\d{4}$/.test(a)){toast('PIN must be exactly 4 digits');return;}
    if(/^(\d)\1{3}$|^(0123|1234|2345|3456|4567|5678|6789|9876|8765|7654|6543|5432|4321|3210|2580|0852)$/.test(a)){toast('PIN too easy to guess — pick another');return;}
    if(a!==b){toast('PINs do not match');return;}
    var salt=randSalt();
    localStorage.setItem(PK,JSON.stringify({v:2,salt:salt,iter:PIN_ITER,hash:await pinHash(a,salt,PIN_ITER)}));
    localStorage.removeItem(FK);
    /* Derive enc key from new PIN — re-encrypt any existing API key */
    _encKey=await deriveEncKey(a,salt);
    await migrateApiKeyToEncrypted(_encKey);
    closeAllSheets();
    $('formSave').onclick=submitForm;
    toast('PIN lock enabled');rerender();
  };
  openSheet('formSheet');
}
function removePin(){
  toast('Remove PIN lock?','CONFIRM',function(){
    localStorage.removeItem(PK);
    localStorage.removeItem('apexone_api_enc');
    _encKey=null;
    toast('PIN lock removed');rerender();
  });
}
let lastActive=Date.now();
['click','touchstart','keydown','scroll'].forEach(function(ev){
  document.addEventListener(ev,function(){lastActive=Date.now();},{passive:true});
});
setInterval(function(){
  if(localStorage.getItem(PK)&&!$('lockScreen').classList.contains('show')&&Date.now()-lastActive>10*60*1000)lockNow();
},30000);

/* ════ LIVE TICKER — nothing static ════ */
var _tickerDirty=false;
setInterval(function(){
  var changed=false;
  state.production.forEach(function(p){
    if(p.status!=='running')return;
    var jit=Math.round((Math.random()-0.45)*10);
    p.actual=Math.max(0,Math.min(Math.round(p.target*1.05),p.actual+jit));
    var made=Math.max(0,Math.round(p.actual/720));
    p.good+=made;p.total+=made;
    /* bound the counters so the live feed can never overflow */
    if(p.total>99999999){p.good=Math.round(p.good/2);p.total=Math.round(p.total/2);}
    var perf=p.target?Math.min(1,p.actual/p.target):0;
    var qual=p.total?p.good/p.total:1;
    p.oee=Math.round(p.uptime/100*perf*qual*100);
    changed=true;
  });
  if(!changed)return;
  _tickerDirty=true;
  var sheetOpen=document.querySelector('.sheet.open');
  var typing=document.activeElement&&['INPUT','TEXTAREA','SELECT'].indexOf(document.activeElement.tagName)>=0;
  if(!sheetOpen&&!typing&&['home','production','analytics'].indexOf(current)>=0)rerender();
},5000);
/* Flush ticker mutations to localStorage every 60 s — avoids a write every 5 s */
setInterval(function(){if(_tickerDirty){_tickerDirty=false;save();}},60000);

/* ════ CLOCK + THEME ════ */
setInterval(function(){
  $('barClock').textContent=new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
},60000);
function applyTheme(){
  var dark=state.settings.dark;
  var root=document.documentElement;
  root.setAttribute('data-theme',dark?'dark':'light');
  /* Also set variables directly — bypasses any stale SW-cached CSS */
  if(!dark){
    root.style.setProperty('--bg','#eef2fb');
    root.style.setProperty('--panel','#ffffff');
    root.style.setProperty('--card','#ffffff');
    root.style.setProperty('--raised','#f0f4ff');
    root.style.setProperty('--border','#cdd8f2');
    root.style.setProperty('--border2','#dde5f7');
    root.style.setProperty('--text','#0f172a');
    root.style.setProperty('--muted','#48597e');
    root.style.setProperty('--dim','#93a3c4');
    root.style.setProperty('--shadow','0 8px 24px rgba(30,50,100,.12)');
  }else{
    root.style.setProperty('--bg','#03050f');
    root.style.setProperty('--panel','#070d1e');
    root.style.setProperty('--card','#0c1428');
    root.style.setProperty('--raised','#111e38');
    root.style.setProperty('--border','#1a2d52');
    root.style.setProperty('--border2','#0f1e3a');
    root.style.setProperty('--text','#e8f4ff');
    root.style.setProperty('--muted','#a8c8ff');
    root.style.setProperty('--dim','#6a8acf');
    root.style.setProperty('--shadow','0 8px 32px rgba(0,0,0,.55)');
  }
  $('themeBtn').innerHTML=icon(dark?'moon':'sun');
  var mt=document.querySelector('meta[name="theme-color"]');
  if(mt)mt.setAttribute('content',dark?'#03050f':'#eef2fb');
}

/* ════ PWA: INSTALL + OFFLINE + SW ════ */
let deferredInstall=null;
window.addEventListener('beforeinstallprompt',function(e){
  e.preventDefault();
  deferredInstall=e;
  if(!localStorage.getItem('apexone_nobanner'))$('installBanner').classList.add('show');
});
function triggerInstall(){
  if(deferredInstall){
    deferredInstall.prompt();
    deferredInstall.userChoice.then(function(){deferredInstall=null;$('installBanner').classList.remove('show');});
  }else{
    toast('Use your browser menu → "Add to Home Screen"');
  }
}
window.addEventListener('appinstalled',function(){
  $('installBanner').classList.remove('show');
  toast('APEX ONE installed — find it on your home screen');
});
function netStatus(){
  $('netDot').classList.toggle('off',!navigator.onLine);
  $('netDot').title=navigator.onLine?'online':'offline';
}
window.addEventListener('online',function(){netStatus();toast('Back online');});
/* UX-01: keyboard activation for onclick divs (Enter / Space) */
document.addEventListener('keydown',function(e){
  if(e.key!=='Enter'&&e.key!==' ')return;
  var el=e.target;
  if(el.tagName==='BUTTON'||el.tagName==='A'||el.tagName==='INPUT'||el.tagName==='SELECT'||el.tagName==='TEXTAREA')return;
  if(el.getAttribute('role')==='button'||el.hasAttribute('onclick')){e.preventDefault();el.click();}
});
window.addEventListener('offline',function(){netStatus();toast('Offline — changes are saved locally');});

/* ════ OBSERVABILITY ════ */
var _OBS_KEY='apexone_obs';
var _obsInit=(function(){try{return JSON.parse(localStorage.getItem(_OBS_KEY)||'[]');}catch(e){return[];}}());
const OBS={errors:_obsInit,MAX_ERRORS:20};
function _obsPersist(){try{localStorage.setItem(_OBS_KEY,JSON.stringify(OBS.errors));}catch(e){}}
/* Global error boundary — catches unhandled JS errors */
window.addEventListener('error',function(e){
  var entry={t:Date.now(),msg:e.message||'Unknown error',file:e.filename?e.filename.split('/').pop():'',line:e.lineno,col:e.colno};
  OBS.errors.unshift(entry);
  if(OBS.errors.length>OBS.MAX_ERRORS)OBS.errors.length=OBS.MAX_ERRORS;
  _obsPersist();
  console.error('[APEX ONE] Uncaught error:',e.message,'at',e.filename+':'+e.lineno);
  /* Show user-friendly toast for non-script-load errors */
  if(!e.filename||e.filename.includes(location.hostname)){
    toast('Unexpected error — please refresh if anything looks wrong');
  }
});
window.addEventListener('unhandledrejection',function(e){
  var entry={t:Date.now(),msg:'Unhandled promise rejection: '+(e.reason&&e.reason.message||String(e.reason))};
  OBS.errors.unshift(entry);
  if(OBS.errors.length>OBS.MAX_ERRORS)OBS.errors.length=OBS.MAX_ERRORS;
  _obsPersist();
  console.error('[APEX ONE] Unhandled rejection:',e.reason);
});
/* Performance timing — log key metrics to console after page load */
window.addEventListener('load',function(){
  if(!window.performance)return;
  var nav=performance.getEntriesByType('navigation')[0];
  if(nav){
    console.info('[APEX ONE] FCP ~'+Math.round(nav.domContentLoadedEventEnd)+'ms · Load ~'+Math.round(nav.loadEventEnd)+'ms');
  }
});
/* Expose error log for debugging in console: apexDebug() */
window.apexDebug=function(){
  console.table(OBS.errors.slice(0,10));
  console.info('State size:',JSON.stringify(state).length,'bytes');
  console.info('localStorage used:',(localStorage.getItem(SK)||'').length,'bytes');
};

function buildSidebar(){
  var sb=$('sidebar');
  if(!sb)return;
  var secs={};
  MODULES.forEach(function(m){(secs[m.s]=secs[m.s]||[]).push(m);});
  sb.innerHTML=Object.keys(secs).map(function(s){
    return'<div class="side-section">'+esc(s)+'</div>'
      +secs[s].map(function(m){
        var badgeHtml=m.id==='email'?'<span class="side-badge" id="sideEmailBadge" style="display:none">0</span>':'';
        return'<button class="side-link" data-side="'+m.id+'" onclick="navigate(\''+m.id+'\')">'+icon(m.i,'sm')+' '+esc(m.l)+badgeHtml+'</button>';
      }).join('');
  }).join('');
}

/* ════ INIT ════ */
function init(){
  /* Apply white-label branding to static HTML elements */
  document.title=BRAND.name;
  var logos=document.querySelectorAll('.brand-logo');
  logos.forEach(function(el){el.textContent=BRAND.short;});
  var lockTitle=$('lockScreenTitle');
  if(lockTitle)lockTitle.textContent=BRAND.name+' Locked';
  var installLabel=document.querySelector('#installBanner .brand-logo');
  var installText=document.querySelector('#installBanner div[style*="font-weight:800"]');
  if(installText)installText.textContent='Install '+BRAND.name;

  load();
  seedIfEmpty();
  applyTheme();
  buildModSheet();
  buildQuickSheet();
  buildSidebar();
  buildPinPad();
  netStatus();
  updateBadges();
  if(localStorage.getItem(PK))lockNow();
  /* nav wiring */
  document.querySelectorAll('.nav-tab').forEach(function(t){
    t.addEventListener('click',function(){
      var n=t.getAttribute('data-nav');
      if(n==='modules'){openSheet('modSheet');updateBadges();}
      else if(n==='copilot')openCopilot();
      else navigate(n);
    });
  });
  $('fabBtn').addEventListener('click',function(){openSheet('quickSheet');});
  $('themeBtn').addEventListener('click',function(){state.settings.dark=!state.settings.dark;applyTheme();save();});
  $('searchBtn').addEventListener('click',function(){openSheet('searchSheet');setTimeout(function(){$('gSearchInput').focus();},300);});
  var searchDeb=null;
  $('gSearchInput').addEventListener('input',function(){clearTimeout(searchDeb);searchDeb=setTimeout(runGlobalSearch,160);});
  $('formSave').onclick=submitForm;
  $('copInput').addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();sendCopilot();}});
  $('installYes').addEventListener('click',triggerInstall);
  $('installNo').addEventListener('click',function(){localStorage.setItem('apexone_nobanner','1');$('installBanner').classList.remove('show');});
  window.addEventListener('hashchange',function(){navigate(location.hash.slice(1)||'home');});
  /* Access code gate — if BRAND.accessCode is set, require it before first use */
  if(BRAND.accessCode&&!localStorage.getItem('apexone_access_granted')){
    showAccessGate();
  }
  navigate(location.hash.slice(1)||'home');
  /* service worker */
  if('serviceWorker'in navigator&&(location.protocol==='https:'||location.hostname==='localhost'||location.hostname==='127.0.0.1')){
    navigator.serviceWorker.register('/sw.js').catch(function(){});
  }
}
document.addEventListener('DOMContentLoaded',init);

/* Expose globals required by inline HTML event handlers */
if(typeof navigate!=='undefined')window.navigate=navigate;
if(typeof closeAllSheets!=='undefined')window.closeAllSheets=closeAllSheets;
if(typeof openSheet!=='undefined')window.openSheet=openSheet;
if(typeof openForm!=='undefined')window.openForm=openForm;
if(typeof sendCopilot!=='undefined')window.sendCopilot=sendCopilot;
if(typeof openCopilot!=='undefined')window.openCopilot=openCopilot;
if(typeof setSearch!=='undefined')window.setSearch=setSearch;
if(typeof setFilter!=='undefined')window.setFilter=setFilter;
if(typeof delItem!=='undefined')window.delItem=delItem;
if(typeof cycleTask!=='undefined')window.cycleTask=cycleTask;
if(typeof ackAlert!=='undefined')window.ackAlert=ackAlert;
if(typeof saveSettings!=='undefined')window.saveSettings=saveSettings;
if(typeof saveApiKey!=='undefined')window.saveApiKey=saveApiKey;
if(typeof clearApiKey!=='undefined')window.clearApiKey=clearApiKey;
if(typeof exportData!=='undefined')window.exportData=exportData;
if(typeof importData!=='undefined')window.importData=importData;
if(typeof resetData!=='undefined')window.resetData=resetData;
if(typeof exportRosterCSV!=='undefined')window.exportRosterCSV=exportRosterCSV;
if(typeof setupPin!=='undefined')window.setupPin=setupPin;
if(typeof removePin!=='undefined')window.removePin=removePin;
if(typeof lockNow!=='undefined')window.lockNow=lockNow;
if(typeof triggerInstall!=='undefined')window.triggerInstall=triggerInstall;
if(typeof toast!=='undefined')window.toast=toast;
if(typeof submitForm!=='undefined')window.submitForm=submitForm;
if(typeof addToCart!=='undefined')window.addToCart=addToCart;
if(typeof checkout!=='undefined')window.checkout=checkout;
if(typeof apexDebug!=='undefined')window.apexDebug=apexDebug;
if(typeof composeEmail!=='undefined')window.composeEmail=composeEmail;
if(typeof composeFromTemplate!=='undefined')window.composeFromTemplate=composeFromTemplate;
if(typeof viewEmail!=='undefined')window.viewEmail=viewEmail;
if(typeof sendEmail!=='undefined')window.sendEmail=sendEmail;
if(typeof deleteEmail!=='undefined')window.deleteEmail=deleteEmail;
if(typeof replyEmail!=='undefined')window.replyEmail=replyEmail;
if(typeof forwardEmail!=='undefined')window.forwardEmail=forwardEmail;
if(typeof openOrderEmail!=='undefined')window.openOrderEmail=openOrderEmail;
if(typeof adjCart!=='undefined')window.adjCart=adjCart;
if(typeof adjStock!=='undefined')window.adjStock=adjStock;
if(typeof advancePO!=='undefined')window.advancePO=advancePO;
if(typeof autoFillRoster!=='undefined')window.autoFillRoster=autoFillRoster;
if(typeof bumpCoverage!=='undefined')window.bumpCoverage=bumpCoverage;
if(typeof bumpProgress!=='undefined')window.bumpProgress=bumpProgress;
if(typeof cycleLine!=='undefined')window.cycleLine=cycleLine;
if(typeof cycleShift!=='undefined')window.cycleShift=cycleShift;
if(typeof closeHR!=='undefined')window.closeHR=closeHR;
if(typeof exportLeaderboard!=='undefined')window.exportLeaderboard=exportLeaderboard;
if(typeof issueCert!=='undefined')window.issueCert=issueCert;
if(typeof logUnits!=='undefined')window.logUnits=logUnits;
if(typeof moveStage!=='undefined')window.moveStage=moveStage;
if(typeof raisePO!=='undefined')window.raisePO=raisePO;
if(typeof serviceNow!=='undefined')window.serviceNow=serviceNow;
if(typeof setHol!=='undefined')window.setHol=setHol;

})()
