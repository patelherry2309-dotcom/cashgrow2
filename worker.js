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

        const {
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
      message: `Razorpay API error ${paymentResponse.status}`,
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
                 FROM referral_rewards
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
                `INSERT INTO referral_rewards
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
       console.error("VERIFY ERROR:", error);
        return json(
          {
            success: false,
            message: "Verification failed"
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
