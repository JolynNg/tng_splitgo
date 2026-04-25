#!/usr/bin/env bash
# Smoke-test the deployed SplitGo backend end-to-end.
# Exercises: DynamoDB write, DynamoDB read, S3 pre-signed URL, Lambda compute.

set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: ./test.sh <invoke-url>"
  echo "e.g.    ./test.sh https://abc123.execute-api.ap-southeast-5.amazonaws.com"
  exit 1
fi

API="$1"

echo "▸ POST /bills"
CREATE=$(curl -s -X POST "$API/bills" \
  -H "Content-Type: application/json" \
  -d '{
    "creator": "TestPayer",
    "items": [
      {"id": 1, "name": "Roti Canai", "qty": 2, "unit": 3.50},
      {"id": 2, "name": "Teh Tarik",  "qty": 1, "unit": 4.20}
    ],
    "participants": ["TestPayer", "Sara", "Marcus"],
    "receiptMeta": {"restaurant": "Mamak Pelita", "sst": 0.50, "serviceCharge": 0}
  }')
echo "  ← $CREATE"
BILL_ID=$(echo "$CREATE" | python3 -c "import sys,json;print(json.load(sys.stdin)['billId'])")
echo "  billId: $BILL_ID"

echo "▸ POST /bills/$BILL_ID/claim (Sara claims item 1)"
curl -s -X POST "$API/bills/$BILL_ID/claim" \
  -H "Content-Type: application/json" \
  -d "{\"participant\":\"Sara\",\"claimedItemIds\":[1]}" | head -c 200; echo

echo "▸ POST /bills/$BILL_ID/claim (Marcus claims item 2)"
curl -s -X POST "$API/bills/$BILL_ID/claim" \
  -H "Content-Type: application/json" \
  -d "{\"participant\":\"Marcus\",\"claimedItemIds\":[2]}" | head -c 200; echo

echo "▸ GET /bills/$BILL_ID"
curl -s "$API/bills/$BILL_ID" | head -c 400; echo

echo "▸ POST /upload-url"
curl -s -X POST "$API/upload-url" \
  -H "Content-Type: application/json" \
  -d '{"ext":"jpg"}' | head -c 300; echo

echo "▸ POST /bills/$BILL_ID/close"
curl -s -X POST "$API/bills/$BILL_ID/close" \
  -H "Content-Type: application/json" \
  -d '{}' | head -c 300; echo

echo ""
echo "✅ All endpoints responded. Bill id: $BILL_ID"
