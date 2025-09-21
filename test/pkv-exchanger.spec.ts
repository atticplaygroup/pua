import { describe, it, beforeEach, expect } from 'vitest';
import { ExchangeClient } from '../src/lib/pkv-exchanger.js';
import { requestSuiFromFaucetV2 } from '@mysten/sui/faucet';
import { PaymentEnvironment } from '../src/proto/gen/es/exchange/v1/exchange_pb.js';
import type { Instance } from '../src/proto/gen/es/kvstore/v1/kvstore_pb.js';

const test_mnemonics =
  'wild shiver source slam trouble talent fantasy depart sleep burger fit trumpet';

describe('exchange client should work as expected', function () {
  let exchangeClient: ExchangeClient;
  let sellerExchangeClient: ExchangeClient;
  let exchange: Instance;
  let seller: Instance;
  const suiHost = 'http://127.0.0.1:9123';
  const host = 'http://127.0.0.1:50052';
  const hostMultiaddr = '/ip4/127.0.0.1/tcp/50052/http';
  const suiNetwork = PaymentEnvironment.LOCALNET;
  beforeEach(async () => {
    exchangeClient = new ExchangeClient(suiNetwork, test_mnemonics);
    exchange = {
      did: 'did:example:prex',
      multiaddrs: [hostMultiaddr],
      peerId: '',
      $typeName: 'kvstore.v1.Instance',
    };
    sellerExchangeClient = new ExchangeClient(suiNetwork, test_mnemonics);
    seller = {
      did: (await sellerExchangeClient.deriveUsernameAndPassword())[0],
      multiaddrs: ['/doesnt/matter/in/this/test'],
      peerId: '',
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
});
