# PUA - Paid User Agent

This is a library acting as a [Block Broker](https://www.npmjs.com/package/@helia/block-brokers)
in [Helia](https://github.com/ipfs/helia).
You may use it with Helia's [Verified Fetch](https://github.com/ipfs/helia-verified-fetch)
to get blocks from [Pkv](https://github.com/atticplaygroup/pkv) with these benefits:

- Automatic exchange selection based on their reputation
- Automatic service provider selection based on their prices and reputation
- Automatic payment to those services

> [!CAUTION]
> The library is in active development. It does not guarantee a smart spending now.
> You may unexpectedly spend a lot if you use mainnet tokens.
> We will improve its spending on the way.

## Usage

Initialize it with mnemonics, which should already have money in it.
If not, please deposit from mainnet or get from faucet,
with some tools beyond the scope of this library,
for example a [Sui wallet](https://blog.sui.io/sui-wallets/).

Storing mnemonics in browser can be dangerous but is acceptable for our usage.
See a discussion on this topic [here](https://github.com/atticplaygroup/prex/wiki/paid-service#permissionless).

```typescript
import { pkvBlockBroker, PaymentEnvironment } from '@atticplaygroup/pua';

const pkvBlockBrokerInstance = pkvBlockBroker({
  paymentEnvironment: PaymentEnvironment.DEVNET,
  mnemonics:
    'wild shiver source slam trouble talent fantasy depart sleep burger fit trumpet',
});
```

Then create use Helia's verified fetch to fetch an IPFS file.

```typescript
import type { VerifiedFetch } from '@helia/verified-fetch';
import { createVerifiedFetch } from '@helia/verified-fetch';
import { createHeliaHTTP } from '@helia/http';
import { delegatedHTTPRouting } from '@helia/routers';

async function initVerifiedFetch(): Promise<VerifiedFetch> {
  // Delegated routing provider URL.
  // It can be a public one run by 3rd parties like https://delegated-ipfs.dev
  // It does not need to be the same as the storage provider.
  // Helia will find a storage provider itself.
  const PKV_URL = 'http://localhost:3000';
  const helia = await createHeliaHTTP({
    routers: [
      delegatedHTTPRouting(PKV_URL, {
        timeout: 1_000_000,
      }),
    ],
    blockBrokers: [pkvBlockBrokerInstance],
  });
  return await createVerifiedFetch(helia);
}

async function main() {
  const vFetch = await initVerifiedFetch();
  const response = await vFetch(
    'ipfs://bafkreiepisknsjkso33wxxta5i7voiyzulfrghh2uryxyd5ptin7v5rbva',
  );
  const blob = await response.blob();
  console.log(blob.bytes());
}
```

## Tests

Currently tests require a setup written in bash script. Later we will write an e2e test purely in typescript.

First prepare binaries in the `bin/` folder.

```
bin
├── buf
├── gateway
├── pkv
├── prex
├── sql-migrate
└── sui
```

Get `gateway`, `pkv` from `cmd/gateway/gateway.go` and `cmd/pkv/pkv.go`
from the [Pkv](https://github.com/atticplaygroup/pkv) project,
and `prex` from `main.go` of the [Prex](https://github.com/atticplaygroup/prex) project.

Get `buf` by `go install github.com/bufbuild/buf/cmd/buf@latest`.
And `sql-migrate` from `https://github.com/rubenv/sql-migrate`.

You don't need a local sui binary if you want to use devnet.

Then run the tests:

```bash
cd scripts
bash run-tests.sh
```
