#!/bin/bash

set -euxo pipefail

workspace=/workspaces/ts-dev/pua
export scripts_dir=${workspace}/scripts

export PATH=${PATH}:${workspace}/bin

SUI_NETWORK=localnet

RUN_SERVER=true

if [ ${SUI_NETWORK} = 'localnet' ]; then
  [ ${RUN_SERVER} = 'true' ] && (
    bash ${scripts_dir}/start-localnet.sh &
    sleep 30
  )
  SUI_URL=http://127.0.0.1:9000
elif [ ${SUI_NETWORK} = 'devnet' ]; then
  SUI_URL=https://sui-devnet.mystenlabs.com
else
  echo "Unknown ${SUI_NETWORK}"
  exit 1
fi

sui keytool import 'wild shiver source slam trouble talent fantasy depart sleep burger fit trumpet' ed25519
echo "y
${SUI_URL}
${SUI_NETWORK}
0" | ${workspace}/bin/sui client switch --address 0xba34c1fc825e7aa7e1dc73e7093a7837b077467afbfa52af83ff7db34b8c96f9
sui client faucet

sql-migrate down
sql-migrate up

[ ${RUN_SERVER} = 'true' ] && (
  ${workspace}/bin/prex server gateway --bind-port=3001 --grpc-port=50052 &
  ${workspace}/bin/prex server connect &
  ${workspace}/bin/pkv &
  ${workspace}/bin/gateway &
)

TEMP_DIR=$(mktemp -d)

PREX_URL=localhost:3001
PKV_URL=localhost:3000
export PREX_URL
sleep 3
curl --fail -s "http://${PREX_URL}/v1/ping" | jq .pong || exit 1

bash ${scripts_dir}/register-account.sh ${TEMP_DIR}/seller.yml

SELLER_DID=$(prex client account -c=${TEMP_DIR}/seller.yml | jq -r .username)
QUANTITY=100
SESSION_CREATION_TOKEN=$(bash ${scripts_dir}/buy-token.sh ${TEMP_DIR}/seller.yml ${SELLER_DID} ${QUANTITY} | jq -r .token)

SESSION_JWT=$(curl --fail -s -H "Content-Type: application/json" -d '{
  "jwt": "'"${SESSION_CREATION_TOKEN}"'"
}' "http://${PKV_URL}/v1/sessions:create" | jq -r .jwt)
[ -n "${SESSION_JWT}" ] || exit 1

python3 -c 'contents = [
    0xdd, 0x79, 0xb5, 0x2c, 0x74, 0x3c, 0x1c, 0x9e, 0x83, 0xd0, 0x38, 0x20,
    0xcf, 0x27, 0xf4, 0x0d,
]; open("/tmp/test-file", "wb").write(bytes(contents))'

# RESOURCE=$(curl --fail -s -H "Content-Type: application/json" \
#   -H "Authorization: Bearer ${SESSION_JWT}" \
#   -d '{
#     "value": "'$(cat /tmp/test-file | base64 -w 0)'",
#     "ttl": "24h"
#   }' "http://${PKV_URL}/v1/values:create")

RESOURCE=$(grpcurl -plaintext \
  -H "Authorization: Bearer ${SESSION_JWT}" \
  -d '{"value": "'$(cat /tmp/test-file | base64 -w 0)'", "ttl": "24h"}' \
  localhost:50051 kvstore.v1.KvStoreService/CreateValue)

[ -n "${RESOURCE}" ] || exit 1

cid=$(echo "${RESOURCE}" | jq -r .name | awk -F/ '{print $2}')
# bafkreiepisknsjkso33wxxta5i7voiyzulfrghh2uryxyd5ptin7v5rbva

curl --fail -s -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SESSION_JWT}" \
  -d '{
    "advertisement": {
      "providerInstance": {
        "did": "'"${SELLER_DID}"'",
        "ID": "12D3KooWKiX28sD5zRiHgdwuNAgikjrHzKE7KaeWeN55DAUKMJnz",
        "Addrs": [
          "/ip4/127.0.0.1/tcp/50051/http"
        ]
      },
      "virtualService": {
        "behaviorLink": {
          "name": "serve_all",
          "maintainer": "did:example:foo",
          "version": "v0.1.0"
        },
        "variantLink": {
          "name": "bafkreifx77vplgjib3jfpdobqcuwwyz2xmpvoxyaqgbz5qqzj4r4tyyzcu",
          "maintainer": "did:example:proposer",
          "version": "v0.1.0"
        }
      },
      "cids": ["bafkreiepisknsjkso33wxxta5i7voiyzulfrghh2uryxyd5ptin7v5rbva"],
      "price": 100,
      "coinType": 1,
      "coinEnvironment": 4,
      "exchanges": [
        {
          "did": "did:key:z6MktULudTtAsAhRegYPiZ6631RV3viv12qd4GQF8z1xB22S",
          "ID": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "multiaddrs": [
            "/ip4/127.0.0.1/tcp/50052/http"
          ]
        }
      ],
      "expireTime": "'$(date -d tomorrow +%Y-%m-%dT%H:%M:%S.0000Z)'",
      "updateTime": "'$(date +%Y-%m-%dT%H:%M:%S.0000Z)'",
      "signature": "todo"
    }
  }' "http://${PKV_URL}/v1/instance:register"

curl http://${PKV_URL}/v1/searchCid?cid=${cid}
echo

curl http://${PKV_URL}/routing/v1/providers/${cid}
echo

pnpm run build
pnpm test

[ ${RUN_SERVER} = 'true' ] && (
  [ ${SUI_NETWORK} = 'localnet' ] && (
    pgrep sui | xargs kill
  )

  pgrep prex | xargs kill
  pgrep pkv | xargs kill
  pgrep gateway | xargs kill
)
