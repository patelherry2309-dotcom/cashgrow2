export default {
  async fetch(request, env) {
    try {
      await ensureSchema(env);
      const url = new URL(request.url);
      const path = url.pathname;

      if (path === "/api/health" && request.method === "GET") return json({ success:true, service:"CashGrow", status:"ok" });

      if (path === "/api/register" && request.method === "POST") return register(request, env);
      if (path === "/api/login" && request.method === "POST") return login(request, env);
      if (path === "/api/logout" && request.method === "POST") return logout(request, env);
      if (path === "/api/me" && request.method === "GET") return me(request, env);
      if (path === "/api/profile" && request.method === "POST") return profile(request, env);

      if (path === "/api/create-order" && request.method === "POST") return createOrder(request, env);
      if (path === "/api/verify" && request.method === "POST") return verifyPayment(request, env);

      if (path === "/api/dashboard" && request.method === "GET") return dashboard(request, env);
      if (path === "/api/referrals" && request.method === "GET") return referrals(request, env);
      if (path === "/api/transactions" && request.method === "GET") return transactions(request, env);
      if (path === "/api/withdraw" && request.method === "POST") return withdraw(request, env);
      if (path === "/api/withdrawals" && request.method === "GET") return withdrawals(request, env);

      if (request.method === "GET") return html(home());

      return json({ success:false, message:"Not Found" },404);
    } catch (error) {
      console.error("CASHGROW_ERROR", error);
      return json({ success:false, message:"Server error", error:error?.message || String(error) },500);
    }
  }
};

const PRODUCTS = {
  starter:{ key:"starter", name:"Starter Bundle", amount:59900, reward:400 },
  pro:{ key:"pro", name:"Pro Bundle", amount:99900, reward:800 }
};
const MIN_WITHDRAWAL = 100000;

async function ensureSchema(env){
  if(!env.DB) throw new Error("D1 binding DB is missing");
  const stmts = [
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      referral_code TEXT UNIQUE,
      referred_by TEXT,
      wallet_balance INTEGER NOT NULL DEFAULT 0,
      password_hash TEXT,
      session_token TEXT,
      session_expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      razorpay_order_id TEXT,
      razorpay_payment_id TEXT UNIQUE,
      product TEXT,
      amount INTEGER,
      status TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_user_id INTEGER,
      referred_user_id INTEGER,
      payment_id TEXT,
      product TEXT,
      reward_amount INTEGER,
      status TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0,
      direction TEXT NOT NULL DEFAULT 'credit',
      status TEXT NOT NULL DEFAULT 'completed',
      reference_id TEXT,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      method TEXT,
      account_details TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  ];
  for(const s of stmts) await env.DB.prepare(s).run();
}

function json(data,status=200,headers={}){
  return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=UTF-8",...headers}});
}
function html(body,status=200){ return new Response(body,{status,headers:{"Content-Type":"text/html; charset=UTF-8"}}); }
function text(v){ return String(v ?? "").trim(); }
function money(paise){ return "₹"+(Number(paise||0)/100).toFixed(2); }
function cookieToken(request){
  const c=request.headers.get("Cookie")||"";
  const m=c.match(/(?:^|;\s*)session_token=([^;]+)/);
  return m ? m[1] : null;
}
function setSession(token){
  return `session_token=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`;
}
function clearSession(){
  return "session_token=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0";
}
async function currentUser(request,env){
  const token=cookieToken(request);
  if(!token) return null;
  const now=new Date().toISOString();
  return env.DB.prepare(`SELECT id,name,phone,email,referral_code,referred_by,wallet_balance,created_at
    FROM users WHERE session_token=? AND session_expires_at>? LIMIT 1`).bind(token,now).first();
}
async function requireUser(request,env){
  const u=await currentUser(request,env);
  if(!u) throw Object.assign(new Error("Please login first"),{status:401});
  return u;
}
function safeError(error){ return error?.message || String(error); }

const hex = bytes => Array.from(bytes).map(b=>b.toString(16).padStart(2,"0")).join("");
const hexBytes = hexstr => {
  const out=new Uint8Array(hexstr.length/2);
  for(let i=0;i<out.length;i++) out[i]=parseInt(hexstr.slice(i*2,i*2+2),16);
  return out;
};
async function hashPassword(password){
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),"PBKDF2",false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt,iterations:100000,hash:"SHA-256"},key,256);
  return `pbkdf2$100000$${hex(salt)}$${hex(new Uint8Array(bits))}`;
}
async function verifyPassword(password,stored){
  try{
    const p=stored.split("$");
    if(p.length!==4 || p[0]!=="pbkdf2") return false;
    const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),"PBKDF2",false,["deriveBits"]);
    const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt:hexBytes(p[2]),iterations:Number(p[1]),hash:"SHA-256"},key,256);
    const a=new Uint8Array(bits), b=hexBytes(p[3]);
    if(a.length!==b.length) return false;
    let d=0; for(let i=0;i<a.length;i++) d|=a[i]^b[i];
    return d===0;
  }catch{return false;}
}
async function referralCode(env){
  const chars="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  for(let n=0;n<20;n++){
    const bytes=crypto.getRandomValues(new Uint8Array(6));
    let s="CG"; for(const b of bytes) s+=chars[b%chars.length];
    const x=await env.DB.prepare("SELECT id FROM users WHERE referral_code=? LIMIT 1").bind(s).first();
    if(!x) return s;
  }
  throw new Error("Could not generate referral code");
}

async function register(request,env){
  try{
    const b=await request.json();
    const name=text(b.name), phone=text(b.phone).replace(/\D/g,""), email=text(b.email).toLowerCase(), password=String(b.password||"");
    const ref=text(b.referral_code).toUpperCase();
    if(!name||!phone||!email||!password) return json({success:false,message:"All fields are required."},400);
    if(password.length<6) return json({success:false,message:"Password must be at least 6 characters."},400);
    const existing=await env.DB.prepare("SELECT * FROM users WHERE lower(email)=? OR phone=? LIMIT 1").bind(email,phone).first();
    const hash=await hashPassword(password);
    const token=crypto.randomUUID(), expires=new Date(Date.now()+7*86400000).toISOString();
    if(existing){
      if(existing.password_hash) return json({success:false,message:"Email or phone is already registered. Please login."},409);
      await env.DB.prepare("UPDATE users SET name=?,password_hash=?,session_token=?,session_expires_at=? WHERE id=?").bind(name,hash,token,expires,existing.id).run();
      return json({success:true,message:"Account activated successfully.",user:{...existing,name,password_hash:undefined}},200,{"Set-Cookie":setSession(token)});
    }
    let referredBy=null;
    if(ref){
      const r=await env.DB.prepare("SELECT referral_code FROM users WHERE referral_code=? LIMIT 1").bind(ref).first();
      if(r) referredBy=r.referral_code;
    }
    const code=await referralCode(env);
    const result=await env.DB.prepare(`INSERT INTO users(name,phone,email,referral_code,referred_by,wallet_balance,password_hash,session_token,session_expires_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).bind(name,phone,email,code,referredBy,0,hash,token,expires).run();
    return json({success:true,message:"Account created successfully.",user:{id:result.meta.last_row_id,name,phone,email,referral_code:code,referred_by:referredBy,wallet_balance:0}},200,{"Set-Cookie":setSession(token)});
  }catch(e){ return json({success:false,message:"Registration failed.",error:safeError(e)},500); }
}
async function login(request,env){
  try{
    const b=await request.json(), identifier=text(b.identifier).toLowerCase(), password=String(b.password||"");
    if(!identifier||!password) return json({success:false,message:"Email/phone and password are required."},400);
    const phone=identifier.replace(/\D/g,"");
    const u=await env.DB.prepare("SELECT * FROM users WHERE lower(email)=? OR phone=? LIMIT 1").bind(identifier,phone).first();
    if(!u) return json({success:false,message:"Account not found."},401);
    if(!u.password_hash) return json({success:false,message:"Please create/activate your account first."},400);
    if(!(await verifyPassword(password,u.password_hash))) return json({success:false,message:"Incorrect password."},401);
    const token=crypto.randomUUID(), expires=new Date(Date.now()+7*86400000).toISOString();
    await env.DB.prepare("UPDATE users SET session_token=?,session_expires_at=? WHERE id=?").bind(token,expires,u.id).run();
    return json({success:true,message:"Login successful.",user:{id:u.id,name:u.name,phone:u.phone,email:u.email,referral_code:u.referral_code,referred_by:u.referred_by,wallet_balance:u.wallet_balance||0}},200,{"Set-Cookie":setSession(token)});
  }catch(e){return json({success:false,message:"Login failed.",error:safeError(e)},500);}
}
async function logout(request,env){
  try{ const t=cookieToken(request); if(t) await env.DB.prepare("UPDATE users SET session_token=NULL,session_expires_at=NULL WHERE session_token=?").bind(t).run();
    return json({success:true,message:"Logged out."},200,{"Set-Cookie":clearSession()});
  }catch(e){return json({success:false,message:"Logout failed."},500);}
}
async function me(request,env){
  try{
    const u=await currentUser(request,env); if(!u) return json({success:false,loggedIn:false},401);
    const s=await env.DB.prepare("SELECT COUNT(*) referral_count,COALESCE(SUM(reward_amount),0) referral_earnings FROM referrals WHERE referrer_user_id=? AND status='credited'").bind(u.id).first();
    return json({success:true,loggedIn:true,user:{...u,referral_count:s?.referral_count||0,referral_earnings:s?.referral_earnings||0}});
  }catch(e){return json({success:false,loggedIn:false,error:safeError(e)},500);}
}
async function profile(request,env){
  try{
    const u=await requireUser(request,env), b=await request.json(), name=text(b.name), phone=text(b.phone).replace(/\D/g,"");
    if(!name||!phone) return json({success:false,message:"Name and phone are required."},400);
    await env.DB.prepare("UPDATE users SET name=?,phone=? WHERE id=?").bind(name,phone,u.id).run();
    return json({success:true,message:"Profile updated."});
  }catch(e){return json({success:false,message:safeError(e)},e.status||500);}
}

async function createOrder(request,env){
  try{
    const b=await request.json(), p=PRODUCTS[b.product];
    if(!p) return json({success:false,error:"Invalid product"},400);
    if(!env.RAZORPAY_KEY_ID||!env.RAZORPAY_KEY_SECRET) return json({success:false,error:"Razorpay keys are not configured."},500);
    const auth=btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
    const r=await fetch("https://api.razorpay.com/v1/orders",{method:"POST",headers:{"Authorization":`Basic ${auth}`,"Content-Type":"application/json"},body:JSON.stringify({amount:p.amount,currency:"INR",receipt:`cashgrow_${Date.now()}`})});
    const data=await r.json(); console.log("Razorpay response:",r.status,data);
    if(!r.ok) return json({success:false,error:data?.error?.description||"Razorpay order creation failed"},500);
    return json({success:true,order_id:data.id,amount:p.amount,name:p.name,key_id:env.RAZORPAY_KEY_ID});
  }catch(e){console.error("CREATE ORDER ERROR",e);return json({success:false,error:"Server error while creating order"},500);}
}
async function hmac(secret,message){
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(message))));
}
async function verifyPayment(request,env){
  try{
    const b=await request.json();
    const {razorpay_order_id,razorpay_payment_id,razorpay_signature,name,phone,email,referral_code}=b;
    if(!razorpay_order_id||!razorpay_payment_id||!razorpay_signature) return json({success:false,message:"Payment details are missing"},400);
    const expected=await hmac(env.RAZORPAY_KEY_SECRET,`${razorpay_order_id}|${razorpay_payment_id}`);
    if(expected!==razorpay_signature) return json({success:false,message:"Invalid payment signature"},400);
    const auth=btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
    const pr=await fetch(`https://api.razorpay.com/v1/payments/${razorpay_payment_id}`,{headers:{"Authorization":`Basic ${auth}`}});
    if(!pr.ok){const t=await pr.text();console.error("RAZORPAY_DEBUG",pr.status,t);return json({success:false,message:t},500);}
    const payment=await pr.json();
    if(payment.order_id!==razorpay_order_id) return json({success:false,message:"Order mismatch"},400);
    if(payment.status!=="captured") return json({success:false,message:"Payment is not captured"},400);
    const product=payment.amount===59900?"starter":payment.amount===99900?"pro":null;
    if(!product) return json({success:false,message:"Invalid payment amount"},400);
    const existing=await env.DB.prepare("SELECT id FROM payments WHERE razorpay_payment_id=?").bind(razorpay_payment_id).first();
    if(existing) return json({success:true,message:"Payment already verified."});
    let userId=null;
    const current=await currentUser(request,env);
    if(current) userId=current.id;
    if(!userId){
      const found=await env.DB.prepare("SELECT id FROM users WHERE (email!='' AND lower(email)=?) OR (phone!='' AND phone=?) LIMIT 1").bind(text(email).toLowerCase(),text(phone).replace(/\D/g,"")).first();
      if(found) userId=found.id;
      else {
        const code=await referralCode(env);
        const nr=await env.DB.prepare("INSERT INTO users(name,phone,email,referral_code,referred_by,wallet_balance) VALUES(?,?,?,?,?,0)")
          .bind(name||"CashGrow User",text(phone).replace(/\D/g,""),text(email).toLowerCase(),code,referral_code||null).run();
        userId=nr.meta.last_row_id;
      }
    }
    await env.DB.prepare("INSERT INTO payments(user_id,razorpay_order_id,razorpay_payment_id,product,amount,status) VALUES(?,?,?,?,?,?)")
      .bind(userId,razorpay_order_id,razorpay_payment_id,product,payment.amount,payment.status).run();
    await env.DB.prepare("INSERT INTO transactions(user_id,type,amount,direction,status,reference_id,description) VALUES(?,?,?,?,?,?,?)")
      .bind(userId,"purchase",payment.amount,"debit","completed",razorpay_payment_id,`Purchased ${PRODUCTS[product].name}`).run();
    let rewardMessage="";
    if(referral_code){
      const ref=await env.DB.prepare("SELECT id FROM users WHERE referral_code=? LIMIT 1").bind(text(referral_code).toUpperCase()).first();
      if(ref && ref.id!==userId){
        const dup=await env.DB.prepare("SELECT id FROM referrals WHERE payment_id=?").bind(razorpay_payment_id).first();
        if(!dup){
          const reward=PRODUCTS[product].reward*100;
          await env.DB.prepare("UPDATE users SET wallet_balance=wallet_balance+? WHERE id=?").bind(reward,ref.id).run();
          await env.DB.prepare("INSERT INTO referrals(referrer_user_id,referred_user_id,payment_id,product,reward_amount,status) VALUES(?,?,?,?,?,?)")
            .bind(ref.id,userId,razorpay_payment_id,product,PRODUCTS[product].reward,"credited").run();
          await env.DB.prepare("INSERT INTO transactions(user_id,type,amount,direction,status,reference_id,description) VALUES(?,?,?,?,?,?,?)")
            .bind(ref.id,"referral_reward",reward,"credit","completed",razorpay_payment_id,`Referral reward for ${PRODUCTS[product].name}`).run();
          rewardMessage=` Referral reward ₹${PRODUCTS[product].reward} credited.`;
        }
      }
    }
    return json({success:true,message:"Payment verified successfully."+rewardMessage});
  }catch(e){console.error("VERIFY ERROR",e);return json({success:false,message:"Verification failed",error:safeError(e)},500);}
}

async function dashboard(request,env){
  try{
    const u=await requireUser(request,env);
    const refs=await env.DB.prepare("SELECT COUNT(*) count,COALESCE(SUM(reward_amount),0) earnings FROM referrals WHERE referrer_user_id=? AND status='credited'").bind(u.id).first();
    const tx=await env.DB.prepare("SELECT * FROM transactions WHERE user_id=? ORDER BY id DESC LIMIT 10").bind(u.id).all();
    return json({success:true,user:u,referrals:refs,transactions:tx.results||[]});
  }catch(e){return json({success:false,message:safeError(e)},e.status||500);}
}
async function referrals(request,env){
  try{
    const u=await requireUser(request,env);
    const r=await env.DB.prepare(`SELECT r.*,u.name,u.phone,u.email FROM referrals r LEFT JOIN users u ON u.id=r.referred_user_id WHERE r.referrer_user_id=? ORDER BY r.id DESC`).bind(u.id).all();
    return json({success:true,referral_code:u.referral_code,items:r.results||[]});
  }catch(e){return json({success:false,message:safeError(e)},e.status||500);}
}
async function transactions(request,env){
  try{
    const u=await requireUser(request,env);
    const r=await env.DB.prepare("SELECT * FROM transactions WHERE user_id=? ORDER BY id DESC LIMIT 100").bind(u.id).all();
    return json({success:true,items:r.results||[]});
  }catch(e){return json({success:false,message:safeError(e)},e.status||500);}
}
async function withdraw(request,env){
  try{
    const u=await requireUser(request,env), b=await request.json(), amount=Math.round(Number(b.amount)*100), method=text(b.method), details=text(b.account_details);
    if(!Number.isFinite(amount)||amount<MIN_WITHDRAWAL) return json({success:false,message:"Minimum withdrawal is ₹1,000."},400);
    if(!method||!details) return json({success:false,message:"Withdrawal method and account details are required."},400);
    const fresh=await env.DB.prepare("SELECT wallet_balance FROM users WHERE id=?").bind(u.id).first();
    if(Number(fresh?.wallet_balance||0)<amount) return json({success:false,message:"Insufficient wallet balance."},400);
    await env.DB.prepare("UPDATE users SET wallet_balance=wallet_balance-? WHERE id=?").bind(amount,u.id).run();
    await env.DB.prepare("INSERT INTO withdrawals(user_id,amount,method,account_details,status) VALUES(?,?,?,?,?)").bind(u.id,amount,method,details,"pending").run();
    await env.DB.prepare("INSERT INTO transactions(user_id,type,amount,direction,status,reference_id,description) VALUES(?,?,?,?,?,?,?)").bind(u.id,"withdrawal",amount,"debit","pending",null,"Withdrawal request").run();
    return json({success:true,message:"Withdrawal request submitted."});
  }catch(e){return json({success:false,message:safeError(e)},e.status||500);}
}
async function withdrawals(request,env){
  try{
    const u=await requireUser(request,env);
    const r=await env.DB.prepare("SELECT id,amount,method,status,created_at FROM withdrawals WHERE user_id=? ORDER BY id DESC LIMIT 50").bind(u.id).all();
    return json({success:true,items:r.results||[]});
  }catch(e){return json({success:false,message:safeError(e)},e.status||500);}
}

function home(){
return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CashGrow — Grow smarter. Share. Earn.</title>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<style>
:root{
  --cg-green:#0b3d2e;
  --cg-green2:#0f6b45;
  --cg-lime:#7ee22a;
  --cg-gold:#f7c948;
  --cg-gold2:#ffdf78;
  --cg-ink:#071b14;
  --cg-muted:#66756f;
  --cg-bg:#f4f8f5;
  --cg-white:#ffffff;
  --cg-border:rgba(11,61,46,.12);
  --cg-shadow:0 18px 55px rgba(7,27,20,.10);
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{
  margin:0;
  font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;
  color:var(--cg-ink);
  background:
    radial-gradient(circle at 10% 0%,rgba(126,226,42,.09),transparent 28%),
    radial-gradient(circle at 90% 8%,rgba(247,201,72,.11),transparent 25%),
    var(--cg-bg);
}
a{text-decoration:none;color:inherit}
.nav{
  position:sticky;top:0;z-index:50;
  background:rgba(4,29,21,.94);
  backdrop-filter:blur(16px);
  border-bottom:1px solid rgba(247,201,72,.18);
  box-shadow:0 8px 30px rgba(0,0,0,.12);
}
.navin{
  max-width:1180px;margin:auto;padding:10px 20px;
  display:flex;align-items:center;justify-content:space-between;gap:20px;
}
.brand{display:flex;align-items:center;gap:11px;color:#fff;font-size:22px;font-weight:950;letter-spacing:-.5px}
.brand img{width:48px;height:48px;object-fit:contain;border-radius:12px}
.brandText span:first-child{color:var(--cg-gold)}
.brandText span:last-child{color:var(--cg-lime)}
.links{display:flex;gap:18px;flex-wrap:wrap;font-size:13px;font-weight:800;color:#e8f5ee}
.links a{opacity:.9;transition:.2s}
.links a:hover{color:var(--cg-gold);opacity:1}
.hero{
  position:relative;overflow:hidden;color:#fff;text-align:center;
  padding:76px 20px 72px;
  background:
    radial-gradient(circle at 50% 0%,rgba(126,226,42,.22),transparent 34%),
    radial-gradient(circle at 80% 70%,rgba(247,201,72,.14),transparent 30%),
    linear-gradient(145deg,#031d15 0%,#073d2b 48%,#0a241b 100%);
  border-bottom:1px solid rgba(247,201,72,.18);
}
.hero:before,.hero:after{
  content:"";position:absolute;border-radius:50%;filter:blur(2px);pointer-events:none;
}
.hero:before{width:280px;height:280px;background:rgba(126,226,42,.08);left:-120px;top:-100px}
.hero:after{width:320px;height:320px;background:rgba(247,201,72,.07);right:-140px;bottom:-160px}
.heroLogo{
  width:min(220px,58vw);height:auto;display:block;margin:0 auto 18px;
  filter:drop-shadow(0 14px 30px rgba(0,0,0,.35));
}
.hero h1{font-size:clamp(38px,7vw,62px);line-height:1.02;margin:0 0 14px;letter-spacing:-2px}
.hero h1 .gold{color:var(--cg-gold)}
.hero p{font-size:18px;line-height:1.65;margin:0 auto 26px;max-width:700px;color:#d9eee4}
.cta{
  display:inline-flex;align-items:center;justify-content:center;
  background:linear-gradient(135deg,var(--cg-gold2),var(--cg-gold));
  color:#183427;padding:14px 23px;border-radius:14px;font-weight:950;
  box-shadow:0 10px 30px rgba(247,201,72,.24);
  border:1px solid rgba(255,255,255,.35);
}
.wrap{max-width:1180px;margin:auto;padding:34px 20px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:20px}
.card,.panel{
  background:rgba(255,255,255,.94);
  border:1px solid var(--cg-border);
  border-radius:22px;padding:26px;
  box-shadow:var(--cg-shadow);
  margin-bottom:20px;
}
.card{position:relative;overflow:hidden;transition:transform .2s,box-shadow .2s}
.card:hover{transform:translateY(-4px);box-shadow:0 24px 60px rgba(7,27,20,.14)}
.card:before{
  content:"";position:absolute;left:0;top:0;right:0;height:4px;
  background:linear-gradient(90deg,var(--cg-gold),var(--cg-lime));
}
.price{font-size:40px;font-weight:950;margin:14px 0;color:var(--cg-green)}
.btn{
  width:100%;border:0;border-radius:13px;padding:14px;
  background:linear-gradient(135deg,var(--cg-green2),var(--cg-green));
  color:#fff;font-weight:900;font-size:16px;cursor:pointer;
  box-shadow:0 9px 22px rgba(11,61,46,.18);
}
.btn:hover{filter:brightness(1.08)}
.btn.secondary{background:#092319}
.input{
  width:100%;padding:13px 14px;margin:7px 0;
  border:1px solid #d6e2dc;border-radius:12px;font-size:15px;
  background:#fbfdfc;outline:none;
}
.input:focus{border-color:var(--cg-green2);box-shadow:0 0 0 3px rgba(15,107,69,.10)}
.section{padding:42px 0}
.section h2{text-align:center;font-size:34px;line-height:1.15;margin:0 0 24px;color:var(--cg-green);letter-spacing:-.8px}
.section h2:after{
  content:"";display:block;width:58px;height:4px;border-radius:10px;
  margin:11px auto 0;background:linear-gradient(90deg,var(--cg-gold),var(--cg-lime));
}
.muted{color:var(--cg-muted)}
.steps{counter-reset:s}
.step{
  padding:20px;border:1px solid var(--cg-border);border-radius:18px;
  background:#fff;box-shadow:0 10px 28px rgba(7,27,20,.06)
}
.step b{display:block;margin-bottom:7px;color:var(--cg-green)}
.faq{border-bottom:1px solid #e1e9e4;padding:17px 0}
.faq summary{font-weight:850;cursor:pointer;color:var(--cg-green)}
.account{max-width:620px;margin:25px auto}
.tabs{display:flex;gap:8px;margin-bottom:12px}
.tabs button{flex:1;border:0;padding:11px;border-radius:11px;font-weight:850;background:#e9f1ed;color:var(--cg-green);cursor:pointer}
.tabs .active{background:linear-gradient(135deg,var(--cg-green2),var(--cg-green))!important;color:#fff}
.active{background:var(--cg-green)!important;color:#fff}
.hidden{display:none}
.wallet{font-size:38px;font-weight:950;text-align:center;color:var(--cg-green)}
.refbox{
  background:linear-gradient(135deg,#eff9e9,#fff8df);
  border:1px solid rgba(247,201,72,.35);
  border-radius:16px;padding:18px;text-align:center;
  font-size:22px;font-weight:950;letter-spacing:2px;color:var(--cg-green)
}
.footer{
  background:linear-gradient(145deg,#031d15,#082e21);
  color:#fff;padding:45px 20px;border-top:1px solid rgba(247,201,72,.18)
}
.footerin{max-width:1180px;margin:auto}
.footerBrand{display:flex;align-items:center;gap:12px}
.footerBrand img{width:58px;height:58px;border-radius:14px}
.footerBrand strong{font-size:26px}.footerBrand .gold{color:var(--cg-gold)}.footerBrand .lime{color:var(--cg-lime)}
.small{font-size:13px;color:#c8d9d1}
.notice{padding:12px 14px;border-radius:11px;background:#edf4f0;margin-top:10px}
.success{color:#16803c;font-weight:850}.danger{color:#b42318;font-weight:850}
.trustbar{
  display:grid;grid-template-columns:repeat(3,1fr);gap:12px;
  max-width:900px;margin:-24px auto 8px;position:relative;z-index:5;padding:0 20px
}
.trustitem{
  background:#fff;border:1px solid var(--cg-border);border-radius:16px;
  padding:14px;text-align:center;box-shadow:0 10px 30px rgba(7,27,20,.08)
}
.trustitem b{display:block;color:var(--cg-green);font-size:14px}.trustitem span{font-size:12px;color:var(--cg-muted)}
@media(max-width:760px){
  .links{display:none}.hero{padding:58px 16px}.heroLogo{width:180px}
  .hero h1{font-size:40px}.wrap{padding:25px 15px}.section{padding:30px 0}
  .trustbar{grid-template-columns:1fr;margin-top:-14px}
}
</style>
<link rel="icon" href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MTIgNTEyIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB4Mj0iMSI+PHN0b3Agc3RvcC1jb2xvcj0iI2Y3Yzk0OCIvPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iIzdlZTIyYSIvPjwvbGluZWFyR3JhZGllbnQ+PC9kZWZzPjxyZWN0IHdpZHRoPSI1MTIiIGhlaWdodD0iNTEyIiByeD0iODAiIGZpbGw9IiMwNDFkMTUiLz48cGF0aCBkPSJNOTUgMjYwYy0yMC0xMDAgNjUtMTc1IDE2MC0xNjBsLTQ1IDUwYy00NS00LTgyIDMwLTgyIDc1IDAgMjQgOSA0NiAyNSA2MmwtNDUgNDVjLTctMjAtMTItNDUtMTMtNzJ6IiBmaWxsPSIjZjdjOTQ4Ii8+PHBhdGggZD0iTTE0NSAzNTBsNDUtNDggMzUgMzUgNjUtMTA1IDI4IDI5IDc1LTk4LTEzIDgwLTYyIDY1LTI3LTI4LTY1IDEwNS0zNi0zNS00NSA0OHoiIGZpbGw9InVybCgjZykiLz48cGF0aCBkPSJNMjc4IDEwNWg3MnYxODBoLTcyeiIgZmlsbD0iIzdlZTIyYSIgb3BhY2l0eT0iLjkiLz48cGF0aCBkPSJNMjA1IDE2MGg3MnYxMzBoLTcyeiIgZmlsbD0iIzM5YjU0YSIgb3BhY2l0eT0iLjkiLz48dGV4dCB4PSIyNTYiIHk9IjQzMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9IkFyaWFsLHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iNTgiIGZvbnQtd2VpZ2h0PSI5MDAiIGZpbGw9IiNmN2M5NDgiPkNhc2g8dHNwYW4gZmlsbD0iIzdlZTIyYSI+R3JvdzwvdHNwYW4+PC90ZXh0Pjwvc3ZnPg=="></head>
<body>
<nav class="nav"><div class="navin">
<div class="brand">
<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MTIgNTEyIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB4Mj0iMSI+PHN0b3Agc3RvcC1jb2xvcj0iI2Y3Yzk0OCIvPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iIzdlZTIyYSIvPjwvbGluZWFyR3JhZGllbnQ+PC9kZWZzPjxyZWN0IHdpZHRoPSI1MTIiIGhlaWdodD0iNTEyIiByeD0iODAiIGZpbGw9IiMwNDFkMTUiLz48cGF0aCBkPSJNOTUgMjYwYy0yMC0xMDAgNjUtMTc1IDE2MC0xNjBsLTQ1IDUwYy00NS00LTgyIDMwLTgyIDc1IDAgMjQgOSA0NiAyNSA2MmwtNDUgNDVjLTctMjAtMTItNDUtMTMtNzJ6IiBmaWxsPSIjZjdjOTQ4Ii8+PHBhdGggZD0iTTE0NSAzNTBsNDUtNDggMzUgMzUgNjUtMTA1IDI4IDI5IDc1LTk4LTEzIDgwLTYyIDY1LTI3LTI4LTY1IDEwNS0zNi0zNS00NSA0OHoiIGZpbGw9InVybCgjZykiLz48cGF0aCBkPSJNMjc4IDEwNWg3MnYxODBoLTcyeiIgZmlsbD0iIzdlZTIyYSIgb3BhY2l0eT0iLjkiLz48cGF0aCBkPSJNMjA1IDE2MGg3MnYxMzBoLTcyeiIgZmlsbD0iIzM5YjU0YSIgb3BhY2l0eT0iLjkiLz48dGV4dCB4PSIyNTYiIHk9IjQzMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9IkFyaWFsLHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iNTgiIGZvbnQtd2VpZ2h0PSI5MDAiIGZpbGw9IiNmN2M5NDgiPkNhc2g8dHNwYW4gZmlsbD0iIzdlZTIyYSI+R3JvdzwvdHNwYW4+PC90ZXh0Pjwvc3ZnPg==" alt="CashGrow logo">
<div class="brandText"><span>Cash</span><span>Grow</span></div>
</div>
<div class="links">
<a href="#home">Home</a><a href="#packages">Packages</a><a href="#how">How It Works</a><a href="#referral">Referral</a><a href="#about">About</a><a href="#faq">FAQ</a><a href="#contact">Contact</a>
</div></div></nav>

<section id="home" class="hero">
<img class="heroLogo" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MTIgNTEyIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB4Mj0iMSI+PHN0b3Agc3RvcC1jb2xvcj0iI2Y3Yzk0OCIvPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iIzdlZTIyYSIvPjwvbGluZWFyR3JhZGllbnQ+PC9kZWZzPjxyZWN0IHdpZHRoPSI1MTIiIGhlaWdodD0iNTEyIiByeD0iODAiIGZpbGw9IiMwNDFkMTUiLz48cGF0aCBkPSJNOTUgMjYwYy0yMC0xMDAgNjUtMTc1IDE2MC0xNjBsLTQ1IDUwYy00NS00LTgyIDMwLTgyIDc1IDAgMjQgOSA0NiAyNSA2MmwtNDUgNDVjLTctMjAtMTItNDUtMTMtNzJ6IiBmaWxsPSIjZjdjOTQ4Ii8+PHBhdGggZD0iTTE0NSAzNTBsNDUtNDggMzUgMzUgNjUtMTA1IDI4IDI5IDc1LTk4LTEzIDgwLTYyIDY1LTI3LTI4LTY1IDEwNS0zNi0zNS00NSA0OHoiIGZpbGw9InVybCgjZykiLz48cGF0aCBkPSJNMjc4IDEwNWg3MnYxODBoLTcyeiIgZmlsbD0iIzdlZTIyYSIgb3BhY2l0eT0iLjkiLz48cGF0aCBkPSJNMjA1IDE2MGg3MnYxMzBoLTcyeiIgZmlsbD0iIzM5YjU0YSIgb3BhY2l0eT0iLjkiLz48dGV4dCB4PSIyNTYiIHk9IjQzMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9IkFyaWFsLHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iNTgiIGZvbnQtd2VpZ2h0PSI5MDAiIGZpbGw9IiNmN2M5NDgiPkNhc2g8dHNwYW4gZmlsbD0iIzdlZTIyYSI+R3JvdzwvdHNwYW4+PC90ZXh0Pjwvc3ZnPg==" alt="CashGrow — Grow smarter. Share. Earn.">
<h1><span class="gold">Grow smarter.</span> Share. Earn.</h1>
<p>A premium digital-products and referral platform built with a clean, transparent and mobile-first experience.</p>
<a class="cta" href="#packages">Explore Packages →</a>
</section>
<div class="trustbar">
<div class="trustitem"><b>Secure Payments</b><span>Razorpay checkout & server verification</span></div>
<div class="trustitem"><b>Smart Referral</b><span>Track eligible rewards in your wallet</span></div>
<div class="trustitem"><b>Mobile First</b><span>Designed for a smooth phone experience</span></div>
</div>

<div class="wrap">
<section id="account" class="section">
<div class="panel account">
<h2>CashGrow Account</h2>
<div class="tabs"><button id="loginTab" class="active" onclick="showLogin()">Login</button><button id="regTab" onclick="showRegister()">Create Account</button></div>
<div id="loginForm">
<input id="loginId" class="input" placeholder="Email or Mobile Number">
<input id="loginPass" class="input" type="password" placeholder="Password">
<button class="btn secondary" onclick="login()">Login</button>
</div>
<div id="regForm" class="hidden">
<input id="regName" class="input" placeholder="Full Name">
<input id="regPhone" class="input" placeholder="Mobile Number">
<input id="regEmail" class="input" type="email" placeholder="Email">
<input id="regPass" class="input" type="password" placeholder="Password (minimum 6 characters)">
<input id="regRef" class="input" placeholder="Referral Code (optional)">
<button class="btn" onclick="register()">Create Account</button>
</div>
<div id="authMsg" class="notice"></div>
</div>
<div id="dashboard" class="panel account hidden">
<h2>Your Dashboard</h2><p id="welcome"></p><div class="wallet" id="wallet">₹0.00</div>
<p class="muted" style="text-align:center">Wallet balance</p>
<div class="refbox" id="myRef">-</div><p class="muted" style="text-align:center">Your referral code</p>
<input id="profileName" class="input" placeholder="Name"><input id="profilePhone" class="input" placeholder="Phone">
<button class="btn secondary" onclick="saveProfile()">Save Profile</button>
<div style="height:10px"></div>
<input id="withdrawAmount" class="input" type="number" placeholder="Withdrawal amount (₹)">
<input id="withdrawMethod" class="input" placeholder="Method (UPI/Bank)">
<input id="withdrawDetails" class="input" placeholder="UPI ID / Bank details">
<button class="btn" onclick="requestWithdrawal()">Request Withdrawal</button>
<div id="dashMsg" class="notice"></div><button class="btn secondary" style="margin-top:10px" onclick="logout()">Logout</button>
</div>
</section>

<section id="packages" class="section"><h2>Choose Your Package</h2>
<div class="grid">
<div class="card"><h3>Starter Bundle</h3><p class="muted">Digital Creator Starter Bundle</p><div class="price">₹599</div><p>Referral reward: <b>₹400</b></p><button class="btn" onclick="buy('starter',event)">Buy Starter</button></div>
<div class="card"><h3>Pro Bundle</h3><p class="muted">Digital Creator Pro Bundle</p><div class="price">₹999</div><p>Referral reward: <b>₹800</b></p><button class="btn" onclick="buy('pro',event)">Buy Pro</button></div>
</div><div id="payMsg" class="notice"></div></section>

<section id="how" class="section"><h2>How It Works</h2><div class="grid">
<div class="step"><b>1. Create your account</b><span class="muted">Register with your name, mobile and email.</span></div>
<div class="step"><b>2. Choose a package</b><span class="muted">Select the ₹599 Starter or ₹999 Pro bundle.</span></div>
<div class="step"><b>3. Share your referral</b><span class="muted">Share your personal referral code with eligible customers.</span></div>
<div class="step"><b>4. Earn referral rewards</b><span class="muted">A qualifying referred purchase can credit the applicable reward.</span></div>
</div></section>

<section id="referral" class="section"><h2>Referral Program</h2><div class="grid">
<div class="card"><h3>Starter Referral</h3><div class="price">₹400</div><p class="muted">Reward for a qualifying ₹599 referred purchase.</p></div>
<div class="card"><h3>Pro Referral</h3><div class="price">₹800</div><p class="muted">Reward for a qualifying ₹999 referred purchase.</p></div>
<div class="card"><h3>Minimum Withdrawal</h3><div class="price">₹1,000</div><p class="muted">Wallet withdrawals start from ₹1,000, subject to verification and terms.</p></div>
</div></section>

<section id="about" class="section"><h2>About CashGrow</h2><div class="panel"><p>CashGrow is a digital-products and referral platform designed to make product access and referral tracking simple. Payments are processed through Razorpay and verified on the server before qualifying rewards are credited.</p><p class="muted">Rewards are subject to the applicable program terms, payment verification, anti-fraud checks and account eligibility.</p></div></section>

<section id="faq" class="section"><h2>Frequently Asked Questions</h2><div class="panel">
<details class="faq"><summary>How do I create an account?</summary><p class="muted">Use Create Account above and complete the required fields.</p></details>
<details class="faq"><summary>What are the package prices?</summary><p class="muted">Starter is ₹599 and Pro is ₹999.</p></details>
<details class="faq"><summary>How is a referral reward credited?</summary><p class="muted">The payment is verified first. If the referral code is valid and eligible, the applicable reward is credited to the referrer's wallet.</p></details>
<details class="faq"><summary>What is the minimum withdrawal?</summary><p class="muted">₹1,000.</p></details>
<details class="faq"><summary>Can I withdraw immediately after a purchase?</summary><p class="muted">Withdrawals depend on your available wallet balance and the platform's verification and withdrawal process.</p></details>
</div></section>

<section id="contact" class="section"><h2>Contact</h2><div class="panel"><p><b>CashGrow Support</b></p><p class="muted">For account, payment or withdrawal support, use the support contact provided by CashGrow before launch.</p></div></section>

<section id="policies" class="section"><h2>Terms & Policies</h2><div class="grid">
<div class="card"><h3>Terms</h3><p class="muted">Use the platform lawfully. Payments, rewards and withdrawals are subject to verification, eligibility and applicable terms.</p></div>
<div class="card"><h3>Privacy</h3><p class="muted">Account and payment-related information is used to provide the service, process transactions and maintain security.</p></div>
<div class="card"><h3>Refund</h3><p class="muted">Refunds are handled according to the applicable product, payment and CashGrow refund policy.</p></div>
<div class="card"><h3>Disclaimer</h3><p class="muted">Referral rewards are not guaranteed income. Eligibility and reward credit depend on verified qualifying activity.</p></div>
</div></section>
</div>

<footer class="footer"><div class="footerin">
<div class="footerBrand"><img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MTIgNTEyIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB4Mj0iMSI+PHN0b3Agc3RvcC1jb2xvcj0iI2Y3Yzk0OCIvPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iIzdlZTIyYSIvPjwvbGluZWFyR3JhZGllbnQ+PC9kZWZzPjxyZWN0IHdpZHRoPSI1MTIiIGhlaWdodD0iNTEyIiByeD0iODAiIGZpbGw9IiMwNDFkMTUiLz48cGF0aCBkPSJNOTUgMjYwYy0yMC0xMDAgNjUtMTc1IDE2MC0xNjBsLTQ1IDUwYy00NS00LTgyIDMwLTgyIDc1IDAgMjQgOSA0NiAyNSA2MmwtNDUgNDVjLTctMjAtMTItNDUtMTMtNzJ6IiBmaWxsPSIjZjdjOTQ4Ii8+PHBhdGggZD0iTTE0NSAzNTBsNDUtNDggMzUgMzUgNjUtMTA1IDI4IDI5IDc1LTk4LTEzIDgwLTYyIDY1LTI3LTI4LTY1IDEwNS0zNi0zNS00NSA0OHoiIGZpbGw9InVybCgjZykiLz48cGF0aCBkPSJNMjc4IDEwNWg3MnYxODBoLTcyeiIgZmlsbD0iIzdlZTIyYSIgb3BhY2l0eT0iLjkiLz48cGF0aCBkPSJNMjA1IDE2MGg3MnYxMzBoLTcyeiIgZmlsbD0iIzM5YjU0YSIgb3BhY2l0eT0iLjkiLz48dGV4dCB4PSIyNTYiIHk9IjQzMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9IkFyaWFsLHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iNTgiIGZvbnQtd2VpZ2h0PSI5MDAiIGZpbGw9IiNmN2M5NDgiPkNhc2g8dHNwYW4gZmlsbD0iIzdlZTIyYSI+R3JvdzwvdHNwYW4+PC90ZXh0Pjwvc3ZnPg==" alt="CashGrow logo"><div><strong><span class="gold">Cash</span><span class="lime">Grow</span></strong><div class="small">GROW SMARTER. SHARE. EARN.</div></div></div>
<p>Digital products, account tools and referral tracking in one professional platform.</p>
<p class="small">© 2026 CashGrow. All rights reserved.</p>
</div></footer>

<script>
const $=id=>document.getElementById(id);
function showLogin(){$("loginForm").classList.remove("hidden");$("regForm").classList.add("hidden");$("loginTab").classList.add("active");$("regTab").classList.remove("active");}
function showRegister(){$("loginForm").classList.add("hidden");$("regForm").classList.remove("hidden");$("loginTab").classList.remove("active");$("regTab").classList.add("active");}
function msg(id,t,cls=""){$(id).textContent=t;$(id).className="notice "+cls;}
async function register(){
  msg("authMsg","Creating account...");
  try{const r=await fetch("/api/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:$("regName").value,phone:$("regPhone").value,email:$("regEmail").value,password:$("regPass").value,referral_code:$("regRef").value})});const d=await r.json();if(!d.success){msg("authMsg",d.message||"Registration failed.","danger");return;}msg("authMsg",d.message||"Account created.","success");showDashboard(d.user);}
  catch(e){msg("authMsg","Registration failed.","danger");}
}
async function login(){
  msg("authMsg","Logging in...");
  try{const r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({identifier:$("loginId").value,password:$("loginPass").value})});const d=await r.json();if(!d.success){msg("authMsg",d.message||"Login failed.","danger");return;}msg("authMsg","Login successful.","success");showDashboard(d.user);await loadDashboard();}
  catch(e){msg("authMsg","Login failed.","danger");}
}
function showDashboard(u){$("dashboard").classList.remove("hidden");$("welcome").textContent="Welcome, "+(u.name||"CashGrow Member");$("wallet").textContent="₹"+(Number(u.wallet_balance||0)/100).toFixed(2);$("myRef").textContent=u.referral_code||"-";$("profileName").value=u.name||"";$("profilePhone").value=u.phone||"";}
async function checkLogin(){try{const r=await fetch("/api/me");if(!r.ok)return;const d=await r.json();if(d.success&&d.loggedIn){showDashboard(d.user);await loadDashboard();}}catch(e){}}
async function loadDashboard(){try{const r=await fetch("/api/dashboard");const d=await r.json();if(d.success){$("wallet").textContent="₹"+(Number(d.user.wallet_balance||0)/100).toFixed(2);$("myRef").textContent=d.user.referral_code||"-";}}catch(e){}}
async function logout(){await fetch("/api/logout",{method:"POST"});$("dashboard").classList.add("hidden");showLogin();msg("authMsg","Logged out.");}
async function saveProfile(){const r=await fetch("/api/profile",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:$("profileName").value,phone:$("profilePhone").value})});const d=await r.json();msg("dashMsg",d.message||"Done",d.success?"success":"danger");if(d.success)await loadDashboard();}
async function requestWithdrawal(){const r=await fetch("/api/withdraw",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({amount:$("withdrawAmount").value,method:$("withdrawMethod").value,account_details:$("withdrawDetails").value})});const d=await r.json();msg("dashMsg",d.message||"Done",d.success?"success":"danger");if(d.success)await loadDashboard();}
async function buy(product,ev){
  const button=ev?.currentTarget; if(button){button.disabled=true;button.textContent="Creating Order...";}
  msg("payMsg","Creating payment order...");
  try{
    const r=await fetch("/api/create-order",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({product})});
    const o=await r.json();if(!r.ok||!o.success)throw new Error(o.error||"Order creation failed");
    const options={key:o.key_id,amount:o.amount,currency:"INR",name:"CashGrow",description:o.name,order_id:o.order_id,prefill:{name:$("profileName").value||"",email:$("regEmail").value||$("loginId").value||"",contact:$("profilePhone").value||""},handler:async function(resp){
      msg("payMsg","Verifying payment...");
      const vr=await fetch("/api/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({razorpay_order_id:resp.razorpay_order_id,razorpay_payment_id:resp.razorpay_payment_id,razorpay_signature:resp.razorpay_signature,name:$("profileName").value||$("regName").value,phone:$("profilePhone").value||$("regPhone").value,email:$("regEmail").value,referral_code:$("regRef").value})});
      const d=await vr.json();msg("payMsg",d.message||"Verification failed",d.success?"success":"danger");if(d.success)await loadDashboard();
      if(button){button.disabled=false;button.textContent=product==="starter"?"Buy Starter":"Buy Pro";}
    },modal:{ondismiss:function(){if(button){button.disabled=false;button.textContent=product==="starter"?"Buy Starter":"Buy Pro";}}}};
    const rzp=new Razorpay(options);rzp.on("payment.failed",()=>msg("payMsg","Payment failed. Please try again.","danger"));rzp.open();
  }catch(e){msg("payMsg",e.message||"Payment failed.","danger");if(button){button.disabled=false;button.textContent=product==="starter"?"Buy Starter":"Buy Pro";}}
}
checkLogin();
</script>
</body></html>`;
}
