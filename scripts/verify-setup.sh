#!/bin/bash
# Setup and verify Coinflow sandbox credentials
# Run this after filling in .env.local

set -e

ENV_FILE="/Users/m/coinflow-demo/.env.local"

# Source the env vars
set -a
source "$ENV_FILE"
set +a

echo "=========================================="
echo "  Coinflow Sandbox Verification"
echo "=========================================="
echo ""

# Check required vars
MISSING=0
for var in COINFLOW_MERCHANT_ID COINFLOW_API_KEY; do
  val="${!var}"
  if [ -z "$val" ] || [ "$val" = "your_merchant_id_from_coinflow_dashboard" ] || [ "$val" = "your_a...oard" ]; then
    echo "❌ $var is not set (still has placeholder)"
    MISSING=1
  fi
done

if [ "$MISSING" -eq 1 ]; then
  echo ""
  echo "Edit .env.local with your sandbox credentials from:"
  echo "  https://sandbox-merchant.coinflow.cash/api-keys"
  echo ""
  echo "Then re-run: bash scripts/verify-setup.sh"
  exit 1
fi

echo "✅ .env.local looks configured"
echo ""

# Step 1: Test session key endpoint
echo "--- Step 1: Get Session Key ---"
RESP=$(curl -s -w "\n%{http_code}" \
  "https://api-sandbox.coinflow.cash/api/auth/session-key" \
  -H "Authorization: $COINFLOW_API_KEY" \
  -H "x-coinflow-auth-user-id: test_player_001" \
  -H "accept: application/json")

HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  SESSION_KEY=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['key'])" 2>/dev/null)
  echo "✅ Session key obtained (${SESSION_KEY:0:20}...)"
else
  echo "❌ Session key failed (HTTP $HTTP_CODE): $BODY"
  exit 1
fi

# Step 2: Test checkout JWT
echo "--- Step 2: Get Checkout JWT ---"
RESP=$(curl -s -w "\n%{http_code}" \
  -X POST "https://api-sandbox.coinflow.cash/api/checkout/jwt-token" \
  -H "Authorization: $COINFLOW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}')

HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  JWT=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['checkoutJwtToken'])" 2>/dev/null)
  echo "✅ Checkout JWT obtained (${JWT:0:30}...)"
else
  echo "❌ Checkout JWT failed (HTTP $HTTP_CODE): $BODY"
  exit 1
fi

# Step 3: Test pricing totals
echo "--- Step 3: Get Pricing Quote ---"
RESP=$(curl -s -w "\n%{http_code}" \
  -X POST "https://api-sandbox.coinflow.cash/api/checkout/totals/$COINFLOW_MERCHANT_ID" \
  -H "x-coinflow-auth-session-key: $SESSION_KEY" \
  -H "Content-Type: application/json" \
  -H "accept: application/json" \
  -d '{"subtotal": {"cents": 1000}, "settlementType": "USDC"}')

HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Pricing quote fetched: $(echo $BODY | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Total: \${d.get(\"total\",{}).get(\"cents\",0)/100:.2f}')")"
else
  echo "⚠️  Pricing quote: HTTP $HTTP_CODE (may need settlement config)"
  echo "   $BODY"
fi

# Step 4: Optionally test destination auth key
SETTLEMENT_WALLET="${COINFLOW_SETTLEMENT_WALLET:-}"
if [ -n "$SETTLEMENT_WALLET" ] && [ "$SETTLEMENT_WALLET" != "0xYourPolygonWalletAddress" ]; then
  echo "--- Step 4: Get Destination Auth Key ---"
  RESP=$(curl -s -w "\n%{http_code}" \
    -X POST "https://api-sandbox.coinflow.cash/api/checkout/destination-auth-key" \
    -H "Authorization: $COINFLOW_API_KEY" \
    -H "Content-Type: application/json" \
    -H "accept: application/json" \
    -d "{\"blockchain\": \"polygon\", \"destination\": \"$SETTLEMENT_WALLET\"}")

  HTTP_CODE=$(echo "$RESP" | tail -1)
  BODY=$(echo "$RESP" | sed '$d')

  if [ "$HTTP_CODE" = "200" ]; then
    DEST_KEY=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['destinationAuthKey'][:30] + '...')")
    echo "✅ Destination auth key: $DEST_KEY"
  else
    echo "⚠️  Destination auth key: HTTP $HTTP_CODE"
  fi
else
  echo "--- Step 4: Skip destination auth (no wallet configured) ---"
fi

# Step 5: Build check
echo "--- Step 5: TypeScript Build Check ---"
cd /Users/m/coinflow-demo
BUILD_OUTPUT=$(npm run build 2>&1) || true
if echo "$BUILD_OUTPUT" | grep -q "Compiled successfully"; then
  echo "✅ Next.js build passes"
else
  LAST_LINES=$(echo "$BUILD_OUTPUT" | tail -10)
  echo "❌ Build error: $LAST_LINES"
  exit 1
fi

echo ""
echo "=========================================="
echo "  ✅ All checks passed!"
echo "=========================================="
echo ""
echo "Start dev server:   cd /Users/m/coinflow-demo && npm run dev"
echo "Open in browser:    http://localhost:3000"
echo ""
echo "Test card (no 3DS): 4111111111111111 (any CVV, future expiry)"
echo "Test card (3DS):    4000000000000002"
