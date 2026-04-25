# SplitGo — Pitch Deck Source

Paste this whole file into a Canva blank Doc, then click **Magic Switch → Convert to Presentation** (or use **Docs → Decks**). Each `##` heading becomes a slide.

---

## SplitGo

**Scan. Split. Settle. All inside TNG.**

The fastest way to split a bill in Malaysia.

*Team: [Sintax Aeral] · TNG Hackathon 2026*
*Powered by AWS + Alibaba Cloud*

> **Speaker note:** Hold for 3 seconds. Smile. *"Hi, we're [team], and we built SplitGo — the fastest way to split a bill in Malaysia, and we built it inside TNG."*

---

## The Problem

It's Friday night. 8 friends just finished hot pot.

- The receipt is in **Chinese**
- Someone fronts **RM 480** on their card
- WhatsApp becomes a calculator
- *"I didn't drink the soju"* · *"Bryan bayar dulu"*
- 30 minutes later, **2 people still haven't paid back**

**Malaysia has the wallet. Has the food culture. Doesn't have the splitter. That's the gap.**

> **Speaker note:** Tell this as a story, not a list. Make eye contact when you say "sound familiar?". The judges have lived this.

---

## The Solution

**SplitGo** is a feature inside TNG eWallet that:

1. **Scans** any receipt — including handwritten, multi-language
2. **Lets every person self-claim** their items in real-time
3. **Atomically settles** via the wallet — no IOUs, no chasing

Three verbs: **Scan · Claim · Settle.**

> **Speaker note:** This is a setup slide for the demo — keep it short. *"Let me show you how it works."* → straight to demo.

---

## Live Demo

**90 seconds. Real receipt. Real multi-device.**

1. Sarah scans a Chinese receipt → OCR in 4s
2. Invites Ben & Ali → live link
3. Each picks what they ate → live dashboard
4. Ben translates receipt to English → 1 tap
5. Sarah closes the bill → everyone sees their share
6. Ben pays → RM 24.50 deducted, balance updated, Sarah gets receipt
7. Sarah leaves → comes back tomorrow → history still lives

**That whole flow took 90 seconds. WhatsApp + calculator usually takes 30 minutes.**

> **Speaker note:** Pre-record a backup video. Test wifi 30 min before. Always have a plan B. After demo: *"That's not a mockup — that's running on AWS in Malaysia right now."*

---

## Architecture

**Dual-cloud, production-shaped.**

- **Mobile** — Expo / React Native, 11 screens, 2 contexts
- **Alibaba Cloud · Model Studio**
  - Qwen-VL-Max → multi-language receipt OCR
  - Qwen-Plus → translation, categorisation, summary
- **AWS · ap-southeast-5 (Malaysia)**
  - API Gateway · 17 routes
  - Lambda · single Node 20 function
  - DynamoDB · 2 tables (bills + contacts/wallet)
  - S3 · receipts (private, pre-signed URLs)
  - SES · settlement email
  - IAM + CloudWatch

**Atomic e-wallet** via DynamoDB conditional updates. **Data resident in Malaysia.**

> **Speaker note:** Don't read the diagram. Just point and say *"Mobile here, AI on Alibaba, state on AWS, all in Malaysia for data residency."* Move on fast.

---

## What makes us different

|  | Splitwise | GrabPay | TNG today | **SplitGo** |
|---|---|---|---|---|
| OCR receipt | basic, paid | no | no | **Qwen-VL multi-lang** |
| Self-claim flow | no | no | no | **yes** |
| Item-level translation | no | no | no | **yes** |
| Live dashboard | no | no | no | **yes** |
| In-wallet atomic settlement | no | partial | partial | **yes** |
| Inside TNG (22M users) | no | no | yes | **yes** |

**Splitwise tracks debts. GrabPay copies WhatsApp. We close the loop.**

> **Speaker note:** Linger on this slide for 20-30s. Let judges read it. The table sells itself.

---

## How TNG earns from this

**Phase 1 — what we built today**

- **Float yield** — 10% adoption × 22M users × RM 200 retained → **~RM 13–17M/yr in BNM-trust yield**
- **Stickiness moat** — friend groups don't churn. Defends core wallet from GrabPay.
- **Cross-sell signal** — split data = highest-quality lead for **GoLife, Aspirasi, GO+**

**Phase 2 — roadmap**

- Merchant SplitGo QR → **0.5–1.5% MDR** + **RM 50–150/mo SaaS** per restaurant
- Promoted merchants → *"Split your next meal at Sushi King for 15% off"*

> *We're not asking TNG to monetise the split. We're asking TNG to use the split to monetise everything else.*

> **Speaker note:** This slide wins or loses the pitch. Be slow, be specific, be honest about Phase 2 being roadmap not built. Judges respect honesty over hype.

---

## Roadmap

**0–3 months** · Pilot with 1 KL restaurant chain (PappaRich-tier). Measure float retention vs. control group.

**3–6 months** · Multi-currency support (THB, SGD, IDR) for travellers. Capture FX spread.

**6–12 months** · Merchant-side SplitGo QR + POS integrations. B2B SaaS pricing live.

**Year 2** · Recurring splits (rent, utilities). Premium tier RM 4.90/mo.

> **Speaker note:** Each horizon = 1 sentence. Don't dwell. Show ambition + realism.

---

## Thank you

**SplitGo · [your team name]**

- 🐙 GitHub: github.com/JolynNg/tng_splitgo
- 📱 Live demo: scan QR on screen
- ✉️ [jianlinlim@gmail.com]

**We're asking for: [selection to next round / pilot mentor / etc.]**

*Built in 48h with AWS + Alibaba Cloud · ap-southeast-5*

> **Speaker note:** End strong. *"Thank you — happy to take questions."* Then wait. Don't fill silence.

---

# How to use this in Canva

1. Open **canva.com** → **Create a design** → **Doc**
2. Copy everything above (between the rules)
3. Paste into the blank doc
4. Click **Magic Switch** (top toolbar) → **Convert to Presentation**
5. Pick a template style (recommend: dark + orange to match TNG branding)
6. Tweak fonts/colors — TNG colors are `#0E5FBF` (blue) and `#F5A623` (orange)

**Pro tip:** if Magic Switch doesn't auto-detect slide breaks, manually split at each `---` divider.
