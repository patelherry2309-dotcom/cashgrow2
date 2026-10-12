export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Create Razorpay Order
    if (url.pathname === "/api/create-order" && request.method === "POST") {
      try {
        const body = await request.json();
        const product = body.product;

        const products = {
          starter: {
            name: "Starter Bundle",
            amount: 59900
          },
          pro: {
            name: "Pro Bundle",
            amount: 99900
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

        if (!response.ok) {
          return json({
            error: data.error?.description || "Razorpay order creation failed"
          }, 500);
        }

        return json({
          order_id: data.id,
          amount: selected.amount,
          name: selected.name
        });

      } catch (error) {
        return json({ error: "Server error" }, 500);
      }
    }

    // Verify Razorpay Payment
    if (url.pathname === "/api/verify" && request.method === "POST") {
      try {
        const body = await request.json();

        const {
          razorpay_order_id,
          razorpay_payment_id,
          razorpay_signature
        } = body;

        if (
          !razorpay_order_id ||
          !razorpay_payment_id ||
          !razorpay_signature
        ) {
          return json({ success: false }, 400);
        }

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

        const signatureBuffer = await crypto.subtle.sign(
          "HMAC",
          key,
          encoder.encode(message)
        );

        const signature = [...new Uint8Array(signatureBuffer)]
          .map(b => b.toString(16).padStart(2, "0"))
          .join("");

        if (signature !== razorpay_signature) {
          return json({
            success: false,
            message: "Invalid payment signature"
          }, 400);
        }

        const auth = btoa(
  `${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`
);

const paymentResponse = await fetch(
  `https://api.razorpay.com/v1/payments/${razorpay_payment_id}`,
  {
    method: "GET",
    headers: {
      Authorization: `Basic ${auth}`
    }
  }
);

if (!paymentResponse.ok) {
  return json({
    success: false,
    message: "Payment details could not be verified"
  }, 400);
}

const payment = await paymentResponse.json();

if (payment.status !== "captured") {
  return json({
    success: false,
    message: "Payment is not captured"
  }, 400);
}

const product =
  payment.amount === 59900
    ? "Starter Bundle"
    : payment.amount === 99900
      ? "Pro Bundle"
      : "Unknown";

const existingPayment = await env.DB.prepare(
  "SELECT id FROM payments WHERE razorpay_payment_id = ?"
)
  .bind(razorpay_payment_id)
  .first();

if (!existingPayment) {
  await env.DB.prepare(`
    INSERT INTO payments
    (user_id, razorpay_order_id, razorpay_payment_id, product, amount, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
    .bind(
      null,
      razorpay_order_id,
      razorpay_payment_id,
      product,
      payment.amount,
      payment.status
    )
    .run();
}

return json({
  success: true,
  message: "Payment verified and saved successfully"
});
      } catch (error) {
        return json({
          success: false,
          message: "Verification failed"
        }, 500);
      }
    }

    // Website
    return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
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
  background: linear-gradient(135deg,#172033,#263b70);
  color: white;
  padding: 55px 20px;
  text-align: center;
}

.hero h1 {
  margin: 0;
  font-size: 44px;
}

.hero p {
  font-size: 18px;
  margin-top: 12px;
}

.container {
  max-width: 900px;
  margin: auto;
  padding: 30px 18px;
}

.products {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.card {
  background: white;
  padding: 25px;
  border-radius: 18px;
  box-shadow: 0 8px 25px rgba(0,0,0,.08);
  text-align: center;
}

.card h2 {
  margin-top: 0;
}

.price {
  font-size: 34px;
  font-weight: bold;
  margin: 18px 0;
}

button {
  border: 0;
  background: #2563eb;
  color: white;
  padding: 14px 25px;
  border-radius: 10px;
  font-size: 16px;
  font-weight: bold;
  cursor: pointer;
}

button:disabled {
  opacity: .6;
}

.rewards {
  margin-top: 30px;
  background: white;
  padding: 25px;
  border-radius: 18px;
  box-shadow: 0 8px 25px rgba(0,0,0,.06);
}

.reward {
  padding: 15px;
  border-bottom: 1px solid #eee;
}

.reward:last-child {
  border-bottom: 0;
}

.notice {
  margin-top: 25px;
  font-size: 13px;
  color: #666;
  line-height: 1.6;
}

.success {
  display: none;
  margin-top: 20px;
  padding: 15px;
  border-radius: 10px;
  background: #e7f8ed;
  color: #176b36;
  text-align: center;
}

@media(max-width:700px) {
  .products {
    grid-template-columns: 1fr;
  }

  .hero h1 {
    font-size: 36px;
  }
}
</style>
</head>

<body>

<section class="hero">
  <h1>CashGrow</h1>
  <p>Digital Creator Bundles & Referral Rewards</p>
</section>

<div class="container">

  <div class="products">

    <div class="card">
      <h2>Starter Bundle</h2>
      <div class="price">₹599</div>
      <p>Digital Creator Bundle</p>
      <button onclick="buyProduct('starter', this)">
        Buy Now
      </button>
    </div>

    <div class="card">
      <h2>Pro Bundle</h2>
      <div class="price">₹999</div>
      <p>Premium Digital Creator Bundle</p>
      <button onclick="buyProduct('pro', this)">
        Buy Now
      </button>
    </div>

  </div>

  <div class="rewards">
    <h2>Referral Rewards</h2>

    <div class="reward">
      <strong>₹599 Bundle</strong><br>
      Referral reward: ₹400
    </div>

    <div class="reward">
      <strong>₹999 Bundle</strong><br>
      Referral reward: ₹800
    </div>

    <div class="notice">
      Referral rewards are subject to applicable terms,
      eligibility and verification. No guaranteed income or
      returns are promised. Digital products are sold as
      described.
    </div>
  </div>

  <div id="success" class="success"></div>

</div>

<script>
async function buyProduct(product, button) {

  button.disabled = true;
  button.innerText = "Please wait...";

  try {

    const response = await fetch("/api/create-order", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ product })
    });

    const order = await response.json();

    if (!response.ok) {
      throw new Error(order.error || "Unable to create order");
    }

    const options = {
      key: "${env.RAZORPAY_KEY_ID}",
      amount: order.amount,
      currency: "INR",
      name: "CashGrow",
      description: order.name,
      order_id: order.order_id,

      handler: async function (payment) {

        const verifyResponse = await fetch("/api/verify", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payment)
        });

        const result = await verifyResponse.json();

        const success = document.getElementById("success");

        if (result.success) {
          success.style.display = "block";
          success.innerText =
            "Payment verified successfully! Payment ID: " +
            payment.razorpay_payment_id;
        } else {
          success.style.display = "block";
          success.innerText =
            "Payment verification failed. Please contact support.";
        }
      },

      theme: {
        color: "#2563eb"
      }
    };

    const razorpay = new Razorpay(options);

    razorpay.on("payment.failed", function () {
      alert("Payment failed. Please try again.");
    });

    razorpay.open();

  } catch (error) {
    alert(error.message);
  }

  button.disabled = false;
  button.innerText = "Buy Now";
}
</script>

</body>
</html>`, {
      headers: {
        "Content-Type": "text/html;charset=UTF-8"
      }
    });
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
