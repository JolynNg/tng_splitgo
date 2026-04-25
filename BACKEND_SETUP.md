# SplitGo Cloud Backend Setup (FinHack)

This app uses **two clouds**, satisfying the FinHack requirement of ≥1 service from each:

| Cloud | Service | Purpose |
|---|---|---|
| **Alibaba Cloud** | Model Studio · Qwen-VL-Max | Receipt OCR (multimodal AI) |
| **AWS** | API Gateway + Lambda + DynamoDB | Live bill session state |

The mobile app falls back to **local demo mode** automatically if either is not yet configured, so you can develop offline.

---

## 1. Alibaba Cloud — Receipt OCR

### Sign up & get API key (5 min)

1. Sign up at [alibabacloud.com](https://www.alibabacloud.com/) (international) or [aliyun.com](https://www.aliyun.com/) (mainland CN).
2. Open **Model Studio** (also called Bailian / 百炼).
3. Go to **API-KEY** in the left menu → **Create new API key**. Copy the key.
4. New users get a **free trial quota** of Qwen-VL-Max requests — more than enough for the hackathon.

### Wire into the app

Create `.env` in the project root (gitignored):

```bash
EXPO_PUBLIC_DASHSCOPE_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Restart Metro:

```bash
CI=false npx expo start --clear
```

The OCR call lives in `src/api/extractReceipt.js`. It hits:

```
POST https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions
Authorization: Bearer $DASHSCOPE_API_KEY
{ "model": "qwen-vl-max", "messages": [...] }
```

Use `dashscope.aliyuncs.com` (no `-intl`) if your account is in mainland China.

> Demo proof: when configured, `OCR_PROVIDER` exported from `extractReceipt.js` returns `"Alibaba Cloud · Qwen-VL-Max"`.

---

## 2. AWS — Live bill session backend

### a. Create the DynamoDB table

```bash
aws dynamodb create-table \
  --table-name SplitGoBills \
  --attribute-definitions AttributeName=billId,AttributeType=S \
  --key-schema AttributeName=billId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST
```

Item schema:

```json
{
  "billId":     "SG-K9X4M",
  "createdAt":  1730000000,
  "creator":    "You",
  "status":     "open",
  "items":      [{"id": 1, "name": "Roti Canai", "qty": 2, "unit": 3.0}],
  "participants": ["You", "Aisyah Rahman", "Marcus Tan"],
  "receiptMeta": {"restaurant": "Mamak Pelita", "sst": 3.81, "serviceCharge": 6.35},
  "claims":     { "1": ["You"], "5": ["You", "Aisyah Rahman"] }
}
```

### b. Lambda handler (Node.js 20)

Save as `lambda/splitgo-bills.js` and zip-deploy:

```js
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = 'SplitGoBills';

const ok = (body) => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(body),
});
const bad = (msg, code = 400) => ({ statusCode: code, body: JSON.stringify({ error: msg }) });

const genId = () => {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let id = 'SG-';
  for (let i = 0; i < 5; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
};

export const handler = async (event) => {
  const method = event.requestContext.http.method;
  const path   = event.requestContext.http.path;
  const body   = event.body ? JSON.parse(event.body) : {};

  // POST /bills
  if (method === 'POST' && path === '/bills') {
    const billId = genId();
    const item = {
      billId,
      createdAt:    Date.now(),
      creator:      body.creator || 'unknown',
      status:       'open',
      items:        body.items || [],
      participants: body.participants || [],
      receiptMeta:  body.receiptMeta || {},
      claims:       {},
    };
    await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
    return ok({ billId, shareLink: `https://splitgo.app/b/${billId}`, createdAt: item.createdAt });
  }

  // GET /bills/{billId}
  const getMatch = path.match(/^\/bills\/([^/]+)$/);
  if (method === 'GET' && getMatch) {
    const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { billId: getMatch[1] } }));
    if (!r.Item) return bad('not found', 404);
    return ok(r.Item);
  }

  // POST /bills/{billId}/claim
  const claimMatch = path.match(/^\/bills\/([^/]+)\/claim$/);
  if (method === 'POST' && claimMatch) {
    const billId = claimMatch[1];
    const { participant, claimedItemIds } = body;
    if (!participant || !Array.isArray(claimedItemIds)) return bad('bad payload');

    const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { billId } }));
    if (!r.Item) return bad('not found', 404);
    if (r.Item.status !== 'open') return bad('bill closed');

    const claims = { ...(r.Item.claims || {}) };
    r.Item.items.forEach((it) => {
      const cur = claims[it.id] || [];
      const has = cur.includes(participant);
      const should = claimedItemIds.includes(it.id);
      if (should && !has) claims[it.id] = [...cur, participant];
      else if (!should && has) claims[it.id] = cur.filter((n) => n !== participant);
    });

    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { billId },
      UpdateExpression: 'SET claims = :c',
      ExpressionAttributeValues: { ':c': claims },
    }));
    return ok({ billId, claims });
  }

  // POST /bills/{billId}/close
  const closeMatch = path.match(/^\/bills\/([^/]+)\/close$/);
  if (method === 'POST' && closeMatch) {
    const billId = closeMatch[1];
    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { billId },
      UpdateExpression: 'SET #s = :s',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':s': 'closed' },
    }));
    return ok({ billId, status: 'closed' });
  }

  return bad('route not found', 404);
};
```

### c. Wire up API Gateway (HTTP API)

Easiest path via console:

1. **Lambda → Create function** → Node.js 20.x → paste handler → set role with `AmazonDynamoDBFullAccess` and `CloudWatchLogsFullAccess`.
2. **API Gateway → Create HTTP API** → integrate to your Lambda function → add routes:
   - `POST /bills`
   - `GET /bills/{billId}`
   - `POST /bills/{billId}/claim`
   - `POST /bills/{billId}/close`
3. Enable **CORS** with allow-origin `*` for the demo.
4. Copy the **Invoke URL** (e.g. `https://abc123.execute-api.ap-southeast-1.amazonaws.com`).

### d. Wire into the app

Add to `.env`:

```bash
EXPO_PUBLIC_AWS_API_URL=https://abc123.execute-api.ap-southeast-1.amazonaws.com
```

Restart Metro. The app's `src/api/billService.js` will start hitting AWS automatically. With the env var unset, it returns `local: true` and the app stays in offline demo mode.

> Demo proof: when configured, `BACKEND_PROVIDER` exported from `billService.js` returns the AWS URL.

---

## 3. Pitch summary for FinHack judges

> *"SplitGo is dual-cloud by design. We use Alibaba Cloud's Qwen-VL multimodal model to read messy real-world receipts in Bahasa, English and Chinese — that's the AI brain. We use AWS API Gateway + Lambda + DynamoDB for the live bill-session state so participants on different phones can claim items and see the dashboard update in real time — that's the system backbone. Both clouds together: Alibaba runs the AI, AWS runs the app."*

---

## 4. Local development (no AWS needed)

If you don't want to set up AWS yet, **leave `EXPO_PUBLIC_AWS_API_URL` unset**. The app:

- Generates a local bill ID like `SG-K9X4M`.
- Stores all claims in `FlowContext`.
- Uses the **Demo: Viewing as ___** switcher to simulate multiple participants on one device.

This is the fastest path to demo end-to-end, then you can layer real AWS on top.

> **OCR is required.** Unlike AWS, there is no local fallback for receipt
> scanning — you must set `EXPO_PUBLIC_DASHSCOPE_API_KEY` (Alibaba Cloud) before
> the **Scan Receipt** flow will work. Sign-up takes ~5 minutes and the free
> trial covers more than enough Qwen-VL-Max requests for the hackathon.
