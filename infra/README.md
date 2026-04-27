# SplitGo · Cloud Infrastructure

Single-command deployment of the entire AWS backend, plus the Alibaba Cloud AI hooks.

## Cloud services used

| Cloud | Service | Role |
|---|---|---|
| **AWS** | API Gateway (HTTP API) | Public REST endpoint |
| **AWS** | Lambda (Node.js 20)    | Business logic |
| **AWS** | DynamoDB               | Bill + claim state |
| **AWS** | S3                     | Receipt photo storage |
| **AWS** | SES (optional)         | Settlement email recap |
| **AWS** | IAM                    | Least-privilege execution role |
| **AWS** | CloudWatch Logs        | Lambda logs |
| **Alibaba** | Model Studio · Qwen-VL-Max | Receipt OCR (called from app) |
| **Alibaba** | Model Studio · Qwen-Plus   | AI-generated WhatsApp summary (called from Lambda) |

## Prerequisites

- AWS CLI configured (`aws configure`)
- Node.js 18+ (for `npm install` inside `lambda/`)
- Alibaba Cloud Model Studio API key in `../.env` as `EXPO_PUBLIC_DASHSCOPE_API_KEY`
- Default region is **`ap-southeast-1` (Singapore)**. For Malaysia instead, run with `AWS_REGION=ap-southeast-5 ./deploy.sh`.

## One-command deploy

```bash
cd infra
./deploy.sh
```

The script is idempotent — re-run any time to push code changes.

## Test the deployed API

```bash
./test.sh https://YOUR-API-ID.execute-api.ap-southeast-1.amazonaws.com
```

This hits every route end-to-end and prints the responses.

## Optional: enable email recaps via SES

1. Verify a sender identity in SES console (your own email is enough for the demo, takes ~2 minutes).
2. Re-run with the sender:
   ```bash
   SES_SENDER="you@example.com" ./deploy.sh
   ```
3. The app will pass `recipients` into `/bills/{id}/close` to trigger an email.

## Update only the Lambda code

```bash
cd infra/lambda
zip -qr ../lambda.zip . -x "*.git*"
aws lambda update-function-code --region ap-southeast-1 \
  --function-name splitgo-api --zip-file fileb://../lambda.zip
```

## Tearing it down

```bash
aws lambda delete-function --region ap-southeast-1 --function-name splitgo-api
aws apigatewayv2 delete-api --region ap-southeast-1 --api-id $(aws apigatewayv2 get-apis --region ap-southeast-1 --query "Items[?Name=='splitgo'].ApiId" --output text)
aws dynamodb delete-table --region ap-southeast-1 --table-name SplitGoBills
aws s3 rb s3://splitgo-receipts-$(aws sts get-caller-identity --query Account --output text) --force
aws iam delete-role-policy --role-name splitgo-lambda-role --policy-name splitgo-lambda-policy
aws iam delete-role --role-name splitgo-lambda-role
```
