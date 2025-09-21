import type { VirtualService } from '../proto/gen/es/kvstore/v1/kvstore_pb.js';

export class BiddingAgent {
  // TODO: sort the services by the information they provide for example deal price
  getBidPrice(service: VirtualService): bigint {
    // TODO: implement
    return BigInt(1000);
  }
  getQuantity(service: VirtualService): bigint {
    return BigInt(1000);
  }
}
