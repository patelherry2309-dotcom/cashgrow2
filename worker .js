export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      await ensureSchema(env);
      return await router(request, env, url);
    } catch (error) {
      console.error("CASHGROW_ERROR", error);
      return json({ success:false, message:"Internal server error." }, 500);
    }
  }
};

const PRODUCTS = {
  starter: { key:"starter", name:"Starter Bundle", amount:59900, price:599, reward:40000, rewardRupees:400 },
  pro: { key:"pro", name:"Pro Bundle", amount:99900, price:999, reward:80000, rewardRupees:800 }
};
const MIN_WITHDRAWAL = 100000;
const SESSION_DAYS = 7;

async function ensureSchema(env) {
  if (!env.DB) throw new Error("D1 binding DB is missing.");
  const stmts = [
    `CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0,
      direction TEXT NOT NULL DEFAULT 'credit',
      status TEXT NOT NULL DEFAULT 'completed',
      reference_id TEXT,
      description TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      method TEXT,
      account_name TEXT,
      account_number TEXT,
      ifsc TEXT,
      upi_id TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_resets_token ON password_resets(token_hash)`
  ];
  for (const sql of stmts) await env.DB.prepare(sql).run();
}

async function router(request, env, url) {
  if (url.pathname === "/api/register" && request.method === "POST") return register(request, env);
  if (url.pathname === "/api/login" && request.method === "POST") return login(request, env);
  if (url.pathname === "/api/logout" && request.method === "POST") return logout(request, env);
  if (url.pathname === "/api/me" && request.method === "GET") return me(request, env);
  if (url.pathname === "/api/profile" && request.method === "POST") return profile(request, env);
  if (url.pathname === "/api/forgot-password" && request.method === "POST") return forgotPassword(request, env, url);
  if (url.pathname === "/api/reset-password" && request.method === "POST") return resetPassword(request, env);
  if (url.pathname === "/api/create-order" && request.method === "POST") return createOrder(request, env);
  if (url.pathname === "/api/verify" && request.method === "POST") return verifyPayment(request, env);
  if (url.pathname === "/api/dashboard" && request.method === "GET") return dashboard(request, env);
  if (url.pathname === "/api/referrals" && request.method === "GET") return referrals(request, env);
  if (url.pathname === "/api/transactions" && request.method === "GET") return transactions(request, env);
  if (url.pathname === "/api/withdraw" && request.method === "POST") return withdraw(request, env);
  if (url.pathname === "/api/withdrawals" && request.method === "GET") return withdrawals(request, env);
  if (url.pathname === "/api/admin/overview" && request.method === "GET") return adminOverview(request, env);
  if (url.pathname === "/api/admin/withdrawals" && request.method === "GET") return adminWithdrawals(request, env);
  if (url.pathname === "/api/admin/withdrawal-status" && request.method === "POST") return adminWithdrawalStatus(request, env);
  if (url.pathname === "/api/admin/payment-status" && request.method === "POST") return adminPaymentStatus(request, env);
  if (url.pathname === "/api/health" && request.method === "GET") return json({success:true, service:"CashGrow", time:new Date().toISOString()});
  if (request.method === "GET") return home(request, env, url);
  return json({success:false,message:"Method not allowed."},405);
}

function json(data, status=200, headers={}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {"Content-Type":"application/json; charset=UTF-8", ...headers}
  });
}
function html(body, status=200) {
  return new Response(body,{status,headers:{"Content-Type":"text/html; charset=UTF-8","Cache-Control":"no-store"}});
}
function now(){ return new Date().toISOString(); }
function clean(s){ return String(s ?? "").trim(); }
function phone(s){ return clean(s).replace(/\D/g,""); }
function moneyPaise(n){ return Math.round(Number(n)||0); }
function b64url(bytes){
  let s=""; const a=new Uint8Array(bytes);
  for(let i=0;i<a.length;i++) s+=String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function hex(bytes){ return Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,"0")).join(""); }
function unhex(s){ const a=new Uint8Array(s.length/2); for(let i=0;i<a.length;i++) a[i]=parseInt(s.slice(i*2,i*2+2),16); return a; }

async function sha256(text){
  return crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));
}
async function hashToken(token){ return hex(await sha256(token)); }

async function hashPassword(password){
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),"PBKDF2",false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt,iterations:100000,hash:"SHA-256"},key,256);
  return `pbkdf2$100000$${hex(salt)}$${hex(bits)}`;
}
async function verifyPassword(password, stored){
  try{
    const p=String(stored).split("$"); if(p.length!==4||p[0]!=="pbkdf2") return false;
    const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),"PBKDF2",false,["deriveBits"]);
    const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt:unhex(p[2]),iterations:Number(p[1]),hash:"SHA-256"},key,256);
    const a=new Uint8Array(bits), b=unhex(p[3]); if(a.length!==b.length) return false;
    let d=0; for(let i=0;i<a.length;i++) d|=a[i]^b[i]; return d===0;
  }catch{return false;}
}
async function referralCode(env){
  const chars="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  for(let k=0;k<20;k++){
    const b=crypto.getRandomValues(new Uint8Array(6)); let s="CG";
    for(let i=0;i<6;i++) s+=chars[b[i]%chars.length];
    const e=await env.DB.prepare("SELECT id FROM users WHERE referral_code=? LIMIT 1").bind(s).first();
    if(!e)return s;
  }
  throw new Error("Could not generate referral code.");
}
function cookie(token,maxAge=604800){
  return `session_token=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}
function getCookie(request,name){
  const c=request.headers.get("Cookie")||"";
  const m=c.match(new RegExp("(?:^|;\\\\s*)"+name+"=([^;]+)"));
  return m?m[1]:null;
}
async function currentUser(request,env){
  const token=getCookie(request,"session_token"); if(!token)return null;
  return await env.DB.prepare(
    `SELECT id,name,phone,email,referral_code,referred_by,wallet_balance FROM users
     WHERE session_token=? AND session_expires_at>? LIMIT 1`
  ).bind(token,now()).first();
}
async function requireUser(request,env){
  const u=await currentUser(request,env);
  if(!u) return {error:json({success:false,message:"Please login."},401)};
  return {user:u};
}
async function register(request,env){
  const b=await request.json(); const name=clean(b.name), ph=phone(b.phone), email=clean(b.email).toLowerCase(), pw=String(b.password||""), ref=clean(b.referral_code).toUpperCase();
  if(!name||!ph||!email||!pw)return json({success:false,message:"All fields are required."},400);
  if(pw.length<6)return json({success:false,message:"Password must be at least 6 characters."},400);
  const existing=await env.DB.prepare("SELECT * FROM users WHERE lower(email)=? AND phone=? LIMIT 1").bind(email,ph).first();
  const pwh=await hashPassword(pw), token=crypto.randomUUID(), exp=new Date(Date.now()+SESSION_DAYS*86400000).toISOString();
  if(existing){
    if(existing.password_hash)return json({success:false,message:"Account already exists. Please login."},409);
    await env.DB.prepare("UPDATE users SET password_hash=?,session_token=?,session_expires_at=? WHERE id=?").bind(pwh,token,exp,existing.id).run();
    return json({success:true,message:"Account activated successfully.",user:safeUser(existing)},200,{"Set-Cookie":cookie(token)});
  }
  const conflict=await env.DB.prepare("SELECT id FROM users WHERE lower(email)=? OR phone=? LIMIT 1").bind(email,ph).first();
  if(conflict)return json({success:false,message:"Email or phone is already registered."},409);
  let referredBy=null;
  if(ref){
    const r=await env.DB.prepare("SELECT referral_code FROM users WHERE referral_code=? LIMIT 1").bind(ref).first();
    if(r)referredBy=r.referral_code;
  }
  const code=await referralCode(env);
  const ins=await env.DB.prepare(
    `INSERT INTO users(name,phone,email,referral_code,referred_by,wallet_balance,password_hash,session_token,session_expires_at)
     VALUES(?,?,?,?,?,?,?,?,?)`
  ).bind(name,ph,email,code,referredBy,0,pwh,token,exp).run();
  const user={id:ins.meta.last_row_id,name,phone:ph,email,referral_code:code,referred_by:referredBy,wallet_balance:0};
  return json({success:true,message:"Account created successfully.",user},200,{"Set-Cookie":cookie(token)});
}
function safeUser(u){ return {id:u.id,name:u.name,phone:u.phone,email:u.email,referral_code:u.referral_code,referred_by:u.referred_by,wallet_balance:u.wallet_balance||0}; }
async function login(request,env){
  const b=await request.json(), id=clean(b.identifier).toLowerCase(), pw=String(b.password||""), ph=phone(id);
  if(!id||!pw)return json({success:false,message:"Email/mobile and password are required."},400);
  const u=await env.DB.prepare("SELECT * FROM users WHERE lower(email)=? OR phone=? LIMIT 1").bind(id,ph).first();
  if(!u)return json({success:false,message:"Account not found."},401);
  if(!u.password_hash)return json({success:false,message:"Please create/activate your account first."},400);
  if(!(await verifyPassword(pw,u.password_hash)))return json({success:false,message:"Incorrect password."},401);
  const token=crypto.randomUUID(), exp=new Date(Date.now()+SESSION_DAYS*86400000).toISOString();
  await env.DB.prepare("UPDATE users SET session_token=?,session_expires_at=? WHERE id=?").bind(token,exp,u.id).run();
  return json({success:true,message:"Login successful.",user:safeUser(u)},200,{"Set-Cookie":cookie(token)});
}
async function logout(request,env){
  const t=getCookie(request,"session_token"); if(t)await env.DB.prepare("UPDATE users SET session_token=NULL,session_expires_at=NULL WHERE session_token=?").bind(t).run();
  return json({success:true},200,{"Set-Cookie":cookie("",0)});
}
async function me(request,env){
  const u=await currentUser(request,env); if(!u)return json({success:false,loggedIn:false},401);
  const s=await env.DB.prepare("SELECT COUNT(*) referral_count,COALESCE(SUM(reward_amount),0) referral_earnings FROM referrals WHERE referrer_user_id=?").bind(u.id).first();
  return json({success:true,loggedIn:true,user:{...safeUser(u),referral_count:Number(s?.referral_count||0),referral_earnings:Number(s?.referral_earnings||0)}});
}
async function profile(request,env){
  const a=await requireUser(request,env); if(a.error)return a.error; const u=a.user,b=await request.json();
  const name=clean(b.name)||u.name, ph=phone(b.phone)||u.phone, email=clean(b.email).toLowerCase()||u.email;
  const conflict=await env.DB.prepare("SELECT id FROM users WHERE (lower(email)=? OR phone=?) AND id<>? LIMIT 1").bind(email,ph,u.id).first();
  if(conflict)return json({success:false,message:"Email or phone is already used."},409);
  await env.DB.prepare("UPDATE users SET name=?,phone=?,email=? WHERE id=?").bind(name,ph,email,u.id).run();
  return json({success:true,user:safeUser({...u,name,phone:ph,email})});
}

async function forgotPassword(request,env,url){
  const b=await request.json(), identifier=clean(b.identifier).toLowerCase(), ph=phone(identifier);
  const u=await env.DB.prepare("SELECT id,email,name FROM users WHERE lower(email)=? OR phone=? LIMIT 1").bind(identifier,ph).first();
  // Always generic response to avoid account enumeration.
  if(u){
    const raw=crypto.randomUUID().replace(/-/g,"")+crypto.randomUUID().replace(/-/g,"");
    const h=await hashToken(raw), exp=new Date(Date.now()+30*60*1000).toISOString();
    await env.DB.prepare("INSERT INTO password_resets(user_id,token_hash,expires_at,created_at) VALUES(?,?,?,?)").bind(u.id,h,exp,now()).run();
    const base=url.origin;
    const resetLink=`${base}/?reset=${encodeURIComponent(raw)}`;
    if(env.RESEND_API_KEY){
      await sendResetEmail(env,u,resetLink).catch(e=>console.error("RESET_EMAIL",e));
    } else {
      console.log("CASHGROW_RESET_LINK",resetLink);
    }
  }
  return json({success:true,message:"If the account exists, reset instructions have been generated. Check your email."});
}
async function sendResetEmail(env,u,link){
  const from=env.RESET_FROM_EMAIL||"CashGrow <onboarding@resend.dev>";
  const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":`Bearer ${env.RESEND_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({from,to:[u.email],subject:"CashGrow password reset",html:`<p>Hello ${escapeHtml(u.name||"User")},</p><p>Reset your CashGrow password:</p><p><a href="${link}">${link}</a></p><p>This link expires in 30 minutes.</p>`})});
  if(!r.ok)throw new Error("Email send failed");
}
async function resetPassword(request,env){
  const b=await request.json(), token=clean(b.token), pw=String(b.password||"");
  if(!token||pw.length<6)return json({success:false,message:"Valid token and password (6+ characters) are required."},400);
  const h=await hashToken(token), row=await env.DB.prepare("SELECT * FROM password_resets WHERE token_hash=? AND used=0 AND expires_at>? LIMIT 1").bind(h,now()).first();
  if(!row)return json({success:false,message:"Reset link is invalid or expired."},400);
  const pwh=await hashPassword(pw), session=crypto.randomUUID(), exp=new Date(Date.now()+SESSION_DAYS*86400000).toISOString();
  await env.DB.prepare("UPDATE users SET password_hash=?,session_token=?,session_expires_at=? WHERE id=?").bind(pwh,session,exp,row.user_id).run();
  await env.DB.prepare("UPDATE password_resets SET used=1 WHERE id=?").bind(row.id).run();
  return json({success:true,message:"Password reset successfully."},200,{"Set-Cookie":cookie(session)});
}

function productFrom(key){ return PRODUCTS[String(key||"").toLowerCase()]||null; }
async function createOrder(request,env){
  const b=await request.json(), product=productFrom(b.product);
  if(!product)return json({success:false,message:"Invalid product."},400);
  if(!env.RAZORPAY_KEY_ID||!env.RAZORPAY_KEY_SECRET)return json({success:false,message:"Razorpay configuration is missing."},500);
  const ph=phone(b.phone), email=clean(b.email).toLowerCase(), name=clean(b.name), ref=clean(b.referral_code).toUpperCase();
  if(!name||!ph||!email)return json({success:false,message:"Name, phone and email are required."},400);
  let user=await env.DB.prepare("SELECT * FROM users WHERE lower(email)=? OR phone=? LIMIT 1").bind(email,ph).first();
  if(!user){
    let referredBy=null;
    if(ref){
      const r=await env.DB.prepare("SELECT referral_code FROM users WHERE referral_code=? LIMIT 1").bind(ref).first();
      if(r)referredBy=r.referral_code;
    }
    const code=await referralCode(env);
    const ins=await env.DB.prepare("INSERT INTO users(name,phone,email,referral_code,referred_by,wallet_balance) VALUES(?,?,?,?,?,0)").bind(name,ph,email,code,referredBy).run();
    user={id:ins.meta.last_row_id,name,phone:ph,email,referral_code:code,referred_by:referredBy,wallet_balance:0};
  }
console.log("RZP CONFIG CHECK", {
  keyIdPrefix: env.RAZORPAY_KEY_ID?.slice(0, 8),
  keyIdLength: env.RAZORPAY_KEY_ID?.length,
  secretLength: env.RAZORPAY_KEY_SECRET?.length
});
  const auth=btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
  const rr=await fetch("https://api.razorpay.com/v1/orders",{method:"POST",headers:{"Authorization":`Basic ${auth}`,"Content-Type":"application/json"},body:JSON.stringify({amount:product.amount,currency:"INR",receipt:`CG${user.id}-${Date.now()}`,notes:{user_id:String(user.id),product:product.key}})});
  const data=await rr.json();
  if(!rr.ok)return json({success:false,message:"Could not create Razorpay order.",error:data?.error?.description||"Razorpay error"},500);
  return json({success:true,order:data,key_id:env.RAZORPAY_KEY_ID,product,user_id:user.id});
}
async function hmac(secret,text){
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return hex(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(text)));
}
async function razorpayGetPayment(env){
  const auth=btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
  const r=await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`,{headers:{Authorization:`Basic ${auth}`}});
  const d=await r.json(); return {ok:r.ok,data:d};
}
async function verifyPayment(request,env){
  const b=await request.json();
 console.log("VERIFY START");
  const orderId=clean(b.razorpay_order_id), paymentId=clean(b.razorpay_payment_id), signature=clean(b.razorpay_signature);
  const product=productFrom(b.product);
  if(!orderId||!paymentId||!signature||!product)return json({success:false,message:"Required payment fields are missing."},400);
  if(!env.RAZORPAY_KEY_SECRET)return json({success:false,message:"Razorpay secret is missing."},500);
  const expected=await hmac(env.RAZORPAY_KEY_SECRET,`${orderId}|${paymentId}`);
  if(expected!==signature)return json({success:false,message:"Invalid payment signature."},400);
  const rp=await razorpayGetPayment(env,paymentId);
  if(!rp.ok)return json({success:false,message:"Unable to verify payment with Razorpay."},400);
  const p=rp.data;
  if(p.order_id!==orderId)return json({success:false,message:"Payment/order mismatch."},400);
  if(p.status!=="captured")return json({success:false,message:"Payment is not captured."},400);
  if(Number(p.amount)!==product.amount)return json({success:false,message:"Payment amount mismatch."},400);
  const duplicate=await env.DB.prepare("SELECT id,user_id FROM payments WHERE razorpay_payment_id=? LIMIT 1").bind(paymentId).first();
  if(duplicate)return json({success:true,message:"Payment already verified.",duplicate:true});
  let userId=Number(b.user_id)||0;
  if(!userId){
    const u=await env.DB.prepare("SELECT id FROM users WHERE lower(email)=? OR phone=? LIMIT 1").bind(clean(b.email).toLowerCase(),phone(b.phone)).first();
    userId=Number(u?.id||0);
  }
  if(!userId)return json({success:false,message:"User account could not be identified."},400);
  const user=await env.DB.prepare("SELECT * FROM users WHERE id=? LIMIT 1").bind(userId).first();
  if(!user)return json({success:false,message:"User not found."},404);
  const t=now();
  await env.DB.prepare(
    `INSERT INTO payments(user_id,amount,product,status,razorpay_payment_id,created_at)
     VALUES(?,?,?,?,?,?)`
  ).bind(userId,product.amount,product.key,"captured",paymentId,t).run();
  await env.DB.prepare(
    `INSERT INTO transactions(user_id,type,amount,direction,status,reference_id,description,created_at)
     VALUES(?,?,?,?,?,?,?,?)`
  ).bind(userId,"payment",product.amount,"debit","completed",paymentId,`${product.name} purchase`,t).run();
  if(user.referred_by){
    const referrer=await env.DB.prepare("SELECT id FROM users WHERE referral_code=? LIMIT 1").bind(user.referred_by).first();
    if(referrer && Number(referrer.id)!==userId){
      const exists=await env.DB.prepare("SELECT id FROM referrals WHERE payment_id=? LIMIT 1").bind(paymentId).first();
      if(!exists){
        const reward=product.reward;
        await env.DB.prepare("INSERT INTO referrals(referrer_user_id,referred_user_id,product,reward_amount,status,payment_id,created_at) VALUES(?,?,?,?,?,?,?)")
          .bind(referrer.id,userId,product.key,reward,"completed",paymentId,t).run();
        await env.DB.prepare("UPDATE users SET wallet_balance=COALESCE(wallet_balance,0)+? WHERE id=?").bind(reward,referrer.id).run();
        await env.DB.prepare("INSERT INTO transactions(user_id,type,amount,direction,status,reference_id,description,created_at) VALUES(?,?,?,?,?,?,?,?)")
          .bind(referrer.id,"referral_cashback",reward,"credit","completed",paymentId,`${product.name} referral cashback`,t).run();
      }
    }
  }
  return json({success:true,message:"Payment verified successfully.",payment_id:paymentId,product:product.key});
}

async function dashboard(request,env){
  const a=await requireUser(request,env); if(a.error)return a.error; const u=a.user;
  const [r,p,t,w]=await Promise.all([
    env.DB.prepare("SELECT COUNT(*) count,COALESCE(SUM(reward_amount),0) earnings FROM referrals WHERE referrer_user_id=?").bind(u.id).first(),
    env.DB.prepare("SELECT id,amount,product,status,razorpay_payment_id,created_at FROM payments WHERE user_id=? ORDER BY id DESC LIMIT 20").bind(u.id).all(),
    env.DB.prepare("SELECT id,type,amount,direction,status,reference_id,description,created_at FROM transactions WHERE user_id=? ORDER BY id DESC LIMIT 50").bind(u.id).all(),
    env.DB.prepare("SELECT id,amount,status,method,account_name,account_number,ifsc,upi_id,created_at,updated_at FROM withdrawals WHERE user_id=? ORDER BY id DESC LIMIT 20").bind(u.id).all()
  ]);
  return json({success:true,user:{...safeUser(u),wallet_balance:Number(u.wallet_balance||0)},referrals:{count:Number(r?.results?.[0]?.count||r?.count||0),earnings:Number(r?.results?.[0]?.earnings||r?.earnings||0)},payments:p.results||[],transactions:t.results||[],withdrawals:w.results||[]});
}
async function referrals(request,env){
  const a=await requireUser(request,env); if(a.error)return a.error;
  const r=await env.DB.prepare(
    `SELECT r.id,r.product,r.reward_amount,r.status,r.payment_id,r.created_at,
            u.name referred_name,u.email referred_email
     FROM referrals r LEFT JOIN users u ON u.id=r.referred_user_id
     WHERE r.referrer_user_id=? ORDER BY r.id DESC LIMIT 100`
  ).bind(a.user.id).all();
  return json({success:true,referrals:r.results||[]});
}
async function transactions(request,env){
  const a=await requireUser(request,env); if(a.error)return a.error;
  const r=await env.DB.prepare("SELECT * FROM transactions WHERE user_id=? ORDER BY id DESC LIMIT 100").bind(a.user.id).all();
  return json({success:true,transactions:r.results||[]});
}
async function withdraw(request,env){
  const a=await requireUser(request,env); if(a.error)return a.error; const u=a.user,b=await request.json();
  const amount=moneyPaise(b.amount), method=clean(b.method), accountName=clean(b.account_name), accountNumber=clean(b.account_number), ifsc=clean(b.ifsc).toUpperCase(), upi=clean(b.upi_id);
  if(amount<MIN_WITHDRAWAL)return json({success:false,message:"Minimum withdrawal is ₹1,000."},400);
  if(amount%100!==0)return json({success:false,message:"Withdrawal amount must be in whole rupees."},400);
  if(!method)return json({success:false,message:"Withdrawal method is required."},400);
  if(method==="upi"&&!upi)return json({success:false,message:"UPI ID is required."},400);
  if(method!=="upi"&&(!accountName||!accountNumber||!ifsc))return json({success:false,message:"Bank details are required."},400);
  const fresh=await env.DB.prepare("SELECT wallet_balance FROM users WHERE id=?").bind(u.id).first(), bal=Number(fresh?.wallet_balance||0);
  if(bal<amount)return json({success:false,message:"Insufficient wallet balance."},400);
  const t=now();
  // Atomic enough for D1 single request: condition prevents negative balance.
  const deduct=await env.DB.prepare("UPDATE users SET wallet_balance=wallet_balance-? WHERE id=? AND wallet_balance>=?").bind(amount,u.id,amount).run();
  if(!deduct.meta?.changes)return json({success:false,message:"Insufficient wallet balance."},409);
  const ins=await env.DB.prepare(
    `INSERT INTO withdrawals(user_id,amount,status,method,account_name,account_number,ifsc,upi_id,note,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(u.id,amount,"pending",method,accountName,accountNumber,ifsc,upi,"",t,t).run();
  await env.DB.prepare("INSERT INTO transactions(user_id,type,amount,direction,status,reference_id,description,created_at) VALUES(?,?,?,?,?,?,?,?)")
    .bind(u.id,"withdrawal",amount,"debit","pending",String(ins.meta.last_row_id),"Withdrawal request",t).run();
  return json({success:true,message:"Withdrawal request submitted.",withdrawal_id:ins.meta.last_row_id});
}

function adminOk(request,env){
  const secret=env.ADMIN_SECRET; if(!secret)return false;
  return request.headers.get("X-Admin-Secret")===secret;
}
async function adminOverview(request,env){
  if(!adminOk(request,env))return json({success:false,message:"Admin authorization required."},401);
  const [u,p,r,w,t]=await Promise.all([
    env.DB.prepare("SELECT COUNT(*) count FROM users").first(),
    env.DB.prepare("SELECT COUNT(*) count,COALESCE(SUM(amount),0) total FROM payments WHERE status='captured'").first(),
    env.DB.prepare("SELECT COUNT(*) count,COALESCE(SUM(reward_amount),0) total FROM referrals WHERE status='completed'").first(),
    env.DB.prepare("SELECT COUNT(*) count,COALESCE(SUM(amount),0) total FROM withdrawals WHERE status='pending'").first(),
    env.DB.prepare("SELECT COUNT(*) count FROM transactions").first()
  ]);
  return json({success:true,users:u,payments:p,referrals:r,pendingWithdrawals:w,transactions:t});
}
async function adminWithdrawals(request,env){
  if(!adminOk(request,env))return json({success:false,message:"Admin authorization required."},401);
  const r=await env.DB.prepare(
    `SELECT w.*,u.name,u.email,u.phone FROM withdrawals w LEFT JOIN users u ON u.id=w.user_id ORDER BY w.id DESC LIMIT 200`
  ).all();
  return json({success:true,withdrawals:r.results||[]});
}
async function adminWithdrawalStatus(request,env){
  if(!adminOk(request,env))return json({success:false,message:"Admin authorization required."},401);
  const b=await request.json(), id=Number(b.id), status=clean(b.status).toLowerCase(), note=clean(b.note);
  if(!id||!["pending","approved","rejected"].includes(status))return json({success:false,message:"Invalid request."},400);
  const w=await env.DB.prepare("SELECT * FROM withdrawals WHERE id=?").bind(id).first();
  if(!w)return json({success:false,message:"Withdrawal not found."},404);
  if(w.status===status)return json({success:true,message:"No change."});
  const t=now();
  if(w.status==="pending"&&status==="rejected"){
    await env.DB.prepare("UPDATE users SET wallet_balance=wallet_balance+? WHERE id=?").bind(w.amount,w.user_id).run();
    await env.DB.prepare("INSERT INTO transactions(user_id,type,amount,direction,status,reference_id,description,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .bind(w.user_id,"withdrawal_reversal",w.amount,"credit","completed",String(id),"Rejected withdrawal returned to wallet",t).run();
  }
  if(w.status==="rejected" && status==="approved")return json({success:false,message:"Rejected withdrawal cannot be approved directly."},400);
  await env.DB.prepare("UPDATE withdrawals SET status=?,note=?,updated_at=? WHERE id=?").bind(status,note,t,id).run();
  await env.DB.prepare("UPDATE transactions SET status=? WHERE reference_id=? AND type='withdrawal'").bind(status,String(id)).run();
  return json({success:true,message:`Withdrawal ${status}.`});
}
async function adminPaymentStatus(request,env){
  if(!adminOk(request,env))return json({success:false,message:"Admin authorization required."},401);
  const b=await request.json(), id=Number(b.id), status=clean(b.status);
  if(!id||!["pending","captured","failed","refunded"].includes(status))return json({success:false,message:"Invalid status."},400);
  await env.DB.prepare("UPDATE payments SET status=? WHERE id=?").bind(status,id).run();
  return json({success:true});
}
function escapeHtml(s){
  return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
}
function home(request,env,url){
  return html(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CashGrow — Digital Growth & Referral Platform</title>
<meta name="description" content="CashGrow digital product and referral platform.">
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<style>
:root{--bg:#07111f;--card:#101d31;--card2:#14243d;--text:#f7fbff;--muted:#aab8cc;--accent:#35d07f;--accent2:#6ea8ff;--line:#243650;--danger:#ff6b6b}
*{box-sizing:border-box}body{margin:0;font-family:Inter,Arial,sans-serif;background:#f6f8fb;color:#142033}a{text-decoration:none;color:inherit}
.nav{position:sticky;top:0;z-index:20;background:rgba(7,17,31,.96);color:#fff;border-bottom:1px solid #20304a}.navin{max-width:1180px;margin:auto;display:flex;align-items:center;justify-content:space-between;padding:14px 18px}.logo{font-weight:900;font-size:25px;letter-spacing:-1px}.logo span{color:var(--accent)}.links{display:flex;gap:18px;align-items:center}.links a{color:#dbe7f7;font-size:14px}.btn{border:0;border-radius:12px;padding:12px 17px;font-weight:800;cursor:pointer}.btn.primary{background:var(--accent);color:#06120b}.btn.dark{background:#102037;color:#fff}.btn.light{background:#fff;color:#0d1a2b}.hero{background:linear-gradient(135deg,#07111f,#102b4b);color:#fff;padding:85px 18px}.heroIn{max-width:1180px;margin:auto;display:grid;grid-template-columns:1.2fr .8fr;gap:35px;align-items:center}.eyebrow{color:var(--accent);font-weight:900;text-transform:uppercase;letter-spacing:2px;font-size:12px}.hero h1{font-size:56px;line-height:1.02;margin:15px 0}.hero p{color:#c5d2e3;font-size:18px;line-height:1.7}.heroCard{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:24px;padding:28px}.price{font-size:40px;font-weight:900}.section{max-width:1180px;margin:auto;padding:70px 18px}.section h2{text-align:center;font-size:36px;margin:0 0 12px}.lead{text-align:center;color:#66758a;max-width:700px;margin:0 auto 35px;line-height:1.7}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}.card{background:#fff;border:1px solid #e4eaf2;border-radius:20px;padding:25px;box-shadow:0 10px 35px rgba(16,32,51,.06)}.card h3{margin-top:0}.muted{color:#718096}.package{position:relative}.package.featured{border:2px solid var(--accent)}.package .tag{position:absolute;right:18px;top:18px;background:#e9fff2;color:#07843f;border-radius:999px;padding:6px 10px;font-size:11px;font-weight:900}.package ul{padding-left:20px;line-height:2;color:#526176}.steps .card{text-align:center}.icon{font-size:34px}.faq details{background:#fff;border:1px solid #e3e9f1;border-radius:14px;padding:17px;margin:10px 0}.auth{background:#0b1728;color:#fff}.authBox{max-width:520px;margin:auto;background:#fff;color:#172236;border-radius:22px;padding:24px}.input{width:100%;padding:13px;border:1px solid #d7dfeb;border-radius:11px;margin:6px 0;font-size:15px}.tabs{display:flex;gap:8px}.tabs button{flex:1}.dash{display:none}.dashGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.stat{background:#f1f6fb;border-radius:15px;padding:16px}.stat b{font-size:23px}.tableWrap{overflow:auto}.table{width:100%;border-collapse:collapse;font-size:13px}.table th,.table td{padding:10px;border-bottom:1px solid #e6ebf1;text-align:left;white-space:nowrap}.footer{background:#07111f;color:#c6d2e1;padding:45px 18px}.footerIn{max-width:1180px;margin:auto;display:grid;grid-template-columns:2fr 1fr 1fr;gap:30px}.modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100;align-items:center;justify-content:center;padding:18px}.modalBox{background:#fff;border-radius:20px;max-width:520px;width:100%;padding:25px;max-height:90vh;overflow:auto}.notice{padding:12px;border-radius:10px;margin:8px 0;font-weight:700}.success{background:#e9fff2;color:#06753a}.error{background:#fff0f0;color:#a11}.small{font-size:12px;color:#748198}@media(max-width:800px){.links{display:none}.heroIn{grid-template-columns:1fr}.hero h1{font-size:42px}.grid{grid-template-columns:1fr}.dashGrid{grid-template-columns:repeat(2,1fr)}.footerIn{grid-template-columns:1fr}.section{padding:50px 16px}}
</style></head><body>
<nav class="nav"><div class="navin"><div class="logo">Cash<span>Grow</span></div><div class="links">
<a href="#home">Home</a><a href="#packages">Packages</a><a href="#how">How It Works</a><a href="#referral">Referral</a><a href="#faq">FAQ</a><button class="btn primary" onclick="openAuth('login')">Login</button>
</div></div></nav>
<section class="hero" id="home"><div class="heroIn"><div><div class="eyebrow">Digital Growth Platform</div><h1>Grow smarter. Share. Earn.</h1><p>Discover practical digital bundles and a transparent referral reward system built for CashGrow members.</p><div style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn primary" href="#packages">Explore Packages</a><button class="btn light" onclick="openAuth('register')">Create Account</button></div></div>
<div class="heroCard"><div class="eyebrow">CashGrow Starter</div><div class="price">₹599</div><p>Digital Starter Bundle</p><hr style="border-color:#29405f"><p>Referral reward: <b>₹400</b> when an eligible referred purchase is successfully captured.</p></div></div></section>
<section class="section" id="packages"><h2>Choose Your Package</h2><p class="lead">Simple pricing, clear referral rewards and a dashboard to track your activity.</p><div class="grid">
<div class="card package"><h3>Starter Bundle</h3><div class="price">₹599</div><p class="muted">For getting started.</p><ul><li>Digital product bundle</li><li>Member dashboard</li><li>Referral tools</li><li>Referral reward ₹400*</li></ul><button class="btn primary" style="width:100%" onclick="buy('starter')">Buy Starter — ₹599</button></div>
<div class="card package featured"><div class="tag">POPULAR</div><h3>Pro Bundle</h3><div class="price">₹999</div><p class="muted">For creators and active members.</p><ul><li>Digital product bundle</li><li>Member dashboard</li><li>Referral tools</li><li>Referral reward ₹800*</li></ul><button class="btn primary" style="width:100%" onclick="buy('pro')">Buy Pro — ₹999</button></div>
<div class="card"><h3>Member Benefits</h3><p class="muted">Track your purchases, referrals, cashback credits, wallet and withdrawal requests from one place.</p><ul><li>Secure account</li><li>Payment history</li><li>Referral history</li><li>Wallet ledger</li></ul></div></div><p class="small" style="text-align:center;margin-top:18px">*Referral rewards apply only to eligible successful captured purchases under the program rules.</p></section>
<section class="section steps" id="how"><h2>How It Works</h2><p class="lead">Four simple steps.</p><div class="grid"><div class="card"><div class="icon">01</div><h3>Create Account</h3><p class="muted">Register with your mobile/email and password.</p></div><div class="card"><div class="icon">02</div><h3>Choose a Bundle</h3><p class="muted">Select Starter ₹599 or Pro ₹999 and pay securely through Razorpay.</p></div><div class="card"><div class="icon">03</div><h3>Share Referral</h3><p class="muted">Share your unique referral link with people you invite.</p></div><div class="card"><div class="icon">04</div><h3>Track Rewards</h3><p class="muted">Eligible referral cashback is credited to your CashGrow wallet.</p></div></div></section>
<section class="section" id="referral"><h2>Referral Program</h2><p class="lead">Your referral code is created automatically when you register.</p><div class="grid"><div class="card"><h3>₹599 Starter</h3><div class="price">₹400</div><p class="muted">Eligible referral cashback.</p></div><div class="card"><h3>₹999 Pro</h3><div class="price">₹800</div><p class="muted">Eligible referral cashback.</p></div><div class="card"><h3>Wallet</h3><div class="price">₹1,000</div><p class="muted">Minimum withdrawal amount.</p></div></div></section>
<section class="section"><h2>About CashGrow</h2><p class="lead">CashGrow is designed as a digital-product and referral platform. Members can purchase digital bundles, use their referral code, view eligible rewards and request withdrawals subject to the platform rules.</p><div class="grid"><div class="card"><h3>Transparent</h3><p class="muted">Payment and wallet activity is recorded in your account.</p></div><div class="card"><h3>Secure</h3><p class="muted">Passwords are hashed and payment signatures are verified server-side.</p></div><div class="card"><h3>Mobile First</h3><p class="muted">Designed for smooth use on phones as well as desktop.</p></div></div></section>
<section class="section faq" id="faq"><h2>Frequently Asked Questions</h2><div style="max-width:850px;margin:auto"><details><summary><b>How does referral cashback work?</b></summary><p class="muted">When an eligible referred member completes a captured purchase, the configured referral reward is credited once to the referrer.</p></details><details><summary><b>What is the minimum withdrawal?</b></summary><p class="muted">The current minimum withdrawal is ₹1,000.</p></details><details><summary><b>Can the same payment earn twice?</b></summary><p class="muted">No. The system protects against duplicate payment rewards.</p></details><details><summary><b>How are payments processed?</b></summary><p class="muted">Payments are processed through Razorpay and verified on the server using the Razorpay signature and payment status.</p></details><details><summary><b>How do I reset my password?</b></summary><p class="muted">Use Forgot Password. If email delivery is configured, a reset link is sent to your registered email.</p></details></div></section>
<section class="section" id="contact"><h2>Contact Us</h2><p class="lead">For support, use the official CashGrow support email configured by the site owner. Replace the placeholder contact details below before public launch.</p><div class="card" style="max-width:650px;margin:auto"><p><b>Email:</b> support@cashgrow.example</p><p><b>Support:</b> Please use your official support channel.</p><p class="small">Replace these placeholders with your real business contact details before launch.</p></div></section>
<section class="section"><h2>Terms & Policies</h2><div class="grid"><div class="card"><h3>Terms & Conditions</h3><p class="muted">Use of CashGrow is subject to applicable law, accurate account information, successful payment verification, referral eligibility rules and responsible use of the platform.</p></div><div class="card"><h3>Privacy Policy</h3><p class="muted">CashGrow stores account, payment, referral and withdrawal information needed to operate the service. Passwords are stored as cryptographic hashes.</p></div><div class="card"><h3>Refund & Cancellation</h3><p class="muted">Refunds, cancellations and digital-product eligibility are subject to the published business policy and applicable consumer law. Review and replace this template with your final legal policy.</p></div><div class="card"><h3>Disclaimer</h3><p class="muted">Referral rewards are not guaranteed income. Eligibility depends on valid transactions and the program rules. This website should not be presented as a promise of profit or guaranteed returns.</p></div></div></section>
<section class="section auth" id="account"><div class="authBox" id="authBox"><h2 id="authTitle">CashGrow Account</h2><div class="tabs"><button class="btn dark" onclick="showLogin()">Login</button><button class="btn" onclick="showRegister()">Create Account</button></div><div id="authMsg"></div>
<div id="loginForm"><input class="input" id="loginId" placeholder="Email or Mobile Number"><input class="input" id="loginPw" type="password" placeholder="Password"><button class="btn primary" style="width:100%" onclick="login()">Login</button><button class="btn light" style="width:100%;margin-top:8px" onclick="showForgot()">Forgot Password?</button></div>
<div id="registerForm" style="display:none"><input class="input" id="regName" placeholder="Full Name"><input class="input" id="regPhone" placeholder="Mobile Number"><input class="input" id="regEmail" placeholder="Email"><input class="input" id="regPw" type="password" placeholder="Password (6+ characters)"><input class="input" id="regRef" placeholder="Referral Code (optional)"><button class="btn primary" style="width:100%" onclick="register()">Create Account</button></div>
<div id="forgotForm" style="display:none"><input class="input" id="forgotId" placeholder="Email or Mobile Number"><button class="btn primary" style="width:100%" onclick="forgot()">Send Reset</button><button class="btn light" style="width:100%;margin-top:8px" onclick="showLogin()">Back to Login</button></div></div>
<div class="authBox dash" id="dashboard"><h2>My Dashboard</h2><div class="dashGrid"><div class="stat"><small>Wallet</small><br><b id="dWallet">₹0</b></div><div class="stat"><small>Referrals</small><br><b id="dRefs">0</b></div><div class="stat"><small>Referral Earnings</small><br><b id="dEarn">₹0</b></div><div class="stat"><small>Referral Code</small><br><b id="dCode">-</b></div></div>
<p><b>Referral Link</b></p><input class="input" id="dLink" readonly><button class="btn light" onclick="copyReferral()">Copy Referral Link</button>
<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:18px"><button class="btn dark" onclick="loadDash()">Refresh</button><button class="btn primary" onclick="openWithdraw()">Withdraw</button><button class="btn light" onclick="openProfile()">Profile</button><button class="btn light" onclick="logout()">Logout</button></div>
<h3>Purchase History</h3><div class="tableWrap"><table class="table"><thead><tr><th>Product</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead><tbody id="paymentsBody"></tbody></table></div>
<h3>Transactions</h3><div class="tableWrap"><table class="table"><thead><tr><th>Type</th><th>Amount</th><th>Direction</th><th>Status</th><th>Date</th></tr></thead><tbody id="txBody"></tbody></table></div>
<h3>Withdrawals</h3><div class="tableWrap"><table class="table"><thead><tr><th>Amount</th><th>Status</th><th>Method</th><th>Date</th></tr></thead><tbody id="wdBody"></tbody></table></div>
</div></section>
<footer class="footer"><div class="footerIn"><div><div class="logo">Cash<span>Grow</span></div><p>Digital products, member tools and referral tracking in one platform.</p></div><div><b>Explore</b><p><a href="#packages">Packages</a></p><p><a href="#referral">Referral Program</a></p><p><a href="#faq">FAQ</a></p></div><div><b>Policies</b><p>Terms & Conditions</p><p>Privacy Policy</p><p>Refund Policy</p><p>Disclaimer</p></div></div><p style="max-width:1180px;margin:30px auto 0;border-top:1px solid #21334d;padding-top:20px">© ${new Date().getFullYear()} CashGrow. All rights reserved.</p></footer>
<div class="modal" id="modal"><div class="modalBox"><div id="modalContent"></div></div></div>
<script>
const $=id=>document.getElementById(id);
let current=null;
function msg(text,ok=false){$('authMsg').innerHTML='<div class="notice '+(ok?'success':'error')+'">'+text+'</div>'}
function showLogin(){ $('loginForm').style.display='block';$('registerForm').style.display='none';$('forgotForm').style.display='none';}
function showRegister(){ $('loginForm').style.display='none';$('registerForm').style.display='block';$('forgotForm').style.display='none';}
function showForgot(){ $('loginForm').style.display='none';$('registerForm').style.display='none';$('forgotForm').style.display='block';}
function openAuth(mode){document.querySelector('#account').scrollIntoView({behavior:'smooth'});mode==='register'?showRegister():showLogin();}
async function api(path,opt={}){const r=await fetch(path,{credentials:'same-origin',...opt});let d={};try{d=await r.json()}catch{};return {r,d}}
async function login(){const identifier=$('loginId').value.trim(),password=$('loginPw').value;if(!identifier||!password)return msg('Enter email/mobile and password.');msg('Logging in...',true);const x=await api('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier,password})});if(!x.d.success)return msg(x.d.message||'Login failed.');current=x.d.user;showDashboard();loadDash();}
async function register(){const body={name:$('regName').value.trim(),phone:$('regPhone').value.trim(),email:$('regEmail').value.trim(),password:$('regPw').value,referral_code:$('regRef').value.trim()};if(!body.name||!body.phone||!body.email||!body.password)return msg('Fill all required fields.');const x=await api('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!x.d.success)return msg(x.d.message||'Registration failed.');current=x.d.user;showDashboard();loadDash();}
async function forgot(){const identifier=$('forgotId').value.trim();if(!identifier)return msg('Enter your email or mobile number.');const x=await api('/api/forgot-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier})});msg(x.d.message||'Request submitted.',true);}
function showDashboard(){$('authBox').style.display='none';$('dashboard').style.display='block';}
function rupees(p){return '₹'+(Number(p||0)/100).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});}
async function loadDash(){const x=await api('/api/dashboard');if(!x.d.success){$('dashboard').style.display='none';$('authBox').style.display='block';return}const u=x.d.user;$('dWallet').textContent=rupees(u.wallet_balance);$('dRefs').textContent=x.d.referrals.count;$('dEarn').textContent=rupees(x.d.referrals.earnings);$('dCode').textContent=u.referral_code||'-';$('dLink').value=location.origin+'/?ref='+encodeURIComponent(u.referral_code||'');$('paymentsBody').innerHTML=(x.d.payments||[]).map(p=>'<tr><td>'+p.product+'</td><td>'+rupees(p.amount)+'</td><td>'+p.status+'</td><td>'+new Date(p.created_at).toLocaleString()+'</td></tr>').join('');$('txBody').innerHTML=(x.d.transactions||[]).map(t=>'<tr><td>'+t.type+'</td><td>'+rupees(t.amount)+'</td><td>'+t.direction+'</td><td>'+t.status+'</td><td>'+new Date(t.created_at).toLocaleString()+'</td></tr>').join('');$('wdBody').innerHTML=(x.d.withdrawals||[]).map(w=>'<tr><td>'+rupees(w.amount)+'</td><td>'+w.status+'</td><td>'+w.method+'</td><td>'+new Date(w.created_at).toLocaleString()+'</td></tr>').join('');}
async function logout(){await api('/api/logout',{method:'POST'});$('dashboard').style.display='none';$('authBox').style.display='block';showLogin();}
async function copyReferral(){try{await navigator.clipboard.writeText($('dLink').value);alert('Referral link copied.')}catch{alert($('dLink').value)}}
function openProfile(){const u=current||{};$('modalContent').innerHTML='<h2>Profile</h2><input class="input" id="pName" value="'+(u.name||'')+'"><input class="input" id="pPhone" value="'+(u.phone||'')+'"><input class="input" id="pEmail" value="'+(u.email||'')+'"><button class="btn primary" onclick="saveProfile()">Save Profile</button><button class="btn light" onclick="closeModal()">Close</button>';$('modal').style.display='flex';}
async function saveProfile(){const b={name:$('pName').value,phone:$('pPhone').value,email:$('pEmail').value};const x=await api('/api/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});if(!x.d.success)return alert(x.d.message);current=x.d.user;alert('Profile updated.');closeModal();loadDash();}
function openWithdraw(){$('modalContent').innerHTML='<h2>Withdraw</h2><p class="small">Minimum withdrawal: ₹1,000</p><input class="input" id="wAmount" type="number" min="1000" placeholder="Amount in ₹"><select class="input" id="wMethod"><option value="upi">UPI</option><option value="bank">Bank Account</option></select><input class="input" id="wUpi" placeholder="UPI ID"><input class="input" id="wName" placeholder="Account Holder Name"><input class="input" id="wAcc" placeholder="Account Number"><input class="input" id="wIfsc" placeholder="IFSC"><button class="btn primary" onclick="sendWithdraw()">Submit Withdrawal</button><button class="btn light" onclick="closeModal()">Cancel</button>';$('modal').style.display='flex';}
async function sendWithdraw(){const method=$('wMethod').value;const b={amount:Number($('wAmount').value)*100,method,upi_id:$('wUpi').value,account_name:$('wName').value,account_number:$('wAcc').value,ifsc:$('wIfsc').value};const x=await api('/api/withdraw',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});alert(x.d.message||'Done');if(x.d.success){closeModal();loadDash();}}
function closeModal(){$('modal').style.display='none';}
async function buy(product){openAuth('login');const x=await api('/api/me');if(!x.d.success){alert('Please login or create an account first, then choose the package again.');return}current=x.d.user;const b={product,name:current.name,phone:current.phone,email:current.email,referral_code:current.referred_by||'',user_id:current.id};const order=await api('/api/create-order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});if(!order.d.success){alert(order.d.message||'Order creation failed.');return}const o=order.d.order;const rz=new Razorpay({key:order.d.key_id,amount:o.amount,currency:o.currency,name:'CashGrow',description:order.d.product.name,order_id:o.id,prefill:{name:current.name,email:current.email,contact:current.phone},theme:{color:'#35d07f'},handler:async function(resp){const v=await api('/api/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...resp,product:product,user_id:current.id,name:current.name,phone:current.phone,email:current.email})});if(v.d.success){alert('Payment successful and verified.');loadDash();}else alert(v.d.message||'Verification failed.')}});rz.open();}
(async()=>{const q=new URLSearchParams(location.search);const ref=q.get('ref');if(ref)$('regRef').value=ref;const m=await api('/api/me');if(m.d.success){current=m.d.user;showDashboard();loadDash();}const reset=q.get('reset');if(reset){showForgot();$('modalContent').innerHTML='<h2>Reset Password</h2><input class="input" id="rpw" type="password" placeholder="New password"><button class="btn primary" onclick="resetPw(\\''+reset+'\\')">Reset Password</button>';$('modal').style.display='flex';}})();
async function resetPw(token){const x=await api('/api/reset-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,password:$('rpw').value})});alert(x.d.message);if(x.d.success){closeModal();location.href='/';}}
</script></body></html>`);
}
