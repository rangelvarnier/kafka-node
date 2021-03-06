'use strict';

const uuid = require('uuid');
const createTopic = require('../docker/createTopic');
const sendMessage = require('./helpers/sendMessage');
const async = require('async');
const _ = require('lodash');
const sinon = require('sinon');

const ConsumerGroupStream = require('../lib/consumerGroupStream');

function createConsumerGroupStream (topic, overrides) {
  const consumerOptions = _.defaultsDeep(overrides || {}, {
    kafkaHost: '127.0.0.1:9092',
    groupId: 'ExampleTestGroup',
    sessionTimeout: 15000,
    protocol: ['roundrobin'],
    asyncPush: false,
    id: 'consumer1',
    autoCommit: false,
    fromOffset: 'earliest'
  });
  return new ConsumerGroupStream(consumerOptions, topic);
}

describe('ConsumerGroupStream', function () {
  let topic, groupId;

  beforeEach(function () {
    topic = uuid.v4();
    groupId = uuid.v4();
    return createTopic(topic, 1, 1);
  });

  describe('Auto Commit', function () {
    it('should resume at the next offset after new stream starts', function (done) {
      let messages;
      let consumerGroupStream;
      let lastReadOffset;
      async.series(
        [
          function (callback) {
            messages = _.times(3, uuid.v4);
            sendMessage(messages, topic, callback);
          },

          function (callback) {
            const messagesToRead = _.clone(messages);
            consumerGroupStream = createConsumerGroupStream(topic, { autoCommit: true, groupId: groupId });
            consumerGroupStream.on('data', function (message) {
              _.pull(messagesToRead, message.value, message.offset);
              if (messagesToRead.length === 0) {
                lastReadOffset = message.offset;
                callback(null);
              }
            });
          },

          function (callback) {
            setImmediate(function () {
              consumerGroupStream.close(callback);
              consumerGroupStream = null;
            });
          },

          function (callback) {
            setTimeout(callback, 100);
          },

          function (callback) {
            sendMessage([uuid.v4()], topic, callback);
          },

          function (callback) {
            consumerGroupStream = createConsumerGroupStream(topic, { autoCommit: true, groupId: groupId });
            consumerGroupStream.on('readable', function () {
              const message = consumerGroupStream.read();
              message.offset.should.be.equal(lastReadOffset + 1);
              consumerGroupStream.close(callback);
            });
          }
        ],
        done
      );
    });
  });

  describe('#close', function () {
    it('should not call consumerGroup with force option', function (done) {
      const consumerGroupStream = createConsumerGroupStream(topic);

      const closeSpy = sinon.spy(consumerGroupStream.consumerGroup, 'close');

      consumerGroupStream.close(function () {
        sinon.assert.calledOnce(closeSpy);
        sinon.assert.calledWithExactly(closeSpy, false, sinon.match.func);
        done();
      });
    });

    it('autoCommit false should close the consumer without committing offsets', function (done) {
      const messages = _.times(3, uuid.v4);
      let consumerGroupStream;

      async.series(
        [
          function (callback) {
            sendMessage(messages, topic, callback);
          },
          function (callback) {
            const messagesToRead = _.clone(messages);
            consumerGroupStream = createConsumerGroupStream(topic, { groupId: groupId });
            consumerGroupStream.on('data', function (message) {
              _.pull(messagesToRead, message.value);
              if (messagesToRead.length === 0) {
                callback(null);
              }
            });
          },
          function (callback) {
            consumerGroupStream.close(callback);
          },
          function (callback) {
            const messagesToRead = _.clone(messages);
            consumerGroupStream = createConsumerGroupStream(topic, { groupId: groupId });
            consumerGroupStream.on('data', function (message) {
              _.pull(messagesToRead, message.value);
              if (messagesToRead.length === 0) {
                callback(null);
              }
            });
          },
          function (callback) {
            consumerGroupStream.close(callback);
          }
        ],
        done
      );
    });
  });
});
