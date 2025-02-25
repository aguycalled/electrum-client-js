const SocketClient = require('../socket/socket_client')
const util = require('./util')

const keepAliveInterval = 120 * 1000 // 2 minutes

class ElectrumClient extends SocketClient {
  constructor(host, port, protocol, options) {
    super(host, port, protocol, options)
  }

  async connect(clientName, electrumProtocolVersion, persistencePolicy = null) {
    this.persistencePolicy = persistencePolicy

    this.timeLastCall = 0
    this.clientName = clientName;
    this.protocolVersion = electrumProtocolVersion || '1.4';
    this.persistencePolicy = persistencePolicy;

    if (this.status === 0) {
      try {
        // Connect to Electrum Server.
        await super.connect()

        // Negotiate protocol version.
        const version = await this.server_version(clientName || 'electrum-js', electrumProtocolVersion || '1.4')
        console.log(`Negotiated version: [${version}]`)

        this.onReady()

        // Get banner.
        const banner = await this.server_banner()
        console.log(banner)
      } catch (err) {
        this.onError(`failed to connect to electrum server: [${err}]`)
      }

      this.keepAlive()
    }
  }

  async request(method, params) {
    if (this.status === 0) {
      throw new Error('connection not established')
    }

    this.timeLastCall = new Date().getTime()

    const response = new Promise((resolve, reject) => {
      const id = ++this.id

      const content = util.makeRequest(method, params, id)

      this.callback_message_queue[id] = util.createPromiseResult(resolve, reject)

      this.client.send(content + '\n')
    })

    return await response
  }

  /**
   * Ping the server to ensure it is responding, and to keep the session alive.
   * The server may disconnect clients that have sent no requests for roughly 10
   * minutes. It sends a ping request every 2 minutes. If the request fails it
   * logs an error and closes the connection.
   */
  async keepAlive() {
    if (this.timeout != null) {
      clearTimeout(this.timeout);
    }
    this.timeout = setTimeout(() => {
      if (this.timeLastCall !== 0 && new Date().getTime() > this.timeLastCall + 5000) {
        const pingTimer = setTimeout(() => {
          this.onError(new Error('keepalive ping timeout'));
        }, 9000);
        this.server_ping().catch((reason) => {
          console.log('keepalive ping failed because of', reason);
          clearTimeout(pingTimer);
        }).then(() => clearTimeout(pingTimer));
      }
    }, 5000);
  }

  close() {
    return super.close()
  }

  onClose() {
    super.onClose()

    const list = [
      'server.peers.subscribe',
      'blockchain.numblocks.subscribe',
      'blockchain.headers.subscribe',
      'blockchain.address.subscribe',
    ]

    // TODO: We should probably leave listeners if the have persistency policy.
    //list.forEach((event) => this.subscribe.removeAllListeners(event))

    // Stop keep alive.
    clearInterval(this.keepAliveHandle)

    setTimeout(() => {
      if (this.persistencePolicy != null && this.persistencePolicy.maxRetry > 0) {
        this.reconnect();
        this.persistencePolicy.maxRetry -= 1;
      } else if (this.persistencePolicy != null && this.persistencePolicy.callback != null) {
        this.persistencePolicy.callback();
      } else if (this.persistencePolicy == null) {
        this.reconnect();
      }
    }, 1000);
  }

  reconnect() {
    console.log('electrum reconnect');
    try {
      return this.connect(this.clientName, this.protocolVersion, this.persistencePolicy);
    } catch (e) {
      console.log('Failed to reconnect: '+e);
    }
  }

  // TODO: Refactor persistency
  // reconnect() {
  //   return this.initElectrum(this.electrumConfig);
  // }

  // ElectrumX API
  //
  // Documentation:
  // https://electrumx.readthedocs.io/en/latest/protocol-methods.html
  //
  server_version(client_name, protocol_version) {
    return this.request('server.version', [client_name, protocol_version])
  }
  server_banner() {
    return this.request('server.banner', [])
  }
  server_ping() {
    return this.request('server.ping', [])
  }
  server_addPeer(features) {
    return this.request('server.add_peer', [features])
  }
  server_donation_address() {
    return this.request('server.donation_address', [])
  }
  server_features() {
    return this.request('server.features', [])
  }
  server_peers_subscribe() {
    return this.request('server.peers.subscribe', [])
  }
  blockchain_address_getProof(address) {
    return this.request('blockchain.address.get_proof', [address])
  }
  blockchain_dotnav_resolveName(name, subdomains) {
    return this.request('blockchain.dotnav.resolve_name', [name, subdomains])
  }
  blockchain_scripthash_getBalance(scripthash) {
    return this.request('blockchain.scripthash.get_balance', [scripthash])
  }
  blockchain_scripthash_getHistory(scripthash, height = 0, to_height = -1) {
    if (this.protocolVersion == '1.5') {
      return this.request('blockchain.scripthash.get_history', [scripthash, height, to_height])
    } else {
      return this.request('blockchain.scripthash.get_history', [scripthash])
    }
  }
  blockchain_scripthash_getMempool(scripthash) {
    return this.request('blockchain.scripthash.get_mempool', [scripthash])
  }
  blockchain_scripthash_listunspent(scripthash) {
    return this.request('blockchain.scripthash.listunspent', [scripthash])
  }
  blockchain_scripthash_subscribe(scripthash) {
    return this.request('blockchain.scripthash.subscribe', [scripthash])
  }
  blockchain_outpoint_subscribe(hash, out) {
    return this.request('blockchain.outpoint.subscribe', [hash, out])
  }
  blockchain_stakervote_subscribe(scripthash) {
    return this.request('blockchain.stakervote.subscribe', [scripthash])
  }
  blockchain_consensus_subscribe() {
    return this.request('blockchain.consensus.subscribe', [])
  }
  blockchain_dao_subscribe() {
    return this.request('blockchain.dao.subscribe', [])
  }
  blockchain_scripthash_unsubscribe(scripthash) {
    return this.request('blockchain.scripthash.unsubscribe', [scripthash])
  }
  blockchain_outpoint_unsubscribe(hash, out) {
    return this.request('blockchain.outpoint.unsubscribe', [hash, out])
  }
  blockchain_block_header(height, cpHeight = 0) {
    return this.request('blockchain.block.header', [height, cpHeight])
  }
  blockchain_block_headers(startHeight, count, cpHeight = 0) {
    return this.request('blockchain.block.headers', [startHeight, count, cpHeight])
  }
  blockchainEstimatefee(number) {
    return this.request('blockchain.estimatefee', [number])
  }
  blockchain_headers_subscribe() {
    return this.request('blockchain.headers.subscribe', [])
  }
  blockchain_relayfee() {
    return this.request('blockchain.relayfee', [])
  }
  blockchain_transaction_broadcast(rawtx) {
    return this.request('blockchain.transaction.broadcast', [rawtx])
  }
  blockchain_transaction_get(tx_hash, verbose) {
    return this.request('blockchain.transaction.get', [tx_hash, verbose ? verbose : false])
  }
  blockchain_transaction_getKeys(tx_hash) {
    return this.request('blockchain.transaction.get_keys', [tx_hash])
  }
  blockchain_staking_getKeys(spending_pkh) {
    return this.request('blockchain.staking.get_keys', [spending_pkh])
  }
  blockchain_token_getToken(id) {
    return this.request('blockchain.token.get_token', [id])
  }
  blockchain_token_getNft(id, subid, get_utxo) {
    return this.request('blockchain.token.get_nft', [id, subid, get_utxo ? get_utxo : false])
  }
  blockchain_transaction_getMerkle(tx_hash, height) {
    return this.request('blockchain.transaction.get_merkle', [tx_hash, height])
  }
  mempool_getFeeHistogram() {
    return this.request('mempool.get_fee_histogram', [])
  }
  // ---------------------------------
  // protocol 1.1 deprecated method
  // ---------------------------------
  blockchain_utxo_getAddress(tx_hash, index) {
    return this.request('blockchain.utxo.get_address', [tx_hash, index])
  }
  blockchain_numblocks_subscribe() {
    return this.request('blockchain.numblocks.subscribe', [])
  }
  // ---------------------------------
  // protocol 1.2 deprecated method
  // ---------------------------------
  blockchain_block_getChunk(index) {
    return this.request('blockchain.block.get_chunk', [index])
  }
  blockchain_address_getBalance(address) {
    return this.request('blockchain.address.get_balance', [address])
  }
  blockchain_address_getHistory(address) {
    return this.request('blockchain.address.get_history', [address])
  }
  blockchain_address_getMempool(address) {
    return this.request('blockchain.address.get_mempool', [address])
  }
  blockchain_address_listunspent(address) {
    return this.request('blockchain.address.listunspent', [address])
  }
  blockchain_address_subscribe(address) {
    return this.request('blockchain.address.subscribe', [address])
  }
  blockchain_scripthash_getBalanceBatch(scripthash) {
    return this.requestBatch('blockchain.scripthash.get_balance', scripthash);
  }
  blockchain_scripthash_listunspentBatch(scripthash) {
    return this.requestBatch('blockchain.scripthash.listunspent', scripthash);
  }
  blockchain_scripthash_getHistoryBatch(scripthash) {
    return this.requestBatch('blockchain.scripthash.get_history', scripthash);
  }
  blockchain_transaction_getBatch(tx_hash, verbose) {
    return this.requestBatch('blockchain.transaction.get', tx_hash, verbose);
  }
  blockchain_transaction_getMerkle(tx_hash, height) {
    return this.request('blockchain.transaction.get_merkle', [tx_hash, height]);
  }
}

module.exports = ElectrumClient
