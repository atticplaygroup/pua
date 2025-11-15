import { describe, it, beforeEach, expect } from 'vitest';
import { ExchangeClient, computeMerkleRoot } from '../src/lib/pkv-exchanger.js';
import { requestSuiFromFaucetV2 } from '@mysten/sui/faucet';
import { ExchangeService, PaymentEnvironment } from '../src/proto/gen/es/exchange/v1/exchange_pb.js';
import { CoinEnvironment, CoinType, CoinTypeSchema, KvStoreService, type Instance, type ProviderAdvertise } from '../src/proto/gen/es/kvstore/v1/kvstore_pb.js';
import { createHeliaHTTP } from '@helia/http';
import { unixfs } from '@helia/unixfs';
import { readFile } from 'node:fs/promises';
import { createConnectTransport } from '@connectrpc/connect-web';
import { createClient } from '@connectrpc/connect';
import { CID } from 'multiformats';

const buyerMnemonics =
  'wild shiver source slam trouble talent fantasy depart sleep burger fit trumpet';
const sellerMnemonics =
  'clog claw carpet funny popular power output reopen park wing actress time';

describe('exchange client should work as expected', function () {
  let exchangeClient: ExchangeClient;
  let sellerExchangeClient: ExchangeClient;
  let exchange: Instance;
  let seller: Instance;
  const suiHost = 'http://127.0.0.1:9123';
  const host = 'http://127.0.0.1:50052';
  const sellerHost = 'http://127.0.0.1:50051';
  const hostMultiaddr = '/ip4/127.0.0.1/tcp/50052/http';
  const suiNetwork = PaymentEnvironment.LOCALNET;

  let merkleDagCids: string[];
  beforeEach(async () => {
    exchangeClient = new ExchangeClient(suiNetwork, buyerMnemonics);
    exchange = {
      did: 'did:example:prex',
      multiaddrs: [hostMultiaddr],
      peerId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      $typeName: 'kvstore.v1.Instance',
    };
    sellerExchangeClient = new ExchangeClient(suiNetwork, sellerMnemonics);
    seller = {
      did: (await sellerExchangeClient.deriveUsernameAndPassword())[0],
      multiaddrs: ['/ip4/127.0.0.1/tcp/50051/http'],
      peerId: '12D3KooWKiX28sD5zRiHgdwuNAgikjrHzKE7KaeWeN55DAUKMJnz',
      $typeName: 'kvstore.v1.Instance',
    };
  });
  it('should init successfully', () => {
    expect(exchangeClient.keypair).to.not.be.undefined;
  });
  it('should get payment method', async () => {
    const paymentAddress = await exchangeClient.getPaymentMethod(host);
    expect(paymentAddress).to.not.be.undefined;
  });
  it('should make deposit', async () => {
    for (const client of [exchangeClient, sellerExchangeClient]) {
      const faucetResponse = await requestSuiFromFaucetV2({
        host: suiHost,
        recipient: client.keypair!.toSuiAddress(),
      });
      expect(faucetResponse.status).to.equal('Success');
      const digest = await client.makeDeposit(host, 10_000_000_000);
      expect(digest).to.not.be.undefined;
      expect(digest.length).to.be.oneOf([43, 44]);
    }
  });
  it('should get challenge', async () => {
    for (const client of [exchangeClient, sellerExchangeClient]) {
      const challengeResponse = await client.getChallenge(host);
      expect(challengeResponse.challenge.length).to.be.oneOf([43, 44]);
    }
  });
  it('should register account', async () => {
    for (const client of [exchangeClient, sellerExchangeClient]) {
      const faucetResponse = await requestSuiFromFaucetV2({
        host: suiHost,
        recipient: client.keypair!.toSuiAddress(),
      });
      expect(faucetResponse.status).to.equal('Success');
      const account = await client.registerExchangeAccount(
        host,
        10_000_000_000
      );
      expect(Number(account.accountId)).to.be.greaterThan(0);
    }
  });
  it('should login', async () => {
    const response = await exchangeClient.loginExchangeAccount(host);
    expect(Number(response.account?.accountId)).to.be.greaterThan(0);
  });
  it('should get exchange quota token', async () => {
    const token = await exchangeClient.getExchangeQuotaToken(
      host,
      seller.did!,
      BigInt(100)
    );
    expect(token).to.not.be.undefined;
  });
  it('should derive password', async() => {
    expect(exchangeClient.keypair).toBeDefined();
    expect(exchangeClient.keypair.toSuiAddress()).to.eq('0xba34c1fc825e7aa7e1dc73e7093a7837b077467afbfa52af83ff7db34b8c96f9');
    const [username, password] = await exchangeClient.deriveUsernameAndPassword();
    expect(username).to.eq('did:key:z6MkkiXi5iJxVWrCXs9r77Rgqfc87KmzdWYmhe2YSeb5DnbV');
    expect(password).to.eq('00lcp23N39+Nic0uw48oJbYbRxsBxGGcA8ojPGaGo9Q=');
  })
  it('should put content', async () => {
    const dataBuf = await readFile(`${__dirname}/../../video/assets/bbb_00000.mp4`);
    const data = new Uint8Array(dataBuf);
    const sellerMnemonics = 'clog claw carpet funny popular power output reopen park wing actress time';
    const sellerClient = new ExchangeClient(exchangeClient.suiNetwork, sellerMnemonics);
    const sellerAccount = await sellerClient.registerExchangeAccount(host, 10_000_000_000);
    expect(sellerAccount.accountId).toBeGreaterThan(0);
    const [sellerDid, _] = await sellerClient.deriveUsernameAndPassword();
    const helia = await createHeliaHTTP();
    const ufs = unixfs(helia);
    const cid = await ufs.addBytes(data);
    const resourceNames = await exchangeClient.putMerkleDag(host, sellerDid, helia, cid, BigInt(86400));
    console.log(`resourceNames: ${JSON.stringify(resourceNames)}`);
    expect(resourceNames.length).to.be.greaterThan(0);
    for (const resourceName of resourceNames) {
      const [prefix, cidString] = resourceName.split('/')
      expect(prefix).toEqual('values');
      expect(CID.parse(cidString).version).toEqual(1);
    }
    merkleDagCids = resourceNames.map(
      (x) => x.split('/')[1]
    );
  });
  it('should compute merkle root', async () => {
    const mtRoot = computeMerkleRoot([
      'bafkreiavcs6vzwpfmzbgmv7tqznntxt5o2hrnlyljnl4pdtn4rtk7ux664',
      'bafkreiepisknsjkso33wxxta5i7voiyzulfrghh2uryxyd5ptin7v5rbva',
      'bafkreiep756fqmdgp2klajv25feea4txal7uuixiskz676d62oma7gndzu',
      'bafkreibaxl6z3plfboy4ufbfdultkkn7dyvoouv4o2luhhddcmxtsjyfue',
      'bafkreicigr2y3oxhbj3ruqv47guz34arud62uhdeh7n6k7sh6ic55w6lgq',
      'bafybeievlej43fqr3jrfqmkviqdmnkdf7hv3fa22ll4ln7m6czjc22q5xe',
      'bafkreiczu3hchqxcnpt4mjvktbo6qtn4uo5zqazgzkvt26scve222oz4ke'
    ]);
    expect(mtRoot).toEqual('bafkreidy4rgd74uu56zt22bruidwzyicqqakgfguhtb3dkuvo7kg4z6sri');
  })
  it('should register provider instance', async () => {
    const client = createClient(
      KvStoreService,
      createConnectTransport({
        baseUrl: sellerHost,
      }),
    );

    const mtRoot = computeMerkleRoot(merkleDagCids);
    const now = new Date();
    const expireTime = new Date(now.getTime() + (1000 * 60 * 60 * 24));
    const time1970 = new Date('1970-01-01T00:00:00Z');
    const ad: ProviderAdvertise = {
      providerInstance: seller,
      virtualService: {
        behaviorLink: {
          name: 'serve_all',
          maintainer: 'did:example:foo',
          version: 'v0.1.0',
          $typeName: 'kvstore.v1.GlobalLink',
          description: '',
          displayName: '',
          signature: '',
        },
        variantLink: {
          name: mtRoot,
          // Not necessarily be the same as seller who can provider service for contents proposed by others
          maintainer: 'did:example:proposer',
          version: 'v0.1.0',
          $typeName: 'kvstore.v1.GlobalLink',
          description: '',
          displayName: '',
          signature: '',
        },
        $typeName: 'kvstore.v1.VirtualService',
      },
      cids: merkleDagCids,
      price: BigInt(100),
      coinType: CoinType.SUI,
      coinEnvironment: CoinEnvironment.LOCALNET,
      exchanges: [exchange],
      expireTime: {
        seconds: BigInt(expireTime.getTime() - time1970.getTime()) / 1000n,
        nanos: 0,
        $typeName: 'google.protobuf.Timestamp',
      },
      updateTime: {
        seconds: BigInt(now.getTime() - time1970.getTime()) / 1000n,
        nanos: 0,
        $typeName: 'google.protobuf.Timestamp',
      },
      signature: 'todo',
      $typeName: 'kvstore.v1.ProviderAdvertise',
      pricingDetails: 'todo',
    }
    // In practice use a cache for session tokens
    const token = await exchangeClient.getExchangeQuotaToken(host, seller.did, BigInt(10_000_000));
    expect(token).toBeDefined();
    console.log(`token: ${token}`);
    const sessionToken = await client.createSession({
      jwt: token,
    });
    expect(sessionToken.jwt).toBeDefined();
    const headers = new Headers();
    headers.set('Authorization', `Bearer ${sessionToken.jwt}`);
    await client.registerInstance({
      advertisement: ad,
    }, {
      headers: headers,
    });
  })
});
