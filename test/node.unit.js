'use strict';

var should = require('chai').should();
var sinon = require('sinon');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var bitcore = require('bitcore');
var Networks = bitcore.Networks;
var blockData = require('./data/livenet-345003.json');
var Block = require('../lib/block');
var proxyquire = require('proxyquire');
var chainlib = require('chainlib');
var OriginalNode = chainlib.Node;
var fs = require('fs');
var bitcoinConfBuffer = fs.readFileSync('./test/data/bitcoin.conf');

var BaseNode = function() {};
util.inherits(BaseNode, EventEmitter);
BaseNode.log = chainlib.log;
BaseNode.prototype._loadConfiguration = sinon.spy();
BaseNode.prototype._initialize = sinon.spy();
chainlib.Node = BaseNode;

var Node = proxyquire('../lib/node', {
  chainlib: chainlib,
  fs: {
    readFileSync: sinon.stub().returns(bitcoinConfBuffer)
  }
});
chainlib.Node = OriginalNode;

describe('Bitcoind Node', function() {
  describe('#_loadConfiguration', function() {
    it('should call the necessary methods', function() {
      var node = new Node({});
      node._loadBitcoinConf = sinon.spy();
      node._loadBitcoind = sinon.spy();
      node._loadConfiguration({});
      node._loadBitcoind.called.should.equal(true);
      node._loadBitcoinConf.called.should.equal(true);
      BaseNode.prototype._loadConfiguration.called.should.equal(true);
    });
  });
  describe('#_loadBitcoinConf', function() {
    it('will parse a bitcoin.conf file', function() {
      var node = new Node({});
      node._loadBitcoinConf({datadir: '~/.bitcoin'});
      should.exist(node.bitcoinConfiguration);
      node.bitcoinConfiguration.should.deep.equal({
        server: 1,
        whitelist: '127.0.0.1',
        txindex: 1,
        port: 20000,
        rpcallowip: '127.0.0.1',
        rpcuser: 'bitcoin',
        rpcpassword: 'local321'
      });
    });
  });
  describe('#_loadBitcoind', function() {
    it('should initialize', function() {
      var node = new Node({});
      node._loadBitcoind({datadir: './test'});
      should.exist(node.bitcoind);
    });
    it('should initialize with testnet', function() {
      var node = new Node({});
      node._loadBitcoind({datadir: './test', testnet: true});
      should.exist(node.bitcoind);
    });
  });
  describe('#_syncBitcoind', function() {
    it('will get and add block up to the tip height', function(done) {
      var node = new Node({});
      node.Block = Block;
      node.bitcoindHeight = 1;
      var blockBuffer = new Buffer(blockData);
      var block = Block.fromBuffer(blockBuffer);
      node.bitcoind = {
        getBlock: sinon.stub().callsArgWith(1, null, blockBuffer)
      };
      node.chain = {
        tip: {
          __height: 0,
          hash: block.prevHash
        },
        saveMetadata: sinon.stub(),
        emit: sinon.stub()
      };
      node.db = {
        _onChainAddBlock: function(block, callback) {
          node.chain.tip.__height += 1;
          callback();
        }
      };
      node.on('synced', function() {
        done();
      });
      node._syncBitcoind();
    });
    it('will exit and emit error with error from bitcoind.getBlock', function(done) {
      var node = new Node({});
      node.bitcoindHeight = 1;
      node.bitcoind = {
        getBlock: sinon.stub().callsArgWith(1, new Error('test error'))
      };
      node.chain = {
        tip: {
          __height: 0
        }
      };
      node.on('error', function(err) {
        err.message.should.equal('test error');
        done();
      });
      node._syncBitcoind();
    });
  });
  describe('#_loadNetwork', function() {
    it('should use the testnet network if testnet is specified', function() {
      var config = {
        network: 'testnet'
      };
      var node = new Node(config);
      node._loadNetwork(config);
      node.network.name.should.equal('testnet');
    });
    it('should use the regtest network if regtest is specified', function() {
      var config = {
        network: 'regtest'
      };
      var node = new Node(config);
      node._loadNetwork(config);
      node.network.name.should.equal('regtest');
    });
    it('should use the livenet network if nothing is specified', function() {
      var config = {};
      var node = new Node(config);
      node._loadNetwork(config);
      node.network.name.should.equal('livenet');
    });
  });
  describe('#_loadDB', function() {
    it('should load the db', function() {
      var DB = function(config) {
        config.path.should.equal(process.env.HOME + '/.bitcoin/bitcoindjs.db');
      };
      var config = {
        DB: DB,
        datadir: '~/.bitcoin'
      };

      var node = new Node(config);
      node.network = Networks.livenet;
      node._loadDB(config);
      node.db.should.be.instanceof(DB);
    });
    it('should load the db for testnet', function() {
      var DB = function(config) {
        config.path.should.equal(process.env.HOME + '/.bitcoin/testnet3/bitcoindjs.db');
      };
      var config = {
        DB: DB,
        datadir: '~/.bitcoin'
      };

      var node = new Node(config);
      node.network = Networks.testnet;
      node._loadDB(config);
      node.db.should.be.instanceof(DB);
    });
    it('error with unknown network', function() {
      var config = {
        datadir: '~/.bitcoin'
      };

      var node = new Node(config);
      node.network = 'not a network';
      (function() {
        node._loadDB(config);
      }).should.throw('Unknown network');
    });
    it('should load the db with regtest', function() {
      var DB = function(config) {
        config.path.should.equal(process.env.HOME + '/.bitcoin/regtest/bitcoindjs.db');
      };
      var config = {
        DB: DB,
        datadir: '~/.bitcoin'
      };

      var node = new Node(config);
      // Switch to use regtest
      Networks.remove(Networks.testnet);
      Networks.add({
        name: 'regtest',
        alias: 'regtest',
        pubkeyhash: 0x6f,
        privatekey: 0xef,
        scripthash: 0xc4,
        xpubkey: 0x043587cf,
        xprivkey: 0x04358394,
        networkMagic: 0xfabfb5da,
        port: 18444,
        dnsSeeds: [ ]
      });
      var regtest = Networks.get('regtest');
      node.network = regtest;
      node._loadDB(config);
      node.db.should.be.instanceof(DB);
      Networks.remove(regtest);
      // Add testnet back
      Networks.add({
        name: 'testnet',
        alias: 'testnet',
        pubkeyhash: 0x6f,
        privatekey: 0xef,
        scripthash: 0xc4,
        xpubkey: 0x043587cf,
        xprivkey: 0x04358394,
        networkMagic: 0x0b110907,
        port: 18333,
        dnsSeeds: [
          'testnet-seed.bitcoin.petertodd.org',
          'testnet-seed.bluematt.me',
          'testnet-seed.alexykot.me',
          'testnet-seed.bitcoin.schildbach.de'
        ]
      });
    });
  });
  describe('#_loadConsensus', function() {
    var node = new Node({});

    it('should use the genesis specified in the config', function() {
      var config = {
        genesis: '0100000043497fd7f826957108f4a30fd9cec3aeba79972084e90ead01ea330900000000bac8b0fa927c0ac8234287e33c5f74d38d354820e24756ad709d7038fc5f31f020e7494dffff001d03e4b6720101000000010000000000000000000000000000000000000000000000000000000000000000ffffffff0e0420e7494d017f062f503253482fffffffff0100f2052a010000002321021aeaf2f8638a129a3156fbe7e5ef635226b0bafd495ff03afe2c843d7e3a4b51ac00000000'
      };
      node._loadConsensus(config);
      should.exist(node.chain);
      node.chain.genesis.hash.should.equal('00000000b873e79784647a6c82962c70d228557d24a747ea4d1b8bbe878e1206');
    });
    it('should use the testnet genesis if testnet is specified', function() {
      var config = {
        network: 'testnet'
      };
      node._loadConsensus(config);
      should.exist(node.chain);
      node.chain.genesis.hash.should.equal('000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943');
    });
    it('should use the livenet genesis if nothing is specified', function() {
      var config = {};
      node._loadConsensus(config);
      should.exist(node.chain);
      node.chain.genesis.hash.should.equal('000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f');
    });
  });

  describe('#_initializeBitcoind', function() {
    it('will call db.initialize() on ready event', function(done) {
      var node = new Node({});
      node.bitcoind = new EventEmitter();
      node.bitcoind.getInfo = sinon.stub().returns({blocks: 10});
      node.db = {
        initialize: sinon.spy()
      };
      sinon.stub(chainlib.log, 'info');
      node.bitcoind.on('ready', function() {
        setImmediate(function() {
          chainlib.log.info.callCount.should.equal(1);
          chainlib.log.info.restore();
          node.db.initialize.callCount.should.equal(1);
          node.bitcoindHeight.should.equal(10);
          done();
        });
      });
      node._initializeBitcoind();
      node.bitcoind.emit('ready');
    });
    it('will call emit an error from bitcoind.js', function(done) {
      var node = new Node({});
      node.bitcoind = new EventEmitter();
      node.on('error', function(err) {
        should.exist(err);
        err.message.should.equal('test error');
        done();
      });
      node._initializeBitcoind();
      node.bitcoind.emit('error', new Error('test error'));
    });
  });

  describe('#_initializeDatabase', function() {
    it('will call chain.initialize() on ready event', function(done) {
      var node = new Node({});
      node.db = new EventEmitter();
      node.chain = {
        initialize: sinon.spy()
      };
      sinon.stub(chainlib.log, 'info');
      node.db.on('ready', function() {
        setImmediate(function() {
          chainlib.log.info.callCount.should.equal(1);
          chainlib.log.info.restore();
          node.chain.initialize.callCount.should.equal(1);
          done();
        });
      });
      node._initializeDatabase();
      node.db.emit('ready');
    });
    it('will call emit an error from db', function(done) {
      var node = new Node({});
      node.db = new EventEmitter();
      node.on('error', function(err) {
        should.exist(err);
        err.message.should.equal('test error');
        done();
      });
      node._initializeDatabase();
      node.db.emit('error', new Error('test error'));
    });
  });

  describe('#_initializeChain', function() {
    it('will call emit an error from chain', function(done) {
      var node = new Node({});
      node.chain = new EventEmitter();
      node.on('error', function(err) {
        should.exist(err);
        err.message.should.equal('test error');
        done();
      });
      node._initializeChain();
      node.chain.emit('error', new Error('test error'));
    });
  });

  describe('#_initialize', function() {

    it('should initialize', function(done) {
      var node = new Node({});
      node.chain = {};
      node.Block = 'Block';
      node.bitcoind = 'bitcoind';
      node.db = {};

      node._initializeBitcoind = sinon.spy();
      node._initializeDatabase = sinon.spy();
      node._initializeChain = sinon.spy();
      node._initialize();

      // references
      node.db.chain.should.equal(node.chain);
      node.db.Block.should.equal(node.Block);
      node.db.bitcoind.should.equal(node.bitcoind);
      node.chain.db.should.equal(node.db);
      node.chain.db.should.equal(node.db);

      // events
      node._initializeBitcoind.callCount.should.equal(1);
      node._initializeDatabase.callCount.should.equal(1);
      node._initializeChain.callCount.should.equal(1);

      // start syncing
      node.setSyncStrategy = sinon.spy();
      node.on('ready', function() {
        done();
      });
      node.emit('ready');

    });

  });
});
