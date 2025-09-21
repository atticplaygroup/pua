import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { Keypair } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import type { LoginResponse } from '../proto/gen/es/exchange/v1/exchange_pb.js';
import {
  ExchangeService,
  PaymentEnvironment,
} from '../proto/gen/es/exchange/v1/exchange_pb.js';
import type { PeerInfo } from '@libp2p/interface';
import { encodeDID } from 'key-did-provider-ed25519';
import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';

interface ExchangeAccount {
  accountId: bigint;
  balance: bigint;
}

function string2bytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

export interface InstanceAndAccessToken {
  instanceDid: string;
  quotaToken: string;
  instanceInfo: PeerInfo;
}

export class ExchangeClient {
  keypair: Keypair;
  suiNetwork: PaymentEnvironment;

  client: SuiClient;
  constructor(suiNetwork: PaymentEnvironment, mnemonics: string) {
    this.suiNetwork = suiNetwork;
    let rpcUrl: string;
    this.keypair = Ed25519Keypair.deriveKeypair(mnemonics);
    if (this.suiNetwork == PaymentEnvironment.DEVNET) {
      rpcUrl = getFullnodeUrl('devnet');
    } else if (this.suiNetwork == PaymentEnvironment.MAINNET) {
      rpcUrl = getFullnodeUrl('mainnet');
    } else if (this.suiNetwork == PaymentEnvironment.TESTNET) {
      rpcUrl = getFullnodeUrl('testnet');
    } else if (this.suiNetwork == PaymentEnvironment.LOCALNET) {
      rpcUrl = getFullnodeUrl('localnet');
    } else {
      const e = new Error(`Unknown network ${this.suiNetwork}`);
      console.error(e);
      throw e;
    }
    this.client = new SuiClient({ url: rpcUrl });
  }
  async getPaymentMethod(host: string): Promise<string> {
    const client = createClient(
      ExchangeService,
      createConnectTransport({
        baseUrl: host,
      }),
    );
    const paymentMethods = await client.listPaymentMethods({});
    if (!paymentMethods || !paymentMethods.paymentMethods) {
      throw new Error(`bad paymentMethods`);
    }
    for (const method of paymentMethods.paymentMethods) {
      if (method.environment === this.suiNetwork && method.address) {
        return method.address;
      }
    }
    throw new Error(`no payment method matching ${this.suiNetwork} found`);
  }
  async makeDeposit(host: string, initialDeposit: number): Promise<string> {
    const exchangeAddress = await this.getPaymentMethod(host);
    const tx = new Transaction();
    const [coin] = tx.splitCoins(tx.gas, [initialDeposit]);
    tx.transferObjects([coin], exchangeAddress);
    const result = await this.client.signAndExecuteTransaction({
      signer: this.keypair!,
      transaction: tx,
    });
    const response = await this.client.waitForTransaction({
      digest: result.digest,
    });
    if (response.errors) {
      throw new Error(`transfer sui got error ${response.errors}`);
    }
    return response.digest;
  }
  async getChallenge(host: string) {
    const client = createClient(
      ExchangeService,
      createConnectTransport({
        baseUrl: host,
      }),
    );
    const challengeResponse = await client.getChallenge({
      address: this.keypair.toSuiAddress(),
    });
    if (!challengeResponse || !challengeResponse.challenge) {
      throw new Error(`bad challengeResponse`);
    }
    const { bytes, signature } = await this.keypair!.signPersonalMessage(
      challengeResponse.challenge,
    );
    return {
      challenge: bytes,
      signature: signature,
      startTime: challengeResponse.startTime!,
    };
  }
  async deriveUsernameAndPassword(): Promise<[string, string]> {
    return [
      encodeDID(this.keypair!.getPublicKey().toRawBytes()),
      'test_password', // TODO: Use some KDF
    ];
  }
  async registerExchangeAccount(
    host: string,
    initialDeposit: number,
  ): Promise<ExchangeAccount> {
    const digest = await this.makeDeposit(host, initialDeposit);
    const challengeResponse = await this.getChallenge(host);
    const [username, password] = await this.deriveUsernameAndPassword();
    const challengeBytes = string2bytes(challengeResponse.challenge);
    const client = createClient(
      ExchangeService,
      createConnectTransport({
        baseUrl: host,
      }),
    );
    const response = await client.deposit({
      username,
      password,
      ttl: {
        seconds: BigInt(86400),
      }, // TODO: set the ttl wisely
      proof: {
        chainDigest: digest,
        startTime: challengeResponse.startTime,
        challenge: challengeBytes,
        signature: challengeResponse.signature,
      },
    });
    if (!response.account?.accountId || !response.account?.balance) {
      throw new Error(`malformed deposit response`);
    }
    return {
      accountId: response.account?.accountId,
      balance: response.account?.balance,
    };
  }
  async loginExchangeAccount(host: string): Promise<LoginResponse> {
    const [username, password] = await this.deriveUsernameAndPassword();
    const client = createClient(
      ExchangeService,
      createConnectTransport({
        baseUrl: host,
      }),
    );
    const response = await client.login({
      username,
      password,
    });
    return response;
  }
  async getExchangeQuotaToken(
    host: string,
    providerDid: string,
    quantity: bigint,
  ): Promise<string> {
    let loginResponse;
    try {
      loginResponse = await this.loginExchangeAccount(host);
    } catch (e) {
      console.warn(`login failed: ${JSON.stringify(e)}`);
      // Account does not exist. Register then login again.
      await this.registerExchangeAccount(host, 10_000_000_000);
      loginResponse = await this.loginExchangeAccount(host);
    }

    const req = {
      amount: quantity,
      audience: providerDid,
    };
    const headers = new Headers();
    headers.set('Authorization', `Bearer ${loginResponse.accessToken}`);
    const client = createClient(
      ExchangeService,
      createConnectTransport({
        baseUrl: host,
      }),
    );
    const response = await client.buyToken(req, {
      headers: headers,
    });
    if (!response.token) {
      throw new Error(`empty token`);
    }
    return response.token;
  }
}
