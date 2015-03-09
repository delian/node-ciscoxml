/**
 * Created by delian on 3/8/15.
 */

var net = require('net');
var debug = require('debug')('ciscoxml');
var util = require('util');
var xml2js = require('xml2js');
//var clone = require('clone');

var xmlBuilder = new xml2js.Builder({ rootName: 'Request' });
var xmlParser = xml2js.parseString;

// TODO: Error handling and state cleaning when the TCP session is disconnected

function Session(config) {
    if (!(this instanceof Session)) return new Session(config);

    var me = this;

    me.config = {
        host: '127.0.0.1',
        port: '38751',
        userPromptRegex: /(Username|Login)\:\s*/i,
        passPromptRegex: /Password\:\s*/i,
        xmlPromptRegex: /XML\>\s*/,
        authFailRegex: /Authentication Failed/i,
        username: 'guest',
        password: 'guest',
        connectErrCnt: 3,
        autoConnect: true,
        autoDisconnect: 60000
    };
    if (typeof config == 'object') util._extend(me.config,config);
    me.client = new net.Socket();
    me.connected = false;
    me.authenticated = false;
    me.buffer = "";
    me.autoDisconnectId = null;
    me.rawQueue = []; // This queue contains the tasks we like to execute - data + callback for response
    me.rawQueueBlocked = false;

    me.client.on('end',function() {
        debug('Session ended');
        me.connected = false;
        me.authenticated = false;

        // Distribute errors if we have tasks waiting
        if (me.rawQueueBlocked) {
            debug('ERROR: Remote side disconnected, but we still wait for response');
            return me.errorRawTask(new Error('Remote side disconnected'));
        }

        if (me.rawQueue.length>0) { // This should never happen
            debug('WARN: Remote side disconnected, but we have tasks waiting');
            if (me.config.autoConnect) {
                debug('WARN: autoConnect is true. Reconnect');
                me.connect();
            }
        }

    });

    return this;
}

/**
 * Connect to the remote site
 * @param config
 * @param cb
 */
Session.prototype.connect = function(config,callback) {
    var me = this;
    var cb = callback;
    if (typeof config == 'object') util._extend(me.config,config);
    if (typeof config == 'function') cb = config;
    debug('Trying to connect to %s:%s',me.config.host, me.config.port);
    me.client.on('error',function(err) {
        debug('ERROR: Connect error %s',err);
        if (typeof cb == 'function') cb(err);
        me.errorRawTask(err);
        if (me.config.connectErrCnt>0) me.config.connectErrCnt--;
    });
    if (me.config.connectErrCnt<=0) {
        debug('ERROR: We have no more right to retry!');
        if (typeof cb == 'function') return cb(new Error('No more connect retry!'));
        return;
    }
    this.client.connect(
        me.config.port,
        me.config.host,
        function() {
            debug('Connected to %s:%s',me.config.host,me.config.port);
            me.connected = true;
            me.authenticated = false;
            me.client.on('data',function(data) {
                // We receive data
                me.buffer += data;
                if (!me.authenticated) {
                    // Check for authentication
                    // Check for Login: or Username: and send the username
                    // Check for Password: and send password
                    // Check for XML and terminate the authentication
                    debug('AUTH: >>> %s',me.buffer);
                    if (me.buffer.match(me.config.xmlPromptRegex)) {
                        me.authenticated = true;
                        me.buffer = "";
                        debug('AUTH: ---- Authentication successful!');
                        me.nextRawTask(); // Lets add the next task if it is waiting
                        if (typeof cb == 'function') cb(null,me);
                        cb = null; // Avoid double call of the callback
                        return; // Successful completion
                    } else {
                        if (me.buffer.match(me.config.userPromptRegex)) {
                            me.client.write(me.config.username+'\r\n');
                            me.buffer = "";
                            debug('AUTH: <<< %s',me.config.username);
                        }
                        if (me.buffer.match(me.config.passPromptRegex)) {
                            me.client.write(me.config.password+'\r\n');
                            me.buffer = "";
                            debug('AUTH: <<< %s',me.config.password);
                        }
                        if (me.buffer.match(me.config.authFailRegex)) {
                            debug('AUTH: !!!! Authentication failed!');
                            if (typeof cb == 'function') cb(new Error('Authentication Failed'));
                            return me.client.end(); // Fail
                        }
                    }
                    return;
                }

                if (me.buffer.match(me.config.xmlPromptRegex)) {
                    me.buffer = me.buffer.replace(me.config.xmlPromptRegex,'');
                }
                // We are authenticated and we receive data. Lets filter <Response ..>...</Response> and return it back to a CB queue
                if (me.buffer.match(/\<\/Response\>/i)) {
                    debug('RESPONSE: <<< %s',me.buffer);
                    me.popNextTask(me.buffer);
                    me.buffer = me.buffer.replace(/^[\s\S]*<\/Response\>/i,''); // Remove it from the buffer
                    //debug('TRIM: buffer left to be %s', me.buffer);
                }
            });
        }
    );
};

/**
 * Disconnect from the remote site
 * @param cb
 */
Session.prototype.disconnect = function(cb) {
    if (this.config.connectErrCnt>0) this.config.connectErrCnt++; // to avoid normal decrease of the counter
    this.client.end();
    debug('SESSION disconnected');
    if (typeof cb == 'function') cb();
};

/**
 * Execute the next task if we are not waiting for response
 */
Session.prototype.nextRawTask = function() {
    var me = this;
    if (!(me.connected && me.authenticated)) {
        if (!me.config.autoConnect) return;
        debug('WARN: Next task is dispatched, but we are not yet connected. Connect...');
        return me.connect(); // Connect has automatic nextRawTask execution
    }
    if (me.rawQueueBlocked) return;
    if (me.rawQueue.length == 0) {
        // Execute autoDisconnect
        if (me.config.autoDisconnect && me.config.autoDisconnect>0) {
            if (me.autoDisconnectId) clearTimeout(me.autoDisconnectId);
            me.autoDisconnectId = setTimeout(function() {
                debug('WARN: Timeout expired with no new tasks. Autodisconnect');
                me.disconnect();
            },me.config.autoDisconnect);
            return;
        }
    }
    if (me.autoDisconnectId) clearTimeout(me.autoDisconnectId);
    me.rawQueueBlocked = true;
    var data = me.rawQueue[0].data;
    if (!data.match(/\r\n$/)) data += '\r\n';
    me.client.write(data,function() {
        debug('QUEUE: >>> data sent to device %s',data);
    });
};

/**
 * Remove the top task blocked task
 */
Session.prototype.popNextTask = function(data) {
    if (!this.rawQueueBlocked) return;
    if (typeof this.rawQueue[0].cb == 'function') this.rawQueue[0].cb(null,data);
    this.rawQueue.shift();
    this.rawQueueBlocked = false;
    this.nextRawTask();
};

/**
 * Sends raw data and expects callback
 * @param data
 * @param cb
 */
Session.prototype.sendRaw = function(data,cb) {
    debug('QUEUE: New task has been add with %s',data);
    this.rawQueue.push({ data: data, cb: cb });
    this.nextRawTask();
};

/**
 * Discard all of the tasks in the raw queue
 */
Session.prototype.discardRawQueue = function() {
    if (this.rawQueue.length>0) debug('DISCARD %d raw tasks!',this.rawQueue.length);
    this.rawQueue = [];
    this.rawQueueBlocked = false;
};

/**
 * Executes error to all waiting tasks in the raw queue
 * @param err
 */
Session.prototype.errorRawTask = function(err) {
    if (this.rawQueue.length>0) debug('Notify with error %d raw tasks!',this.rawQueue.length);
    this.rawQueue.forEach(function(q) {
        if (typeof q.cb == 'function') q.cb(err);
    });
    this.discardRawQueue();
};

// ------ XML ------

Session.prototype.sendRawXml = function(data,cb) {
    if (typeof data != 'object') {
        debug('ERROR: We received request not in the right format! %s',data);
        return cb(new Error('Incorrect data'));
    }
    if (typeof data['$'] == 'undefined') data['$'] = { MajorVersion: '1', MinorVersion: '0' };
    return this.sendRaw(xmlBuilder.buildObject(data),function (err,data) {
        if (err) return cb(err,data);
        xmlParser(data,cb); // Now we could inherit the error from the XML parsing
    });
};

// ------ Global Commands ------

Session.prototype.rootGetDataSpaceInfo = function(cb) {
    this.sendRawXml({ GetDataSpaceInfo: '' },cb);
};

module.exports = Session;
