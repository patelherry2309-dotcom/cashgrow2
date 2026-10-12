export default {
  async fetch(request) {
    return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CashGrow - Digital Creator Bundles</title>
  <style>
    *{box-sizing:border-box}
    body{
      margin:0;
      font-family:Arial,sans-serif;
      background:#f5f7fb;
      color:#172033;
    }
    .hero{
      background:linear-gradient(135deg,#116530,#39a852);
      color:white;
      padding:55px 20px;
      text-align:center;
    }
    .hero h1{
      margin:0;
      font-size:42px;
    }
    .hero p{
      font-size:18px;
      margin:15px 0 0;
    }
    .container{
      max-width:1000px;
      margin:auto;
      padding:35px 18px;
    }
    .title{
      text-align:center;
      font-size:30px;
      margin-bottom:25px;
    }
    .plans{
      display:grid;
      grid-template-columns:repeat(auto-fit,minmax(280px,1fr));
      gap:22px;
    }
    .card{
      background:white;
      border-radius:18px;
      padding:28px;
      box-shadow:0 8px 25px rgba(0,0,0,.08);
      text-align:center;
    }
    .card h2{
      margin-top:0;
      font-size:25px;
    }
    .price{
      font-size:38px;
      font-weight:bold;
      color:#16833a;
      margin:18px 0;
    }
    .card ul{
      text-align:left;
      line-height:1.9;
      padding-left:20px;
    }
    .btn{
      display:block;
      background:#16833a;
      color:white;
      text-decoration:none;
      padding:14px;
      border-radius:10px;
      font-weight:bold;
      margin-top:22px;
    }
    .referral{
      margin-top:30px;
      background:#fff;
      border-radius:18px;
      padding:25px;
      text-align:center;
      box-shadow:0 8px 25px rgba(0,0,0,.06);
    }
    .referral h2{
      margin-top:0;
    }
    .note{
      font-size:13px;
      color:#667085;
      margin-top:25px;
      line-height:1.6;
    }
    footer{
      text-align:center;
      padding:25px;
      color:#667085;
      font-size:14px;
    }
  </style>
</head>

<body>

<section class="hero">
  <h1>CashGrow</h1>
  <p>Digital Creator Bundles & Referral Rewards</p>
</section>

<div class="container">

  <h2 class="title">Choose Your Bundle</h2>

  <div class="plans">

    <div class="card">
      <h2>Starter Bundle</h2>
      <div class="price">₹599</div>
      <ul>
        <li>Digital creator resources</li>
        <li>Ready-to-use content materials</li>
        <li>Creator learning resources</li>
        <li>Access to your purchased digital bundle</li>
      </ul>
      <a class="btn" href="#">Buy Now</a>
    </div>

    <div class="card">
      <h2>Pro Bundle</h2>
      <div class="price">₹999</div>
      <ul>
        <li>Premium digital creator resources</li>
        <li>Ready-to-use content materials</li>
        <li>Advanced creator resources</li>
        <li>Access to your purchased digital bundle</li>
      </ul>
      <a class="btn" href="#">Buy Now</a>
    </div>

  </div>

  <div class="referral">
    <h2>Referral Rewards</h2>
    <p>Invite eligible customers and receive rewards according to the CashGrow referral program terms.</p>
    <p><strong>₹599 Bundle → ₹400 referral reward</strong></p>
    <p><strong>₹999 Bundle → ₹800 referral reward</strong></p>
  </div>

  <p class="note">
    Referral rewards are subject to the applicable program terms and eligibility.
    CashGrow does not guarantee income or returns. Digital products are sold as described.
  </p>

</div>

<footer>
  © 2026 CashGrow. All rights reserved.
</footer>

</body>
</html>`, {
      headers: {
        "content-type": "text/html;charset=UTF-8"
      }
    });
  }
};
