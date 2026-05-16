#!/usr/bin/env bash
# SplitGo · one-shot deployment of the entire AWS backend.
# Idempotent: safe to re-run; updates resources in place if they already exist.
#
# Usage:
#   cd infra && ./deploy.sh
#
# Environment overrides (optional):
#   AWS_REGION  (default: ap-southeast-1 · Singapore)
#   STACK_NAME  (default: splitgo)
#   SES_SENDER  (default: empty — email step skipped if not provided)
#   DASHSCOPE_API_KEY (default: read from ../.env)
#   QWEN_TEXT_MODEL   (default: qwen-plus)
#   QWEN_VL_MODEL     (default: qwen-vl-max)

set -euo pipefail

REGION="${AWS_REGION:-ap-southeast-1}"
STACK="${STACK_NAME:-splitgo}"
TABLE="SplitGoBills"
CONTACTS_TABLE="SplitGoContacts"
TRIPS_TABLE="SplitGoTrips"
ROLE_NAME="${STACK}-lambda-role"
POLICY_NAME="${STACK}-lambda-policy"
FUNC_NAME="${STACK}-api"

if [ -z "${DASHSCOPE_API_KEY:-}" ] && [ -f ../.env ]; then
  DASHSCOPE_API_KEY="$(grep -E '^EXPO_PUBLIC_DASHSCOPE_API_KEY=' ../.env | cut -d'=' -f2- || echo '')"
fi
DASHSCOPE_API_KEY="${DASHSCOPE_API_KEY:-}"
QWEN_TEXT_MODEL="${QWEN_TEXT_MODEL:-qwen-plus}"
QWEN_VL_MODEL="${QWEN_VL_MODEL:-qwen-vl-max}"
SES_SENDER="${SES_SENDER:-}"

if [ -z "$DASHSCOPE_API_KEY" ]; then
  echo "Missing DASHSCOPE_API_KEY. Add EXPO_PUBLIC_DASHSCOPE_API_KEY=... to ../.env or export DASHSCOPE_API_KEY before deploying." >&2
  exit 1
fi

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="splitgo-receipts-${ACCOUNT}"

echo "──────────────────────────────────────────────────────────────"
echo " SplitGo deploy"
echo " Region:         $REGION"
echo " Account:        $ACCOUNT"
echo " Table:          $TABLE"
echo " Bucket:         $BUCKET"
echo " Lambda:         $FUNC_NAME"
echo " SES sender:     ${SES_SENDER:-<not set, email disabled>}"
echo " Qwen text:      $QWEN_TEXT_MODEL"
echo " Qwen vision:    $QWEN_VL_MODEL"
echo " DashScope key:  ${DASHSCOPE_API_KEY:+set}${DASHSCOPE_API_KEY:-<not set>}"
echo "──────────────────────────────────────────────────────────────"

# ================================================================
# 1. DynamoDB
# ================================================================
echo "▸ DynamoDB table $TABLE"
if aws dynamodb describe-table --region "$REGION" --table-name "$TABLE" >/dev/null 2>&1; then
  echo "  ✓ exists"
else
  aws dynamodb create-table --region "$REGION" \
    --table-name "$TABLE" \
    --attribute-definitions AttributeName=billId,AttributeType=S \
    --key-schema AttributeName=billId,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST >/dev/null
  aws dynamodb wait table-exists --region "$REGION" --table-name "$TABLE"
  echo "  ✓ created"
fi

# Contacts table — directory of "people you can add to a bill"
echo "▸ DynamoDB table $CONTACTS_TABLE"
if aws dynamodb describe-table --region "$REGION" --table-name "$CONTACTS_TABLE" >/dev/null 2>&1; then
  echo "  ✓ exists"
else
  aws dynamodb create-table --region "$REGION" \
    --table-name "$CONTACTS_TABLE" \
    --attribute-definitions AttributeName=contactId,AttributeType=S \
    --key-schema AttributeName=contactId,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST >/dev/null
  aws dynamodb wait table-exists --region "$REGION" --table-name "$CONTACTS_TABLE"
  echo "  ✓ created"
fi

# Seed starter contacts on the FIRST run only (so re-deploy is non-destructive).
SEED_COUNT="$(aws dynamodb scan --region "$REGION" --table-name "$CONTACTS_TABLE" \
  --select COUNT --query 'Count' --output text 2>/dev/null || echo 0)"
if [ "$SEED_COUNT" = "0" ]; then
  echo "  ▸ seeding starter contacts"
  NOW="$(date +%s)000"
  aws dynamodb batch-write-item --region "$REGION" --request-items "$(cat <<JSON
{
  "$CONTACTS_TABLE": [
    { "PutRequest": { "Item": {
      "contactId": {"S": "CT-seed-javon"}, "name": {"S": "Javon"},
      "phone": {"S": "+60145246924"}, "color": {"S": "#0070BA"},
      "balance": {"N": "1000"}, "createdAt": {"N": "$NOW"}
    }}},
    { "PutRequest": { "Item": {
      "contactId": {"S": "CT-seed-bc"}, "name": {"S": "BC"},
      "phone": {"S": "+60124523653"}, "color": {"S": "#7AC74F"},
      "balance": {"N": "1000"}, "createdAt": {"N": "$NOW"}
    }}},
    { "PutRequest": { "Item": {
      "contactId": {"S": "CT-seed-kenny"}, "name": {"S": "Kenny"},
      "phone": {"S": "+60167745723"}, "color": {"S": "#F5A623"},
      "balance": {"N": "1000"}, "createdAt": {"N": "$NOW"}
    }}},
    { "PutRequest": { "Item": {
      "contactId": {"S": "CT-seed-ashley"}, "name": {"S": "Ashley"},
      "phone": {"S": "+60172346924"}, "color": {"S": "#E63946"},
      "balance": {"N": "1000"}, "createdAt": {"N": "$NOW"}
    }}},
    { "PutRequest": { "Item": {
      "contactId": {"S": "CT-seed-christina"}, "name": {"S": "Christina"},
      "phone": {"S": "+60119482529"}, "color": {"S": "#9B5DE5"},
      "balance": {"N": "1000"}, "createdAt": {"N": "$NOW"}
    }}},
    { "PutRequest": { "Item": {
      "contactId": {"S": "CT-seed-yen"}, "name": {"S": "Yen"},
      "phone": {"S": "+60182463561"}, "color": {"S": "#00B4D8"},
      "balance": {"N": "1000"}, "createdAt": {"N": "$NOW"}
    }}}
  ]
}
JSON
)" >/dev/null
  echo "  ✓ seeded 6 starter contacts"
else
  echo "  ✓ $SEED_COUNT contacts already present (skipping seed)"
fi

# Trips table — server-of-record for travel groups (so every device on the
# trip sees the same name/roster, not just the device that created it).
echo "▸ DynamoDB table $TRIPS_TABLE"
if aws dynamodb describe-table --region "$REGION" --table-name "$TRIPS_TABLE" >/dev/null 2>&1; then
  echo "  ✓ exists"
else
  aws dynamodb create-table --region "$REGION" \
    --table-name "$TRIPS_TABLE" \
    --attribute-definitions AttributeName=travelGroupId,AttributeType=S \
    --key-schema AttributeName=travelGroupId,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST >/dev/null
  aws dynamodb wait table-exists --region "$REGION" --table-name "$TRIPS_TABLE"
  echo "  ✓ created"
fi

# ================================================================
# 2. S3 bucket for receipts
# ================================================================
echo "▸ S3 bucket $BUCKET"
if aws s3api head-bucket --bucket "$BUCKET" --region "$REGION" 2>/dev/null; then
  echo "  ✓ exists"
else
  if [ "$REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" >/dev/null
  else
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
      --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
  fi
  aws s3api put-public-access-block --bucket "$BUCKET" \
    --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" >/dev/null
  aws s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration '{
    "CORSRules":[{
      "AllowedHeaders":["*"],
      "AllowedMethods":["PUT","GET"],
      "AllowedOrigins":["*"],
      "ExposeHeaders":["ETag"],
      "MaxAgeSeconds":3000
    }]
  }' >/dev/null
  echo "  ✓ created with CORS"
fi

# ================================================================
# 3. IAM role + policy
# ================================================================
echo "▸ IAM role $ROLE_NAME"
if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  echo "  ✓ exists"
else
  aws iam create-role --role-name "$ROLE_NAME" \
    --assume-role-policy-document file://trust-policy.json >/dev/null
  echo "  ✓ created"
fi

# Always update the inline policy (so changes take effect on re-deploy)
aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name "$POLICY_NAME" \
  --policy-document file://lambda-policy.json >/dev/null
echo "  ✓ inline policy synced"

ROLE_ARN="$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text)"

# ================================================================
# 4. Build Lambda zip
# ================================================================
echo "▸ Building Lambda package"
pushd lambda >/dev/null
[ -d node_modules ] || npm install --silent --omit=dev
rm -f ../lambda.zip
zip -qr ../lambda.zip . -x "*.git*"
popd >/dev/null
echo "  ✓ lambda.zip built"

# ================================================================
# 5. Lambda function
# ================================================================
echo "▸ Lambda function $FUNC_NAME"

ENV_VARS=$(cat <<EOF
{
  "Variables": {
    "BILLS_TABLE":       "$TABLE",
    "CONTACTS_TABLE":    "$CONTACTS_TABLE",
    "TRIPS_TABLE":       "$TRIPS_TABLE",
    "RECEIPT_BUCKET":    "$BUCKET",
    "SES_SENDER":        "$SES_SENDER",
    "DASHSCOPE_API_KEY": "$DASHSCOPE_API_KEY",
    "QWEN_TEXT_MODEL":   "$QWEN_TEXT_MODEL",
    "QWEN_VL_MODEL":     "$QWEN_VL_MODEL"
  }
}
EOF
)

if aws lambda get-function --region "$REGION" --function-name "$FUNC_NAME" >/dev/null 2>&1; then
  aws lambda update-function-code --region "$REGION" \
    --function-name "$FUNC_NAME" --zip-file fileb://lambda.zip >/dev/null
  aws lambda wait function-updated --region "$REGION" --function-name "$FUNC_NAME"
  aws lambda update-function-configuration --region "$REGION" \
    --function-name "$FUNC_NAME" \
    --environment "$ENV_VARS" \
    --timeout 30 --memory-size 512 >/dev/null
  echo "  ✓ updated"
else
  # Newly-created roles need a few seconds to propagate before Lambda accepts them
  sleep 8
  aws lambda create-function --region "$REGION" \
    --function-name "$FUNC_NAME" \
    --runtime nodejs20.x \
    --role "$ROLE_ARN" \
    --handler index.handler \
    --zip-file fileb://lambda.zip \
    --timeout 30 --memory-size 512 \
    --environment "$ENV_VARS" >/dev/null
  echo "  ✓ created"
fi

LAMBDA_ARN="$(aws lambda get-function --region "$REGION" --function-name "$FUNC_NAME" --query 'Configuration.FunctionArn' --output text)"

# ================================================================
# 6. API Gateway HTTP API
# ================================================================
echo "▸ API Gateway HTTP API $STACK"
API_ID="$(aws apigatewayv2 get-apis --region "$REGION" --query "Items[?Name=='$STACK'].ApiId" --output text)"
if [ -z "$API_ID" ] || [ "$API_ID" = "None" ]; then
  API_ID="$(aws apigatewayv2 create-api --region "$REGION" \
    --name "$STACK" \
    --protocol-type HTTP \
    --target "$LAMBDA_ARN" \
    --cors-configuration "AllowOrigins=*,AllowMethods=GET,POST,OPTIONS,AllowHeaders=*" \
    --query 'ApiId' --output text)"
  echo "  ✓ created ($API_ID)"
else
  echo "  ✓ exists ($API_ID)"
fi

# Permission for API Gateway → Lambda
aws lambda add-permission --region "$REGION" \
  --function-name "$FUNC_NAME" \
  --statement-id apigw-invoke \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:$REGION:$ACCOUNT:$API_ID/*/*" >/dev/null 2>&1 || true

INVOKE_URL="https://$API_ID.execute-api.$REGION.amazonaws.com"

# Keep the app’s Metro bundle in sync with this API (avoids stale / wrong API ids).
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"
if [ -f "$ENV_FILE" ]; then
  if grep -q '^EXPO_PUBLIC_AWS_API_URL=' "$ENV_FILE"; then
    TMP="$(mktemp)"
    sed "s|^EXPO_PUBLIC_AWS_API_URL=.*|EXPO_PUBLIC_AWS_API_URL=${INVOKE_URL}|" "$ENV_FILE" >"$TMP" && mv "$TMP" "$ENV_FILE"
    echo "▸ Updated EXPO_PUBLIC_AWS_API_URL in .env"
  else
    printf '\nEXPO_PUBLIC_AWS_API_URL=%s\n' "$INVOKE_URL" >>"$ENV_FILE"
    echo "▸ Appended EXPO_PUBLIC_AWS_API_URL to .env"
  fi
else
  echo "▸ No .env at repo root — create one with EXPO_PUBLIC_AWS_API_URL=$INVOKE_URL"
fi

# ================================================================
# Done
# ================================================================
echo ""
echo "──────────────────────────────────────────────────────────────"
echo " ✅  Deploy complete"
echo "──────────────────────────────────────────────────────────────"
echo " Invoke URL:       $INVOKE_URL"
echo " DynamoDB table:   $TABLE"
echo " S3 bucket:        $BUCKET"
echo " Lambda:           $FUNC_NAME"
echo ""
echo " Next: restart Metro so the app picks up .env (deploy updates it when .env exists):"
echo "   CI=false npx expo start --clear"
echo "──────────────────────────────────────────────────────────────"
