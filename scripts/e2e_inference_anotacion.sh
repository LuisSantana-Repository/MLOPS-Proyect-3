#!/usr/bin/env bash
# P0-3 de punta a punta, contra el stack real:
#   clasifica un recorte en /api/inference -> lo envía a anotación -> lo encuentra
#   pendiente, con la sugerencia del modelo, en el portal de anotación.
#
# Requisitos: `docker compose up -d` (inference y annotation-api arriba), el portal
# corriendo (`cd portal && npm run dev`) y una versión de modelo publicada.
#
# Uso:  scripts/e2e_inference_anotacion.sh [versión] [recorte]
#       PORTAL_URL=http://localhost:3000 scripts/e2e_inference_anotacion.sh 1.0.0
set -euo pipefail

PORTAL_URL="${PORTAL_URL:-http://localhost:3000}"
VERSION="${1:-1.0.0}"
CROP="${2:-}"

json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

if [ -z "$CROP" ]; then
  CROP=$(curl -fsS "$PORTAL_URL/api/crops?limit=1" | json "d['crops'][0]['cropPath']")
fi
echo "1) Clasificando $CROP con el modelo $VERSION…"
FORM=$(mktemp)
curl -fsS -X POST "$PORTAL_URL/api/inference" -F "version=$VERSION" -F "cropPath=$CROP" >"$FORM"
PREDICTED=$(json "d['predictedClass']" <"$FORM")
echo "   clase predicha: $PREDICTED"

echo "2) Enviando a anotación…"
BODY=$(python3 - "$FORM" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
print(json.dumps({
    "image": r["image"],
    "modelVersion": r["version"],
    "suggestedClass": r["predictedClass"],
    "probabilities": {p["className"]: p["probability"] for p in r["probabilities"]},
}))
PY
)
SENT=$(curl -fsS -X POST "$PORTAL_URL/api/annotation" -H "Content-Type: application/json" -d "$BODY")
IMAGE_ID=$(echo "$SENT" | json "d['imageId']")
echo "   imagen #$IMAGE_ID registrada en el portal de anotación"

echo "3) Buscándola entre las pendientes del portal de anotación…"
curl -fsS "$PORTAL_URL/api/p2/images/search?status=pending&pageSize=100" | python3 -c "
import json, sys
image_id, predicted = int(sys.argv[1]), sys.argv[2]
found = [i for i in json.load(sys.stdin)['data'] if i['id'] == image_id]
assert found, f'la imagen #{image_id} no aparece entre las pendientes'
item = found[0]
assert item['status'] == 'pending', item['status']
assert item['suggestion'] and item['suggestion']['category'] == predicted, item['suggestion']
print('   pendiente, sugerencia:', item['suggestion'])
" "$IMAGE_ID" "$PREDICTED"

rm -f "$FORM"
echo "OK: anótala en $PORTAL_URL/annotate/$IMAGE_ID"
