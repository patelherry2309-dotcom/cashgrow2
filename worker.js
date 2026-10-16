export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================
    // CREATE RAZORPAY ORDER
    // =========================
    if (url.pathname === "/api/create-order" && request.method === "POST") {
      try {
        const body = await request.json();

        const product = body.product;
        const name = body.name || "";
        const phone = body.phone || "";
        const email = body.email || "";
        const referralCode = body.referral_code || "";

        const products = {
          starter: {
            name: "Starter Bundle",
            amount: 59900,
            reward: 400
          },
          pro: {
            name: "Pro Bundle",
            amount: 99900,
            reward: 800
          }
        };

        if (!products[product]) {
          return json({ error: "Invalid product" }, 400);
        }

        const selected = products[product];

        const auth = btoa(
          `${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`
        );

        const response = await fetch(
          "https://api.razorpay.com/v1/orders",
          {
            method: "POST",
            headers: {
              "Authorization": `Basic ${auth}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              amount: selected.amount,
              currency: "INR",
              receipt: `cashgrow_${Date.now()}`
            })
          }
        );

        const data = await response.json();
console.error("Razorpay response:", response.status, data);
        if (!response.ok) {
          return json(
            {
              error:
                data?.error?.description ||
                "Razorpay order creation failed"
            },
            500
          );
        }

        return json({
          order_id: data.id,
          amount: selected.amount,
          name: selected.name,
          key_id: env.RAZORPAY_KEY_ID,
          customer: {
            name,
            phone,
            email,
            referral_code: referralCode
          }
        });
      } catch (error) {
       console.error("CREATE ORDER ERROR:", error);
        return json(
          {
            error: "Server error while creating order"
          },
          500
        );
      }
    }

    // =========================
    // VERIFY PAYMENT
    // =========================
    if (url.pathname === "/api/verify" && request.method === "POST") {
      try {
        const body = await request.json();

        let {
          razorpay_order_id,
          razorpay_payment_id,
          razorpay_signature,
          name,
          phone,
          email,
          referral_code
        } = body;

        if (
          !razorpay_order_id ||
          !razorpay_payment_id ||
          !razorpay_signature
        ) {
          return json(
            {
              success: false,
              message: "Payment details are missing"
            },
            400
          );
        }

        // -------------------------
        // Verify Razorpay signature
        // -------------------------
        const message =
          `${razorpay_order_id}|${razorpay_payment_id}`;

        const encoder = new TextEncoder();
 
console.error(
  "RAZORPAY_KEY_CHECK",
  JSON.stringify({
    keyIdPresent: !!env.RAZORPAY_KEY_ID,
    secretPresent: !!env.RAZORPAY_KEY_SECRET
  })
);

const key = await crypto.subtle.importKey(
        
          "raw",
          encoder.encode(env.RAZORPAY_KEY_SECRET),
          {
            name: "HMAC",
            hash: "SHA-256"
          },
          false,
          ["sign"]
        );

        const signatureBuffer =
          await crypto.subtle.sign(
            "HMAC",
            key,
            encoder.encode(message)
          );

        const generatedSignature =
          [...new Uint8Array(signatureBuffer)]
            .map(b => b.toString(16).padStart(2, "0"))
            .join("");

        if (generatedSignature !== razorpay_signature) {
          return json(
            {
              success: false,
              message: "Invalid payment signature"
            },
            400
          );
        }

        // -------------------------
        // Get payment details
        // -------------------------
        const auth = btoa(
          `${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`
        );

        const paymentResponse = await fetch(
          `https://api.razorpay.com/v1/payments/${razorpay_payment_id}`,
          {
            method: "GET",
            headers: {
              "Authorization": `Basic ${auth}`
            }
          }
        );

        if (!paymentResponse.ok) {
  const errorText = await paymentResponse.text();

  console.error(
  "RAZORPAY_DEBUG",
  JSON.stringify({
    status: paymentResponse.status,
    ok: paymentResponse.ok,
    error: errorText
  })
);

  return json(
    {
      success: false,
      message: errorText,
      details: errorText
    },
    500
  );
}
        

        const payment = await paymentResponse.json();

        if (payment.status !== "captured") {
          return json(
            {
              success: false,
              message: "Payment is not captured"
            },
            400
          );
        }

        // -------------------------
        // Detect product
        // -------------------------
        let product = "";
        let rewardAmount = 0;

        if (payment.amount === 59900) {
          product = "starter";
          rewardAmount = 400;
        } else if (payment.amount === 99900) {
          product = "pro";
          rewardAmount = 800;
        } else {
          return json(
            {
              success: false,
              message: "Invalid payment amount"
            },
            400
          );
        }

        // -------------------------
        // Prevent duplicate payment
        // -------------------------
        const existingPayment =
          await env.DB.prepare(
            `SELECT id
             FROM payments
             WHERE razorpay_payment_id = ?`
          )
            .bind(razorpay_payment_id)
            .first();

        if (existingPayment) {
          return json({
            success: true,
            message: "Payment already verified"
          });
        }

        // -------------------------
        // Save payment
        // -------------------------
        // Find or create buyer user before saving payment
let paymentUserId = null;

const existingPaymentUser = await env.DB.prepare(
  `SELECT id
   FROM users
   WHERE (email != '' AND email = ?)
      OR (phone != '' AND phone = ?)
   LIMIT 1`
)
.bind(email || "", phone || "")
.first();

if (existingPaymentUser) {
  paymentUserId = existingPaymentUser.id;
} else {
  const paymentReferralCode =
    "CG" +
    Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase();

  const newPaymentUser = await env.DB.prepare(
    `INSERT INTO users
    (
      name,
      phone,
      email,
      referral_code,
      referred_by,
      wallet_balance
    )
    VALUES (?, ?, ?, ?, ?, ?)`
  )
  .bind(
    name || "CashGrow User",
    phone || "",
    email || "",
    paymentReferralCode,
    referral_code || null,
    0
  )
  .run();

  paymentUserId = newPaymentUser.meta.last_row_id;
}
        await env.DB.prepare(
          `INSERT INTO payments
          (
            user_id,
            razorpay_order_id,
            razorpay_payment_id,
            product,
            amount,
            status
          )
          VALUES (?, ?, ?, ?, ?, ?)`
        )
          .bind(
            paymentUserId,
            razorpay_order_id,
            razorpay_payment_id,
            product,
            payment.amount,
            payment.status
          )
          .run();

        // ==================================================
        // REFERRAL SYSTEM
        // ==================================================

        let referralMessage = "";

        if (referral_code) {
          const referrer =
            await env.DB.prepare(
              `SELECT id, referral_code, wallet_balance
               FROM users
               WHERE referral_code = ?`
            )
              .bind(referral_code)
              .first();

          if (referrer) {
            // Create a new user for the buyer
            const newReferralCode =
              "CG" +
              Math.random()
                .toString(36)
                .substring(2, 8)
                .toUpperCase();

            const existingUser =
              await env.DB.prepare(
                `SELECT id
                 FROM users
                 WHERE email = ? OR phone = ?`
              )
                .bind(email || "", phone || "")
                .first();

            let referredUserId = null;

            if (existingUser) {
              referredUserId = existingUser.id;
            } else {
              const userResult =
                await env.DB.prepare(
                  `INSERT INTO users
                  (
                    name,
                    phone,
                    email,
                    referral_code,
                    referred_by,
                    wallet_balance
                  )
                  VALUES (?, ?, ?, ?, ?, ?)`
                )
                  .bind(
                    name || "CashGrow User",
                    phone || "",
                    email || "",
                    newReferralCode,
                    referral_code,
                    0
                  )
                  .run();

              referredUserId =
                userResult.meta.last_row_id;
            }

            // Check duplicate reward
            const existingReward =
              await env.DB.prepare(
                `SELECT id
                 FROM referrals
                 WHERE payment_id = ?`
              )
                .bind(razorpay_payment_id)
                .first();

            if (!existingReward) {
              await env.DB.prepare(
                `UPDATE users
                 SET wallet_balance =
                   wallet_balance + ?
                 WHERE id = ?`
              )
                .bind(
                  rewardAmount * 100,
                  referrer.id
                )
                .run();

              await env.DB.prepare(
                `INSERT INTO referrals
                (
                  referrer_user_id,
                  referred_user_id,
                  payment_id,
                  product,
                  reward_amount,
                  status
                )
                VALUES (?, ?, ?, ?, ?, ?)`
              )
                .bind(
                  referrer.id,
                  referredUserId,
                  razorpay_payment_id,
                  product,
                  rewardAmount,
                  "credited"
                )
                .run();

              referralMessage =
                ` Referral reward ₹${rewardAmount} credited.`;
            }
          }
        }

        return json({
          success: true,
          message:
            "Payment verified successfully." +
            referralMessage
        });

    } catch (error) {
  console.error(
    "VERIFY ERROR:",
    error?.message || String(error)
  );

  return json(
    {
      success: false,
      message: "Verification failed",
      error: error?.message || String(error)
    },
    500
  );
}
      }
    

  // =========================
    // CASHGROW WEBSITE
    // =========================
    if (request.method === "GET") {
      return new Response(
        `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport"
content="width=device-width, initial-scale=1.0">

<title>CashGrow</title>

<script src="https://checkout.razorpay.com/v1/checkout.js"></script>

<style>
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: Arial, sans-serif;
  background: #f5f7fb;
  color: #172033;
}

.hero {
  background: linear-gradient(135deg,#4f46e5,#7c3aed);
  color: white;
  padding: 55px 20px;
  text-align: center;
}

.hero h1 {
  margin: 0 0 10px;
  font-size: 38px;
}

.hero p {
  margin: 0;
  opacity: .95;
}

.container {
  max-width: 900px;
  margin: 30px auto;
  padding: 0 18px;
}

.form-box,
.card {
  background: white;
  border-radius: 18px;
  padding: 22px;
  margin-bottom: 20px;
  box-shadow: 0 8px 30px rgba(0,0,0,.08);
}

input {
  width: 100%;
  padding: 14px;
  margin: 8px 0;
  border: 1px solid #ddd;
  border-radius: 10px;
  font-size: 16px;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit,minmax(260px,1fr));
  gap: 18px;
}

.card h2 {
  margin-top: 0;
}

.price {
  font-size: 32px;
  font-weight: bold;
  margin: 15px 0;
}

button {
  width: 100%;
  border: 0;
  border-radius: 10px;
  padding: 15px;
  background: #4f46e5;
  color: white;
  font-size: 17px;
  font-weight: bold;
  cursor: pointer;
}

button:disabled {
  opacity: .6;
}

.message {
  text-align: center;
  margin: 20px 0;
  font-weight: bold;
}
</style>
</head>

<body>

<section class="hero">
  <h1>CashGrow</h1>
  <p>Digital Creator Bundles & Referral Rewards</p>
</section>

<div class="container">

  <div class="form-box">
    <h2>Your Details</h2>

    <input id="name"
      placeholder="Full Name">

    <input id="phone"
      placeholder="Mobile Number">

    <input id="email"
      placeholder="Email Address">

    <input id="referral"
      placeholder="Referral Code (optional)">
  </div>

  <div class="cards">

    <div class="card">
      <h2>Starter Bundle</h2>
      <p>Digital Creator Starter Bundle</p>
      <div class="price">₹599</div>

      <button
        onclick="buy('starter')">
        Buy Now
      </button>
    </div>

    <div class="card">
      <h2>Pro Bundle</h2>
      <p>Digital Creator Pro Bundle</p>
      <div class="price">₹999</div>

      <button
        onclick="buy('pro')">
        Buy Now
      </button>
    </div>

  </div>

  <div id="message"
       class="message"></div>

</div>

<script>

async function buy(product) {

  const button =
    event.target;

  button.disabled = true;
  button.innerText =
    "Creating Order...";

  const name =
    document.getElementById("name").value;

  const phone =
    document.getElementById("phone").value;

  const email =
    document.getElementById("email").value;

  const referral =
    document.getElementById("referral").value;

  try {

    const orderResponse =
      await fetch("/api/create-order", {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify({
          product,
          name,
          phone,
          email,
          referral_code: referral
        })
      });

    const order =
      await orderResponse.json();

    if (!orderResponse.ok) {
      throw new Error(
        order.error ||
        "Order creation failed"
      );
    }

    const options = {

      key: order.key_id,

      amount: order.amount,

      currency: "INR",

      name: "CashGrow",

      description:
        order.name,

      order_id:
        order.order_id,

      handler: async function(response) {

        document.getElementById(
          "message"
        ).innerText =
          "Verifying payment...";

        const verifyResponse =
          await fetch("/api/verify", {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json"
            },
            body: JSON.stringify({

              razorpay_order_id:
                response.razorpay_order_id,

              razorpay_payment_id:
                response.razorpay_payment_id,

              razorpay_signature:
                response.razorpay_signature,

              name,
              phone,
              email,
              referral_code:
                referral

            })
          });

        const result =
          await verifyResponse.json();

        if (result.success) {

          document.getElementById(
            "message"
          ).innerText =
            result.message;

        } else {

          document.getElementById(
            "message"
          ).innerText =
            result.message ||
            "Payment verification failed";

        }

        button.disabled = false;
        button.innerText =
          "Buy Now";
      },

      prefill: {
        name,
        email,
        contact: phone
      },

      theme: {
        color: "#4f46e5"
      }

    };

    const rzp =
      new Razorpay(options);

    rzp.on(
      "payment.failed",
      function(response) {

        document.getElementById(
          "message"
        ).innerText =
          "Payment failed. Please try again.";

        button.disabled = false;
        button.innerText =
          "Buy Now";
      }
    );

    rzp.open();

  } catch (error) {

    document.getElementById(
      "message"
    ).innerText =
      error.message;

    button.disabled = false;
    button.innerText =
      "Buy Now";
  }
}

</script>

</body>
</html>`,
        {
          headers: {
            "Content-Type":
              "text/html; charset=UTF-8"
          }
        }
      );
    }
// ==================== CASHGROW AUTH SYSTEM ====================

const cgHex = (bytes) =>
  Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");

const cgHexToBytes = (hex) => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
};

const cgHashPassword = async (password) => {
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256"
    },
    key,
    256
  );

  return `pbkdf2$100000$${cgHex(salt)}$${cgHex(new Uint8Array(bits))}`;
};

const cgVerifyPassword = async (password, stored) => {
  try {
    const parts = stored.split("$");

    if (parts.length !== 4 || parts[0] !== "pbkdf2") {
      return false;
    }

    const iterations = Number(parts[1]);
    const salt = cgHexToBytes(parts[2]);
    const oldHash = cgHexToBytes(parts[3]);

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );

    const bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt,
        iterations,
        hash: "SHA-256"
      },
      key,
      256
    );

    const newHash = new Uint8Array(bits);

    if (newHash.length !== oldHash.length) return false;

    let diff = 0;

    for (let i = 0; i < newHash.length; i++) {
      diff |= newHash[i] ^ oldHash[i];
    }

    return diff === 0;
  } catch (e) {
    return false;
  }
};

const cgCreateReferralCode = async () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

  for (let attempt = 0; attempt < 10; attempt++) {
    const bytes = crypto.getRandomValues(new Uint8Array(6));

    let suffix = "";

    for (let i = 0; i < 6; i++) {
      suffix += chars[bytes[i] % chars.length];
    }

    const code = "CG" + suffix;

    const exists = await env.DB
      .prepare("SELECT id FROM users WHERE referral_code = ? LIMIT 1")
      .bind(code)
      .first();

    if (!exists) return code;
  }

  throw new Error("Could not generate referral code");
};

const cgSessionCookie = (token) =>
  `session_token=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`;

const cgJsonResponse = (data, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders
    }
  });


// ---------- REGISTER ----------

if (url.pathname === "/api/register" && request.method === "POST") {
  try {
    const body = await request.json();

    const name = String(body.name || "").trim();
    const phone = String(body.phone || "").replace(/\D/g, "");
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const referralCode = String(body.referral_code || "").trim().toUpperCase();

    if (!name || !phone || !email || !password) {
      return cgJsonResponse(
        { success: false, message: "All fields are required." },
        400
      );
    }

    if (password.length < 6) {
      return cgJsonResponse(
        { success: false, message: "Password must be at least 6 characters." },
        400
      );
    }

    const existingExact = await env.DB
      .prepare(
        "SELECT * FROM users WHERE lower(email) = ? AND phone = ? LIMIT 1"
      )
      .bind(email, phone)
      .first();

    const passwordHash = await cgHashPassword(password);

    const sessionToken = crypto.randomUUID();
    const sessionExpires = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000
    ).toISOString();

    // Existing user without password = activate existing account
    if (existingExact) {
      if (existingExact.password_hash) {
        return cgJsonResponse(
          {
            success: false,
            message: "Account already exists. Please login."
          },
          409
        );
      }

      await env.DB
        .prepare(
          `UPDATE users
           SET password_hash = ?,
               session_token = ?,
               session_expires_at = ?
           WHERE id = ?`
        )
        .bind(
          passwordHash,
          sessionToken,
          sessionExpires,
          existingExact.id
        )
        .run();

      return cgJsonResponse(
        {
          success: true,
          message: "Account activated successfully.",
          user: {
            id: existingExact.id,
            name: existingExact.name,
            phone: existingExact.phone,
            email: existingExact.email,
            referral_code: existingExact.referral_code,
            referred_by: existingExact.referred_by,
            wallet_balance: existingExact.wallet_balance || 0
          }
        },
        200,
        {
          "Set-Cookie": cgSessionCookie(sessionToken)
        }
      );
    }

    // Email or phone already used by another account
    const conflict = await env.DB
      .prepare(
        "SELECT id FROM users WHERE lower(email) = ? OR phone = ? LIMIT 1"
      )
      .bind(email, phone)
      .first();

    if (conflict) {
      return cgJsonResponse(
        {
          success: false,
          message: "Email or phone is already registered."
        },
        409
      );
    }

    // Validate referral code if supplied
    let referredBy = null;

    if (referralCode) {
      const referrer = await env.DB
        .prepare(
          "SELECT id, referral_code FROM users WHERE referral_code = ? LIMIT 1"
        )
        .bind(referralCode)
        .first();

      if (referrer) {
        referredBy = referrer.referral_code;
      }
    }

    const newReferralCode = await cgCreateReferralCode();

    const inserted = await env.DB
      .prepare(
        `INSERT INTO users
        (
          name,
          phone,
          email,
          referral_code,
          referred_by,
          wallet_balance,
          password_hash,
          session_token,
          session_expires_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        name,
        phone,
        email,
        newReferralCode,
        referredBy,
        0,
        passwordHash,
        sessionToken,
        sessionExpires
      )
      .run();

    return cgJsonResponse(
      {
        success: true,
        message: "Account created successfully.",
        user: {
          id: inserted.meta.last_row_id,
          name,
          phone,
          email,
          referral_code: newReferralCode,
          referred_by: referredBy,
          wallet_balance: 0
        }
      },
      200,
      {
        "Set-Cookie": cgSessionCookie(sessionToken)
      }
    );
  } catch (error) {
    return cgJsonResponse(
      {
        success: false,
        message: "Registration failed.",
        error: String(error.message || error)
      },
      500
    );
  }
}


// ---------- LOGIN ----------

if (url.pathname === "/api/login" && request.method === "POST") {
  try {
    const body = await request.json();

    const identifier = String(body.identifier || "")
      .trim()
      .toLowerCase();

    const password = String(body.password || "");

    if (!identifier || !password) {
      return cgJsonResponse(
        {
          success: false,
          message: "Email/phone and password are required."
        },
        400
      );
    }

    const phoneIdentifier = identifier.replace(/\D/g, "");

    const user = await env.DB
      .prepare(
        `SELECT *
         FROM users
         WHERE lower(email) = ?
            OR phone = ?
         LIMIT 1`
      )
      .bind(identifier, phoneIdentifier)
      .first();

    if (!user) {
      return cgJsonResponse(
        {
          success: false,
          message: "Account not found."
        },
        401
      );
    }

    if (!user.password_hash) {
      return cgJsonResponse(
        {
          success: false,
          message:
            "Please create/activate your account first using Register."
        },
        400
      );
    }

    const valid = await cgVerifyPassword(
      password,
      user.password_hash
    );

    if (!valid) {
      return cgJsonResponse(
        {
          success: false,
          message: "Incorrect password."
        },
        401
      );
    }

    const sessionToken = crypto.randomUUID();

    const sessionExpires = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000
    ).toISOString();

    await env.DB
      .prepare(
        `UPDATE users
         SET session_token = ?,
             session_expires_at = ?
         WHERE id = ?`
      )
      .bind(
        sessionToken,
        sessionExpires,
        user.id
      )
      .run();

    return cgJsonResponse(
      {
        success: true,
        message: "Login successful.",
        user: {
          id: user.id,
          name: user.name,
          phone: user.phone,
          email: user.email,
          referral_code: user.referral_code,
          referred_by: user.referred_by,
          wallet_balance: user.wallet_balance || 0
        }
      },
      200,
      {
        "Set-Cookie": cgSessionCookie(sessionToken)
      }
    );
  } catch (error) {
    return cgJsonResponse(
      {
        success: false,
        message: "Login failed."
      },
      500
    );
  }
}


// ---------- CURRENT USER ----------

if (url.pathname === "/api/me" && request.method === "GET") {
  try {
    const cookie = request.headers.get("Cookie") || "";

    const match = cookie.match(
      /(?:^|;\s*)session_token=([^;]+)/
    );

    if (!match) {
      return cgJsonResponse(
        {
          success: false,
          loggedIn: false
        },
        401
      );
    }

    const sessionToken = match[1];

    const now = new Date().toISOString();

    const user = await env.DB
      .prepare(
        `SELECT
          id,
          name,
          phone,
          email,
          referral_code,
          referred_by,
          wallet_balance
         FROM users
         WHERE session_token = ?
           AND session_expires_at > ?
         LIMIT 1`
      )
      .bind(sessionToken, now)
      .first();

    if (!user) {
      return cgJsonResponse(
        {
          success: false,
          loggedIn: false
        },
        401
      );
    }

    const stats = await env.DB
      .prepare(
        `SELECT
          COUNT(*) AS referral_count,
          COALESCE(SUM(reward_amount), 0) AS referral_earnings
         FROM referrals
         WHERE referrer_user_id = ?`
      )
      .bind(user.id)
      .first();

    return cgJsonResponse({
      success: true,
      loggedIn: true,
      user: {
        ...user,
        wallet_balance: user.wallet_balance || 0,
        referral_count: stats?.referral_count || 0,
        referral_earnings: stats?.referral_earnings || 0
      }
    });
  } catch (error) {
    return cgJsonResponse(
      {
        success: false,
        loggedIn: false
      },
      500
    );
  }
}


// ---------- LOGOUT ----------

if (url.pathname === "/api/logout" && request.method === "POST") {
  try {
    const cookie = request.headers.get("Cookie") || "";

    const match = cookie.match(
      /(?:^|;\s*)session_token=([^;]+)/
    );

    if (match) {
      await env.DB
        .prepare(
          `UPDATE users
           SET session_token = NULL,
               session_expires_at = NULL
           WHERE session_token = ?`
        )
        .bind(match[1])
        .run();
    }

    return cgJsonResponse(
      {
        success: true,
        message: "Logged out."
      },
      200,
      {
        "Set-Cookie":
          "session_token=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"
      }
    );
  } catch (error) {
    return cgJsonResponse(
      {
        success: false,
        message: "Logout failed."
      },
      500
    );
  }
}
    return new Response("Not Found", {
      status: 404
    });
  }
};


function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type":
          "application/json"
      }
    }
  );
}
