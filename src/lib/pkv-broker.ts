import type { BlockBroker, BlockRetrievalOptions } from '@helia/interface';
import type { CID } from 'multiformats/cid';
import { multiaddrToUri } from '@multiformats/multiaddr-to-uri';
import type {
  TrustlessGatewayBlockBrokerComponents,
  TrustlessGatewayBlockBrokerInit,
} from '@helia/block-brokers';
import type { Routing } from '@helia/interface';
import { ExchangeClient } from './pkv-exchanger.js';
import { PaymentEnvironment } from '../proto/gen/es/exchange/v1/exchange_pb.js';
import { KvStoreService } from '../proto/gen/es/kvstore/v1/kvstore_pb.js';
import type { ProviderAdvertise } from '../proto/gen/es/kvstore/v1/kvstore_pb.js';
import { BiddingAgent } from './pkv-bidding-agent.js';
import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';

type PkvBlockBrokerComponent = TrustlessGatewayBlockBrokerComponents;

export interface PkvBlockBrokerInit extends TrustlessGatewayBlockBrokerInit {
  paymentEnvironment: PaymentEnvironment;
  mnemonics: string;
}

class PkvBlockBroker implements BlockBroker {
  routing: Routing;
  exchanger: ExchangeClient;
  agent: BiddingAgent;
  constructor(components: PkvBlockBrokerComponent, init: PkvBlockBrokerInit) {
    console.log(`PkvBlockBroker constructor called: ${JSON.stringify(init)}`);
    this.exchanger = new ExchangeClient(
      init.paymentEnvironment,
      init.mnemonics,
    );
    this.routing = components.routing;
    this.agent = new BiddingAgent();
  }
  async getSessionJwt(provider: ProviderAdvertise): Promise<string> {
    const providerInstance = provider.providerInstance;
    // TODO: add caching to reuse sessions
    for (const kvindex of providerInstance!.multiaddrs) {
      const host = multiaddrToUri(kvindex);
      for (const exchange of provider.exchanges!) {
        const exchangeInstance = exchange;
        for (const exchangeAddr of exchangeInstance.multiaddrs) {
          const sessionCreationJwt = await this.exchanger.getExchangeQuotaToken(
            multiaddrToUri(exchangeAddr),
            providerInstance!.did!,
            // TODO: add provider info for agent decision
            this.agent.getQuantity({
              behaviorLink: {
                name: 'serve_all',
                maintainer: 'did:example:foo',
                version: 'v0.1.0',
                $typeName: 'kvstore.v1.GlobalLink',
                description: '',
                displayName: '',
                signature: '',
              },
              variantLink: undefined,
              $typeName: 'kvstore.v1.VirtualService',
            }),
          );
          const client = createClient(
            KvStoreService,
            createConnectTransport({
              baseUrl: host,
            }),
          );
          const response = await client.createSession({
            jwt: sessionCreationJwt,
          });
          if (!response.jwt) {
            throw new Error(`got empty jwt without raising error`);
          }
          return response.jwt;
        }
      }
    }
    throw new Error(`no multiaddrs succeeded to create session token`);
  }
  async retrieve(
    cid: CID,
    options?: BlockRetrievalOptions,
  ): Promise<Uint8Array> {
    console.log(`PkvBlockBroker.retrieve called: cid: ${cid.toString()}`);
    for await (const provider of this.routing.findProviders(cid, options)) {
      for (const kvindex of provider.multiaddrs) {
        const host = multiaddrToUri(kvindex);
        const client = createClient(
          KvStoreService,
          createConnectTransport({
            baseUrl: host,
          }),
        );
        const response = await client.searchCid({ cid: cid.toString() });
        if (!response.storageInstances) {
          throw new Error(
            'kvindex returned empty storage instances without raising error',
          );
        }
        for (const detailedProvider of response.storageInstances) {
          if (!detailedProvider.exchanges) {
            // TODO: Skipping invalid providers is a more desired behavior in the future.
            throw new Error(`got empty exchanges of a provider`);
          }
          const headers = new Headers();
          headers.set(
            'Authorization',
            `Bearer ${await this.getSessionJwt(detailedProvider)}`,
          );
          const client = createClient(
            KvStoreService,
            createConnectTransport({
              baseUrl: host,
            }),
          );
          const valueResponse = await client.getValue(
            {
              name: `values/${cid.toString()}`,
            },
            {
              headers: headers,
            },
          );
          if (!valueResponse.value) {
            throw new Error(`got empty value without raising error`);
          }
          return valueResponse.value;
        }
      }
    }
    throw new Error(`cannot retrieve after all instance tried`);
  }
}

export function pkvBlockBroker(
  init: PkvBlockBrokerInit = {
    paymentEnvironment: PaymentEnvironment.DEVNET,
    mnemonics:
      'wild shiver source slam trouble talent fantasy depart sleep burger fit trumpet',
  },
): (components: PkvBlockBrokerComponent) => BlockBroker {
  return (components) => new PkvBlockBroker(components, init);
}
