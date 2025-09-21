import { delegatedHTTPRouting } from '@helia/routers';
import type { Helia } from '@helia/interface';
import { describe, it, beforeEach, expect } from 'vitest';
import { pkvBlockBroker } from '../src/lib/pkv-broker.js';
import type { VerifiedFetch } from '@helia/verified-fetch';
import { createVerifiedFetch } from '@helia/verified-fetch';
import { CID } from 'multiformats';
import { trustlessGateway } from '@helia/block-brokers';
import { codecs } from 'multiformats/basics';
import { digest } from 'multiformats';
import { sha256 } from 'multiformats/hashes/sha2';
import { PaymentEnvironment } from '../src/proto/gen/es/exchange/v1/exchange_pb.js';
import { createHeliaHTTP } from '@helia/http';

describe('broker verified fetch', async () => {
  let helia: Helia;
  let vFetch: VerifiedFetch;
  const fileContent = Uint8Array.from([
    0xdd, 0x79, 0xb5, 0x2c, 0x74, 0x3c, 0x1c, 0x9e, 0x83, 0xd0, 0x38, 0x20,
    0xcf, 0x27, 0xf4, 0x0d,
  ]);

  // Not necessarily the same as the storage provider but for convenience use the same
  const PKV_URL = 'http://localhost:3000';

  beforeEach(async () => {
    helia = await createHeliaHTTP({
      routers: [
        delegatedHTTPRouting(PKV_URL, {
          timeout: 1_000_000,
        }),
      ],
      // blockBrokers: [
      //   trustlessGateway({
      //     allowInsecure: true,
      //     allowLocal: true,
      //   }),
      // ],
      blockBrokers: [
        pkvBlockBroker({
          paymentEnvironment: PaymentEnvironment.LOCALNET,
          mnemonics:
            'wild shiver source slam trouble talent fantasy depart sleep burger fit trumpet',
        }),
      ],
    });
    vFetch = await createVerifiedFetch(helia);
  });

  it('should fetch content', async () => {
    const fileDigest = await sha256.encode(fileContent);
    const cidV1 = CID.createV1(
      codecs.raw.code,
      digest.create(sha256.code, fileDigest)
    );
    const cid = cidV1.toString();

    for await (const provider of helia.routing.findProviders(CID.parse(cid))) {
      expect(provider.multiaddrs).to.have.length(1);
      break;
    }

    const response = await vFetch(`ipfs://${cid}`);
    expect(response.status).to.equal(200);
    const blob = await response.blob();
    const actualFileContent = await blob.bytes();
    expect(actualFileContent).to.deep.equal(fileContent);
  });
});
