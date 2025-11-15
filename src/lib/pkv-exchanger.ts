import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { Keypair } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import type { LoginResponse } from '../proto/gen/es/exchange/v1/exchange_pb.js';
import keccak256 from 'keccak256';
import { MerkleTree } from 'merkletreejs';
import { digest } from 'multiformats';
import { codecs } from 'multiformats/basics';
import {
  ExchangeService,
  PaymentEnvironment,
} from '../proto/gen/es/exchange/v1/exchange_pb.js';
import {
  Codec,
  KvStoreService,
} from '../proto/gen/es/kvstore/v1/kvstore_pb.js';
import type { PeerInfo } from '@libp2p/interface';
import { encodeDID } from 'key-did-provider-ed25519';
import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { CID } from 'multiformats';
import { Helia } from '@helia/interface';
import * as dagPb from '@ipld/dag-pb';
import * as raw from 'multiformats/codecs/raw';
import { argon2id } from 'hash-wasm';
import { fromByteArray as b64encode, toByteArray as b64decode} from 'base64-js';

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

function asArrayBuffer(data: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data.slice(0);
  const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return view.slice().buffer;
}

export function computeMerkleRoot(cidStrings: string[]): string {
  const cids = cidStrings.map((x) => CID.parse(x));
  const bytes = cids.map((x) => keccak256(Buffer.from(x.bytes)));
  const mt = new MerkleTree(bytes, keccak256, {
    sortPairs: false,
    fillDefaultHash: () => Buffer.alloc(32, 0),
  });
  const keccak256MultiHash = 0x1b;
  const cidV1 = CID.createV1(
    codecs.raw.code,
    digest.create(keccak256MultiHash, mt.getRoot()),
  );
  return cidV1.toString();
}

export class ExchangeClient {
  keypair: Keypair;
  mnemonics: string;
  suiNetwork: PaymentEnvironment;

  client: SuiClient;
  constructor(suiNetwork: PaymentEnvironment, mnemonics: string) {
    this.suiNetwork = suiNetwork;
    let rpcUrl: string;
    this.mnemonics = mnemonics;
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
  async derivePassword(): Promise<string> {
    // TODO: read from user yaml not this hard-coded public one
    const argon2Salt = Uint8Array.from([
      0x5e, 0xc5, 0x57, 0xbd, 0x6f, 0x5d, 0xbb, 0xa2,
      0xf2, 0xba, 0x8c, 0xf7, 0x31, 0xc6, 0xc2, 0x5b,
      0xb8, 0x2a, 0x5e, 0x94, 0x52, 0x10, 0xae, 0x6e,
      0xe7, 0xe1, 0xa2, 0x06, 0xff, 0xa8, 0xe7, 0x5d,
    ]);
    // TODO: read from another field of user yaml
    const hkdfSalt = argon2Salt;
    const info = new TextEncoder().encode('password')
    const ikm = await argon2id({
      password: this.mnemonics,
      salt: argon2Salt,
      parallelism: 1,
      iterations: 3,
      memorySize: 64 * 1024,
      hashLength: 32,
      outputType: 'binary',
    });

    const baseKey = await crypto.subtle.importKey(
      "raw",
      asArrayBuffer(ikm),
      "HKDF",
      false,
      ['deriveBits']
    );

    const bits = await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: hkdfSalt,
        info,
      },
      baseKey,
      256,
    );
    return b64encode(new Uint8Array(bits));
  }
  async deriveUsernameAndPassword(): Promise<[string, string]> {
    return [
      encodeDID(this.keypair!.getPublicKey().toRawBytes()),
      await this.derivePassword(),
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
  async putRawBytes(
    exchangeHost: string,
    providerDid: string,
    value: Uint8Array,
    codec: Codec,
    ttlSeconds: bigint,
  ): Promise<string> {
    // FIXME: get from index or exchange
    const providerHost = 'http://localhost:50051'
    const sessionCreationJwt = await this.getExchangeQuotaToken(exchangeHost, providerDid, BigInt(10_000_000));
    const client = createClient(
      KvStoreService,
      createConnectTransport({
        baseUrl: providerHost,
      }),
    );
    const response = await client.createSession({
      jwt: sessionCreationJwt,
    });
    if (!response.jwt) {
      throw new Error(`got empty session token`);
    }
    const headers = new Headers();
    headers.set('Authorization', `Bearer ${response.jwt}`);
    const resourceName = await client.createValue(
      {
        codec: codec,
        value: value,
        ttl: {
          seconds: ttlSeconds,
        },
      },
      { headers: headers },
    );
    return resourceName.name;
  }
  async putMerkleDag(host: string, providerDid: string, helia: Helia, cid: CID, ttlSeconds: bigint): Promise<string[]> {
    let resourceNames = [];
    const block = await helia.blockstore.get(cid, { offline: true });
    if (cid.code === raw.code) {
      resourceNames.push(await this.putRawBytes(host, providerDid, block, 1, ttlSeconds));
    } else {
      resourceNames.push(await this.putRawBytes(host, providerDid, block, 2, ttlSeconds));
      const pbNode = dagPb.decode(block);
      for (const link of pbNode.Links) {
        const childResourceNames = await this.putMerkleDag(host, providerDid, helia, link.Hash, ttlSeconds);
        resourceNames.concat(childResourceNames);
      }
    }
    return resourceNames;
  }
}
