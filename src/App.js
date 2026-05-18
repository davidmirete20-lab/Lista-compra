import { useState, useEffect, useRef } from "react";
import { BrowserMultiFormatReader } from "@zxing/library";

// ── Firebase ──────────────────────────────────────────────────────
const FB_URL = "https://lista-de-la-compra-c4da7-default-rtdb.europe-west1.firebasedatabase.app";
async function fbGet(path) { const r = await fetch(`${FB_URL}/${path}.json`); return r.json(); }
async function fbSet(path, data) { await fetch(`${FB_URL}/${path}.json`, { method:"PUT", body:JSON.stringify(data), headers:{"Content-Type":"application/json"} }); }
async function fbPush(path, data) { const r = await fetch(`${FB_URL}/${path}.json`, { method:"POST", body:JSON.stringify(data), headers:{"Content-Type":"application/json"} }); return r.json(); }
async function fbDelete(path) { await fetch(`${FB_URL}/${path}.json`, { method:"DELETE" }); }

// ── Constants ─────────────────────────────────────────────────────
const SUPERMARKETS = ["Mercadona","Carrefour","Lidl","Alcampo","DIA","Family Cash","Consum","Otros"];
const CATEGORIES   = ["Lácteos","Aceites","Panadería","Pasta y arroz","Conservas","Frutas y verduras","Carnes","Bebidas","Limpieza","Otro"];
const UNITS        = ["ud","kg","g","L","ml","pack"];
const EMOJI = {"Lácteos":"🥛","Aceites":"🫙","Panadería":"🍞","Pasta y arroz":"🍝","Conservas":"🥫","Frutas y verduras":"🥦","Carnes":"🥩","Bebidas":"🥤","Limpieza":"🧹","Otro":"🛒"};
const BG    = {"Lácteos":"#FFF8E7","Aceites":"#FFF3E0","Panadería":"#FBE9E7","Pasta y arroz":"#FFF9C4","Conservas":"#F3E5F5","Frutas y verduras":"#E8F5E9","Carnes":"#FCE4EC","Bebidas":"#E3F2FD","Limpieza":"#E0F2F1","Otro":"#F5F5F5"};

const uid  = () => Math.random().toString(36).substr(2,9);
const fmt  = n => parseFloat(n).toFixed(2)+"€";
const best = p => { const e=Object.entries(p||{}); return e.length?e.reduce((a,b)=>a[1]<b[1]?a:b):null; };
const LOCAL_USER_KEY = "compra_username";

// ── Open Food Facts lookup ────────────────────────────────────────
async function lookupBarcode(code) {
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v0/product/${code}.json`);
    const d = await r.json();
    if (d.status === 1 && d.product) {
      const p = d.product;
      const name = p.product_name_es || p.product_name || `Producto ${code}`;
      const cat  = p.categories_tags?.[0]?.replace("en:","") || "Otro";
      const mappedCat = CATEGORIES.find(c =>
        cat.toLowerCase().includes(c.toLowerCase().split(" ")[0].toLowerCase())
      ) || "Otro";
      return { name, category: mappedCat, found: true };
    }
  } catch(e) {}
  return { name: `Producto ${code}`, category: "Otro", found: false };
}

// ── Icons ─────────────────────────────────────────────────────────
const IcoCheck = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const IcoBack  = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M19 12H5M12 5l-7 7 7 7" stroke="#111" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const IcoList  = ({on}) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M3 12h18M3 18h18" stroke={on?"#FF385C":"#BDBDBD"} strokeWidth={on?2.5:2} strokeLinecap="round"/></svg>;
const IcoStar  = ({on}) => <svg width="22" height="22" viewBox="0 0 24 24" fill={on?"#FF385C":"none"}><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" stroke={on?"#FF385C":"#BDBDBD"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const IcoClock = ({on}) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 8v4l3 3" stroke={on?"#FF385C":"#BDBDBD"} strokeWidth={on?2.5:2} strokeLinecap="round"/><circle cx="12" cy="12" r="9" stroke={on?"#FF385C":"#BDBDBD"} strokeWidth={on?2.5:2}/></svg>;
const IcoPlus  = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/></svg>;
const IcoCart  = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" stroke="#FF385C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><line x1="3" y1="6" x2="21" y2="6" stroke="#FF385C" strokeWidth="2"/><path d="M16 10a4 4 0 01-8 0" stroke="#FF385C" strokeWidth="2" strokeLinecap="round"/></svg>;

function Notif({n}) {
  if (!n) return null;
  return <div style={{position:"fixed",top:20,left:"50%",transform:"translateX(-50%)",
    background:n.err?"#FF385C":"#111",color:"#fff",padding:"12px 24px",borderRadius:100,
    fontWeight:700,fontSize:13,zIndex:9999,whiteSpace:"nowrap",
    boxShadow:"0 8px 32px rgba(0,0,0,.2)"}}>{n.msg}</div>;
}

// ── Camera Scanner Component ──────────────────────────────────────
function CameraScanner({ onDetected, onClose }) {
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const [error, setError] = useState(null);
  const [scanning, setScanning] = useState(true);

  useEffect(() => {
    const codeReader = new BrowserMultiFormatReader();
    readerRef.current = codeReader;

    codeReader.decodeFromVideoDevice(null, videoRef.current, (result, err) => {
      if (result && scanning) {
        setScanning(false);
        onDetected(result.getText());
      }
    }).catch(e => {
      setError("No se pudo acceder a la cámara. Asegúrate de dar permiso.");
    });

    return () => { try { codeReader.reset(); } catch(e) {} };
  }, []);

  return (
    <div style={{position:"fixed",inset:0,background:"#000",zIndex:1000,
      display:"flex",flexDirection:"column"}}>
      {/* Header */}
      <div style={{padding:"16px 20px",display:"flex",alignItems:"center",gap:12,
        background:"rgba(0,0,0,.7)"}}>
        <button onClick={onClose}
          style={{width:38,height:38,borderRadius:100,background:"rgba(255,255,255,.15)",
            border:"none",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M19 12H5M12 5l-7 7 7 7" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <span style={{color:"#fff",fontWeight:700,fontSize:17}}>Escanear código de barras</span>
      </div>

      {/* Video */}
      <div style={{flex:1,position:"relative",display:"flex",alignItems:"center",justifyContent:"center"}}>
        <video ref={videoRef} style={{width:"100%",height:"100%",objectFit:"cover"}} playsInline muted/>

        {/* Viewfinder overlay */}
        <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{width:260,height:160,position:"relative"}}>
            {/* Corner brackets */}
            {[{top:0,left:0,borderTop:"3px solid #FF385C",borderLeft:"3px solid #FF385C"},
              {top:0,right:0,borderTop:"3px solid #FF385C",borderRight:"3px solid #FF385C"},
              {bottom:0,left:0,borderBottom:"3px solid #FF385C",borderLeft:"3px solid #FF385C"},
              {bottom:0,right:0,borderBottom:"3px solid #FF385C",borderRight:"3px solid #FF385C"},
            ].map((s,i) => (
              <div key={i} style={{position:"absolute",width:24,height:24,...s}}/>
            ))}
            {/* Scan line */}
            <div style={{position:"absolute",top:"50%",left:0,right:0,height:2,
              background:"rgba(255,56,92,.7)",
              animation:"scanline 2s ease-in-out infinite"}}/>
          </div>
        </div>

        {error && (
          <div style={{position:"absolute",bottom:40,left:20,right:20,
            background:"rgba(255,56,92,.9)",borderRadius:16,padding:"16px",textAlign:"center"}}>
            <p style={{color:"#fff",fontWeight:600,fontSize:14}}>{error}</p>
          </div>
        )}
      </div>

      <div style={{padding:"20px",background:"rgba(0,0,0,.7)",textAlign:"center"}}>
        <p style={{color:"rgba(255,255,255,.6)",fontSize:13}}>Apunta al código de barras del producto</p>
      </div>

      <style>{`@keyframes scanline{0%{top:10%}50%{top:90%}100%{top:10%}}`}</style>
    </div>
  );
}

function PriceEditor({prices, onAdd}) {
  const [sup,setSup] = useState("Mercadona");
  const [val,setVal] = useState("");
  const b = best(prices);
  return (
    <div>
      {Object.entries(prices).sort((a,b)=>a[1]-b[1]).map(([s,p])=>{
        const isBest=b&&b[0]===s;
        return (
          <div key={s} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
            padding:"11px 14px",borderRadius:14,marginBottom:8,
            background:isBest?"#FFF0F2":"#FAFAFA",border:`1.5px solid ${isBest?"#FF385C":"#F0F0F0"}`}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              {isBest&&<span style={{fontSize:10,background:"#FF385C",color:"#fff",padding:"2px 8px",borderRadius:100,fontWeight:800}}>MEJOR</span>}
              <span style={{fontSize:14,color:isBest?"#FF385C":"#888",fontWeight:isBest?600:400}}>{s}</span>
            </div>
            <span style={{fontWeight:700,fontSize:15,color:isBest?"#FF385C":"#111"}}>{fmt(p)}</span>
          </div>
        );
      })}
      <div style={{display:"flex",gap:8,marginTop:10}}>
        <select value={sup} onChange={e=>setSup(e.target.value)}
          style={{flex:1,background:"#F7F7F7",border:"1.5px solid #EFEFEF",borderRadius:12,
            color:"#111",padding:"11px 12px",fontSize:13,outline:"none",fontFamily:"inherit"}}>
          {SUPERMARKETS.map(s=><option key={s}>{s}</option>)}
        </select>
        <input type="number" placeholder="€" value={val} onChange={e=>setVal(e.target.value)}
          style={{width:68,background:"#F7F7F7",border:"1.5px solid #EFEFEF",borderRadius:12,
            color:"#111",padding:"11px 10px",fontSize:14,outline:"none",fontFamily:"inherit"}}/>
        <button onClick={()=>{if(val){onAdd(sup,parseFloat(val));setVal("");}}}
          style={{width:42,height:42,borderRadius:12,border:"none",background:"#FF385C",
            color:"#fff",fontSize:20,fontWeight:700,cursor:"pointer",display:"flex",
            alignItems:"center",justifyContent:"center",flexShrink:0}}>+</button>
      </div>
    </div>
  );
}

function SetupScreen({onDone}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#FF385C");
  const colors = ["#FF385C","#833AB4","#3897F0","#F77737","#2ECC71","#E74C3C"];
  return (
    <div style={{height:"100vh",display:"flex",flexDirection:"column",alignItems:"center",
      justifyContent:"center",padding:"40px 32px",background:"#fff",fontFamily:"'Poppins','Helvetica Neue',sans-serif"}}>
      <div style={{fontSize:64,marginBottom:16}}>🛒</div>
      <h1 style={{fontWeight:800,fontSize:28,letterSpacing:-.5,marginBottom:8,textAlign:"center"}}>Lista de la compra</h1>
      <p style={{fontSize:14,color:"#aaa",marginBottom:40,textAlign:"center"}}>Compartida en tiempo real</p>
      <div style={{width:"100%",maxWidth:320}}>
        <label style={{fontWeight:600,fontSize:13,color:"#888",display:"block",marginBottom:8}}>¿Cómo te llamas?</label>
        <input autoFocus value={name} onChange={e=>setName(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&name.trim()&&onDone(name.trim(),color)}
          placeholder="Tu nombre..."
          style={{width:"100%",background:"#F7F7F7",border:"1.5px solid #EFEFEF",borderRadius:16,
            color:"#111",padding:"16px 18px",fontSize:16,outline:"none",fontFamily:"inherit",
            fontWeight:600,marginBottom:24}}/>
        <label style={{fontWeight:600,fontSize:13,color:"#888",display:"block",marginBottom:12}}>Elige tu color</label>
        <div style={{display:"flex",gap:12,marginBottom:32}}>
          {colors.map(c=>(
            <button key={c} onClick={()=>setColor(c)}
              style={{width:38,height:38,borderRadius:100,
                border:color===c?"3px solid #111":"3px solid transparent",
                background:c,cursor:"pointer",transition:"all .2s"}}/>
          ))}
        </div>
        <button onClick={()=>name.trim()&&onDone(name.trim(),color)}
          style={{width:"100%",background:"#FF385C",border:"none",borderRadius:18,
            padding:"16px 0",fontWeight:700,fontSize:16,color:"#fff",cursor:"pointer",
            opacity:name.trim()?1:.5,transition:"opacity .2s"}}>
          Entrar →
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [meSetup, setMeSetup] = useState(false);
  const [me, setMe] = useState({name:"",color:"#FF385C",id:""});

  const [tab,    setTab]    = useState("list");
  const [sub,    setSub]    = useState(null);
  const [filter, setFilter] = useState("all");

  const [list, setList] = useState([]);
  const [favs, setFavs] = useState([]);
  const [hist, setHist] = useState([]);

  const [selItem, setSelItem] = useState(null);
  const [selHist, setSelHist] = useState(null);
  const [notif,   setNotif]   = useState(null);
  const [online,  setOnline]  = useState(true);

  const [newItem,  setNewItem]  = useState({name:"",category:"Otro",quantity:1,unit:"ud"});

  // Camera & scan state
  const [showCamera,   setShowCamera]   = useState(false);
  const [scanCtx,      setScanCtx]      = useState("list"); // list | favs | execute
  const [scanRes,      setScanRes]      = useState(null);
  const [lookingUp,    setLookingUp]    = useState(false);

  // Execute mode
  const [exItems, setExItems] = useState([]);
  const [exRes,   setExRes]   = useState(null);
  const [exSup,   setExSup]   = useState("Mercadona");
  const [queue,   setQueue]   = useState([]);
  const [curQ,    setCurQ]    = useState(null);

  const lastRef = useRef({list:null,favs:null,hist:null});

  const notify = (msg,err=false) => { setNotif({msg,err}); setTimeout(()=>setNotif(null),2500); };

  useEffect(()=>{
    const saved = localStorage.getItem(LOCAL_USER_KEY);
    if(saved){ setMe(JSON.parse(saved)); setMeSetup(true); }
  },[]);

  const handleSetup = (name,color) => {
    const user={name,color,id:uid()};
    localStorage.setItem(LOCAL_USER_KEY,JSON.stringify(user));
    setMe(user); setMeSetup(true);
  };

  useEffect(()=>{
    if(!meSetup) return;
    loadAll();
    const iv=setInterval(loadAll,3000);
    return ()=>clearInterval(iv);
  },[meSetup]);

  const loadAll = async () => {
    try {
      const [l,f,h]=await Promise.all([fbGet("list"),fbGet("favs"),fbGet("hist")]);
      const toArr=obj=>obj?Object.entries(obj).map(([fbId,v])=>({...v,fbId})):[];
      const nl=toArr(l),nf=toArr(f),nh=toArr(h);
      const sl=JSON.stringify(nl),sf=JSON.stringify(nf),sh=JSON.stringify(nh);
      if(sl!==lastRef.current.list){setList(nl);lastRef.current.list=sl;}
      if(sf!==lastRef.current.favs){setFavs(nf);lastRef.current.favs=sf;}
      if(sh!==lastRef.current.hist){setHist(nh);lastRef.current.hist=sh;}
      setOnline(true);
    } catch(e){setOnline(false);}
  };

  const pending  = list.filter(i=>!i.checked).length;
  const filtered = list.filter(i=>filter==="pending"?!i.checked:filter==="done"?i.checked:true);

  const toggleCheck = async item => {
    const updated={...item,checked:!item.checked};
    setList(p=>p.map(i=>i.fbId===item.fbId?updated:i));
    await fbSet(`list/${item.fbId}`,updated);
  };
  const addToList = async item => { await fbPush("list",item); await loadAll(); };
  const addToFavs = async item => { await fbPush("favs",item); await loadAll(); };
  const delFromList = async item => { await fbDelete(`list/${item.fbId}`); setList(p=>p.filter(i=>i.fbId!==item.fbId)); setSub(null); };
  const delFromFavs = async item => { await fbDelete(`favs/${item.fbId}`); setFavs(p=>p.filter(i=>i.fbId!==item.fbId)); setSub(null); };
  const updateListItem = async (item,changes) => { const u={...item,...changes}; await fbSet(`list/${item.fbId}`,u); setList(p=>p.map(i=>i.fbId===item.fbId?u:i)); setSelItem(u); };
  const updateFavItem  = async (item,changes) => { const u={...item,...changes}; await fbSet(`favs/${item.fbId}`,u); setFavs(p=>p.map(i=>i.fbId===item.fbId?u:i)); setSelItem(u); };

  const handleAdd = async target => {
    if(!newItem.name.trim()) return;
    const item={name:newItem.name,category:newItem.category,quantity:newItem.quantity,
      unit:newItem.unit,addedBy:me.name,addedByColor:me.color,prices:{},checked:false,createdAt:Date.now()};
    if(target==="list") await addToList(item);
    else await addToFavs(item);
    setNewItem({name:"",category:"Otro",quantity:1,unit:"ud"});
    notify(`"${item.name}" añadido`);
    setSub(null);
  };

  const favToList = async fav => {
    if(list.find(i=>i.name===fav.name)){notify("Ya está en la lista",true);return;}
    await addToList({...fav,fbId:undefined,checked:false,addedBy:me.name,addedByColor:me.color,createdAt:Date.now()});
    notify(`"${fav.name}" añadido a la lista ✓`);
  };

  // ── Camera detected barcode ──
  const handleBarcodeDetected = async code => {
    setShowCamera(false);
    setLookingUp(true);
    notify("Buscando producto...");
    const result = await lookupBarcode(code);
    setLookingUp(false);
    if(scanCtx==="execute"){
      setExRes(result);
    } else {
      setScanRes(result);
      setSub("scanAdd");
    }
    if(!result.found) notify("Producto no encontrado, edita el nombre",true);
  };

  const addScanned = async () => {
    if(!scanRes) return;
    const item={name:scanRes.name,category:scanRes.category,quantity:1,unit:"ud",
      addedBy:me.name,addedByColor:me.color,prices:{},checked:false,createdAt:Date.now()};
    if(scanCtx==="list") await addToList(item);
    else await addToFavs(item);
    setScanRes(null); setSub(null);
    notify(`"${item.name}" añadido`);
  };

  const openCamera = ctx => { setScanCtx(ctx); setScanRes(null); setShowCamera(true); };

  // ── Execute ──
  const startExecute = () => { setExItems([]); setExRes(null); setSub("execute"); };
  const finishExecute = () => {
    const notDone=list.filter(i=>!i.checked&&!exItems.find(s=>s.name===i.name));
    if(notDone.length){setQueue(notDone);setCurQ(notDone[0]);setSub("resolve");}
    else saveCompra();
  };
  const resolveQ = async action => {
    if(action==="dismiss") await delFromList(curQ);
    const rest=queue.slice(1);
    if(rest.length){setQueue(rest);setCurQ(rest[0]);}
    else{setQueue([]);setCurQ(null);saveCompra();}
  };
  const saveCompra = async () => {
    const total=exItems.reduce((s,i)=>s+(i.price||0),0);
    const date=new Date().toLocaleDateString("es-ES",{day:"numeric",month:"short",year:"numeric"});
    await fbPush("hist",{date,total,supermarket:exSup,items:exItems,savedBy:me.name,createdAt:Date.now()});
    for(const ex of exItems){
      const found=list.find(i=>i.name===ex.name);
      if(found) await fbSet(`list/${found.fbId}`,{...found,checked:true});
    }
    await loadAll();
    setExItems([]); setSub(null); setTab("history");
    notify("¡Compra guardada!");
  };

  const histToList = async hi => {
    if(list.find(i=>i.name===hi.name)){notify("Ya en la lista",true);return;}
    await addToList({name:hi.name,category:hi.category,quantity:hi.quantity,unit:hi.unit||"ud",
      addedBy:me.name,addedByColor:me.color,prices:{},checked:false,createdAt:Date.now()});
    notify(`"${hi.name}" añadido`);
  };
  const histToFavs = async hi => {
    if(favs.find(i=>i.name===hi.name)){notify("Ya en favoritos",true);return;}
    await addToFavs({name:hi.name,category:hi.category,quantity:hi.quantity||1,unit:hi.unit||"ud",
      addedBy:me.name,addedByColor:me.color,prices:{},createdAt:Date.now()});
    notify(`"${hi.name}" en favoritos ⭐`);
  };
  const repeatCompra = async h => {
    for(const hi of h.items){
      if(!list.find(i=>i.name===hi.name))
        await addToList({name:hi.name,category:hi.category,quantity:hi.quantity,unit:hi.unit||"ud",
          addedBy:me.name,addedByColor:me.color,prices:{},checked:false,createdAt:Date.now()});
    }
    notify("Compra añadida a la lista ✓");
    setSub(null); setTab("list");
  };

  const inp={width:"100%",background:"#F7F7F7",border:"1.5px solid #EFEFEF",borderRadius:14,
    color:"#111",padding:"14px 16px",fontSize:15,outline:"none",fontFamily:"inherit"};

  const subTitle=sub==="addItem"?"Añadir producto":sub==="scanAdd"?"Producto escaneado"
    :sub==="detail"?selItem?.name:sub==="execute"?"Haciendo la compra"
    :sub==="resolve"?"Productos pendientes":sub==="histDetail"?selHist?.supermarket:"";

  if(!meSetup) return <SetupScreen onDone={handleSetup}/>;

  return (
    <div style={{height:"100vh",display:"flex",flexDirection:"column",background:"#fff",
      color:"#111",fontFamily:"'Poppins','Helvetica Neue',sans-serif",maxWidth:430,margin:"0 auto",overflow:"hidden"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
        input,select,button{font-family:inherit}
        ::-webkit-scrollbar{display:none}
        @keyframes su{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        @keyframes notif{0%{opacity:0;transform:translateX(-50%) translateY(-16px)}
          12%{opacity:1;transform:translateX(-50%) translateY(0)}
          88%{opacity:1;transform:translateX(-50%) translateY(0)}
          100%{opacity:0;transform:translateX(-50%) translateY(-16px)}}
        .su{animation:su .22s ease forwards}
        .tap{transition:transform .12s,opacity .12s}
        .tap:active{transform:scale(.95);opacity:.75}
      `}</style>

      {showCamera && <CameraScanner onDetected={handleBarcodeDetected} onClose={()=>setShowCamera(false)}/>}
      <Notif n={notif}/>

      {/* HEADER */}
      <div style={{flexShrink:0,background:"#fff",borderBottom:"1px solid #F0F0F0",padding:sub?"14px 20px":"20px 20px 0"}}>
        {sub?(
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <button className="tap" onClick={()=>{setSub(null);setScanRes(null);}}
              style={{width:38,height:38,borderRadius:100,background:"#F5F5F5",border:"none",
                display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
              <IcoBack/>
            </button>
            <span style={{fontWeight:700,fontSize:17,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{subTitle}</span>
          </div>
        ):(
          <>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
              <h1 style={{fontSize:24,fontWeight:800,lineHeight:1.1,letterSpacing:-.5}}>
                {tab==="list"?pending>0?<>🛒 <span style={{color:"#FF385C"}}>{pending}</span> pendiente{pending>1?"s":""}</>:"Todo listo ✓"
                  :tab==="favs"?"⭐ Favoritos":"📦 Historial"}
              </h1>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{width:8,height:8,borderRadius:100,background:online?"#3CB371":"#FF385C"}}/>
                <button className="tap" onClick={()=>{localStorage.removeItem(LOCAL_USER_KEY);setMeSetup(false);}}
                  style={{width:34,height:34,borderRadius:100,border:`3px solid ${me.color}`,
                    background:me.color,color:"#fff",fontWeight:800,fontSize:13,cursor:"pointer"}}>
                  {me.name.charAt(0).toUpperCase()}
                </button>
              </div>
            </div>
            <p style={{fontSize:12,color:"#bbb",marginBottom:12}}>
              Hola, <span style={{color:me.color,fontWeight:700}}>{me.name}</span>
            </p>
            {tab==="list"&&(
              <div style={{display:"flex",gap:8,paddingBottom:14}}>
                {[["all","Todo"],["pending","Pendiente"],["done","Hecho"]].map(([v,l])=>(
                  <button key={v} className="tap" onClick={()=>setFilter(v)}
                    style={{padding:"7px 16px",borderRadius:100,border:"none",
                      background:filter===v?"#111":"#F5F5F5",color:filter===v?"#fff":"#888",
                      fontSize:13,fontWeight:600,cursor:"pointer",transition:"all .2s"}}>
                    {l}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* CONTENT */}
      <div style={{flex:1,overflowY:"auto",padding:"16px 20px"}}>

        {/* LIST */}
        {tab==="list"&&!sub&&(
          <div className="su">
            {filtered.length===0&&(
              <div style={{textAlign:"center",paddingTop:60,color:"#ccc"}}>
                <div style={{fontSize:52,marginBottom:12}}>🛒</div>
                <p style={{fontWeight:600}}>La lista está vacía</p>
                <p style={{fontSize:13,marginTop:8}}>Pulsa + para añadir</p>
              </div>
            )}
            {filtered.length>0&&(
              <div style={{borderRadius:22,overflow:"hidden",boxShadow:"0 2px 16px rgba(0,0,0,.07)",border:"1.5px solid #F0F0F0",background:"#fff"}}>
                {filtered.map((item,idx)=>{
                  const b=best(item.prices);
                  return (
                    <div key={item.fbId||idx} className="tap" onClick={()=>{setSelItem(item);setSub("detail");}}
                      style={{display:"flex",alignItems:"center",gap:10,padding:"13px 14px",cursor:"pointer",
                        background:item.checked?"#FAFAFA":"#fff",
                        borderBottom:idx<filtered.length-1?"1px solid #F5F5F5":"none",
                        opacity:item.checked?.5:1}}>
                      <div onClick={e=>{e.stopPropagation();toggleCheck(item);}}
                        style={{width:26,height:26,borderRadius:100,flexShrink:0,cursor:"pointer",
                          background:item.checked?"#FF385C":"transparent",
                          border:item.checked?"none":"2px solid #E0E0E0",
                          display:"flex",alignItems:"center",justifyContent:"center",transition:"all .2s"}}>
                        {item.checked&&<IcoCheck/>}
                      </div>
                      <span style={{fontSize:20,flexShrink:0}}>{EMOJI[item.category]}</span>
                      <div style={{flex:1,minWidth:0}}>
                        <p style={{fontWeight:600,fontSize:14,textDecoration:item.checked?"line-through":"none",
                          color:item.checked?"#ccc":"#111",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                          {item.name}
                        </p>
                        {b&&<p style={{fontSize:11,color:"#FF385C",fontWeight:700,marginTop:1}}>{fmt(b[1])} · {b[0]}</p>}
                      </div>
                      <span style={{fontSize:12,color:"#ccc",flexShrink:0}}>{item.quantity}{item.unit}</span>
                      <div style={{width:22,height:22,borderRadius:100,flexShrink:0,
                        background:item.addedByColor||"#eee",display:"flex",alignItems:"center",
                        justifyContent:"center",fontSize:9,fontWeight:800,color:"#fff"}}>
                        {(item.addedBy||"?").charAt(0).toUpperCase()}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* DETAIL */}
        {sub==="detail"&&selItem&&(
          <div className="su">
            <div style={{borderRadius:24,padding:"24px 20px",marginBottom:14,background:BG[selItem.category],textAlign:"center"}}>
              <div style={{fontSize:52,marginBottom:8}}>{EMOJI[selItem.category]}</div>
              <h2 style={{fontWeight:800,fontSize:20,marginBottom:4}}>{selItem.name}</h2>
              <p style={{color:"#888",fontSize:14}}>{selItem.quantity} {selItem.unit} · {selItem.category}</p>
              <p style={{color:"#bbb",fontSize:12,marginTop:6}}>Por <span style={{color:selItem.addedByColor,fontWeight:700}}>{selItem.addedBy}</span></p>
            </div>
            {tab==="list"&&(
              <button className="tap" onClick={async()=>{
                if(favs.find(f=>f.name===selItem.name)){notify("Ya en favoritos",true);return;}
                await addToFavs({...selItem,fbId:undefined,checked:undefined,createdAt:Date.now()});
                notify("Guardado en favoritos ⭐");
              }} style={{width:"100%",background:"#fff",border:"1.5px solid #F0F0F0",borderRadius:16,
                padding:"13px 0",fontWeight:600,fontSize:14,color:"#111",cursor:"pointer",
                marginBottom:12,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                ⭐ Guardar en favoritos
              </button>
            )}
            <div style={{background:"#fff",borderRadius:20,padding:"18px 16px",
              boxShadow:"0 2px 12px rgba(0,0,0,.06)",border:"1.5px solid #F5F5F5",marginBottom:12}}>
              <p style={{fontWeight:700,fontSize:12,color:"#aaa",letterSpacing:.5,textTransform:"uppercase",marginBottom:14}}>Comparativa de precios</p>
              {Object.keys(selItem.prices||{}).length===0&&<p style={{fontSize:13,color:"#bbb",marginBottom:12}}>Sin precios aún.</p>}
              <PriceEditor prices={selItem.prices||{}} onAdd={async(s,v)=>{
                const np={...selItem.prices,[s]:v};
                if(tab==="list") await updateListItem(selItem,{prices:np});
                else await updateFavItem(selItem,{prices:np});
                notify("Precio guardado");
              }}/>
            </div>
            <button className="tap" onClick={()=>tab==="list"?delFromList(selItem):delFromFavs(selItem)}
              style={{width:"100%",background:"#FFF0F2",border:"none",borderRadius:16,
                padding:"13px 0",fontWeight:600,fontSize:14,color:"#FF385C",cursor:"pointer"}}>
              Eliminar producto
            </button>
          </div>
        )}

        {/* ADD */}
        {sub==="addItem"&&(
          <div className="su" style={{display:"flex",flexDirection:"column",gap:14}}>
            <div>
              <label style={{fontWeight:600,fontSize:13,color:"#888",display:"block",marginBottom:8}}>Nombre</label>
              <input autoFocus value={newItem.name} placeholder="Ej: Yogur natural..."
                onChange={e=>setNewItem(p=>({...p,name:e.target.value}))}
                onKeyDown={e=>e.key==="Enter"&&handleAdd(tab==="favs"?"favs":"list")}
                style={{...inp,fontSize:16,fontWeight:500}}/>
            </div>
            <div style={{display:"flex",gap:10}}>
              <div style={{flex:1}}>
                <label style={{fontWeight:600,fontSize:13,color:"#888",display:"block",marginBottom:8}}>Cantidad</label>
                <input type="number" min={1} value={newItem.quantity}
                  onChange={e=>setNewItem(p=>({...p,quantity:parseInt(e.target.value)||1}))} style={inp}/>
              </div>
              <div style={{flex:1}}>
                <label style={{fontWeight:600,fontSize:13,color:"#888",display:"block",marginBottom:8}}>Unidad</label>
                <select value={newItem.unit} onChange={e=>setNewItem(p=>({...p,unit:e.target.value}))}
                  style={{...inp,appearance:"none"}}>
                  {UNITS.map(u=><option key={u}>{u}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label style={{fontWeight:600,fontSize:13,color:"#888",display:"block",marginBottom:8}}>Categoría</label>
              <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                {CATEGORIES.map(c=>(
                  <button key={c} className="tap" onClick={()=>setNewItem(p=>({...p,category:c}))}
                    style={{padding:"7px 13px",borderRadius:100,border:"none",cursor:"pointer",
                      background:newItem.category===c?BG[c]:"#F5F5F5",
                      color:newItem.category===c?"#111":"#aaa",
                      fontWeight:newItem.category===c?700:500,fontSize:12}}>
                    {EMOJI[c]} {c}
                  </button>
                ))}
              </div>
            </div>
            <button className="tap" onClick={()=>handleAdd(tab==="favs"?"favs":"list")}
              style={{width:"100%",background:"#FF385C",border:"none",borderRadius:18,
                padding:"16px 0",fontWeight:700,fontSize:16,color:"#fff",cursor:"pointer",
                boxShadow:"0 4px 16px rgba(255,56,92,.35)"}}>
              Añadir a {tab==="favs"?"favoritos":"la lista"}
            </button>
          </div>
        )}

        {/* SCAN RESULT */}
        {sub==="scanAdd"&&(
          <div className="su" style={{display:"flex",flexDirection:"column",gap:14}}>
            {scanRes&&(
              <>
                <div style={{borderRadius:24,background:BG[scanRes.category],padding:"28px 20px",textAlign:"center"}}>
                  <div style={{fontSize:52,marginBottom:8}}>{EMOJI[scanRes.category]}</div>
                  <h2 style={{fontWeight:800,fontSize:20,marginBottom:4}}>{scanRes.name}</h2>
                  <p style={{color:"#888",fontSize:14}}>{scanRes.category}</p>
                </div>
                <div>
                  <label style={{fontWeight:600,fontSize:13,color:"#888",display:"block",marginBottom:8}}>Confirma o edita el nombre</label>
                  <input value={scanRes.name} onChange={e=>setScanRes(r=>({...r,name:e.target.value}))} style={inp}/>
                </div>
                <button className="tap" onClick={addScanned}
                  style={{width:"100%",background:"#FF385C",border:"none",borderRadius:18,
                    padding:"16px 0",fontWeight:700,fontSize:16,color:"#fff",cursor:"pointer",
                    boxShadow:"0 4px 16px rgba(255,56,92,.35)"}}>
                  Añadir a {scanCtx==="favs"?"favoritos":"la lista"}
                </button>
                <button className="tap" onClick={()=>openCamera(scanCtx)}
                  style={{width:"100%",background:"#F5F5F5",border:"none",borderRadius:18,
                    padding:"16px 0",fontWeight:600,fontSize:15,color:"#888",cursor:"pointer"}}>
                  📷 Escanear otro
                </button>
              </>
            )}
          </div>
        )}

        {/* EXECUTE */}
        {sub==="execute"&&(
          <div className="su" style={{display:"flex",flexDirection:"column",gap:14}}>
            <div style={{borderRadius:20,background:"#F6FFF9",border:"1.5px solid #C8F5D4",padding:"14px 16px"}}>
              <p style={{fontWeight:700,fontSize:13,color:"#3CB371",marginBottom:exItems.length?10:0}}>
                ✅ {exItems.length} escaneado{exItems.length!==1?"s":""}
              </p>
              {exItems.map((i,idx)=>(
                <div key={idx} style={{display:"flex",justifyContent:"space-between",fontSize:14,color:"#555",marginTop:6}}>
                  <span>· {EMOJI[i.category]} {i.name}</span>
                  <span style={{fontWeight:600,color:"#3CB371"}}>{i.price?fmt(i.price):"—"}</span>
                </div>
              ))}
            </div>
            <div>
              <label style={{fontWeight:600,fontSize:13,color:"#888",display:"block",marginBottom:8}}>Supermercado</label>
              <select value={exSup} onChange={e=>setExSup(e.target.value)} style={{...inp,appearance:"none"}}>
                {SUPERMARKETS.map(s=><option key={s}>{s}</option>)}
              </select>
            </div>

            {exRes&&(
              <div style={{borderRadius:20,background:"#F9F9F9",padding:"14px",border:"1.5px solid #F0F0F0"}}>
                <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:12}}>
                  <div style={{width:44,height:44,borderRadius:14,background:BG[exRes.category],
                    display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>
                    {EMOJI[exRes.category]}
                  </div>
                  <div style={{flex:1}}>
                    <p style={{fontWeight:700,fontSize:15}}>{exRes.name}</p>
                    <input value={exRes.name} onChange={e=>setExRes(r=>({...r,name:e.target.value}))}
                      style={{...inp,padding:"6px 10px",fontSize:13,marginTop:4}}/>
                  </div>
                </div>
                <div style={{display:"flex",gap:10}}>
                  <input type="number" placeholder="Precio €" step="0.01"
                    onChange={e=>setExRes(r=>({...r,_price:parseFloat(e.target.value)||0}))}
                    style={{...inp,flex:1,padding:"11px 14px"}}/>
                  <button className="tap" onClick={()=>{
                    setExItems(p=>[...p,{name:exRes.name,category:exRes.category,quantity:1,unit:"ud",price:exRes._price||0}]);
                    setExRes(null); notify(`"${exRes.name}" añadido ✓`);
                  }} style={{width:48,height:48,borderRadius:14,border:"none",background:"#FF385C",
                    color:"#fff",fontSize:22,fontWeight:700,cursor:"pointer",flexShrink:0,
                    display:"flex",alignItems:"center",justifyContent:"center"}}>✓</button>
                </div>
              </div>
            )}

            <button className="tap" onClick={()=>openCamera("execute")}
              style={{width:"100%",background:"#FF385C",border:"none",borderRadius:18,
                padding:"16px 0",fontWeight:700,fontSize:16,color:"#fff",cursor:"pointer",
                boxShadow:"0 4px 16px rgba(255,56,92,.35)",display:"flex",
                alignItems:"center",justifyContent:"center",gap:10}}>
              📷 Escanear producto
            </button>

            {exItems.length>0&&(
              <button className="tap" onClick={finishExecute}
                style={{width:"100%",background:"#111",border:"none",borderRadius:18,
                  padding:"16px 0",fontWeight:700,fontSize:16,color:"#fff",cursor:"pointer"}}>
                Finalizar compra →
              </button>
            )}
          </div>
        )}

        {/* RESOLVE */}
        {sub==="resolve"&&curQ&&(
          <div className="su">
            <p style={{fontSize:14,color:"#aaa",marginBottom:20}}>
              {queue.length} producto{queue.length!==1?"s":""} sin escanear. ¿Qué hacemos?
            </p>
            <div style={{borderRadius:24,background:BG[curQ.category],padding:"28px 20px",textAlign:"center",marginBottom:20}}>
              <div style={{fontSize:52,marginBottom:8}}>{EMOJI[curQ.category]}</div>
              <h3 style={{fontWeight:800,fontSize:20,marginBottom:4}}>{curQ.name}</h3>
              <p style={{color:"#888",fontSize:14}}>{curQ.quantity} {curQ.unit}</p>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <button className="tap" onClick={()=>resolveQ("keep")}
                style={{padding:"16px",borderRadius:18,border:"1.5px solid #E0E0E0",
                  background:"#fff",fontWeight:700,fontSize:15,color:"#111",cursor:"pointer"}}>
                📋 Mantener en la lista
              </button>
              <button className="tap" onClick={()=>resolveQ("dismiss")}
                style={{padding:"16px",borderRadius:18,border:"none",
                  background:"#FFF0F2",fontWeight:700,fontSize:15,color:"#FF385C",cursor:"pointer"}}>
                🗑 Eliminar de la lista
              </button>
            </div>
          </div>
        )}

        {/* FAVS */}
        {tab==="favs"&&!sub&&(
          <div className="su">
            {favs.length===0&&(
              <div style={{textAlign:"center",paddingTop:60,color:"#ccc"}}>
                <div style={{fontSize:52,marginBottom:12}}>⭐</div>
                <p style={{fontWeight:600}}>Sin favoritos aún</p>
              </div>
            )}
            <div style={{columns:2,gap:12}}>
              {favs.map((item,idx)=>{
                const b=best(item.prices);
                return (
                  <div key={item.fbId||idx} className="tap" onClick={()=>{setSelItem(item);setSub("detail");}}
                    style={{breakInside:"avoid",marginBottom:12,borderRadius:20,overflow:"hidden",
                      boxShadow:"0 2px 12px rgba(0,0,0,.08)",cursor:"pointer",border:"1.5px solid #F5F5F5",background:"#fff"}}>
                    <div style={{background:BG[item.category],padding:"20px 0",textAlign:"center",fontSize:36}}>
                      {EMOJI[item.category]}
                    </div>
                    <div style={{padding:"10px 12px 12px"}}>
                      <p style={{fontWeight:700,fontSize:14,marginBottom:4,lineHeight:1.3}}>{item.name}</p>
                      <p style={{fontSize:12,color:"#bbb"}}>{item.quantity} {item.unit}</p>
                      {b&&<p style={{fontSize:13,color:"#FF385C",fontWeight:700,marginTop:4}}>{fmt(b[1])}</p>}
                      <button className="tap" onClick={e=>{e.stopPropagation();favToList(item);}}
                        style={{marginTop:10,width:"100%",background:"#FF385C",border:"none",
                          borderRadius:10,padding:"8px 0",fontWeight:700,fontSize:12,color:"#fff",cursor:"pointer"}}>
                        + Añadir a lista
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* HISTORY */}
        {tab==="history"&&!sub&&(
          <div className="su">
            {hist.length===0&&(
              <div style={{textAlign:"center",paddingTop:60,color:"#ccc"}}>
                <div style={{fontSize:52,marginBottom:12}}>📦</div>
                <p style={{fontWeight:600}}>Sin historial todavía</p>
              </div>
            )}
            {[...hist].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).map((h,idx)=>(
              <div key={h.fbId||idx} className="tap" onClick={()=>{setSelHist(h);setSub("histDetail");}}
                style={{borderRadius:20,marginBottom:12,overflow:"hidden",
                  boxShadow:"0 2px 12px rgba(0,0,0,.07)",cursor:"pointer",border:"1.5px solid #F5F5F5"}}>
                <div style={{background:"#111",padding:"14px 18px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <p style={{fontWeight:700,fontSize:16,color:"#fff"}}>{h.supermarket}</p>
                    <p style={{fontSize:12,color:"#666",marginTop:2}}>{h.date} · {h.savedBy||""}</p>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <p style={{fontWeight:800,fontSize:20,color:"#FF385C"}}>{fmt(h.total)}</p>
                    <p style={{fontSize:12,color:"#555"}}>{(h.items||[]).length} productos</p>
                  </div>
                </div>
                <div style={{padding:"12px 18px",background:"#fff",display:"flex",flexWrap:"wrap",gap:6}}>
                  {(h.items||[]).slice(0,5).map((i,ii)=>(
                    <span key={ii} style={{fontSize:11,background:"#F5F5F5",borderRadius:100,padding:"4px 12px",color:"#666",fontWeight:500}}>
                      {EMOJI[i.category]} {i.name}
                    </span>
                  ))}
                  {(h.items||[]).length>5&&<span style={{fontSize:11,color:"#bbb"}}>+{h.items.length-5} más</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* HISTORY DETAIL */}
        {sub==="histDetail"&&selHist&&(
          <div className="su">
            <div style={{background:"#111",borderRadius:20,padding:"20px",marginBottom:14,
              display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <p style={{fontWeight:700,fontSize:18,color:"#fff"}}>{selHist.supermarket}</p>
                <p style={{fontSize:13,color:"#888",marginTop:4}}>{selHist.date}</p>
              </div>
              <p style={{fontWeight:800,fontSize:24,color:"#FF385C"}}>{fmt(selHist.total)}</p>
            </div>
            <button className="tap" onClick={()=>repeatCompra(selHist)}
              style={{width:"100%",background:"#FF385C",border:"none",borderRadius:18,
                padding:"14px 0",fontWeight:700,fontSize:15,color:"#fff",cursor:"pointer",
                marginBottom:16,boxShadow:"0 4px 16px rgba(255,56,92,.3)"}}>
              🔁 Repetir esta compra
            </button>
            <p style={{fontWeight:700,fontSize:12,color:"#aaa",letterSpacing:.5,textTransform:"uppercase",marginBottom:12}}>
              Productos ({(selHist.items||[]).length})
            </p>
            {(selHist.items||[]).map((i,idx)=>(
              <div key={idx} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",
                borderRadius:18,marginBottom:8,background:"#fff",boxShadow:"0 2px 8px rgba(0,0,0,.05)",border:"1.5px solid #F5F5F5"}}>
                <div style={{width:44,height:44,borderRadius:14,background:BG[i.category],
                  display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>
                  {EMOJI[i.category]}
                </div>
                <div style={{flex:1}}>
                  <p style={{fontWeight:600,fontSize:15}}>{i.name}</p>
                  <p style={{fontSize:12,color:"#bbb",marginTop:2}}>{i.quantity} {i.unit||"ud"}</p>
                </div>
                <div style={{textAlign:"right",flexShrink:0}}>
                  <p style={{fontWeight:700,fontSize:15,marginBottom:6}}>{i.price?fmt(i.price):"—"}</p>
                  <div style={{display:"flex",gap:6}}>
                    <button className="tap" onClick={()=>histToList(i)}
                      style={{fontSize:11,background:"#F5F5F5",border:"none",borderRadius:100,padding:"4px 10px",color:"#555",fontWeight:600,cursor:"pointer"}}>+ Lista</button>
                    <button className="tap" onClick={()=>histToFavs(i)}
                      style={{fontSize:11,background:"#FFF0F2",border:"none",borderRadius:100,padding:"4px 10px",color:"#FF385C",fontWeight:600,cursor:"pointer"}}>⭐</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* BOTTOM NAV */}
      {!sub&&(
        <div style={{flexShrink:0,background:"#fff",borderTop:"1px solid #F0F0F0",padding:"10px 20px 22px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-around",marginBottom:tab==="list"?10:0}}>
            <button className="tap" onClick={()=>setTab("list")}
              style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,background:"none",border:"none",cursor:"pointer",padding:"4px 12px"}}>
              <IcoList on={tab==="list"}/>
              <span style={{fontSize:11,fontWeight:tab==="list"?700:500,color:tab==="list"?"#FF385C":"#BDBDBD"}}>Lista</span>
            </button>
            <button className="tap" onClick={()=>setSub("addItem")}
              style={{width:52,height:52,borderRadius:100,border:"none",
                background:"linear-gradient(135deg,#FF385C,#833AB4)",
                display:"flex",alignItems:"center",justifyContent:"center",
                boxShadow:"0 4px 20px rgba(255,56,92,.4)",cursor:"pointer",marginTop:-18}}>
              <IcoPlus/>
            </button>
            <button className="tap" onClick={()=>setTab("favs")}
              style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,background:"none",border:"none",cursor:"pointer",padding:"4px 12px"}}>
              <IcoStar on={tab==="favs"}/>
              <span style={{fontSize:11,fontWeight:tab==="favs"?700:500,color:tab==="favs"?"#FF385C":"#BDBDBD"}}>Favoritos</span>
            </button>
            <button className="tap" onClick={()=>setTab("history")}
              style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,background:"none",border:"none",cursor:"pointer",padding:"4px 12px"}}>
              <IcoClock on={tab==="history"}/>
              <span style={{fontSize:11,fontWeight:tab==="history"?700:500,color:tab==="history"?"#FF385C":"#BDBDBD"}}>Historial</span>
            </button>
            <button className="tap" onClick={()=>openCamera(tab==="favs"?"favs":"list")}
              style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,background:"none",border:"none",cursor:"pointer",padding:"4px 12px"}}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" stroke="#BDBDBD" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="12" cy="13" r="4" stroke="#BDBDBD" strokeWidth="2"/>
              </svg>
              <span style={{fontSize:11,fontWeight:500,color:"#BDBDBD"}}>Cámara</span>
            </button>
          </div>
          {tab==="list"&&(
            <button className="tap" onClick={startExecute}
              style={{width:"100%",background:"#111",border:"none",borderRadius:16,
                padding:"14px 0",fontWeight:700,fontSize:15,color:"#fff",cursor:"pointer",
                display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>
              <IcoCart/> Hacer la compra
            </button>
          )}
        </div>
      )}
    </div>
  );
}
